/** Display formatting only. Never use these results for arithmetic. */

export const APP_LOCALE = process.env.NEXT_PUBLIC_LOCALE || "en-IL";
export const APP_TZ = process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Jerusalem";
export const APP_CURRENCY = "ILS";

type Num = string | number | { toString(): string } | null | undefined;

const moneyFmt = new Map<string, Intl.NumberFormat>();
function mf(currency: string) {
  let f = moneyFmt.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(APP_LOCALE, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    moneyFmt.set(currency, f);
  }
  return f;
}

/** Formats a decimal string exactly (Intl accepts decimal strings without float conversion). */
export function money(value: Num, currency = APP_CURRENCY): string {
  if (value === null || value === undefined || value === "") return "—";
  const s = typeof value === "number" ? value : value.toString();
  // Intl.NumberFormat.format accepts numeric strings as exact decimals (ES2023).
  return mf(currency).format(s as unknown as number);
}

export function num(value: Num, maxDp = 2): string {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: maxDp }).format(value.toString() as unknown as number);
}

/** Fraction string ("0.1834") → "18.3%". */
export function percent(fraction: Num, dp = 1): string {
  if (fraction === null || fraction === undefined || fraction === "") return "—";
  return new Intl.NumberFormat(APP_LOCALE, { style: "percent", maximumFractionDigits: dp, minimumFractionDigits: 0 }).format(Number(fraction.toString()));
}

export function grams(value: Num): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value.toString());
  if (Math.abs(n) >= 1000) return `${num(n / 1000, 2)} kg`;
  return `${num(n, 1)} g`;
}

/** Remaining weight shown with honest precision: estimates are rounded to 10 g and prefixed with ≈. */
export function spoolWeight(value: Num, measured: boolean): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value.toString());
  return measured ? grams(n) : `≈ ${grams(Math.round(n / 10) * 10)}`;
}

export function minutesToHuman(minutes: Num): string {
  if (minutes === null || minutes === undefined || minutes === "") return "—";
  const m = Math.round(Number(minutes.toString()));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: APP_TZ });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: APP_TZ });

export function date(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateFmt.format(typeof d === "string" ? new Date(d) : d);
}

export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return dateTimeFmt.format(typeof d === "string" ? new Date(d) : d);
}

/** yyyy-mm-dd in the business timezone, for <input type="date"> values. */
export function isoDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  return parts;
}

export function relativeDays(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "";
  const x = typeof d === "string" ? new Date(d) : d;
  const days = Math.round((startOfDay(x).getTime() - startOfDay(now).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
