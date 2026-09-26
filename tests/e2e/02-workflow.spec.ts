import { expect, test, type Page } from "@playwright/test";
import { combo, login } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await login(page);
});
test.afterAll(async () => page.close());

test("add a printer with cost data", async () => {
  await page.goto("/printers/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("X1C E2E");
  await page.getByRole("textbox", { name: "Model", exact: true }).fill("X1 Carbon");
  await page.getByLabel("Purchase price").fill("5000");
  await page.getByLabel("Expected lifetime").fill("5000");
  await page.getByLabel("Average power while printing").fill("150");
  await page.getByLabel("Maintenance reserve").fill("0.25");
  await page.getByLabel("Consumables (nozzles, plates…)").fill("0.15");
  await page.getByRole("button", { name: "Add printer" }).click();
  await expect(page.getByRole("heading", { name: "X1C E2E" })).toBeVisible();
  await expect(page.getByText("Machine cost")).toBeVisible();
});

test("add a material and receive spools", async () => {
  await page.goto("/materials/new");
  await page.getByLabel("Type").selectOption({ label: "PLA — PLA" });
  await page.getByLabel("Brand").fill("Bambu Lab");
  await page.getByRole("textbox", { name: "Color", exact: true }).fill("Black");
  await page.getByLabel(/Price per kg/).fill("100");
  await page.getByLabel("Minimum stock").fill("200");
  await page.getByRole("button", { name: "Create material" }).click();
  await expect(page.getByRole("heading", { name: /Bambu Lab\s+— Black/ })).toBeVisible();
  await page.getByRole("link", { name: "Receive spools" }).click();
  await page.getByLabel("Spools").fill("2");
  await page.getByLabel("Price per spool").fill("90");
  await page.getByRole("checkbox", { name: /Update the material's price/ }).uncheck();
  await page.getByRole("button", { name: "Receive spools" }).click();
  await expect(page.getByText("SP-0001").first()).toBeVisible();
  await expect(page.getByText("SP-0002").first()).toBeVisible();
});

test("create a customer and detect a duplicate", async () => {
  await page.goto("/customers/new");
  await page.getByLabel("Full name").fill("Avi Mizrahi");
  await page.getByLabel("Phone").fill("050-555-1212");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "Avi Mizrahi" })).toBeVisible();
  await page.goto("/customers/new");
  await page.getByLabel("Full name").fill("A. Mizrahi");
  await page.getByLabel("Phone").fill("+972 50 555 1212");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByText("Possible duplicate")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create customer" })).toBeDisabled();
});

test("build a two-item quote with live pricing, send and accept it", async () => {
  await page.goto("/quotes/new");
  await combo(page, "doc-customer", "Avi Mizrahi");
  await page.getByLabel("Reference / title").fill("E2E brackets and knobs");
  const first = page.getByRole("region", { name: "Item 1" });
  await first.getByLabel("Part name").fill("Bracket");
  await first.getByLabel("Quantity").fill("4");
  await combo(page, first.getByLabel("Material"), "Bambu Lab");
  await first.getByLabel("Grams / unit").fill("50");
  await first.getByLabel("Print time / unit").fill("1h 30m");
  await first.getByLabel("Units / plate").fill("2");
  await page.getByRole("button", { name: "Add item" }).click();
  const second = page.getByRole("region", { name: "Item 2" });
  await second.getByLabel("Service").selectOption("MODELING_AND_PRINTING");
  await second.getByLabel("Part name").fill("Custom knob");
  await second.getByLabel("Quantity").fill("2");
  await second.getByLabel("Grams / unit").fill("20");
  await second.getByLabel("Print time / unit").fill("45");
  await second.getByLabel("Estimated hours").fill("2");
  // Live summary appears once everything needed is present.
  await expect(page.getByText("Subtotal (excl. VAT)")).toBeVisible();
  await expect(page.getByText("Internal — not on documents")).toBeVisible();
  // The breakdown dialog explains the price.
  await first.getByRole("button", { name: "Show price breakdown" }).click();
  await expect(page.getByRole("dialog")).toContainText("Production cost");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save quote" }).click();
  await expect(page).toHaveURL(/\/quotes\/c/);
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  const pdf = await page.request.get(page.url().replace("/quotes/", "/api/pdf/quote/"));
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Customer accepted" }).click();
  await page.getByLabel("Approval note").fill("Approved by phone (E2E)");
  await page.getByRole("button", { name: "Confirm acceptance" }).click();
  await expect(page).toHaveURL(/\/orders\/c/);
  await expect(page.getByText("Awaiting modeling").first()).toBeVisible();
});

test("design approval releases the order to production", async () => {
  const orderUrl = page.url();
  await page.getByRole("link", { name: /· D-0001/ }).click();
  await page.getByRole("button", { name: "Start work" }).click();
  await page.getByRole("button", { name: "Sent to customer for approval" }).click();
  await page.getByRole("button", { name: "Customer approved" }).click();
  await page.getByLabel("Approval note").fill("Looks great");
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await page.goto(orderUrl);
  // Cannot be marked ready before printing.
  await page.getByRole("button", { name: /Queue for production/ }).click();
  await expect(page.getByText("Queued").first()).toBeVisible();
  await page.getByRole("button", { name: /Create jobs/ }).click();
  await expect(page.getByText(/Created 4 job/)).toBeVisible();
});

test("run print jobs on the production board", async () => {
  const orderUrl = page.url();
  await page.goto("/production");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Start", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("dialog")).toContainText("Filament used");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.goto(orderUrl);
  await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("4/4 done")).toBeVisible();
});

test("deliver, collect payment and complete", async () => {
  await page.getByRole("button", { name: /Mark delivered/ }).click();
  await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
  // Completion is blocked while money is owed.
  await expect(page.getByText(/Outstanding balance of/)).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Complete order/ }).click();
  await expect(page.getByText("Completed", { exact: true }).first()).toBeVisible();
  const res = await page.request.get(page.url().replace("/orders/", "/api/pdf/delivery/"));
  expect(res.status()).toBe(200);
  // Inventory reflects the consumption recorded on the board.
  await page.goto("/materials");
  await expect(page.getByText(/Bambu Lab\s+— Black/)).toBeVisible();
});
