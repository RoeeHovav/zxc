import { describe, expect, it } from "vitest";
import { detectFileType, extensionOf, formatBytes, isInlineSafe } from "./files";

const buf = (s: string | number[]) => (typeof s === "string" ? Buffer.from(s, "latin1") : Buffer.from(s));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00];

describe("detectFileType", () => {
  it("accepts real files by extension and content", () => {
    expect(detectFileType("part.STL", buf("solid bracket\nfacet normal"), 300)).toMatchObject({ ok: true, kind: "MODEL", extension: "stl" });
    expect(detectFileType("binary.stl", Buffer.alloc(84), 84 + 50 * 12)).toMatchObject({ ok: true });
    expect(detectFileType("plate.gcode.3mf", buf(ZIP), 1000)).toMatchObject({ ok: true, kind: "MODEL", mime: "model/3mf", inline: false });
    expect(detectFileType("photo.png", buf(PNG), 100)).toMatchObject({ ok: true, kind: "IMAGE", inline: true });
    expect(detectFileType("scan.pdf", buf("%PDF-1.7"), 100)).toMatchObject({ ok: true, inline: true });
    expect(detectFileType("model.step", buf("ISO-10303-21;\nHEADER;"), 100)).toMatchObject({ ok: true });
  });

  it("rejects disallowed extensions, including active content", () => {
    for (const name of ["evil.html", "icon.svg", "run.exe", "script.js", "noext"]) {
      expect(detectFileType(name, buf("x"), 1)).toMatchObject({ ok: false, error: expect.stringContaining("not allowed") });
    }
  });

  it("rejects content that does not match the extension", () => {
    expect(detectFileType("fake.png", buf("<html><script>alert(1)</script>"), 40)).toMatchObject({ ok: false, error: expect.stringContaining("does not look like") });
    expect(detectFileType("fake.pdf", buf(PNG), 8)).toMatchObject({ ok: false });
    expect(detectFileType("fake.3mf", buf("solid x"), 7)).toMatchObject({ ok: false });
    // Binary STL must have a consistent size; markup posing as a text model is refused.
    expect(detectFileType("odd.stl", Buffer.alloc(90), 90)).toMatchObject({ ok: false });
    expect(detectFileType("trap.obj", buf("v 1 2 3\n<script>alert(1)</script>"), 40)).toMatchObject({ ok: false });
    expect(detectFileType("bin.txt", buf([0x41, 0x00, 0x42]), 3)).toMatchObject({ ok: false });
  });

  it("only marks images and PDFs as safe to show inline", () => {
    expect(isInlineSafe("png")).toBe(true);
    expect(isInlineSafe("pdf")).toBe(true);
    for (const ext of ["txt", "csv", "stl", "3mf", "zip", "svg", "html"]) expect(isInlineSafe(ext)).toBe(false);
  });
});

describe("helpers", () => {
  it("extracts the last extension", () => {
    expect(extensionOf("a.b.GCODE ")).toBe("gcode");
    expect(extensionOf("README")).toBe("");
  });
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
