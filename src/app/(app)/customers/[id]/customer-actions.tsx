"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Download, MoreHorizontal, Pencil, ShieldOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dialog";
import { anonymizeCustomerAction, archiveCustomerAction, deleteCustomerAction } from "../actions";

export function CustomerActions({ id, archived, anonymized, number }: { id: string; archived: boolean; anonymized: boolean; number: string }) {
  const router = useRouter();
  const report = (r: { ok: boolean; error?: string; message?: string }) => {
    if (r.ok) toast.success(r.message ?? "Done.");
    else toast.error(r.error);
    return r.ok;
  };
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {!anonymized && (
            <DropdownMenuItem asChild>
              <Link href={`/customers/${id}/edit`}>
                <Pencil /> Edit
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <a href={`/api/customers/${id}/export`} download>
              <Download /> Export personal data (JSON)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => report(await archiveCustomerAction(id, !archived)) && router.refresh()}>
            {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Restore from archive" : "Archive"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!anonymized && (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon" aria-label="Erase personal data" title="Erase personal data">
              <ShieldOff />
            </Button>
          }
          title="Erase personal data?"
          description="Name, contact details, address, tax ID, notes and customer files are permanently erased. Orders, payments and document numbers are kept for accounting retention. This cannot be undone."
          confirmLabel="Erase personal data"
          requireText={number}
          onConfirm={async () => {
            if (report(await anonymizeCustomerAction(id))) router.refresh();
          }}
        />
      )}
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon" aria-label="Delete customer" title="Delete customer">
            <Trash2 />
          </Button>
        }
        title="Delete this customer?"
        description="Only customers without quotes, orders, payments or designs can be deleted. Otherwise archive or erase personal data instead."
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          if (report(await deleteCustomerAction(id))) router.push("/customers");
        }}
      />
    </div>
  );
}
