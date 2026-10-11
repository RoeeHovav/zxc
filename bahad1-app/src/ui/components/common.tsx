import { useEffect, useState } from 'react';
import type { ContentBundle } from '../../domain/types';
import { useApp } from '../../app/store';

export function Progress({ value, gold }: { value: number; gold?: boolean }) {
  return <div className={`progress${gold ? ' gold' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const Num = ({ children }: { children: React.ReactNode }) => <span className="num">{children}</span>;

/** Loads chapter bundles on demand (lazy), returns them when ready. */
export function useChapters(ids: string[] | null): { bundles: Record<string, ContentBundle>; loading: boolean } {
  const { ensureChapters, bundles } = useApp();
  const [loading, setLoading] = useState(true);
  const key = ids ? ids.join(',') : '*';
  useEffect(() => {
    let alive = true;
    setLoading(true);
    ensureChapters(ids ?? undefined).then(() => { if (alive) setLoading(false); }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ensureChapters]);
  return { bundles, loading };
}

export function useTimer(running: boolean) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now() - ms;
    const id = setInterval(() => setMs(Date.now() - t0), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return ms;
}

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
