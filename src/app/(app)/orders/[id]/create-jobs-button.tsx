"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createJobsAction } from "../actions";

export function CreateJobsButton({ orderId, units }: { orderId: string; units: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const r = await createJobsAction(orderId);
        setBusy(false);
        if (r.ok) {
          toast.success(`Created ${r.data.length} job(s): ${r.data.join(", ")}`);
          router.refresh();
        } else toast.error(r.error);
      }}
    >
      <ListPlus /> Create jobs ({units} unit{units === 1 ? "" : "s"})
    </Button>
  );
}
