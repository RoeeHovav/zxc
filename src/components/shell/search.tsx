"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { Boxes, ClipboardList, FileText, Layers, Loader2, PenTool, Printer, Search, Users } from "lucide-react";
import { searchAction } from "@/app/(app)/search-action";
import type { SearchHit } from "@/server/services/search";
import { cn } from "@/lib/utils";

const ICONS: Record<SearchHit["type"], React.ComponentType<{ className?: string }>> = {
  customer: Users,
  order: ClipboardList,
  quote: FileText,
  material: Boxes,
  design: PenTool,
  printer: Printer,
  job: Layers,
};
const LABELS: Record<SearchHit["type"], string> = {
  customer: "Customers",
  order: "Orders",
  quote: "Quotations",
  design: "Designs",
  material: "Materials",
  printer: "Printers",
  job: "Print jobs",
};

export function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [results, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (q.trim().length < 2) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchAction(q);
        if (id === reqId.current) {
          setHits(res);
          setActive(0);
        }
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const hits = q.trim().length < 2 ? [] : results;
  const go = (hit: SearchHit) => {
    setOpen(false);
    setQ("");
    router.push(hit.href);
  };

  const grouped = Object.entries(
    hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
      (acc[h.type] ??= []).push(h);
      return acc;
    }, {}),
  );

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground shadow-sm hover:border-primary/40">
        <Search className="size-4" aria-hidden />
        <span className="truncate">Search customers, orders, parts…</span>
        <kbd className="ms-auto hidden rounded border border-border bg-muted px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <D.Content className="fixed inset-x-3 top-[10vh] z-50 mx-auto max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-pop)] outline-none">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search across customers, orders, quotations, materials, designs and printers</D.Description>
          <div className="flex items-center gap-2 border-b border-border px-4">
            {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : <Search className="size-4 text-muted-foreground" />}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, hits.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && hits[active]) {
                  e.preventDefault();
                  go(hits[active]);
                }
              }}
              placeholder="Search by name, phone, order #, part name…"
              aria-label="Search"
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls="search-results"
              aria-activedescendant={hits[active] ? `hit-${hits[active].type}-${hits[active].id}` : undefined}
              className="h-12 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <div id="search-results" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
            {q.trim().length < 2 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Type at least 2 characters.</p>
            ) : !loading && hits.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No results for “{q}”.</p>
            ) : (
              grouped.map(([type, list]) => (
                <div key={type} className="mb-2">
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{LABELS[type as SearchHit["type"]]}</p>
                  {list.map((h) => {
                    const idx = hits.indexOf(h);
                    const Icon = ICONS[h.type];
                    return (
                      <button
                        key={h.id}
                        id={`hit-${h.type}-${h.id}`}
                        role="option"
                        aria-selected={idx === active}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(h)}
                        className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-start", idx === active && "bg-accent")}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{h.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
