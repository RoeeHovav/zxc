import { requireApiUser } from "@/server/auth";
import { apiHandler, contentDisposition } from "@/server/api";
import { exportCustomerData } from "@/server/services/customers";
import { prisma } from "@/server/db";
import { audit } from "@/server/services/common";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiHandler(async () => {
    const user = await requireApiUser("customers");
    const { id } = await params;
    const data = await exportCustomerData(id);
    await prisma.$transaction((tx) => audit(tx, { userId: user.id, entityType: "CUSTOMER", entityId: id, action: "EXPORT", summary: `Exported personal data for ${data.customer.number}` }));
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": contentDisposition("attachment", `customer-${data.customer.number}.json`),
        "Cache-Control": "no-store",
      },
    });
  });
}
