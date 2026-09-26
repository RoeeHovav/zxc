import { z } from "zod";
import { D } from "../money";

/** Optional free text: trims, empty → null. */
export const optText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .nullish()
    .transform((v) => (v ? v : null));

export const reqText = (label: string, max = 200) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Decimal number kept as a string (never converted to float). Empty → null. */
export const optDecimal = (opts: { min?: number; max?: number; label?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim().replace(/,/g, "");
      if (s === "") return null;
      if (!DECIMAL_RE.test(s)) {
        ctx.addIssue({ code: "custom", message: `${opts.label ?? "Value"} must be a number.` });
        return z.NEVER;
      }
      const n = Number(s);
      if (opts.min !== undefined && n < opts.min) {
        ctx.addIssue({ code: "custom", message: `${opts.label ?? "Value"} must be at least ${opts.min}.` });
        return z.NEVER;
      }
      if (opts.max !== undefined && n > opts.max) {
        ctx.addIssue({ code: "custom", message: `${opts.label ?? "Value"} must be at most ${opts.max}.` });
        return z.NEVER;
      }
      return s;
    });

export const reqDecimal = (opts: { min?: number; max?: number; label: string }) => optDecimal(opts).refine((v): v is string => v !== null, `${opts.label} is required.`);

/** Percentage entered as 0–100 in forms, stored as fraction string ("18" → "0.18"). */
export const optPercent = (label = "Percentage", max = 100) => optDecimal({ min: 0, max, label }).transform((v) => (v === null ? null : fractionFromPercent(v)));

export function fractionFromPercent(v: string): string {
  return new D(v).div(100).toString();
}

export const optInt = (opts: { min?: number; max?: number; label?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const n = Number(String(v).trim());
      if (!Number.isInteger(n)) {
        ctx.addIssue({ code: "custom", message: `${opts.label ?? "Value"} must be a whole number.` });
        return z.NEVER;
      }
      if (opts.min !== undefined && n < opts.min) {
        ctx.addIssue({ code: "custom", message: `${opts.label ?? "Value"} must be at least ${opts.min}.` });
        return z.NEVER;
      }
      if (opts.max !== undefined && n > opts.max) {
        ctx.addIssue({ code: "custom", message: `${opts.label ?? "Value"} must be at most ${opts.max}.` });
        return z.NEVER;
      }
      return n;
    });

export const optDate = () =>
  z
    .string()
    .nullish()
    .transform((v, ctx) => {
      if (!v || v.trim() === "") return null;
      const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid date." });
        return z.NEVER;
      }
      return d;
    });

export const checkbox = () =>
  z
    .union([z.boolean(), z.string()])
    .nullish()
    .transform((v) => v === true || v === "on" || v === "true" || v === "1");

export const optEmail = () =>
  z
    .string()
    .trim()
    .max(254)
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address.");

export const optId = () =>
  z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => (v ? v : null));

/** Flatten a ZodError into field → first message. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function formToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
