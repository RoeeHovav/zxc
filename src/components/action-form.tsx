"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, FormError, Input, Select, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/use-form-action";
import type { ActionResult } from "@/server/action";
import { cn } from "@/lib/utils";

type AnyResult = ActionResult<unknown> | null;
const ErrorsContext = React.createContext<Record<string, string>>({});

export function useFieldError(name: string) {
  return React.useContext(ErrorsContext)[name];
}

/**
 * Standard form wired to a server action returning ActionResult.
 * Handles field errors, generic errors, pending state, toasts and follow-up navigation.
 */
export function ActionForm<T>({
  action,
  children,
  submitLabel = "Save",
  successMessage,
  redirectTo,
  onSuccess,
  className,
  footer,
  cancel,
  submitVariant = "primary",
}: {
  action: (prev: AnyResult, fd: FormData) => Promise<ActionResult<T>>;
  children: React.ReactNode;
  submitLabel?: string;
  successMessage?: string;
  redirectTo?: string | ((data: T) => string);
  onSuccess?: (data: T) => void;
  className?: string;
  footer?: "inline" | "none" | "card";
  cancel?: React.ReactNode;
  submitVariant?: "primary" | "danger";
}) {
  const router = useRouter();
  const [state, onSubmit, pending] = useFormAction<AnyResult>(action as (prev: AnyResult, fd: FormData) => Promise<AnyResult>, null);
  const handled = React.useRef<AnyResult>(null);
  React.useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) {
      const msg = successMessage ?? state.message;
      if (msg) toast.success(msg);
      onSuccess?.(state.data as T);
      if (redirectTo) router.push(typeof redirectTo === "function" ? redirectTo(state.data as T) : redirectTo);
      else router.refresh();
    } else if (!state.fieldErrors || Object.keys(state.fieldErrors).length === 0) {
      toast.error(state.error);
    }
  }, [state, successMessage, onSuccess, redirectTo, router]);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <ErrorsContext.Provider value={errors}>
      <form onSubmit={onSubmit} noValidate className={cn("grid gap-4", className)}>
        {state && !state.ok && <FormError message={state.error} />}
        {children}
        {footer !== "none" && (
          <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", footer === "card" && "-mx-5 -mb-4 mt-2 border-t border-border px-5 py-3")}>
            {cancel}
            <Button type="submit" loading={pending} variant={submitVariant}>
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </ErrorsContext.Provider>
  );
}

type Common = { name: string; label: React.ReactNode; hint?: React.ReactNode; required?: boolean; className?: string };

export function TextField({ name, label, hint, required, className, suffix, ...rest }: Common & { suffix?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = useFieldError(name);
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} suffix={suffix}>
      <Input name={name} {...rest} />
    </Field>
  );
}

export function NumberField({ name, label, hint, required, className, suffix, ...rest }: Common & { suffix?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const error = useFieldError(name);
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className} suffix={suffix}>
      <Input name={name} type="text" inputMode="decimal" autoComplete="off" className={cn("tabular", suffix ? "pe-12" : undefined)} {...rest} />
    </Field>
  );
}

export function SelectField({ name, label, hint, required, className, options, placeholder, ...rest }: Common & { options: { value: string; label: string }[]; placeholder?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const error = useFieldError(name);
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      <Select name={name} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function TextareaField({ name, label, hint, required, className, ...rest }: Common & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const error = useFieldError(name);
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      <Textarea name={name} {...rest} />
    </Field>
  );
}

export function CheckboxField({ name, label, hint, className, ...rest }: Omit<Common, "required"> & React.InputHTMLAttributes<HTMLInputElement>) {
  return <Checkbox name={name} label={label} hint={hint} className={className} {...rest} />;
}
