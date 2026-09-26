import { test } from "@playwright/test";
import { login, noHorizontalOverflow } from "./helpers";

const PAGES = ["/dashboard", "/orders", "/quotes", "/customers", "/production", "/materials", "/printers", "/designs", "/finance", "/reports", "/settings", "/quotes/new"];

for (const [label, width, height] of [["phone", 375, 812], ["tablet", 768, 1024], ["desktop", 1280, 860]] as const) {
  test(`no horizontal overflow on ${label} (${width}px)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await login(page);
    for (const p of PAGES) {
      await page.goto(p, { waitUntil: "networkidle" });
      await noHorizontalOverflow(page);
    }
    await page.goto("/dashboard");
    await info.attach(`dashboard-${label}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}
