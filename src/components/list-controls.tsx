"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Debounced search box that keeps its value in the URL (?q=) so results are shareable and survive reloads. */
export function SearchInput({ placeholder = "Search…", param = "q" }: { placeholder?: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = React.useState(params.get(param) ?? "");
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params.toString());
      if (value) sp.set(param, value);
      else sp.delete(param);
      sp.delete("page");
      router.replace(`${pathname}${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md border border-input bg-card ps-9 pe-8 text-sm shadow-sm placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => setValue("")} className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** Segmented filter links (server-driven via URL params). */
export function FilterTabs({ options, param = "filter", current }: { options: { value: string; label: string; count?: number }[]; param?: string; current: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div role="tablist" aria-label="Filter" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
      {options.map((o) => {
        const sp = new URLSearchParams(params.toString());
        if (o.value === options[0].value) sp.delete(param);
        else sp.set(param, o.value);
        sp.delete("page");
        const active = current === o.value;
        return (
          <Link
            key={o.value}
            role="tab"
            aria-selected={active}
            href={`${pathname}${sp.toString() ? `?${sp}` : ""}`}
            scroll={false}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="ms-1.5 tabular text-muted-foreground">{o.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}
