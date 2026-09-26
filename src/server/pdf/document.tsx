import "server-only";
import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { CustomerDocument } from "../services/customer-documents";

const FONT_DIR = path.join(process.cwd(), "src/assets/fonts");
Font.register({
  family: "Heebo",
  fonts: [
    { src: path.join(FONT_DIR, "Heebo-400.woff"), fontWeight: 400 },
    { src: path.join(FONT_DIR, "Heebo-700.woff"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const moneyFmt = (currency: string) => new Intl.NumberFormat("en-IL", { style: "currency", currency, minimumFractionDigits: 2 });

const s = StyleSheet.create({
  page: { fontFamily: "Heebo", fontSize: 9.5, color: "#1f2937", paddingTop: 36, paddingBottom: 64, paddingHorizontal: 40, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  bizName: { fontSize: 15, fontWeight: 700, color: "#111827", lineHeight: 1.25, marginBottom: 3 },
  muted: { color: "#6b7280" },
  small: { fontSize: 8.5 },
  docTitle: { fontSize: 20, fontWeight: 700, textAlign: "right", lineHeight: 1.2, marginBottom: 4 },
  docNumber: { fontSize: 10, textAlign: "right", marginTop: 2 },
  row: { flexDirection: "row" },
  parties: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18, gap: 24 },
  box: { flex: 1 },
  label: { fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, color: "#6b7280", marginBottom: 3, fontWeight: 700 },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#d1d5db", paddingBottom: 5, marginBottom: 2 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 6 },
  cDesc: { flex: 1, paddingRight: 8 },
  cQty: { width: 42, textAlign: "right" },
  cUnit: { width: 72, textAlign: "right" },
  cTotal: { width: 80, textAlign: "right" },
  th: { fontSize: 7.5, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 },
  totals: { alignSelf: "flex-end", width: 230, marginTop: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  grand: { borderTopWidth: 1, borderTopColor: "#111827", marginTop: 4, paddingTop: 5, fontSize: 11.5, fontWeight: 700, lineHeight: 1.3 },
  notes: { marginTop: 20, gap: 10 },
  footer: { position: "absolute", bottom: 26, left: 40, right: 40, borderTopWidth: 0.5, borderTopColor: "#e5e7eb", paddingTop: 6, fontSize: 7.5, color: "#6b7280" },
});

function CustomerPdf({ doc }: { doc: CustomerDocument }) {
  const fmt = moneyFmt(doc.currency);
  const m = (v: string | null) => (v === null ? "" : fmt.format(v as unknown as number));
  const accent = doc.business.brandColor;
  return (
    <Document title={`${doc.title} ${doc.number}`} author={doc.business.name} creator="PrintForge" producer="PrintForge">
      <Page size="A4" style={s.page}>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, backgroundColor: accent }} fixed />
        <View style={s.header}>
          <View style={{ maxWidth: 280 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt attribute */}
            {doc.business.logo && <Image src={{ data: doc.business.logo.data, format: doc.business.logo.format }} style={{ maxHeight: 48, maxWidth: 160, marginBottom: 8, objectFit: "contain" }} />}
            <Text style={s.bizName}>{doc.business.name}</Text>
            {doc.business.legalName && <Text style={s.muted}>{doc.business.legalName}</Text>}
            {doc.business.address.map((l, i) => (
              <Text key={i} style={s.muted}>
                {l}
              </Text>
            ))}
            <Text style={s.muted}>{[doc.business.phone, doc.business.email, doc.business.website].filter(Boolean).join(" · ")}</Text>
            {doc.business.taxId && <Text style={s.muted}>Business ID: {doc.business.taxId}</Text>}
          </View>
          <View>
            <Text style={[s.docTitle, { color: accent }]}>{doc.title}</Text>
            <Text style={s.docNumber}>{doc.number}</Text>
            <Text style={[s.docNumber, s.muted]}>Date: {doc.issueDate}</Text>
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.box}>
            <Text style={s.label}>{doc.kind === "DELIVERY_NOTE" ? "Deliver to" : "Bill to"}</Text>
            <Text style={{ fontWeight: 700 }}>{doc.customer.name}</Text>
            {doc.customer.company && <Text>{doc.customer.company}</Text>}
            {doc.customer.address.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            {doc.customer.phone && <Text style={s.muted}>{doc.customer.phone}</Text>}
            {doc.customer.email && <Text style={s.muted}>{doc.customer.email}</Text>}
            {doc.customer.taxId && <Text style={s.muted}>Tax ID: {doc.customer.taxId}</Text>}
          </View>
          <View style={[s.box, { alignItems: "flex-end" }]}>
            {doc.reference && (
              <>
                <Text style={s.label}>Reference</Text>
                <Text style={{ marginBottom: 6 }}>{doc.reference}</Text>
              </>
            )}
            {doc.meta.map(([k, v]) => (
              <View key={k} style={[s.row, { gap: 6 }]}>
                <Text style={s.muted}>{k}:</Text>
                <Text>{/^-?\d+(\.\d+)?$/.test(v) ? m(v) : v}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={s.tableHead} fixed>
          <Text style={[s.cDesc, s.th]}>Description</Text>
          <Text style={[s.cQty, s.th]}>Qty</Text>
          {doc.showPrices && <Text style={[s.cUnit, s.th]}>Unit price</Text>}
          {doc.showPrices && <Text style={[s.cTotal, s.th]}>Amount</Text>}
        </View>
        {doc.lines.map((l, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <View style={s.cDesc}>
              <Text style={{ fontWeight: 700 }}>{l.description}</Text>
              {l.details.map((d, k) => (
                <Text key={k} style={[s.muted, s.small]}>
                  {d.replace(/(\d+\.\d{2})$/, (x) => m(x))}
                </Text>
              ))}
            </View>
            <Text style={s.cQty}>{l.quantity ?? ""}</Text>
            {doc.showPrices && <Text style={s.cUnit}>{m(l.unitPrice)}</Text>}
            {doc.showPrices && <Text style={s.cTotal}>{m(l.total)}</Text>}
          </View>
        ))}

        {doc.totals.length > 0 && (
          <View style={s.totals} wrap={false}>
            {doc.totals.map(([k, v, strong], i) => (
              <View key={i} style={[s.totalRow, strong && k === "Total" ? s.grand : {}, strong && k !== "Total" ? { fontWeight: 700 } : {}]}>
                <Text>{k}</Text>
                <Text>{m(v)}</Text>
              </View>
            ))}
          </View>
        )}

        {doc.notes.length > 0 && (
          <View style={s.notes}>
            {doc.notes.map((n, i) => (
              <View key={i} wrap={false}>
                <Text style={s.label}>{n.title}</Text>
                <Text>{n.body}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.footer} fixed>
          {doc.footer && <Text>{doc.footer}</Text>}
          <Text>{doc.disclaimer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${doc.number} · page ${pageNumber} of ${totalPages}`} style={{ textAlign: "right", marginTop: 2 }} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderCustomerPdf(doc: CustomerDocument): Promise<Buffer> {
  return renderToBuffer(<CustomerPdf doc={doc} />);
}
