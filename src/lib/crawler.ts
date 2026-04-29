import { chromium, Page, Browser } from "playwright";
import slugify from "slugify";
import { connectDB } from "@/lib/mongodb";
import { uploadImageBuffer } from "@/lib/cloudinary";
import { Manga, Chapter, IManga } from "@/models";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrawlProgress {
  mangaUrl: string;
  stage: "manga-info" | "chapters" | "images" | "done" | "error";
  message: string;
  progress: number; // 0-100
  chaptersDone?: number;
  chaptersTotal?: number;
  imagesDone?: number;
  imagesTotal?: number;
  error?: string;
}

export type ProgressCallback = (progress: CrawlProgress) => void;

export interface CrawlOptions {
  signal?: AbortSignal;
  skipExistingImages?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSlug(title: string): string {
  return slugify(title, { lower: true, strict: true, locale: "vi" });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Crawl aborted");
  }
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Crawl aborted"));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new Error("Crawl aborted"));
      },
      { once: true },
    );
  });
}

async function fetchImageBuffer(
  page: Page,
  url: string,
  retries = 3,
  signal?: AbortSignal,
): Promise<Buffer> {
  const cleanedUrl = url.trim();
  return await withRetry(async () => {
    throwIfAborted(signal);
    const res = await page.request.get(cleanedUrl);
    if (!res.ok()) {
      throw new Error(`Failed to fetch image (${res.status()}): ${cleanedUrl}`);
    }
    return Buffer.from(await res.body());
  }, retries);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000,
  signal?: AbortSignal,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      throwIfAborted(signal);
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await delay(delayMs * (i + 1), signal);
    }
  }
  throw new Error("Unreachable");
}

// ─── Manga Info Scraper ───────────────────────────────────────────────────────

async function scrapeMangaInfo(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page
    .waitForSelector("h1, .manga-title, .story-detail", { timeout: 15000 })
    .catch(() => {});

  const info = await page.evaluate(() => {
    const getText = (sel: string) =>
      (document.querySelector(sel) as HTMLElement)?.innerText?.trim() ?? "";

    const getAttr = (sel: string, attr: string) =>
      (document.querySelector(sel) as HTMLElement)?.getAttribute(attr) ?? "";

    // Title
    const title = getText("h1.text-xl") || getText("main h1") || document.title;

    // Cover image
    const coverImg = getAttr(".cover-frame img", "src");

    // Description
    const description =
      getText(".detail-content p") ||
      getText("#story_detail .detail-content") ||
      getText(".story-detail .detail-content") ||
      getText(".description") ||
      "";

    // Tags/Genres
    const tagEls = document.querySelectorAll(
      '.kind a, .genre a, [class*="genre"] a, .detail-info a[href*="the-loai"]',
    );
    const tags = Array.from(document.querySelectorAll("#genres-list a")).map(
      (el) => el.textContent.trim().toLowerCase(),
    );
    // Author / Artist
    const author =
      getText(".author a") ||
      getText('[class*="author"] a') ||
      getText(".info-detail li:nth-child(2) a") ||
      "";
    const artist = getText(".artist a") || "";

    // Status
    const status =
      getText(".status span.col-xs-8") ||
      getText('[class*="status"] .col-xs-8') ||
      getText(".detail-info .status") ||
      "";

    // Alternative titles
    const altTitle =
      getText(".othername") || getText('[class*="other"] .col-xs-8') || "";
    const altTitles = altTitle ? [altTitle] : [];

    // Chapter list — collect all chapter links
    const chapterLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>("#chapterList a"),
    ).map((a) => a.href.trim());

    return {
      title,
      coverImg,
      description,
      tags,
      author,
      artist,
      status,
      altTitles,
      chapterLinks,
    };
  });

  return info;
}

// ─── Chapter Scraper ──────────────────────────────────────────────────────────

