/**
 * Builds Bambu Studio–style 3MF archives from the text fixtures in this folder.
 * See README.md for where the fixture contents come from.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const DIR = path.join(process.cwd(), "tests/fixtures/bambu");
export const fixture = (name: string) => readFileSync(path.join(DIR, name), "utf8");

/** 1×1 transparent PNG. */
export const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`;

const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">BambuStudio-02.02.01.60</metadata>
 <resources/>
 <build/>
</model>`;

export interface BuildOptions {
  sliceInfo?: string | null;
  projectSettings?: string | null;
  thumbnails?: Record<number, Uint8Array>;
  contentTypes?: boolean;
  extra?: Record<string, string | Uint8Array>;
}

export async function buildBambu3mf(opts: BuildOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  if (opts.contentTypes !== false) {
    zip.file("[Content_Types].xml", CONTENT_TYPES);
    zip.file("3D/3dmodel.model", MODEL);
  }
  if (opts.sliceInfo) zip.file("Metadata/slice_info.config", opts.sliceInfo);
  if (opts.projectSettings) zip.file("Metadata/project_settings.config", opts.projectSettings);
  for (const [index, png] of Object.entries(opts.thumbnails ?? {})) zip.file(`Metadata/plate_${index}.png`, png);
  for (const [name, content] of Object.entries(opts.extra ?? {})) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
