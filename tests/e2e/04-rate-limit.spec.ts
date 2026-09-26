import { expect, test } from "@playwright/test";

test("repeated failed logins are rate limited", async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill("attacker-target@e2e.test");
    await page.getByLabel("Password").fill(`wrong-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password");
  }
  await page.getByLabel("Password").fill("another-guess");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("Too many failed attempts");
});
