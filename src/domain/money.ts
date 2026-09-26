import DecimalJs from "decimal.js";

/**
 * Isolated Decimal constructor for all business arithmetic.
 * 40 significant digits; HALF_UP is the rounding convention for money.
 * Never use JS floating point for amounts that end up in totals.
 */
export const D = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
});
export type Dec = InstanceType<typeof D>;
export type DecimalLike = string | number | Dec | { toString(): string };

export const ZERO = new D(0);
export const ONE = new D(1);

/** Parse a value to Decimal. Throws on invalid input rather than producing NaN. */
export function dec(value: DecimalLike): Dec {
  if (value instanceof D) return value;
  const s = typeof value === "string" ? value.trim() : value.toString();
  if (s === "") throw new Error("Empty decimal value");
  const d = new D(s);
  if (!d.isFinite()) throw new Error(`Invalid decimal value: ${s}`);
  return d;
}

/** Parse an optional value. Empty string / null / undefined → null (never zero). */
export function decOrNull(value: DecimalLike | null | undefined): Dec | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  try {
    return dec(value);
  } catch {
    return null;
  }
}

/** Round to agorot (2 dp) HALF_UP. */
export function roundMoney(value: Dec): Dec {
  return value.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export function moneyStr(value: Dec): string {
  return roundMoney(value).toFixed(2);
}

export function sum(values: Dec[]): Dec {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

/**
 * Round a price to a commercial step (e.g. 1.00 or 0.10).
 * UP always rounds away from zero to protect margin; NEAREST uses HALF_UP.
 * Noise below 1e-6 is removed first so exact values are not bumped a full step.
 */
export function roundToStep(value: Dec, step: Dec | null, mode: "UP" | "NEAREST"): Dec {
  const clean = value.toDecimalPlaces(6, D.ROUND_HALF_UP);
  if (!step || step.lte(0)) return roundMoney(clean);
  const units = clean.div(step);
  const rounded = mode === "UP" ? units.ceil() : units.toDecimalPlaces(0, D.ROUND_HALF_UP);
  return roundMoney(rounded.times(step));
}

/** Fraction (0.1834) → display percentage string with given dp ("18.34"). */
export function pctStr(fraction: Dec, dp = 2): string {
  return fraction.times(100).toDecimalPlaces(dp, D.ROUND_HALF_UP).toFixed(dp);
}

/** Convert anything decimal-ish (including Prisma.Decimal) to a canonical string, or null. */
export function toDecString(value: DecimalLike | null | undefined): string | null {
  const d = decOrNull(value ?? null);
  return d ? d.toString() : null;
}
