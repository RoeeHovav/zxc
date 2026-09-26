import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({
  className,
  title,
  description,
  actions,
  children,
}: {
  className?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        {title && <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>}
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}
