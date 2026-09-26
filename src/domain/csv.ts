/**
 * RFC 4180 CSV with protection against spreadsheet formula injection
 * (cells starting with = + - @ tab or CR are prefixed with an apostrophe,
 * except plain negative numbers which stay numeric).
 */
export type Cell = string | number | boolean | null | undefined | Date;

const NUMERIC = /^-?\d+(\.\d+)?$/;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  // UTF-8 BOM so Excel opens Hebrew text correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
