/**
 * Upload validation: extension allow-list plus content sniffing.
 * Files are never executed; this prevents mislabeled/malicious content from being
 * stored under a trusted type (e.g. HTML disguised as an image).
 */
export type FileKind = "MODEL" | "IMAGE" | "DOCUMENT" | "ARCHIVE" | "OTHER";

interface TypeRule {
  kind: FileKind;
  mime: string;
  check: (head: Buffer, size: number) => boolean;
  /** Safe to display inline in the browser. */
  inline?: boolean;
}

const startsWith = (head: Buffer, sig: number[], offset = 0) => sig.every((b, i) => head[offset + i] === b);
const ascii = (head: Buffer, n = 512) => head.subarray(0, n).toString("latin1");
const isText = (head: Buffer) => !head.subarray(0, 1024).includes(0);
const ZIP = (h: Buffer) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]);
const looksLikeMarkup = (h: Buffer) => /<\s*(script|html|iframe|svg|object|embed)\b/i.test(ascii(h, 2048));

export const FILE_RULES: Record<string, TypeRule> = {
  stl: {
    kind: "MODEL",
    mime: "model/stl",
    // ASCII STL starts with "solid"; binary STL is 84-byte header + 50 bytes/triangle.
    check: (h, size) => /^\s*solid/i.test(ascii(h, 80)) || (size >= 84 && (size - 84) % 50 === 0),
  },
  "3mf": { kind: "MODEL", mime: "model/3mf", check: ZIP },
  step: { kind: "MODEL", mime: "model/step", check: (h) => ascii(h, 200).includes("ISO-10303-21") },
  stp: { kind: "MODEL", mime: "model/step", check: (h) => ascii(h, 200).includes("ISO-10303-21") },
  iges: { kind: "MODEL", mime: "model/iges", check: (h) => isText(h) && !looksLikeMarkup(h) },
  igs: { kind: "MODEL", mime: "model/iges", check: (h) => isText(h) && !looksLikeMarkup(h) },
  obj: { kind: "MODEL", mime: "model/obj", check: (h) => isText(h) && !looksLikeMarkup(h) },
  ply: { kind: "MODEL", mime: "application/octet-stream", check: (h) => ascii(h, 3) === "ply" },
  amf: { kind: "MODEL", mime: "application/octet-stream", check: (h) => ZIP(h) || (isText(h) && ascii(h, 200).includes("<amf")) },
  f3d: { kind: "MODEL", mime: "application/octet-stream", check: ZIP },
  gcode: { kind: "MODEL", mime: "text/plain", check: (h) => isText(h) && !looksLikeMarkup(h) },
  png: { kind: "IMAGE", mime: "image/png", check: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47]), inline: true },
  jpg: { kind: "IMAGE", mime: "image/jpeg", check: (h) => startsWith(h, [0xff, 0xd8, 0xff]), inline: true },
  jpeg: { kind: "IMAGE", mime: "image/jpeg", check: (h) => startsWith(h, [0xff, 0xd8, 0xff]), inline: true },
  gif: { kind: "IMAGE", mime: "image/gif", check: (h) => ascii(h, 4) === "GIF8", inline: true },
  webp: { kind: "IMAGE", mime: "image/webp", check: (h) => ascii(h, 4) === "RIFF" && ascii(h, 12).slice(8) === "WEBP", inline: true },
  heic: { kind: "IMAGE", mime: "image/heic", check: (h) => ascii(h, 12).slice(4, 8) === "ftyp" },
  pdf: { kind: "DOCUMENT", mime: "application/pdf", check: (h) => ascii(h, 5) === "%PDF-", inline: true },
  txt: { kind: "DOCUMENT", mime: "text/plain", check: (h) => isText(h) },
  csv: { kind: "DOCUMENT", mime: "text/csv", check: (h) => isText(h) },
  md: { kind: "DOCUMENT", mime: "text/plain", check: (h) => isText(h) },
  zip: { kind: "ARCHIVE", mime: "application/zip", check: ZIP },
};

export const ACCEPT_ATTRIBUTE = Object.keys(FILE_RULES)
  .map((e) => `.${e}`)
  .join(",");

export function extensionOf(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

export type DetectResult = { ok: true; kind: FileKind; mime: string; extension: string; inline: boolean } | { ok: false; error: string };

export function detectFileType(name: string, head: Buffer, size: number): DetectResult {
  const ext = extensionOf(name);
  const rule = FILE_RULES[ext];
  if (!rule) return { ok: false, error: `Files of type ".${ext || "?"}" are not allowed. Allowed: ${Object.keys(FILE_RULES).join(", ")}.` };
  if (!rule.check(head, size)) return { ok: false, error: `The file content does not look like a valid .${ext} file.` };
  return { ok: true, kind: rule.kind, mime: rule.mime, extension: ext, inline: !!rule.inline };
}

export function isInlineSafe(extension: string) {
  return !!FILE_RULES[extension]?.inline;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
