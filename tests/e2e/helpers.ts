import { expect, type Locator, type Page } from "@playwright/test";

export const OWNER = { email: "owner@e2e.test", password: "e2e correct horse battery", name: "E2E Owner" };

export async function login(page: Page) {
  await page.goto("/login");
  if (page.url().includes("/setup")) {
    // Fresh database (spec run on its own): create the owner first.
    await page.getByLabel("Business name").fill("E2E Print Shop");
    await page.getByLabel("Your name").fill(OWNER.name);
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(OWNER.password);
    await page.getByLabel("Confirm password").fill(OWNER.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    return;
  }
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Picks an option in a Combobox (trigger id or locator) by visible option text. */
export async function combo(page: Page, trigger: string | Locator, text: string) {
  await (typeof trigger === "string" ? page.locator(`#${trigger}`) : trigger).click();
  await page.getByRole("option", { name: new RegExp(text) }).first().click();
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, `horizontal overflow on ${page.url()}`).toBe(false);
}
