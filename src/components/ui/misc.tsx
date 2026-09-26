import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, qs } from "@/lib/utils";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "muted";

const toneClass: Record<Tone, string> = {
  neutral: "bg-accent text-foreground ring-border",
  primary: "bg-primary-soft text-primary ring-primary/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-destructive-soft text-destructive ring-destructive/20",
  info: "bg-info-soft text-info ring-info/20",
  muted: "bg-muted text-muted-foreground ring-border",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", toneClass[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions, back, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string }; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            {back.label}
          </Link>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Icon className="size-6" />
        </div>
      )}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} aria-hidden />;
}

export function Stat({ label, value, hint, tone, icon: Icon, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; icon?: React.ComponentType<{ className?: string }>; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn("size-4 text-muted-foreground", tone && tone !== "neutral" && toneClass[tone].split(" ")[1])} />}
      </div>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-primary/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function KeyValue({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 break-words font-medium">{v ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({ page, pageSize, total, params }: { page: number; pageSize: number; total: number; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="px-5 py-3 text-xs text-muted-foreground">{total} result{total === 1 ? "" : "s"}</p>;
  const link = (p: number) => qs({ ...params, page: p > 1 ? p : undefined });
  return (
    <nav className="flex items-center justify-between gap-2 px-5 py-3 text-xs text-muted-foreground" aria-label="Pagination">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1">
        {page > 1 ? (
          <Link href={link(page - 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 hover:bg-accent" aria-label="Previous page">
            <ChevronLeft className="size-3.5 rtl:rotate-180" /> Prev
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={link(page + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 hover:bg-accent" aria-label="Next page">
            Next <ChevronRight className="size-3.5 rtl:rotate-180" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export function Alert({ tone = "info", title, children, className, icon: Icon }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; className?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg px-4 py-3 text-sm ring-1 ring-inset", toneClass[tone], className)}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-[13px] leading-relaxed opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}
