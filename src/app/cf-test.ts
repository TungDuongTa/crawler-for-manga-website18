import { chromium } from "playwright";
import path from "path";

async function main() {
  const context = await chromium.launchPersistentContext(
    path.join(process.cwd(), ".cf-test-profile"),
    {
      headless: false,
      channel: "chrome",
      viewport: { width: 1365, height: 768 },
    },
  );

  const page = await context.newPage();

  await page.goto("https://damconuong.lol", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("Title:", await page.title());
  console.log("URL:", page.url());

  console.log("Browser will stay open. Try the checkbox manually.");
  await page.waitForTimeout(10 * 60 * 1000);

  await context.close();
}

main().catch(console.error);
