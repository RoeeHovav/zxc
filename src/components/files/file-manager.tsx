"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Box, Download, File as FileIcon, FileImage, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ACCEPT_ATTRIBUTE, formatBytes } from "@/domain/files";
import { deleteFileAction } from "./actions";
import { ModelPreviewButton } from "./model-viewer";
import { cn } from "@/lib/utils";
import { date } from "@/lib/format";

export interface FileRow {
  id: string;
  originalName: string;
  sizeBytes: number;
  kind: string;
  extension: string;
  createdAt: Date | string;
  purpose?: string | null;
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = { MODEL: Box, IMAGE: FileImage, DOCUMENT: FileText };

function uploadOne(file: File, target: Record<string, string>, purpose: string | undefined, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(target)) fd.append(k, v);
    if (purpose) fd.append("purpose", purpose);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `Upload failed (${xhr.status}).`;
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg;
        } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(fd);
  });
}

export function FileManager({
  target,
  files,
  title = "Files",
  purpose,
  disabled,
  compact,
}: {
  target: Record<string, string>;
  files: FileRow[];
  title?: string;
  purpose?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [progress, setProgress] = React.useState<{ name: string; p: number } | null>(null);
  const [drag, setDrag] = React.useState(false);

  const handle = async (list: FileList | null) => {
    if (!list?.length) return;
    let ok = 0;
    for (const f of Array.from(list)) {
      setProgress({ name: f.name, p: 0 });
      try {
        await uploadOne(f, target, purpose, (p) => setProgress({ name: f.name, p }));
        ok++;
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = "";
    if (ok) {
      toast.success(`${ok} file${ok > 1 ? "s" : ""} uploaded.`);
      router.refresh();
    }
  };

  const images = files.filter((f) => f.kind === "IMAGE" && ["png", "jpg", "jpeg", "gif", "webp"].includes(f.extension));

  const body = (
    <div
      className={cn("px-5 py-4", drag && "bg-primary-soft/60")}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!disabled) void handle(e.dataTransfer.files);
      }}
    >
      {images.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.slice(0, 8).map((f) => (
            <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/files/${f.id}`} alt={f.originalName} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
            </a>
          ))}
        </div>
      )}
      {files.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{disabled ? "No files." : "No files yet. Drop files here or use Upload."}</p>
      ) : (
        <ul className="divide-y divide-border">
          {files.map((f) => {
            const Icon = KIND_ICON[f.kind] ?? FileIcon;
            return (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:text-primary">
                    {f.originalName}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(f.sizeBytes)} · {date(f.createdAt)}
                    {f.purpose ? ` · ${f.purpose.toLowerCase()}` : ""}
                  </p>
                </div>
                <ModelPreviewButton fileId={f.id} name={f.originalName} extension={f.extension} sizeBytes={f.sizeBytes} />
                <Button variant="ghost" size="icon-sm" asChild>
                  <a href={`/api/files/${f.id}?download=1`} aria-label={`Download ${f.originalName}`}>
                    <Download />
                  </a>
                </Button>
                {!disabled && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.originalName}`}>
                        <Trash2 />
                      </Button>
                    }
                    title="Delete file?"
                    description={`“${f.originalName}” will be permanently deleted.`}
                    confirmLabel="Delete"
                    onConfirm={async () => {
                      const r = await deleteFileAction(f.id);
                      if (r.ok) {
                        toast.success("File deleted.");
                        router.refresh();
                      } else toast.error(r.error);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {progress && (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="truncate text-xs text-muted-foreground">Uploading {progress.name}…</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
        </div>
      )}
      <input ref={input} type="file" multiple hidden accept={ACCEPT_ATTRIBUTE} onChange={(e) => void handle(e.target.files)} />
    </div>
  );

  const uploadButton = !disabled && (
    <Button size="sm" variant="secondary" onClick={() => input.current?.click()} loading={!!progress}>
      <Upload /> Upload
    </Button>
  );

  if (compact)
    return (
      <div className="rounded-lg border border-dashed border-border">
        <div className="flex items-center justify-between px-5 pt-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Paperclip className="size-3.5" /> {title}
          </p>
          {uploadButton}
        </div>
        {body}
      </div>
    );
  return (
    <Card>
      <CardHeader title={title} description="STL, 3MF, STEP, OBJ, images, PDF…" actions={uploadButton} />
      {body}
    </Card>
  );
}
