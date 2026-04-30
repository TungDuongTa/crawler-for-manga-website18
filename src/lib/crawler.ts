import { chromium, type Page, type BrowserContext } from "playwright";
import slugify from "slugify";
import fs from "fs";
import path from "path";
import { connectDB } from "@/lib/mongodb";
import { uploadImageBuffer } from "@/lib/cloudinary";
import { Manga, Chapter, IManga } from "@/models";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrawlProgress {
  mangaUrl: string;
  stage: "manga-info" | "chapters" | "images" | "done" | "error";
  message: string;
  progress: number;
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

// ─── Runtime config ───────────────────────────────────────────────────────────
//
// Why this version exists:
// - Your Cloudflare page says "Incompatible browser extension or network configuration".
// - challenges.cloudflare.com works for you in a normal browser.
// - So this version avoids puppeteer-extra-plugin-stealth and avoids aggressive
//   automation flags that can make Cloudflare dislike the browser.
// - It can use a persistent Playwright profile, which is usually more reliable
//   than transferring FlareSolverr cookies into a brand-new browser context.
//
// Recommended .env.local while debugging:
//   FLARESOLVERR_URL=http://localhost:8191/v1
//   CRAWLER_HEADLESS=false
//   CRAWLER_USE_PERSISTENT_PROFILE=true
//
// Optional:
//   PROXY_SERVER=http://host:port
//   PROXY_USER=username
//   PROXY_PASS=password

const FLARE_URL = process.env.FLARESOLVERR_URL ?? "http://localhost:8191/v1";
const HEADLESS = process.env.CRAWLER_HEADLESS === "true";
const USE_PERSISTENT_PROFILE =
  process.env.CRAWLER_USE_PERSISTENT_PROFILE !== "false";

const PROFILE_DIR = path.join(process.cwd(), ".browser-profile-damconuong");
const COOKIE_FILE = path.join(process.cwd(), ".cf_cookies_damconuong.json");
const UA_FILE = path.join(process.cwd(), ".cf_user_agent_damconuong.txt");

const DEBUG_HTML = path.join(process.cwd(), "cloudflare-blocked.html");
const DEBUG_PNG = path.join(process.cwd(), "cloudflare-blocked.png");

// ─── FlareSolverr ─────────────────────────────────────────────────────────────

interface FlareCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

interface FlareSolution {
  url: string;
  status: number;
  cookies: FlareCookie[];
  userAgent: string;
  response: string;
}

async function solveWithFlare(
  url: string,
  signal?: AbortSignal,
): Promise<FlareSolution> {
  const controller = new AbortController();
  signal?.addEventListener("abort", () => controller.abort(), { once: true });

  const proxy =
    process.env.PROXY_SERVER && process.env.PROXY_USER && process.env.PROXY_PASS
      ? {
          url: process.env.PROXY_SERVER,
          username: process.env.PROXY_USER,
          password: process.env.PROXY_PASS,
        }
      : process.env.PROXY_SERVER
        ? { url: process.env.PROXY_SERVER }
        : undefined;

  const res = await fetch(FLARE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({
      cmd: "request.get",
      url,
      maxTimeout: 60000,
      ...(proxy ? { proxy } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `FlareSolverr HTTP ${res.status} at ${FLARE_URL}. Body: ${text.slice(0, 500)}`,
    );
  }

  const data = await res.json();

  if (data.status !== "ok") {
    throw new Error(
      `FlareSolverr failed: ${data.message ?? JSON.stringify(data).slice(0, 500)}`,
    );
  }

  const solution = data.solution as FlareSolution;

  console.log("[flare] status:", solution.status);
  console.log("[flare] url:", solution.url);
  console.log("[flare] ua:", solution.userAgent);
  console.log(
    "[flare] cookies:",
    solution.cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
    })),
  );

  const hasClearance = solution.cookies.some((c) => c.name === "cf_clearance");
  if (!hasClearance) {
    throw new Error("[flare] solved response did not include cf_clearance");
  }

  return solution;
}

