import { expect, test } from "@playwright/test";
import { buildBambu3mf, fixture, TINY_PNG } from "../fixtures/bambu/build";
import { login } from "./helpers";

test("fill a quote line from a Bambu Studio 3MF, with manual fallback for unsliced files", async ({ page }) => {
  await login(page);
  await page.goto("/quotes/new");
  const item = page.getByRole("region", { name: "Item 1" });
  const input = item.getByTestId("slicer-file");

  // An unsliced project explains what to do and changes nothing.
  await input.setInputFiles({ name: "project.3mf", mimeType: "model/3mf", buffer: Buffer.from(await buildBambu3mf({ sliceInfo: fixture("unsliced-project.slice_info.config") })) });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("No usable slicing data");
  await expect(dialog).toContainText("Export plate sliced file");
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(item.getByLabel("Grams / unit")).toHaveValue("");

  // A sliced two-plate file: pick plate 1 (4 identical brackets).
  const sliced = await buildBambu3mf({ sliceInfo: fixture("current-two-plates.slice_info.config"), projectSettings: fixture("project_settings.config"), thumbnails: { 1: TINY_PNG, 2: TINY_PNG } });
  await input.setInputFiles({ name: "brackets.gcode.3mf", mimeType: "model/3mf", buffer: Buffer.from(sliced) });
  await expect(dialog).toContainText("Bambu Lab P1S");
  await expect(dialog).toContainText("4× Bracket");
  await expect(dialog.getByLabel("Finished units this plate produces")).toHaveValue("4");
  await expect(dialog).toContainText("14.61 g");
  // Plate 2 holds different parts, so it defaults to one unit and shows the slicer warning.
  await dialog.getByText("Plate 2", { exact: true }).click();
  await expect(dialog.getByLabel("Finished units this plate produces")).toHaveValue("1");
  await expect(dialog).toContainText("bed_temperature_too_high_than_filament");
  await dialog.getByText("Plate 1", { exact: true }).click();
  await dialog.getByRole("button", { name: "Apply to item" }).click();
  await expect(dialog).toBeHidden();

  await expect(item.getByLabel("Grams / unit")).toHaveValue("14.61");
  await expect(item.getByLabel("Print time / unit")).toHaveValue("31m");
  await expect(item.getByLabel("Units / plate")).toHaveValue("4");
  await expect(item.getByLabel("Part name")).toHaveValue("Bracket");
});
