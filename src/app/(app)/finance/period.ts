import { firstParam } from "@/lib/utils";

export type PeriodKey = "month" | "last-month" | "quarter" | "year" | "last-year" | "custom";

/** Resolves ?period= (and ?from=&to= for custom) into a half-open date range. */
export function resolvePeriod(sp: Record<string, string | string[] | undefined>, now = new Date()) {
  const key = (firstParam(sp.period) ?? "month") as PeriodKey;
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "last-month":
      return { key, from: new Date(y, m - 1, 1), to: new Date(y, m, 1), label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1)) };
    case "quarter": {
      const q = Math.floor(m / 3);
      return { key, from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 1), label: `Q${q + 1} ${y}` };
    }
    case "year":
      return { key, from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), label: String(y) };
    case "last-year":
      return { key, from: new Date(y - 1, 0, 1), to: new Date(y, 0, 1), label: String(y - 1) };
    case "custom": {
      const f = firstParam(sp.from);
      const t = firstParam(sp.to);
      const from = f ? new Date(`${f}T00:00:00`) : new Date(y, m, 1);
      const toIncl = t ? new Date(`${t}T00:00:00`) : now;
      const to = new Date(toIncl.getFullYear(), toIncl.getMonth(), toIncl.getDate() + 1);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return { key: "month" as PeriodKey, from: new Date(y, m, 1), to: new Date(y, m + 1, 1), label: "This month" };
      return { key, from, to, label: `${f ?? ""} – ${t ?? ""}` };
    }
    default:
      return { key: "month" as PeriodKey, from: new Date(y, m, 1), to: new Date(y, m + 1, 1), label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(y, m, 1)) };
  }
}

export const PERIOD_OPTIONS = [
  { value: "month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
  { value: "last-year", label: "Last year" },
  { value: "custom", label: "Custom" },
];
