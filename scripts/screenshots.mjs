import { chromium } from "playwright";
import fs from "node:fs";
fs.mkdirSync("test-results", { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/home/chief/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
for (const [name, width, height] of [
  ["desktop", 1440, 1080],
  ["mobile", 390, 844],
  ["small", 320, 700],
]) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4187");
  await page
    .getByRole("heading", { name: "Small paws. Big adventures." })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  console.log(
    JSON.stringify({
      name,
      errors,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    }),
  );
  await page.close();
}
await browser.close();