async function injectFlareCookies(
  ctx: BrowserContext,
  cookies: FlareCookie[],
): Promise<void> {
  const mapped = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain.startsWith(".") ? c.domain : c.domain,
    path: c.path || "/",
    expires: c.expires ?? -1,
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? true,
    sameSite: (c.sameSite as "Strict" | "Lax" | "None") ?? "Lax",
  }));

  await ctx.addCookies(mapped);

  const after = await ctx.cookies("https://damconuong.lol");
  console.log(
    "[cookies] after inject:",
    after.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
    })),
  );
}

async function saveCookies(ctx: BrowserContext): Promise<void> {
  try {
    const cookies = await ctx.cookies("https://damconuong.lol");
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    console.log(`[cookies] saved ${cookies.length} cookies to ${COOKIE_FILE}`);
  } catch (err) {
    console.warn("[cookies] save failed:", (err as Error).message);
  }
}

async function loadCookies(ctx: BrowserContext): Promise<void> {
  if (!fs.existsSync(COOKIE_FILE)) return;

  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf-8"));
    await ctx.addCookies(cookies);
    console.log(
      `[cookies] loaded ${cookies.length} cookies from ${COOKIE_FILE}`,
    );
  } catch (err) {
    console.warn(
      "[cookies] load failed; deleting stale file:",
      (err as Error).message,
    );
    try {
      fs.unlinkSync(COOKIE_FILE);
    } catch {}
  }
}

function saveUserAgent(ua: string): void {
  try {
    fs.writeFileSync(UA_FILE, ua, "utf-8");
  } catch {}
}

function loadUserAgent(): string | null {
  try {
    if (!fs.existsSync(UA_FILE)) return null;
    return fs.readFileSync(UA_FILE, "utf-8").trim() || null;
  } catch {
    return null;
  }
}

// ─── General helpers ──────────────────────────────────────────────────────────

function makeSlug(title: string): string {
  return slugify(title, { lower: true, strict: true, locale: "vi" });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("Crawl aborted");
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
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

function jitter(base: number, spread: number): number {
  return base + Math.random() * spread;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000,
  signal?: AbortSignal,
): Promise<T> {
  let lastErr: unknown;

  for (let i = 0; i < retries; i++) {
    try {
      throwIfAborted(signal);
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === retries - 1) break;
      await delay(delayMs * (i + 1), signal);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function isCloudflareBlocked(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => "");
  const html = await page.content().catch(() => "");

  return (
    /just a moment/i.test(title) ||
    /attention required/i.test(title) ||
    /performing security verification/i.test(html) ||
    /incompatible browser extension or network configuration/i.test(html) ||
    /challenge-platform|turnstile|cf-chl|cf_clearance|__cf_chl/i.test(html)
  );
}

async function assertNotCloudflareBlocked(
  page: Page,
  url: string,
): Promise<void> {
  if (!(await isCloudflareBlocked(page))) return;

  try {
    fs.writeFileSync(DEBUG_HTML, await page.content());
    await page.screenshot({ path: DEBUG_PNG, fullPage: true });
  } catch {}

  throw new Error(
    `Cloudflare challenge/block page detected after navigation: ${url}. ` +
      `Check ${DEBUG_HTML} and ${DEBUG_PNG}.`,
  );
}

async function waitForRealPage(page: Page, url: string, signal?: AbortSignal) {
  // Give Cloudflare JS a little time. If the challenge can complete naturally,
  // it usually redirects within this period.
  for (let i = 0; i < 20; i++) {
    throwIfAborted(signal);
    if (!(await isCloudflareBlocked(page))) return;
    await delay(1000, signal);
  }

  await assertNotCloudflareBlocked(page, url);
}

async function humanBehaviour(page: Page, signal?: AbortSignal): Promise<void> {
  await delay(jitter(500, 1000), signal);
  await page.mouse.move(100 + Math.random() * 400, 100 + Math.random() * 300, {
    steps: 20,
  });
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let pos = 0;
      const id = setInterval(
        () => {
          window.scrollBy(0, 80);
          pos += 80;
          if (pos >= 500) {
            clearInterval(id);
            resolve();
          }
        },
        80 + Math.random() * 40,
      );
    });
  });
  await delay(jitter(300, 700), signal);
}

