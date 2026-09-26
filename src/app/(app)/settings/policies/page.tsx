import type { Metadata } from "next";
import { requireUser } from "@/server/auth";
import { listPolicies } from "@/server/services/settings";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/misc";
import { money, percent } from "@/lib/format";
import { D } from "@/domain/money";
import { markupToMargin, marginToMarkup } from "@/domain/pricing/engine";
import { PolicyDialog, PolicyArchiveButton } from "./policy-dialog";

export const metadata: Metadata = { title: "Pricing policies" };

export default async function PoliciesPage() {
  await requireUser("settings");
  const policies = await listPolicies(true);
  const pct = (v: { toString(): string }) => new D(v.toString()).times(100).toString();
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Pricing policies" description="Choose one per quote/order, or set a default per customer (e.g. wholesale)." actions={<PolicyDialog />} />
        <ul className="divide-y divide-border">
          {policies.map((p) => {
            const equivalent = p.method === "MARKUP" ? `≈ ${percent(markupToMargin(new D(p.markupPercent.toString())).toString())} margin` : `≈ ${percent(marginToMarkup(new D(p.marginPercent.toString())).toString())} markup`;
            return (
              <li key={p.id} className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${p.isArchived ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <p className="font-medium">
                    {p.name}
                    {p.isDefault && (
                      <Badge tone="primary" className="ms-2">
                        Default
                      </Badge>
                    )}
                    {p.isArchived && (
                      <Badge tone="muted" className="ms-2">
                        Archived
                      </Badge>
                    )}
                  </p>
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {p.method === "MARKUP" ? `${percent(p.markupPercent)} markup on cost` : `${percent(p.marginPercent)} target margin`} ({equivalent}) · minimum order {money(p.minimumOrderCharge)} · warn below {percent(p.minimumMarginPercent)} margin · round {p.roundingMode === "UP" ? "up" : "to nearest"} to {money(p.priceRoundingStep)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <PolicyDialog
                    id={p.id}
                    initial={{
                      name: p.name,
                      description: p.description ?? "",
                      method: p.method,
                      markupPercent: pct(p.markupPercent),
                      marginPercent: pct(p.marginPercent),
                      minimumOrderCharge: p.minimumOrderCharge.toString(),
                      minimumMarginPercent: pct(p.minimumMarginPercent),
                      priceRoundingStep: p.priceRoundingStep.toString(),
                      roundingMode: p.roundingMode,
                      isDefault: p.isDefault,
                    }}
                  />
                  {!p.isDefault && <PolicyArchiveButton id={p.id} archived={p.isArchived} />}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="self-start">
        <CardHeader title="Markup vs. margin" />
        <CardContent className="grid gap-3 text-sm">
          <p>
            <strong>Markup</strong> is profit as a share of <em>cost</em>: price = cost × (1 + markup).
          </p>
          <p>
            <strong>Gross margin</strong> is profit as a share of the <em>price</em>: price = cost ÷ (1 − margin).
          </p>
          <div className="rounded-lg bg-muted p-3 text-xs">
            Cost ₪100 → 50% markup = <strong>₪150</strong> (33% margin) · 50% margin = <strong>₪200</strong> (100% markup)
          </div>
          <Alert tone="info">Changing a policy never alters existing quotes or orders — they keep the policy captured when priced.</Alert>
        </CardContent>
      </Card>
    </div>
  );
}
