"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/form";

export function TypeFilter({ types, current }: { types: string[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Select
      aria-label="Filter by material type"
      value={current}
      className="sm:w-36"
      onChange={(e) => {
        const sp = new URLSearchParams(params.toString());
        if (e.target.value) sp.set("type", e.target.value);
        else sp.delete("type");
        router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
      }}
    >
      <option value="">All types</option>
      {types.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </Select>
  );
}