async function navigateSafe(
  page: Page,
  url: string,
  signal?: AbortSignal,
): Promise<void> {
  console.log("[nav] goto:", url);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("[nav] title:", await page.title().catch(() => ""));
  console.log("[nav] final url:", page.url());

  await waitForRealPage(page, url, signal);
  await humanBehaviour(page, signal);
  await assertNotCloudflareBlocked(page, url);
}

async function fetchImageBuffer(
  page: Page,
  url: string,
  retries = 3,
  signal?: AbortSignal,
): Promise<Buffer> {
  return withRetry(
    async () => {
      throwIfAborted(signal);

      const res = await page.request.get(url.trim(), {
        headers: {
          Referer: page.url(),
          "User-Agent": await page.evaluate(() => navigator.userAgent),
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        timeout: 60000,
      });

      if (!res.ok()) {
        throw new Error(`Failed to fetch image (${res.status()}): ${url}`);
      }

      return Buffer.from(await res.body());
    },
    retries,
    1500,
    signal,
  );
}

// ─── Browser/session creation ─────────────────────────────────────────────────

async function createCrawlerContext(
  startUrl: string,
  signal?: AbortSignal,
): Promise<BrowserContext> {
  let flareSession: FlareSolution | null = null;

  try {
    flareSession = await solveWithFlare(startUrl, signal);
    saveUserAgent(flareSession.userAgent);
  } catch (err) {
    console.warn(
      "[flare] solve failed; trying saved profile/session:",
      (err as Error).message,
    );
  }

  const savedUA = loadUserAgent();
  const userAgent = flareSession?.userAgent || savedUA || undefined;

  const proxy = process.env.PROXY_SERVER
    ? {
        server: process.env.PROXY_SERVER,
        username: process.env.PROXY_USER,
        password: process.env.PROXY_PASS,
      }
    : undefined;

  const commonOptions = {
    headless: HEADLESS,
    viewport: { width: 1365, height: 768 },
    locale: "en-US",
    timezoneId: "Asia/Ho_Chi_Minh",
    userAgent,
    proxy,
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",

      // Do NOT add "--disable-blink-features=AutomationControlled" here.
      // That flag can contribute to Cloudflare "incompatible browser" pages.
    ],
  } as const;

  let ctx: BrowserContext;

  if (USE_PERSISTENT_PROFILE) {
    console.log("[browser] launching persistent context:", PROFILE_DIR);
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, commonOptions);
  } else {
    console.log("[browser] launching normal context");
    const browser = await chromium.launch({
      headless: HEADLESS,
      proxy,
      args: commonOptions.args,
    });
    ctx = await browser.newContext({
      viewport: commonOptions.viewport,
      locale: commonOptions.locale,
      timezoneId: commonOptions.timezoneId,
      userAgent: commonOptions.userAgent,
      extraHTTPHeaders: commonOptions.extraHTTPHeaders,
    });
  }

  // Avoid overriding navigator.webdriver manually. Let Playwright behave as-is.
  // Some Cloudflare managed challenges dislike patched/inconsistent browser APIs.

  await loadCookies(ctx);

  if (flareSession) {
    await injectFlareCookies(ctx, flareSession.cookies);
  }

  console.log("[browser] headless:", HEADLESS);
  console.log("[browser] persistent profile:", USE_PERSISTENT_PROFILE);
  console.log("[browser] ua:", userAgent || "(Playwright default)");

  return ctx;
}

// ─── Manga info scraper ───────────────────────────────────────────────────────

