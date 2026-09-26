"use client";
import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { integrityCheckAction } from "../actions";

type Report = Awaited<ReturnType<typeof integrityCheckAction>>;

export function IntegrityCheck() {
  const [busy, setBusy] = React.useState(false);
  const [r, setR] = React.useState<Report | null>(null);
  const run = async () => {
    setBusy(true);
    setR(await integrityCheckAction());
    setBusy(false);
  };
  const data = r?.ok ? r.data : null;
  const issues = data ? data.payments.length + data.spoolMismatches.length + data.itemMismatches.length + data.statusMismatches.length + data.missingFiles.length : 0;
  return (
    <div className="grid gap-3">
      <Button onClick={run} loading={busy} variant="secondary" className="w-fit">
        <ShieldCheck /> Run integrity check
      </Button>
      {r && !r.ok && <Alert tone="danger" title={r.error} />}
      {data && issues === 0 && (
        <Alert tone="success" title="No inconsistencies found.">
          {data.orphanFiles.length ? `${data.orphanFiles.length} stored file(s) are not linked to any record (safe to review).` : "Stored files match their records."}
        </Alert>
      )}
      {data && issues > 0 && (
        <Alert tone="warning" title={`${issues} inconsistency(ies) found`}>
          <ul className="list-disc ps-4">
            {data.payments.map((p) => (
              <li key={p.number}>
                {p.number}: cached paid {p.cached}, ledger {p.ledger}
              </li>
            ))}
            {data.spoolMismatches.map((s) => (
              <li key={s.code}>
                Spool {s.code}: remaining {s.cached} g, ledger {s.ledger} g
              </li>
            ))}
            {data.itemMismatches.map((i, k) => (
              <li key={k}>
                {i.order} “{i.part}”: completed {i.cached}, jobs say {i.jobs}
              </li>
            ))}
            {data.statusMismatches.map((s) => (
              <li key={s.number}>
                {s.number}: status {s.status}, production data implies {s.expected}
              </li>
            ))}
            {data.missingFiles.map((f) => (
              <li key={f}>Missing stored file: {f}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
