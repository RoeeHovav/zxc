import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { login } from "./helpers";

/** ASCII STL of an axis-aligned box (12 triangles). */
function boxStl(x: number, y: number, z: number) {
  const v = (i: number) => [i & 1 ? x : 0, i & 2 ? y : 0, i & 4 ? z : 0].join(" ");
  const faces = [
    [0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4],
    [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5],
  ]; // prettier-ignore
  return `solid box\n${faces.map((f) => `facet normal 0 0 0\nouter loop\n${f.map((i) => `vertex ${v(i)}`).join("\n")}\nendloop\nendfacet`).join("\n")}\nendsolid box\n`;
}

/** Bambu-style project 3MF: the root model only references meshes in 3D/Objects via p:path. */
async function bambuProject3mf() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
  );
  zip.file(
    "3D/3dmodel.model",
    `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"><resources><object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object></resources><build><item objectid="2"/></build></model>`,
  );
  zip.file(
    "3D/Objects/object_1.model",
    `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build/></model>`,
  );
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

test("preview an uploaded STL in 3D with its dimensions", async ({ page }) => {
  await login(page);
  await page.goto("/customers/new");
  await page.getByLabel("Full name").fill("Preview Customer");
  await page.getByLabel("Phone").fill("053-777-8888");
  await page.getByRole("button", { name: "Create customer" }).click();
  await expect(page.getByRole("heading", { name: "Preview Customer" })).toBeVisible();

  // Privacy: the per-customer data export is a JSON download with the customer's records.
  const exported = await page.request.get(page.url().replace("/customers/", "/api/customers/") + "/export");
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-disposition"]).toMatch(/attachment; filename=.*customer-C-\d+\.json/);
  expect((await exported.json()).customer).toMatchObject({ name: "Preview Customer", phone: "053-777-8888" });

  const upload = page.locator("input[type=file][multiple]");
  await upload.setInputFiles({ name: "box.stl", mimeType: "model/stl", buffer: Buffer.from(boxStl(20, 10, 5)) });
  await expect(page.getByRole("link", { name: "box.stl", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview box.stl in 3D" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("20 × 10 × 5 mm");
  await expect(dialog).toContainText("12 triangles");
  await expect(dialog.getByRole("img", { name: /3D preview of box\.stl/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Bambu/Orca project files keep meshes in 3D/Objects/*.model (3MF production extension).
  await upload.setInputFiles({ name: "project.3mf", mimeType: "model/3mf", buffer: await bambuProject3mf() });
  await expect(page.getByRole("link", { name: "project.3mf", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview project.3mf in 3D" }).click();
  await expect(dialog).toContainText("10 × 10 × 0 mm");
  await expect(dialog).toContainText("1 triangle");
  await page.keyboard.press("Escape");

  // A file with no geometry explains itself instead of showing an empty scene.
  await upload.setInputFiles({ name: "empty.obj", mimeType: "text/plain", buffer: Buffer.from("# no geometry\n") });
  await expect(page.getByRole("link", { name: "empty.obj", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview empty.obj in 3D" }).click();
  await expect(dialog).toContainText("No printable geometry found");
});