async function scrapeMangaInfo(page: Page, url: string, signal?: AbortSignal) {
  await navigateSafe(page, url, signal);

  await page
    .waitForSelector("h1, main, body", {
      timeout: 20000,
    })
    .catch(() => {});

  await assertNotCloudflareBlocked(page, url);

  return page.evaluate(() => {
    const clean = (s?: string | null) =>
      (s ?? "")
        .replace(/\s+/g, " ")
        .replace(/\u00a0/g, " ")
        .trim();

    const abs = (u: string) => {
      try {
        return new URL(u, location.href).href;
      } catch {
        return u;
      }
    };

    const textOf = (el: Element | null | undefined) =>
      clean((el as HTMLElement | null)?.innerText || el?.textContent || "");

    const attrOf = (el: Element | null | undefined, attr: string) =>
      clean((el as HTMLElement | null)?.getAttribute(attr) || "");

    const getText = (sel: string) => textOf(document.querySelector(sel));

    const getAttr = (sel: string, attr: string) =>
      attrOf(document.querySelector(sel), attr);

    const normalizeLabel = (s: string) =>
      clean(s).toLowerCase().replace(/[:：]/g, "").replace(/\s+/g, " ");

    /**
     * Find values from rows like:
     *   <li><span>Tên khác:</span><span>Wireless Onahole</span></li>
     *   <p><b>Thể loại:</b> <a>Drama</a>, <a>Manwha</a></p>
     *   <div><strong>Tình trạng</strong><span>Đang tiến hành</span></div>
     */
    function findField(labelVariants: string[]): string {
      const wanted = labelVariants.map(normalizeLabel);

      const rowSelectors = [
        "li",
        ".info-item",
        ".detail-info li",
        ".story-info li",
        ".post-content_item",
        ".item",
        ".row",
        "p",
        "div",
      ];

      const rows = Array.from(
        document.querySelectorAll(rowSelectors.join(",")),
      );

      for (const row of rows) {
        const rowText = textOf(row);
        const rowNorm = normalizeLabel(rowText);

        const matchedLabel = wanted.find((label) => rowNorm.startsWith(label));
        if (!matchedLabel) continue;

        // Prefer child text after the label.
        const children = Array.from(row.children);
        const valueChildren = children.filter((child) => {
          const childNorm = normalizeLabel(textOf(child));
          return (
            childNorm &&
            !wanted.some(
              (label) => childNorm === label || childNorm.startsWith(label),
            )
          );
        });

        const childValue = clean(
          valueChildren.map(textOf).filter(Boolean).join(", "),
        );
        if (childValue) return childValue;

        // Fallback: strip the label from row text.
        let value = rowText;
        for (const label of labelVariants) {
          value = value.replace(
            new RegExp(`^\\s*${label}\\s*[:：]?\\s*`, "i"),
            "",
          );
        }
        return clean(value);
      }

      // Fallback: XPath text search around labels.
      for (const rawLabel of labelVariants) {
        const label = rawLabel.replace(/[:：]/g, "");
        const xpath = `//*[contains(normalize-space(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')), '${label.toLowerCase()}')]`;
        const found = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue as Element | null;

        if (found) {
          const parent = found.parentElement;
          const parentText = textOf(parent);
          const value = parentText
            .replace(new RegExp(`\\s*${rawLabel}\\s*[:：]?\\s*`, "i"), "")
            .replace(new RegExp(`\\s*${label}\\s*[:：]?\\s*`, "i"), "");
          if (clean(value)) return clean(value);
        }
      }

      return "";
    }

    function findLinksNearField(labelVariants: string[]): string[] {
      const wanted = labelVariants.map(normalizeLabel);
      const rows = Array.from(
        document.querySelectorAll(
          "li, .info-item, .detail-info li, .story-info li, p, div",
        ),
      );

      for (const row of rows) {
        const rowNorm = normalizeLabel(textOf(row));
        if (
          !wanted.some(
            (label) =>
              rowNorm.startsWith(label) || rowNorm.includes(label + " "),
          )
        ) {
          continue;
        }

        const links = Array.from(row.querySelectorAll("a"))
          .map((a) => clean(a.textContent))
          .filter(Boolean);

        if (links.length) return links;
      }

      return [];
    }

    // Title.
    const title = getText("h1.text-xl") || getText("main h1") || document.title;

    // Cover image. Prefer images close to the detail area instead of random chapter images.

    const coverImg = getAttr(".cover-frame img", "src");

    const description =
      getText(".detail-content p") ||
      getText("#story_detail .detail-content") ||
      getText(".story-detail .detail-content") ||
      getText(".description") ||
      "";

    const altTitle =
      findField([
        "Tên khác",
        "Tên khác:",
        "Other name",
        "Alternative",
        "Alternative name",
      ]) ||
      getText(".othername") ||
      getText('[class*="other"] .col-xs-8');

    // Tags/Genres
    const tagEls = document.querySelectorAll(
      '.kind a, .genre a, [class*="genre"] a, .detail-info a[href*="the-loai"]',
    );
    const tags = Array.from(document.querySelectorAll("#genres-list a")).map(
      (el) => el.textContent.trim().toLowerCase(),
    );

    const author =
      findField(["Tác giả", "Tác giả:", "Author"]) ||
      getText(".author a") ||
      getText('[class*="author"] a') ||
      getText(".info-detail li:nth-child(2) a") ||
      "";

    const artist = "";

    const status =
      findField(["Tình trạng", "Tình trạng:", "Status"]) ||
      getText(".status span.col-xs-8") ||
      getText('[class*="status"] .col-xs-8') ||
      getText(".detail-info .status") ||
      "";

    const lastUpdated =
      findField([
        "Lần cuối",
        "Lần cuối:",
        "Cập nhật",
        "Cập nhật:",
        "Last updated",
        "Updated",
      ]) || "";

    // Chapter links: keep only links that look like chapters for this story.
    const currentPath = location.pathname.replace(/\/+$/, "");
    const storySlug = currentPath.split("/").filter(Boolean).pop() || "";

    const chapterAnchors = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        [
          "#chapterList a",
          ".chapter-list a",
          ".list-chapter a",
          ".chapters a",
          "[class*='chapter'] a",
          "[class*='chap'] a",
          "a[href*='/chuong-']",
          "a[href*='/chapter-']",
        ].join(","),
      ),
    );

    const chapterLinks = chapterAnchors
      .map((a) => abs(a.getAttribute("href") || ""))
      .filter((href) => {
        if (!href.startsWith(location.origin)) return false;

        const u = new URL(href);
        const p = u.pathname.toLowerCase();
        const currentStory = storySlug.toLowerCase();

        // Only keep chapters under the exact current manga route:
        // /truyen/sextoy-ket-noi-khong-day/chapter-1
        // This prevents "Đề cử" / recommended manga chapter links from being saved.
        const sameMangaPrefix = `/truyen/${currentStory}/`;
        if (!currentStory || !p.startsWith(sameMangaPrefix)) return false;

        const rest = p.slice(sameMangaPrefix.length);

        const looksLikeChapter =
          /^(?:chuong|chapter)[-_]?\d+(?:[.-]\d+)?\/?$/i.test(rest) ||
          /^c\d+(?:[.-]\d+)?\/?$/i.test(rest) ||
          /^chap(?:ter)?[-_]?\d+(?:[.-]\d+)?\/?$/i.test(rest);

        if (!looksLikeChapter) return false;

        if (
          p.includes("/the-loai") ||
          p.includes("/genre") ||
          p.includes("/tim-kiem")
        ) {
          return false;
        }

        return true;
      });

    const uniqueChapterLinks = Array.from(new Set(chapterLinks));

    // Sort chapters if numbers are detectable.
    uniqueChapterLinks.sort((a, b) => {
      const getNo = (href: string) => {
        const m =
          href.match(/(?:chuong|chapter)[-_]?(\d+(?:\.\d+)?)/i) ||
          href.match(/\/c(\d+(?:\.\d+)?)(?:[/.?#-]|$)/i) ||
          href.match(/\/chap(?:ter)?[-_]?(\d+(?:\.\d+)?)/i);
        return m ? Number(m[1]) : Number.NaN;
      };

      const an = getNo(a);
      const bn = getNo(b);

      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return a.localeCompare(b);
    });

    return {
      title,
      coverImg,
      description,
      tags: Array.from(new Set(tags)),
      author,
      artist,
      status,
      lastUpdated,
      altTitles: altTitle ? [altTitle] : [],
      chapterLinks: uniqueChapterLinks,
    };
  });
}

// ─── Chapter image scraper ────────────────────────────────────────────────────

async function scrapeChapterImages(
  page: Page,
  chapterUrl: string,
  signal?: AbortSignal,
): Promise<string[]> {
  await navigateSafe(page, chapterUrl, signal);

  await page
    .waitForSelector(
      '#nt_chap_detail img, .reading-detail img, [class*="chapter"] img, .chapter-content img, main img',
      { timeout: 20000 },
    )
    .catch(() => {});

  await assertNotCloudflareBlocked(page, chapterUrl);

  // Scroll to trigger lazy-loaded images.
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await sleep(120);
    }
    window.scrollTo(0, 0);
  });

  await delay(1000, signal);

  return page.evaluate(() => {
    const containerSelectors = [
      "#chapter-content",
      "#nt_chap_detail",
      ".reading-detail",
      ".chapter-content",
      ".chapter-detail",
      ".chapter-images",
      ".reader-area",
      ".reading-content",
      "article",
      "main",
    ];

    let container: Element | null = null;
    for (const sel of containerSelectors) {
      const el = document.querySelector(sel);
      if (el && el.querySelector("img")) {
        container = el;
        break;
      }
    }

    if (!container) {
      return [];
    }

    const clone = container.cloneNode(true) as Element;

    clone
      .querySelectorAll(
        [
          "[class*='recommend']",
          "[class*='related']",
          "[class*='de-cu']",
          "[class*='suggest']",
          "[id*='recommend']",
          "[id*='related']",
          "header",
          "footer",
          "nav",
          "aside",
        ].join(","),
      )
      .forEach((el) => el.remove());

    const root = clone as ParentNode;

    const items = (
      Array.from(root.querySelectorAll("img")) as HTMLImageElement[]
    )
      .map((img) => {
        const raw =
          img.getAttribute("data-src") ||
          img.getAttribute("data-original") ||
          img.getAttribute("data-lazy-src") ||
          img.getAttribute("src") ||
          "";

        return {
          url: raw.trim(),
          index: Number(img.getAttribute("data-index") ?? NaN),
        };
      })
      .filter(
        (x) => x.url && !x.url.startsWith("data:") && x.url.startsWith("http"),
      );

    if (items.some((x) => Number.isFinite(x.index))) {
      items.sort((a, b) => {
        const ai = Number.isFinite(a.index) ? a.index : Number.MAX_SAFE_INTEGER;
        const bi = Number.isFinite(b.index) ? b.index : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }

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
}

// ─── Parse chapter number ─────────────────────────────────────────────────────

function parseChapterNumber(url: string, title?: string): number {
  const m =
    url.match(/chapter[_-]?(\d+(?:\.\d+)?)/i) ||
    url.match(/chuong[_-]?(\d+(?:\.\d+)?)/i) ||
    url.match(/[/-]c(\d+(?:\.\d+)?)/i) ||
    url.match(/[/-](\d+(?:\.\d+)?)(?:[/#?]|$)/i);

  if (m) return parseFloat(m[1]);

  if (title) {
    const tm =
      title.match(/chapter\s*(\d+(?:\.\d+)?)/i) ||
      title.match(/chuong\s*(\d+(?:\.\d+)?)/i) ||
      title.match(/(\d+(?:\.\d+)?)/);

    if (tm) return parseFloat(tm[1]);
  }

  return 0;
}

// ─── Main crawl ───────────────────────────────────────────────────────────────

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

  const context = await createCrawlerContext(mangaUrl, opts.signal);

  try {
    const page = await context.newPage();

    // ── 1. Manga info ─────────────────────────────────────────────────────────
    emit({ stage: "manga-info", message: "Scraping manga info…", progress: 5 });

    const info = await withRetry(
      () => scrapeMangaInfo(page, mangaUrl, opts.signal),
      2,
      3000,
      opts.signal,
    );

    await saveCookies(context);

    const slug = makeSlug(info.title) || mangaUrl.split("/").pop() || "unknown";

    console.log("[scrape] chapterUrls:", info.chapterLinks);

    emit({
      stage: "manga-info",
      message: `Found: ${info.title} (${info.chapterLinks.length} chapters)`,
      progress: 10,
    });

    if (!info.chapterLinks.length) {
      console.warn(
        "[scrape] no chapter links found. Check selectors or debug HTML.",
      );
    }

    // ── 2. Cover upload ───────────────────────────────────────────────────────
    let coverCloudinaryUrl = "";

    if (info.coverImg) {
      try {
        const buf = await fetchImageBuffer(page, info.coverImg, 3, opts.signal);
        coverCloudinaryUrl = await uploadImageBuffer(
          buf,
          "covers",
          `${slug}-cover`,
        );
      } catch (e) {
        console.error("Cover upload failed:", e);
        coverCloudinaryUrl = info.coverImg;
      }
    }

    // ── 3. Upsert manga doc ───────────────────────────────────────────────────
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
          lastUpdated: info.lastUpdated,
          totalChapters: info.chapterLinks.length,
          chapterUrls: info.chapterLinks,
          crawlStatus: "crawling",
          lastCrawledAt: new Date(),
        },
      },
      { upsert: true, new: true },
    )) as IManga;

    // ── 4. Chapters ───────────────────────────────────────────────────────────
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
      const chapterNum = parseChapterNumber(chapterUrl) || i + 1;

      const existing = await Chapter.findOne({
        mangaId: manga._id,
        chapterNumber: chapterNum,
      });

      if (existing?.status === "done" && opts.skipExistingImages) {
        emit({
          stage: "chapters",
          message: `Skipping chapter ${chapterNum} (already done)`,
          progress: 15 + Math.round((i / Math.max(total, 1)) * 75),
          chaptersDone: i + 1,
          chaptersTotal: total,
        });
        continue;
      }

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
          progress: 15 + Math.round((i / Math.max(total, 1)) * 75),
          chaptersDone: i,
          chaptersTotal: total,
        });

        const images = await withRetry(
          () => scrapeChapterImages(page, chapterUrl, opts.signal),
          2,
          3000,
          opts.signal,
        );

        const pages: {
          index: number;
          originalUrl: string;
          cloudinaryUrl: string;
        }[] = [];

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
              progress: 15 + Math.round((i / Math.max(total, 1)) * 75),
              chaptersDone: i,
              chaptersTotal: total,
              imagesDone: j + 1,
              imagesTotal: images.length,
            });
          }

          await delay(jitter(350, 600), opts.signal);
        }

        await Chapter.findByIdAndUpdate(chapter._id, {
          $set: {
            pages,
            pageCount: pages.length,
            status: "done",
            crawledAt: new Date(),
          },
        });

        await saveCookies(context);

        emit({
          stage: "chapters",
          message: `Chapter ${chapterNum} done (${images.length} pages)`,
          progress: 15 + Math.round(((i + 1) / Math.max(total, 1)) * 75),
          chaptersDone: i + 1,
          chaptersTotal: total,
        });
      } catch (err: any) {
        await Chapter.findByIdAndUpdate(chapter._id, {
          $set: { status: "error", error: err.message },
        });

        console.error(`Chapter ${chapterNum} failed:`, err.message);
      }

      await delay(jitter(1800, 2500), opts.signal);
    }

    // ── 5. Finalise ───────────────────────────────────────────────────────────
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
    await saveCookies(context);
    await context.close();
  }
}

// ─── Batch crawl ──────────────────────────────────────────────────────────────

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
