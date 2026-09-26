"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { saveCustomerAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox, Field, FormError, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { enumLabel } from "@/lib/labels";
import type { ActionResult } from "@/server/action";
import { useFormAction } from "@/components/use-form-action";

type Candidate = { id: string; number: string; name: string; company: string | null; email: string | null; phone: string | null; reason: string };

export interface CustomerFormValues {
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredContact?: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  taxId?: string | null;
  vatExempt?: boolean;
  notes?: string | null;
  tags?: string[];
  pricingPolicyId?: string | null;
  marketingConsent?: boolean;
}

export function CustomerForm({ id, initial, policies, returnTo }: { id: string | null; initial?: CustomerFormValues; policies: { id: string; name: string }[]; returnTo?: string }) {
  const router = useRouter();
  const [state, onSubmit, pending] = useFormAction<ActionResult<{ id: string }> | null>(saveCustomerAction.bind(null, id), null);
  const [allowDuplicate, setAllowDuplicate] = React.useState(false);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const candidates = state && !state.ok ? ((state.details?.candidates as Candidate[] | undefined) ?? []) : [];
  const v = initial ?? {};

  React.useEffect(() => {
    if (state?.ok) {
      toast.success(id ? "Customer updated." : "Customer created.");
      router.push(returnTo ? `${returnTo}${returnTo.includes("?") ? "&" : "?"}customerId=${state.data.id}` : `/customers/${state.data.id}`);
    }
  }, [state, id, router, returnTo]);

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardContent className="grid gap-6 py-6">
          {state && !state.ok && candidates.length === 0 && <FormError message={state.error} />}
          {candidates.length > 0 && (
            <Alert tone="warning" icon={AlertTriangle} title="Possible duplicate">
              <p>These existing customers look similar:</p>
              <ul className="my-2 space-y-1">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <Link href={`/customers/${c.id}`} className="font-medium underline" target="_blank">
                      {c.number} · {c.name}
                    </Link>{" "}
                    <span className="opacity-80">({c.reason})</span>
                  </li>
                ))}
              </ul>
              <Checkbox name="allowDuplicate" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} label="This is a different customer — save anyway" />
            </Alert>
          )}
          <FormSection title="Contact" description="Who the customer is and how they prefer to be reached.">
            <Field label="Full name" error={fe.name} required className="sm:col-span-2">
              <Input name="name" defaultValue={v.name ?? ""} autoComplete="off" autoFocus={!id} />
            </Field>
            <Field label="Company" error={fe.company}>
              <Input name="company" defaultValue={v.company ?? ""} />
            </Field>
            <Field label="Preferred contact" error={fe.preferredContact}>
              <Select name="preferredContact" defaultValue={v.preferredContact ?? "PHONE"}>
                {["PHONE", "WHATSAPP", "EMAIL", "SMS", "OTHER"].map((m) => (
                  <option key={m} value={m}>
                    {enumLabel("contactMethod", m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Phone" error={fe.phone}>
              <Input name="phone" type="tel" inputMode="tel" defaultValue={v.phone ?? ""} placeholder="050-000-0000" />
            </Field>
            <Field label="Email" error={fe.email}>
              <Input name="email" type="email" defaultValue={v.email ?? ""} />
            </Field>
          </FormSection>
          <FormSection title="Delivery address" description="Used on delivery notes and order confirmations.">
            <Field label="Street address" error={fe.addressLine1} className="sm:col-span-2">
              <Input name="addressLine1" defaultValue={v.addressLine1 ?? ""} autoComplete="off" />
            </Field>
            <Field label="Apartment, floor, etc." error={fe.addressLine2} className="sm:col-span-2">
              <Input name="addressLine2" defaultValue={v.addressLine2 ?? ""} />
            </Field>
            <Field label="City" error={fe.city}>
              <Input name="city" defaultValue={v.city ?? ""} />
            </Field>
            <Field label="Postal code" error={fe.postalCode}>
              <Input name="postalCode" defaultValue={v.postalCode ?? ""} />
            </Field>
            <Field label="Country" error={fe.country}>
              <Input name="country" defaultValue={v.country ?? "Israel"} />
            </Field>
          </FormSection>
          <FormSection title="Billing & pricing" description="Tax details for business customers and their default pricing policy.">
            <Field label="Tax ID (ח.פ. / ע.מ.)" error={fe.taxId}>
              <Input name="taxId" defaultValue={v.taxId ?? ""} />
            </Field>
            <Field label="Pricing policy" error={fe.pricingPolicyId} hint="Leave empty to use the default policy.">
              <Select name="pricingPolicyId" defaultValue={v.pricingPolicyId ?? ""}>
                <option value="">Default</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox name="vatExempt" defaultChecked={v.vatExempt} label="VAT exempt customer" hint="No VAT will be added to this customer's documents (e.g. export)." className="sm:col-span-2" />
          </FormSection>
          <FormSection title="Notes & privacy" description="Internal notes are never printed on customer documents.">
            <Field label="Tags" error={fe.tags} hint="Comma separated, e.g. wholesale, cosplay" className="sm:col-span-2">
              <Input name="tags" defaultValue={(v.tags ?? []).join(", ")} />
            </Field>
            <Field label="Internal notes" error={fe.notes} className="sm:col-span-2">
              <Textarea name="notes" defaultValue={v.notes ?? ""} rows={3} />
            </Field>
            <Checkbox
              name="marketingConsent"
              defaultChecked={v.marketingConsent}
              label="Consents to marketing messages"
              hint="Record explicit consent only. PrintForge never sends messages automatically."
              className="sm:col-span-2"
            />
          </FormSection>
        </CardContent>
        <CardFooter>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={candidates.length > 0 && !allowDuplicate}>
            {id ? "Save changes" : "Create customer"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
