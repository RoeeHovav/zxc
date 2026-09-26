"use client";
import * as React from "react";
import { Popover } from "radix-ui";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
  swatch?: string | null;
  disabled?: boolean;
}

/** Searchable single-select. Fully keyboard operable (type, ↑/↓, Enter, Esc). */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  id,
  invalid,
  footer,
  allowClear,
  className,
  "aria-label": ariaLabel,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  invalid?: boolean;
  footer?: React.ReactNode;
  allowClear?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return options;
    const words = t.split(/\s+/);
    return options.filter((o) => words.every((w) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(w)));
  }, [q, options]);

  const choose = (o: ComboOption | null) => {
    if (o?.disabled) return;
    onChange(o ? o.value : null);
    setOpen(false);
    setQ("");
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o)
          setActive(
            Math.max(
              0,
              filtered.findIndex((f) => f.value === value),
            ),
          );
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          className={cn(
            "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-card px-3 text-start text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-ring aria-[invalid=true]:border-destructive",
            className,
          )}
        >
          {selected?.swatch !== undefined && selected && <span className="size-3.5 shrink-0 rounded-full border border-border" style={{ background: selected.swatch ?? "transparent" }} aria-hidden />}
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground/80")}>{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-64 overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-pop)]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, filtered.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered[active]) choose(filtered[active]);
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              aria-controls={listId}
              aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
              className="h-10 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
            {allowClear && value && (
              <li>
                <button type="button" onClick={() => choose(null)} className="w-full rounded-md px-2.5 py-2 text-start text-sm text-muted-foreground hover:bg-accent">
                  Clear selection
                </button>
              </li>
            )}
            {filtered.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">{emptyText}</li>}
            {filtered.map((o, i) => (
              <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm", i === active && "bg-accent", o.disabled && "cursor-not-allowed opacity-50")}
                >
                  {o.swatch !== undefined && <span className="size-3.5 shrink-0 rounded-full border border-border" style={{ background: o.swatch ?? "transparent" }} aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-muted-foreground">{o.hint}</span>}
                  </span>
                  {o.value === value && <Check className="size-4 text-primary" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          {footer && <div className="border-t border-border p-1">{footer}</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
