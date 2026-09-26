"use client";
import { useFormAction } from "@/components/use-form-action";
import { setupAction, type FormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";

export function SetupForm({ needsToken }: { needsToken: boolean }) {
  const [state, onSubmit, pending] = useFormAction<FormState>(setupAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormError message={state?.error} />
      <Field label="Business name" error={fe.businessName} required>
        <Input name="businessName" autoComplete="organization" />
      </Field>
      <Field label="Your name" error={fe.name} required>
        <Input name="name" autoComplete="name" />
      </Field>
      <Field label="Email" error={fe.email} required>
        <Input name="email" type="email" autoComplete="username" />
      </Field>
      <Field label="Password" error={fe.password} hint="At least 10 characters. A passphrase works well." required>
        <Input name="password" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" error={fe.confirm} required>
        <Input name="confirm" type="password" autoComplete="new-password" />
      </Field>
      {needsToken && (
        <Field label="Setup token" error={fe.token} hint="The SETUP_TOKEN value from the server environment." required>
          <Input name="token" type="password" autoComplete="off" />
        </Field>
      )}
      <Button type="submit" size="lg" loading={pending} className="mt-1 w-full">
        Create account
      </Button>
    </form>
  );
}
