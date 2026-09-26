"use client";
import * as React from "react";
import { money } from "@/lib/format";

export interface SeriesDef {
  key: string;
  label: string;
  /** CSS color token, e.g. var(--series-1) — validated for both themes. */
  color: string;
}

/**
 * Grouped monthly bars on a single currency axis. Recessive grid, rounded data-ends
 * anchored at the baseline, 2px gaps, per-month hover tooltip and a table view.
 */
export function MonthlyBars({ data, series, labels, title }: { data: Record<string, string | number>[]; series: SeriesDef[]; labels: string[]; title: string }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [table, setTable] = React.useState(false);
  const W = 720;
  const H = 240;
  const pad = { t: 12, r: 8, b: 26, l: 56 };
  const values = data.flatMap((d) => series.map((s) => Number(d[s.key])));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const nice = (v: number) => {
    if (v === 0) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))));
    return Math.sign(v) * Math.ceil(Math.abs(v) / p) * p;
  };
  const top = nice(max) || 100;
  const bottom = min < 0 ? nice(min) : 0;
  const y = (v: number) => pad.t + ((top - v) / (top - bottom)) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / data.length;
  const gap = 2;
  const barW = Math.max(3, Math.min(18, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => bottom + ((top - bottom) * i) / ticks);
  const r = Math.min(4, barW / 2);

  const barPath = (x: number, v: number) => {
    const y0 = y(0);
    const y1 = y(v);
    if (Math.abs(y1 - y0) < 0.5) return "";
    if (v >= 0) {
      const h = y0 - y1;
      const rr = Math.min(r, h);
      return `M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + barW - rr} Q${x + barW},${y1} ${x + barW},${y1 + rr} V${y0} Z`;
    }
    const h = y1 - y0;
    const rr = Math.min(r, h);
    return `M${x},${y0} V${y1 - rr} Q${x},${y1} ${x + rr},${y1} H${x + barW - rr} Q${x + barW},${y1} ${x + barW},${y1 - rr} V${y0} Z`;
  };

  return (
    <figure className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <figcaption className="sr-only">{title}</figcaption>
        <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setTable((t) => !t)} className="text-xs font-medium text-primary hover:underline" aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 text-start font-medium">Month</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 text-end font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((d, i) => (
                <tr key={i}>
                  <td className="py-1.5">{labels[i]}</td>
                  {series.map((s) => (
                    <td key={s.key} className="tabular py-1.5 text-end">
                      {money(String(d[s.key]))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
            {tickVals.map((t, i) => (
              <g key={i}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1 : 0.6} strokeDasharray={t === 0 ? undefined : "2 3"} />
                <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--muted-foreground)" className="tabular">
                  {Math.abs(t) >= 1000 ? `₪${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k` : `₪${Math.round(t)}`}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x0 = pad.l + band * i + (band - (barW * series.length + gap * (series.length - 1))) / 2;
              return (
                <g key={i}>
                  {hover === i && <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill="var(--muted)" opacity={0.7} />}
                  {series.map((s, k) => (
                    <path key={s.key} d={barPath(x0 + k * (barW + gap), Number(d[s.key]))} fill={s.color} />
                  ))}
                  <text x={pad.l + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
                    {labels[i]}
                  </text>
                  <rect
                    x={pad.l + band * i}
                    y={pad.t}
                    width={band}
                    height={H - pad.t - pad.b}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={0}
                    aria-label={`${labels[i]}: ${series.map((s) => `${s.label} ${money(String(d[s.key]))}`).join(", ")}`}
                  />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-[var(--shadow-pop)]"
              style={{ left: `${Math.min(75, Math.max(2, ((pad.l + band * hover + band) / W) * 100))}%` }}
            >
              <p className="mb-1 font-semibold">{labels[hover]}</p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="tabular font-medium">{money(String(data[hover][s.key]))}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
