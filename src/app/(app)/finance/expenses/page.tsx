import Link from "next/link";
import type { Metadata } from "next";
import { Download, Paperclip, Plus, Receipt } from "lucide-react";
import { requireUser } from "@/server/auth";
import { listExpenses } from "@/server/services/finance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SearchInput } from "@/components/list-controls";
import { PeriodPicker } from "@/components/period-picker";
import { enumLabel } from "@/lib/labels";
import { date, money } from "@/lib/format";
import { firstParam } from "@/lib/utils";
import { dec, ZERO } from "@/domain/money";
import { PERIOD_OPTIONS, resolvePeriod } from "../period";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("finance");
  const sp = await searchParams;
  const period = resolvePeriod({ ...sp, period: firstParam(sp.period) ?? "year" });
  const category = firstParam(sp.category);
  const q = firstParam(sp.q);
  const rows = await listExpenses({ from: period.from, to: period.to, category, q });
  const total = rows.reduce((a, r) => a.plus(dec(r.amount.toString())), ZERO);
  const qs = `period=${period.key}${period.key === "custom" ? `&from=${firstParam(sp.from) ?? ""}&to=${firstParam(sp.to) ?? ""}` : ""}${category ? `&category=${category}` : ""}`;
  return (
    <>
      <PageHeader
        title="Expenses"
        description={`${period.label}${category ? ` · ${enumLabel("expenseCategory", category)}` : ""} · ${rows.length} item(s) · ${money(total.toFixed(2))}`}
        back={{ href: "/finance", label: "Finance" }}
        actions={
          <>
            <PeriodPicker options={PERIOD_OPTIONS} current={period.key} from={firstParam(sp.from)} to={firstParam(sp.to)} />
            <Button variant="secondary" asChild>
              <a href={`/api/export/expenses?${qs}`}>
                <Download /> CSV
              </a>
            </Button>
            <Button asChild>
              <Link href="/finance/expenses/new">
                <Plus /> Expense
              </Link>
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {category && (
              <Link href={`/finance/expenses?period=${period.key}`}>
                <Badge tone="primary">{enumLabel("expenseCategory", category)} ✕</Badge>
              </Link>
            )}
          </div>
          <SearchInput placeholder="Description, supplier, reference…" />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Receipt} title="No expenses" description="Record rent, software, maintenance parts, shipping and other costs to see indicative net profit." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Description</TH>
                <TH className="hidden md:table-cell">Category</TH>
                <TH className="hidden lg:table-cell">Supplier</TH>
                <TH className="text-end">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {rows.map((e) => (
                <TR key={e.id} className="relative">
                  <TD className="whitespace-nowrap text-muted-foreground">{date(e.date)}</TD>
                  <TD>
                    <Link href={`/finance/expenses/${e.id}`} className="font-medium after:absolute after:inset-0 hover:text-primary">
                      {e.description}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {e.reference && <span>{e.reference}</span>}
                      {e.printer && <span>· {e.printer.name}</span>}
                      {e._count.files > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <Paperclip className="size-3" /> {e._count.files}
                        </span>
                      )}
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <Badge>{enumLabel("expenseCategory", e.category)}</Badge>
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{e.supplier?.name ?? "—"}</TD>
                  <TD className="tabular text-end">
                    {money(e.amount)}
                    {Number(e.vatAmount) > 0 && <div className="text-xs text-muted-foreground">VAT {money(e.vatAmount)}</div>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
