// Renders scripts/og/og.html to site/og.png (1200 x 630) with Playwright.
//   node scripts/og/og.js [tiles base URL]
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const tiles = process.argv[2] ? `?tiles=${encodeURIComponent(process.argv[2])}` : "";
  await page.goto(`file://${path.join(__dirname, "og.html")}${tiles}`);
  await page.waitForSelector("body[data-ready]", { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, "../../site/og.png") });
  await browser.close();
})();
