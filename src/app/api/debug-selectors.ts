import type { NextApiRequest, NextApiResponse } from "next";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { type BrowserContext } from "playwright";

chromiumExtra.use(StealthPlugin());

const FLARE_URL = process.env.FLARESOLVERR_URL ?? "http://localhost:8191/v1";

async function solveWithFlare(url: string) {
  const res = await fetch(FLARE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60000 }),
  });
  const data = await res.json();
  if (data.status !== "ok") throw new Error(data.message);
  return data.solution;
}

async function injectFlareCookies(ctx: BrowserContext, cookies: any[]) {
  await ctx.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain.startsWith(".") ? c.domain : `.${c.domain}`,
      path: c.path ?? "/",
      expires: c.expires ?? -1,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: (c.sameSite as "Strict" | "Lax" | "None") ?? "Lax",
    })),
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { url } = req.query;
  if (!url || typeof url !== "string") {
    return res
      .status(400)
      .json({ error: "Pass ?url=https://damconuong.lol/..." });
  }

  const browser = await chromiumExtra.launch({
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
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    // Inject flare cookies
    const solution = await solveWithFlare(url);
    await injectFlareCookies(context, solution.cookies);

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // ── Inspect the page structure ──────────────────────────────────────────
    const debug = await page.evaluate(() => {
      // Helper to safely get text
      const t = (sel: string) =>
        (document.querySelector(sel) as HTMLElement)?.innerText
          ?.trim()
          .slice(0, 100) ?? null;

      // Dump all IDs and notable classes on the page
      const allIds = Array.from(document.querySelectorAll("[id]")).map(
        (el) => ({ tag: el.tagName, id: el.id }),
      );

      const allAnchors = Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter(
          (h) =>
            h.includes("chap") || h.includes("chuong") || h.includes("chapter"),
        )
        .slice(0, 20);

      // Check common manga selectors
      const selectorTests: Record<string, string | null> = {
        // Title
        h1: t("h1"),
        "h1.text-xl": t("h1.text-xl"),
        ".manga-title": t(".manga-title"),
        // Chapter list containers
        "#chapterList a": document.querySelector("#chapterList a")
          ? "FOUND"
          : null,
        ".list-chapter a": document.querySelector(".list-chapter a")
          ? "FOUND"
          : null,
        ".chapter-list a": document.querySelector(".chapter-list a")
          ? "FOUND"
          : null,
        "ul.list-chapter a": document.querySelector("ul.list-chapter a")
          ? "FOUND"
          : null,
        ".wp-manga-chapter a": document.querySelector(".wp-manga-chapter a")
          ? "FOUND"
          : null,
        "[class*='chapter'] a": document.querySelector("[class*='chapter'] a")
          ? "FOUND"
          : null,
        "[class*='list'] a": document.querySelector("[class*='list'] a")
          ? "FOUND"
          : null,
        // Cover
        ".cover-frame img": document.querySelector(".cover-frame img")
          ? "FOUND"
          : null,
        ".manga-cover img": document.querySelector(".manga-cover img")
          ? "FOUND"
          : null,
        "img[class*='cover']": document.querySelector("img[class*='cover']")
          ? "FOUND"
          : null,
      };

      // Dump first 5 chapter-like anchors with their parent class
      const chapterAnchorsDetailed = Array.from(
        document.querySelectorAll("a[href]"),
      )
        .filter((a) => {
          const href = (a as HTMLAnchorElement).href;
          return (
            href.includes("chap") ||
            href.includes("chuong") ||
            href.includes("chapter")
          );
        })
        .slice(0, 5)
        .map((a) => ({
          text: a.textContent?.trim().slice(0, 60),
          href: (a as HTMLAnchorElement).href,
          parentClass: (a.parentElement?.className ?? "").slice(0, 80),
          grandparentId: a.parentElement?.parentElement?.id ?? null,
        }));

      // Raw outer HTML of likely chapter list container (first 2000 chars)
      const listContainer =
        document.querySelector("#chapterList") ||
        document.querySelector(".list-chapter") ||
        document.querySelector(".chapter-list") ||
        document.querySelector("[class*='chapter-list']") ||
        document.querySelector("[id*='chapter']");

      return {
        pageTitle: document.title,
        selectorTests,
        allIds: allIds.slice(0, 30),
        chapterAnchorsDetailed,
        chapterHrefs: allAnchors,
        listContainerHTML: listContainer?.outerHTML?.slice(0, 2000) ?? null,
        listContainerClass: listContainer?.className ?? null,
        listContainerId: listContainer?.id ?? null,
      };
    });

    return res.status(200).json({ url, debug });
  } finally {
    await browser.close();
  }
}
