/**
 * Dev utility: capture screenshots of the main screens for visual review / README.
 * Usage: BASE_URL=http://localhost:3100 node scripts/screenshots.mjs [outDir] [paths...]
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "docs/screenshots";
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/overview", "/leads", "/pipeline", "/inbox", "/automations", "/knowledge", "/analytics", "/settings"];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(`${base}/sign-in`);
await page.screenshot({ path: `${out}/sign-in.png` });
await page.getByRole("button", { name: /enter demo workspace/i }).click();
await page.waitForURL("**/overview", { timeout: 120_000 });

for (const p of paths) {
  let target = p;
  if (p === "/lead") {
    await page.goto(`${base}/leads`);
    const href = await page.locator("tbody a").first().getAttribute("href");
    target = href;
  }
  await page.goto(`${base}${target}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(800);
  const name = p.replace(/^\//, "").replace(/\//g, "-") || "home";
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log("captured", target);
}
if (errors.length) console.log("BROWSER ERRORS:\n" + [...new Set(errors)].join("\n"));
await browser.close();
