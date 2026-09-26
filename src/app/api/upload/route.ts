import { NextResponse } from "next/server";
import { assertSameOrigin, requireApiUser } from "@/server/auth";
import { apiHandler } from "@/server/api";
import { saveUpload, type AttachTarget } from "@/server/services/files";
import { ServiceError } from "@/server/services/common";

const TARGET_KEYS: (keyof AttachTarget)[] = ["customerId", "quoteId", "quoteItemId", "orderId", "orderItemId", "designProjectId", "printJobId", "expenseId"];

export async function POST(request: Request) {
  return apiHandler(async () => {
    const user = await requireApiUser();
    assertSameOrigin(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ServiceError("The upload could not be read. It may be too large or interrupted.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ServiceError("No file was provided.");
    const target: AttachTarget = {};
    for (const k of TARGET_KEYS) {
      const v = form.get(k);
      if (typeof v === "string" && v) target[k] = v.slice(0, 40);
    }
    const purpose = typeof form.get("purpose") === "string" ? String(form.get("purpose")).slice(0, 40) : null;
    const bytes = Buffer.from(await file.arrayBuffer());
    const rec = await saveUpload(user.id, { name: file.name, bytes }, target, purpose);
    return NextResponse.json({ id: rec.id, name: rec.originalName, size: rec.sizeBytes });
  });
}
