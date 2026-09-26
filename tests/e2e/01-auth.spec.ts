import { expect, test } from "@playwright/test";
import { OWNER, login } from "./helpers";

test.describe.configure({ mode: "serial" });

test("first run redirects to setup and validates input without losing it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel("Business name").fill("E2E Print Shop");
  await page.getByLabel("Your name").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator("form [role=alert]").first()).toContainText("at least 10 characters");
  // Values survive the failed submit.
  await expect(page.getByLabel("Business name")).toHaveValue("E2E Print Shop");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(OWNER.password);
  await page.getByLabel("Confirm password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Hello, E2E/ })).toBeVisible();
});

test("setup page is closed once an owner exists", async ({ page }) => {
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login/);
});

test("protected pages and APIs require a session", async ({ page, request }) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/login\?next=%2Fcustomers/);
  const api = await request.get("/api/export/customers");
  expect(api.status()).toBe(401);
  const pdf = await request.get("/api/pdf/quote/does-not-exist");
  expect(pdf.status()).toBe(401);
});

test("wrong password is rejected with a generic message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("definitely wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("Incorrect email or password");
});

test("login, then sign out", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
