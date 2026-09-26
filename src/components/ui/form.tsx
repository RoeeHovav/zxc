import * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:outline-destructive";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-9", props.type === "number" && "tabular", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

/** Native select: best mobile UX and fully keyboard accessible. */
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(control, "h-9 pe-8 appearance-none bg-[length:16px] bg-[position:right_0.5rem_center] rtl:bg-[position:left_0.5rem_center] bg-no-repeat", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-foreground", className)} {...props} />;
}

export function Checkbox({ label, hint, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input id={props.id ?? id} type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-input accent-[var(--primary)]" {...props} />
      <div className="grid gap-0.5">
        <label htmlFor={props.id ?? id} className="text-sm font-medium leading-snug">
          {label}
        </label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  error?: string | null;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactElement<Record<string, unknown>>;
  suffix?: React.ReactNode;
}

/** Label + control + hint + accessible error message. */
export function Field({ label, htmlFor, error, hint, required, className, children, suffix }: FieldProps) {
  const autoId = React.useId();
  const id = htmlFor ?? (children.props.id as string | undefined) ?? autoId;
  const errId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const control = React.cloneElement(children, {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    required: children.props.required ?? required,
  });
  return (
    <div className={cn("grid gap-1.5 content-start", className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="text-destructive ms-0.5" aria-hidden>
            *
          </span>
        )}
      </Label>
      {suffix ? (
        <div className="relative">
          {control}
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">{suffix}</span>
        </div>
      ) : (
        control
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-4 border-b border-border pb-6 last:border-0 last:pb-0 md:grid-cols-[220px_1fr] md:gap-8", className)}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm text-destructive">
      {message}
    </div>
  );
}
