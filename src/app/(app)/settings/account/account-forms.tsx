"use client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useFormAction } from "@/components/use-form-action";
import { changePasswordAction, signOutOtherSessionsAction, type FormState } from "@/app/(auth)/actions";

export function ChangePasswordForm() {
  const [state, onSubmit, pending] = useFormAction<FormState>(changePasswordAction, null);
  const fe = state?.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {state?.ok ? <Alert tone="success" title={state.message} /> : <FormError message={state?.error} />}
      <Field label="Current password" error={fe.current}>
        <Input name="current" type="password" autoComplete="current-password" />
      </Field>
      <Field label="New password" error={fe.password} hint="At least 10 characters.">
        <Input name="password" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" error={fe.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <Button type="submit" loading={pending} className="w-fit">
        Change password
      </Button>
    </form>
  );
}

export function SignOutOthers() {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        const r = await signOutOtherSessionsAction();
        toast.success(r?.message ?? "Done.");
        router.refresh();
      }}
    >
      <LogOut /> Sign out other devices
    </Button>
  );
}
