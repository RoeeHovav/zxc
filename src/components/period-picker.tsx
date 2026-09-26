"use client";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";

export function PeriodPicker({ options, current, from, to }: { options: { value: string; label: string }[]; current: string; from?: string; to?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [f, setF] = React.useState(from ?? "");
  const [t, setT] = React.useState(to ?? "");
  const push = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.replace(`${pathname}?${sp}`, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select aria-label="Period" value={current} onChange={(e) => push({ period: e.target.value, ...(e.target.value !== "custom" ? { from: null, to: null } : {}) })} className="w-40">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {current === "custom" && (
        <>
          <Input type="date" aria-label="From" value={f} onChange={(e) => setF(e.target.value)} className="w-40" />
          <Input type="date" aria-label="To" value={t} onChange={(e) => setT(e.target.value)} className="w-40" />
          <Button size="md" variant="secondary" onClick={() => push({ period: "custom", from: f, to: t })}>
            Apply
          </Button>
        </>
      )}
    </div>
  );
}