async function scrapeChapterImages(
  page: Page,
  chapterUrl: string,
): Promise<string[]> {
  await page.goto(chapterUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Wait for images
  await page
    .waitForSelector(
      '#nt_chap_detail img, .reading-detail img, [class*="chapter"] img, .chapter-content img',
      { timeout: 15000 },
    )
    .catch(() => {});

  // Scroll to lazy-load images
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  await delay(1000);

  const images = await page.evaluate(() => {
    // Prefer a chapter container so we include BOTH eager `src` images (page 1/2)
    // and lazy `data-src` images (page 3+).
    const containerSelectors = [
      "#chapter-content",
      "#nt_chap_detail",
      ".reading-detail",
      ".chapter-content",
      '[class*="chapter"]',
    ];

    let container: Element | null = null;
    for (const sel of containerSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        container = el;
        break;
      }
    }

    const root: ParentNode = (container ?? document) as ParentNode;
    const imgs = Array.from(root.querySelectorAll("img")) as HTMLImageElement[];

    const items = imgs
      .map((img) => {
        const raw =
          img.getAttribute("data-src") || img.getAttribute("src") || "";
        const url = raw.trim();
        const indexAttr = img.getAttribute("data-index");
        const index = indexAttr ? Number(indexAttr) : Number.NaN;
        return { url, index };
      })
      .filter(
        (x) => x.url && !x.url.startsWith("data:") && x.url.startsWith("http"),
      );

    // Keep stable page order using data-index when available.
    const hasIndexes = items.some((x) => Number.isFinite(x.index));
    if (hasIndexes) {
      items.sort((a, b) => {
        const ai = Number.isFinite(a.index) ? a.index : Number.MAX_SAFE_INTEGER;
        const bi = Number.isFinite(b.index) ? b.index : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }

    // Deduplicate while preserving order.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of items) {
      if (!seen.has(it.url)) {
        seen.add(it.url);
        out.push(it.url);
      }
    }
    return out;
  });

  return images;
}

// ─── Parse Chapter Number ────────────────────────────────────────────────────

function parseChapterNumber(url: string, title?: string): number {
  // Try URL pattern: /chapter-123 or -chuong-12 or /c12
  const urlMatch =
    url.match(/chapter[_-]?(\d+(?:\.\d+)?)/i) ||
    url.match(/chuong[_-]?(\d+(?:\.\d+)?)/i) ||
    url.match(/[/-]c(\d+(?:\.\d+)?)/i);
  if (urlMatch) return parseFloat(urlMatch[1]);

  if (title) {
    const titleMatch =
      title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
      title.match(/(\d+(?:\.\d+)?)/);
    if (titleMatch) return parseFloat(titleMatch[1]);
  }
  return 0;
}

// ─── Main Crawler ────────────────────────────────────────────────────────────

export async function crawlManga(
  mangaUrl: string,
  onProgress?: ProgressCallback,
  opts: CrawlOptions = {},
): Promise<void> {
  await connectDB();
  throwIfAborted(opts.signal);

  const emit = (p: Omit<CrawlProgress, "mangaUrl">) =>
    onProgress?.({ mangaUrl, ...p });

  emit({ stage: "manga-info", message: "Launching browser…", progress: 0 });

  const browser: Browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    const page = await context.newPage();

    // ── 1. Scrape manga info ──────────────────────────────────────────────────
    emit({ stage: "manga-info", message: "Scraping manga info…", progress: 5 });

    const info = await withRetry(
      () => scrapeMangaInfo(page, mangaUrl),
      3,
      1000,
      opts.signal,
    );
    const slug = makeSlug(info.title) || mangaUrl.split("/").pop() || "unknown";

    emit({
      stage: "manga-info",
      message: `Found: ${info.title} (${info.chapterLinks.length} chapters)`,
      progress: 10,
    });

    // ── 2. Upload cover ───────────────────────────────────────────────────────
    let coverCloudinaryUrl = "";
    if (info.coverImg) {
      try {
        const coverBuffer = await fetchImageBuffer(
          page,
          info.coverImg,
          3,
          opts.signal,
        );
        coverCloudinaryUrl = await uploadImageBuffer(
          coverBuffer,
          `covers`,
          `${slug}-cover`,
        );
      } catch (e) {
        console.error("Cover upload failed:", e);
        coverCloudinaryUrl = info.coverImg;
      }
    }

    // ── 3. Save/update manga doc ──────────────────────────────────────────────
    const manga = (await Manga.findOneAndUpdate(
      { slug },
      {
        $set: {
          title: info.title,
          alternativeTitles: info.altTitles,
          sourceUrl: mangaUrl,
          coverUrl: info.coverImg,
          coverCloudinaryUrl,
          description: info.description,
          tags: info.tags,
          author: info.author,
          artist: info.artist,
          status: info.status,
          totalChapters: info.chapterLinks.length,
          chapterUrls: info.chapterLinks,
          crawlStatus: "crawling",
          lastCrawledAt: new Date(),
        },
      },
      { upsert: true, new: true },
    )) as IManga;

    // ── 4. Crawl chapters ─────────────────────────────────────────────────────
    const chapterUrls = info.chapterLinks;
    const total = chapterUrls.length;

    emit({
      stage: "chapters",
      message: `Crawling ${total} chapters…`,
      progress: 15,
      chaptersTotal: total,
      chaptersDone: 0,
    });

    for (let i = 0; i < chapterUrls.length; i++) {
      throwIfAborted(opts.signal);
      const chapterUrl = chapterUrls[i];
      const chapterNum = parseChapterNumber(chapterUrl);

      // Check if already done
      const existing = await Chapter.findOne({
        mangaId: manga._id,
        chapterNumber: chapterNum,
      });
      if (existing?.status === "done" && opts.skipExistingImages) {
        emit({
          stage: "chapters",
          message: `Skipping chapter ${chapterNum} (already done)`,
          progress: 15 + Math.round((i / total) * 75),
          chaptersDone: i + 1,
          chaptersTotal: total,
        });
        continue;
      }

      // Create/update chapter doc
      const chapter = await Chapter.findOneAndUpdate(
        { mangaId: manga._id, chapterNumber: chapterNum },
        {
          $set: {
            mangaSlug: slug,
            sourceUrl: chapterUrl,
            status: "crawling",
          },
        },
        { upsert: true, new: true },
      );

      try {
        emit({
          stage: "chapters",
          message: `Scraping chapter ${chapterNum}…`,
          progress: 15 + Math.round((i / total) * 75),
          chaptersDone: i,
          chaptersTotal: total,
        });

        const images = await withRetry(
          () => scrapeChapterImages(page, chapterUrl),
          3,
          1000,
          opts.signal,
        );

        // Upload images to Cloudinary
        const pages = [];
        for (let j = 0; j < images.length; j++) {
          throwIfAborted(opts.signal);
          const imgUrl = images[j].trim();
          const publicId = `${slug}-ch${chapterNum}-p${j + 1}`;

          let cloudinaryUrl = imgUrl;
          try {
            const buffer = await fetchImageBuffer(page, imgUrl, 3, opts.signal);
            cloudinaryUrl = await uploadImageBuffer(
              buffer,
              `${slug}/ch${chapterNum}`,
              publicId,
            );
          } catch (e) {
            console.error(
              `Image upload failed (ch${chapterNum} p${j + 1}):`,
              e,
            );
          }

          pages.push({ index: j + 1, originalUrl: imgUrl, cloudinaryUrl });

          if (j % 5 === 0) {
            emit({
              stage: "images",
              message: `Chapter ${chapterNum}: uploading image ${j + 1}/${images.length}`,
              progress: 15 + Math.round((i / total) * 75),
              chaptersDone: i,
              chaptersTotal: total,
              imagesDone: j + 1,
              imagesTotal: images.length,
            });
          }

          await delay(200, opts.signal); // rate limit
        }

        await Chapter.findByIdAndUpdate(chapter._id, {
          $set: {
            pages,
            pageCount: pages.length,
            status: "done",
            crawledAt: new Date(),
          },
        });

        emit({
          stage: "chapters",
          message: `Chapter ${chapterNum} done (${images.length} pages)`,
          progress: 15 + Math.round(((i + 1) / total) * 75),
          chaptersDone: i + 1,
          chaptersTotal: total,
        });
      } catch (err: any) {
        await Chapter.findByIdAndUpdate(chapter._id, {
          $set: { status: "error", error: err.message },
        });
        console.error(`Chapter ${chapterNum} failed:`, err.message);
      }

      await delay(500, opts.signal); // polite crawl delay
    }

    // ── 5. Finalize ───────────────────────────────────────────────────────────
    await Manga.findByIdAndUpdate(manga._id, {
      $set: { crawlStatus: "done", lastCrawledAt: new Date() },
    });

    emit({ stage: "done", message: "Crawl complete!", progress: 100 });
  } catch (err: any) {
    emit({
      stage: "error",
      message: err.message,
      progress: 0,
      error: err.message,
    });
    throw err;
  } finally {
    await browser.close();
  }
}

// ─── Batch Crawl ─────────────────────────────────────────────────────────────

export async function crawlMany(
  urls: string[],
  onProgress?: ProgressCallback,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  for (const url of urls) {
    try {
      await crawlManga(url, onProgress, {
        skipExistingImages: true,
        signal: opts.signal,
      });
    } catch (err: any) {
      console.error(`Failed to crawl ${url}:`, err.message);
      onProgress?.({
        mangaUrl: url,
        stage: "error",
        message: err.message,
        progress: 0,
        error: err.message,
      });
    }
  }
}
