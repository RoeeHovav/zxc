import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { requireUser } from "@/server/auth";
import { productionBoard, spoolOptions } from "@/server/services/production";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { firstParam } from "@/lib/utils";
import { ProductionBoard, type BoardJob } from "./board";

export const metadata: Metadata = { title: "Production" };

export default async function ProductionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser("production");
  const sp = await searchParams;
  const { jobs, printers } = await productionBoard();
  const materialIds = [...new Set(jobs.flatMap((j) => [j.materialId, ...j.items.map((i) => i.orderItem.materialId)]).filter((x): x is string => !!x))];
  const spools = await spoolOptions(materialIds);
  const data: BoardJob[] = jobs.map((j) => ({
    id: j.id,
    number: j.number,
    status: j.status,
    printerId: j.printerId,
    printerName: j.printer?.name ?? null,
    orderId: j.order.id,
    orderNumber: j.order.number,
    customer: j.order.customer.name,
    dueDate: j.order.dueDate?.toISOString() ?? null,
    priority: j.order.priority,
    materialId: j.materialId,
    materialLabel: j.material ? `${j.material.materialType.code} ${j.material.brand} ${j.material.colorName}` : null,
    colorHex: j.material?.colorHex ?? null,
    estimatedMinutes: j.estimatedMinutes?.toString() ?? null,
    estimatedGrams: j.estimatedGrams?.toString() ?? null,
    actualMinutes: j.actualMinutes?.toString() ?? null,
    actualGrams: j.actualGrams?.toString() ?? null,
    startedAt: j.startedAt?.toISOString() ?? null,
    queuePosition: j.queuePosition,
    failureReason: j.failureReason,
    hasReprint: j.reprints.length > 0,
    isReprint: !!j.reprintOfId,
    items: j.items.map((i) => ({ id: i.id, partName: i.orderItem.partName, quantity: i.quantity, quantityGood: i.quantityGood, materialId: i.orderItem.materialId })),
  }));
  return (
    <>
      <PageHeader title="Production" description="Drag cards or use the buttons. Finishing a print records actual time and filament used." />
      {data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="Nothing in production"
            description="Queue an order for production and create its print jobs from the order page."
            action={
              <Button asChild variant="secondary">
                <Link href="/orders?view=production">Orders in production</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <ProductionBoard
          jobs={data}
          printers={printers.map((p) => ({ id: p.id, name: p.name, status: p.status }))}
          spools={spools.map((s) => ({ id: s.id, code: s.code, materialId: s.materialId, remainingG: s.remainingG.toString(), measured: s.remainingIsMeasured, label: `${s.material.materialType.code} ${s.material.brand} ${s.material.colorName}` }))}
          highlight={firstParam(sp.job) ?? null}
          initialView={firstParam(sp.view) === "queues" ? "queues" : "board"}
        />
      )}
    </>
  );
}
