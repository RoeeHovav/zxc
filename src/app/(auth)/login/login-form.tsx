"use client";
import { useFormAction } from "@/components/use-form-action";
import { loginAction, type FormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";

export function LoginForm({ next }: { next: string }) {
  const [state, onSubmit, pending] = useFormAction<FormState>(loginAction, null);
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state?.error} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        Sign in
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Forgot your password? Run <code className="rounded bg-muted px-1 py-0.5">npm run user:reset-password</code> on the server (see README).
      </p>
    </form>
  );
}
