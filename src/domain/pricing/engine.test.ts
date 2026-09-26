import { describe, expect, it } from "vitest";
import { markupToMargin, marginToMarkup, priceLine, priceOrder, priceFromCost } from "./engine";
import type { LineInput, OrderInput, PricingContext, ResolvedPrinter } from "./types";
import { dec } from "../money";

/** Context with all overheads disabled so single components can be verified. */
function bareContext(overrides: Partial<PricingContext["rates"]> = {}, policy: Partial<PricingContext["policy"]> = {}): PricingContext {
  return {
    version: 1,
    capturedAt: "2026-01-01T00:00:00.000Z",
    currency: "ILS",
    vatMode: "EXCLUSIVE",
    vatRate: "0.18",
    rates: {
      electricityTariffPerKwh: "0.64",
      laborCostPerHour: "60",
      scannerCostPerHour: "10",
      defaultMachineCostPerHour: "4",
      defaultSetupMinutes: "0",
      materialWastePercent: "0",
      failureAllowancePercent: "0",
      contingencyPercent: "0",
      packingCostPerOrder: "0",
      transactionFeePercent: "0",
      transactionFeeFixed: "0",
      modelingRatePerHour: "180",
      scanningRatePerHour: "200",
      scanCleanupRatePerHour: "150",
      reverseEngineeringRatePerHour: "220",
      ...overrides,
    },
    policy: {
      id: null,
      name: "Test",
      method: "MARKUP",
      markupPercent: "1",
      marginPercent: "0.5",
      minimumOrderCharge: "0",
      minimumMarginPercent: "0.25",
      priceRoundingStep: "1",
      roundingMode: "UP",
      ...policy,
    },
    defaultDepositPercent: "0",
  };
}

const overridePrinter = (rate: string): ResolvedPrinter => ({
  id: "p1",
  name: "X1C",
  hourlyRateOverride: rate,
  purchasePrice: null,
  expectedLifetimeHours: null,
  powerWatts: null,
  maintenancePerHour: null,
  consumablesPerHour: null,
});

const pla = { id: "m1", label: "Bambu PLA Basic Black", pricePerKg: "100", wastePercent: null };

function printLine(over: Partial<LineInput> = {}, print: Partial<NonNullable<LineInput["print"]>> = {}): LineInput {
  return {
    serviceType: "PRINT_ONLY",
    quantity: 1,
    print: {
      material: pla,
      supportMaterial: null,
      printer: overridePrinter("5"),
      gramsPerUnit: "50",
      supportGramsPerUnit: null,
      purgeGramsPerBatch: null,
      unitsPerBatch: 1,
      printMinutesPerUnit: "120",
      setupMinutesPerBatch: null,
      postProcessMinutesPerUnit: null,
      extraCostPerUnit: null,
      ...print,
    },
    modeling: null,
    scanning: null,
    discount: null,
    manualUnitPrice: null,
    ...over,
  };
}

function order(lines: LineInput[], over: Partial<OrderInput> = {}): OrderInput {
  return { lines, orderDiscount: null, shippingCharge: null, shippingCost: null, depositPercent: null, customerVatExempt: false, ...over };
}

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe("markup vs margin", () => {
  it("converts between markup on cost and gross margin on sales", () => {
    expect(markupToMargin(dec("1")).toString()).toBe("0.5");
    expect(marginToMarkup(dec("0.5")).toString()).toBe("1");
    expect(markupToMargin(dec("0.25")).toString()).toBe("0.2");
  });
  it("prices 100 cost at 50% markup = 150 but at 50% margin = 200", () => {
    expect(priceFromCost(dec(100), bareContext({}, { method: "MARKUP", markupPercent: "0.5" })).toString()).toBe("150");
    expect(priceFromCost(dec(100), bareContext({}, { method: "MARGIN", marginPercent: "0.5" })).toString()).toBe("200");
  });
});

describe("priceLine — production", () => {
  it("computes a simple print: 50 g @100/kg + 2 h @5/h = 15 cost, 100% markup = 30", () => {
    const r = priceLine(printLine(), bareContext());
    expect(r.complete).toBe(true);
    expect(r.production?.costs.material).toBe("5.00");
    expect(r.production?.costs.machine).toBe("10.00");
    expect(r.production?.costs.total).toBe("15.00");
    expect(r.production?.unitPrice).toBe("30.00");
    expect(r.net).toBe("30.00");
    expect(r.cost).toBe("15.00");
    expect(r.profit).toBe("15.00");
    expect(r.marginPercent).toBe("0.5000");
    expect(r.markupPercent).toBe("1.0000");
  });

  it("scales material and machine cost linearly with quantity", () => {
    const r = priceLine(printLine({ quantity: 10 }), bareContext());
    expect(r.production?.costs.material).toBe("50.00");
    expect(r.production?.costs.machine).toBe("100.00");
    expect(r.production?.unitPrice).toBe("30.00");
    expect(r.net).toBe("300.00");
  });

  it("applies setup and purge per batch, not per unit", () => {
    // qty 10, 4 per batch → 3 batches; setup 12 min × 3 = 0.6 h × 60 = 36; purge 5 g × 3 = 15 g × 0.1 = 1.50
    const r = priceLine(printLine({ quantity: 10 }, { unitsPerBatch: 4, setupMinutesPerBatch: "12", purgeGramsPerBatch: "5" }), bareContext());
    expect(r.production?.batches).toBe(3);
    expect(r.production?.costs.setupLabor).toBe("36.00");
    expect(r.production?.grams.purge).toBe("15");
    expect(r.production?.costs.material).toBe("51.50");
  });

  it("uses the context default setup time when none is given", () => {
    const r = priceLine(printLine(), bareContext({ defaultSetupMinutes: "30" }));
    expect(r.production?.costs.setupLabor).toBe("30.00");
  });

  it("uses a separate support material price when specified", () => {
    const pva = { id: "m2", label: "PVA", pricePerKg: "400", wastePercent: null };
    const r = priceLine(printLine({}, { supportMaterial: pva, supportGramsPerUnit: "10" }), bareContext());
    expect(r.production?.costs.supportMaterial).toBe("4.00");
  });

  it("applies material waste, failure allowance and contingency", () => {
    // material 50 g + 5% = 52.5 g × 0.1 = 5.25 ; machine 10 ; failure (15.25 × 10%) = 1.525
    // subtotal 16.775 ; contingency 5% = 0.83875 ; total 17.61375 → 17.61
    const r = priceLine(printLine(), bareContext({ materialWastePercent: "0.05", failureAllowancePercent: "0.1", contingencyPercent: "0.05" }));
    expect(r.production?.costs.material).toBe("5.25");
    expect(r.production?.costs.failureAllowance).toBe("1.53");
    expect(r.production?.costs.total).toBe("17.61");
  });

  it("per-material waste override beats the global allowance", () => {
    const r = priceLine(printLine({}, { material: { ...pla, wastePercent: "0.2" } }), bareContext({ materialWastePercent: "0.05" }));
    expect(r.production?.costs.material).toBe("6.00");
  });

  it("computes machine rate from printer components", () => {
    // depreciation 3000/5000 = 0.6 ; energy 150 W → 0.15 kWh × 0.64 = 0.096 ; maintenance 0.2 ; consumables 0.1 → 0.996/h
    const printer: ResolvedPrinter = {
      id: "p2",
      name: "P1S",
      hourlyRateOverride: null,
      purchasePrice: "3000",
      expectedLifetimeHours: "5000",
      powerWatts: "150",
      maintenancePerHour: "0.2",
      consumablesPerHour: "0.1",
    };
    const r = priceLine(printLine({}, { printer, printMinutesPerUnit: "600" }), bareContext());
    expect(r.production?.machineRatePerHour).toBe("0.9960");
    expect(r.production?.machineRateSource).toBe("COMPONENTS");
    expect(r.production?.costs.machine).toBe("9.96");
    expect(r.production?.costs.energy).toBe("0.96");
    expect(r.production?.costs.depreciation).toBe("6.00");
    expect(codes(r)).not.toContain("PRINTER_COST_PARTIAL");
  });

  it("warns (not silently zero) when printer cost components are missing", () => {
    const printer: ResolvedPrinter = { ...overridePrinter("0"), hourlyRateOverride: null, powerWatts: "100" };
    const r = priceLine(printLine({}, { printer }), bareContext());
    expect(r.complete).toBe(true);
    expect(codes(r)).toContain("PRINTER_COST_PARTIAL");
  });

  it("falls back to the default machine rate with a warning when no printer is chosen", () => {
    const r = priceLine(printLine({}, { printer: null }), bareContext());
    expect(codes(r)).toContain("PRINTER_NOT_ASSIGNED");
    expect(r.production?.machineRateSource).toBe("DEFAULT");
    expect(r.production?.costs.machine).toBe("8.00");
  });

  it("falls back to default with a warning when a printer has no cost data at all", () => {
    const printer: ResolvedPrinter = { ...overridePrinter("0"), hourlyRateOverride: null };
    const r = priceLine(printLine({}, { printer }), bareContext());
    expect(codes(r)).toContain("PRINTER_COST_MISSING");
    expect(r.production?.costs.machine).toBe("8.00");
  });

  it("reproduces the documented realistic example exactly", () => {
    // See docs/PRICING.md "Worked example".
    const ctx = bareContext({
      defaultSetupMinutes: "10",
      materialWastePercent: "0.05",
      failureAllowancePercent: "0.08",
      contingencyPercent: "0.03",
    });
    const printer: ResolvedPrinter = {
      id: "p",
      name: "X1C",
      hourlyRateOverride: null,
      purchasePrice: "5000",
      expectedLifetimeHours: "5000",
      powerWatts: "120",
      maintenancePerHour: "0.25",
      consumablesPerHour: "0.15",
    };
    const r = priceLine(
      printLine(
        { quantity: 4 },
        {
          material: { ...pla, pricePerKg: "80" },
          printer,
          gramsPerUnit: "42.5",
          supportGramsPerUnit: "6",
          purgeGramsPerBatch: "3",
          unitsPerBatch: 2,
          printMinutesPerUnit: "95",
          postProcessMinutesPerUnit: "5",
        },
      ),
      ctx,
    );
    expect(r.complete).toBe(true);
    const p = r.production!;
    expect(p.grams.total).toBe("209.7");
    expect(p.costs.material).toBe("14.76");
    expect(p.costs.supportMaterial).toBe("2.02");
    expect(p.machineRatePerHour).toBe("1.4768");
    expect(p.costs.machine).toBe("9.35");
    expect(p.costs.setupLabor).toBe("20.00");
    expect(p.costs.postProcessingLabor).toBe("20.00");
    expect(p.costs.failureAllowance).toBe("2.09");
    expect(p.costs.subtotal).toBe("68.22");
    expect(p.costs.contingency).toBe("2.05");
    expect(p.costs.total).toBe("70.27");
    expect(p.unitCost).toBe("17.5675");
    expect(p.unitPrice).toBe("36.00");
    expect(r.net).toBe("144.00");
    expect(r.profit).toBe("73.73");
    expect(r.marginPercent).toBe("0.5120");
    expect(r.markupPercent).toBe("1.0492");
  });

  it("adds extra per-unit costs (e.g. inserts) into production cost", () => {
    const r = priceLine(printLine({ quantity: 3 }, { extraCostPerUnit: "2.5" }), bareContext());
    expect(r.production?.costs.extras).toBe("7.50");
    expect(r.production?.costs.total).toBe("52.50");
  });
});

describe("priceLine — price rounding", () => {
  it("rounds up to the commercial step", () => {
    // cost 10.01 → ×2 = 20.02 → UP to 21
    const r = priceLine(printLine({}, { gramsPerUnit: "100.1", printMinutesPerUnit: "0.0001" }), bareContext({}, {}));
    // machine: 0.0001/60 h × 5 ≈ 0.0000083 → negligible; material 10.01
    expect(r.production?.costs.total).toBe("10.01");
    expect(r.production?.unitPrice).toBe("21.00");
  });
  it("does not bump exact values to the next step", () => {
    const r = priceLine(printLine({}, { gramsPerUnit: "100", printMinutesPerUnit: "0.0001" }), bareContext());
    expect(r.production?.unitPrice).toBe("20.00");
  });
  it("supports nearest rounding and 0.10 steps", () => {
    const nearest = priceLine(printLine({}, { gramsPerUnit: "100.1", printMinutesPerUnit: "0.0001" }), bareContext({}, { roundingMode: "NEAREST" }));
    expect(nearest.production?.unitPrice).toBe("20.00");
    const dime = priceLine(printLine({}, { gramsPerUnit: "100.1", printMinutesPerUnit: "0.0001" }), bareContext({}, { priceRoundingStep: "0.1" }));
    expect(dime.production?.unitPrice).toBe("20.10");
  });
  it("step 0 means round to agorot only", () => {
    const r = priceLine(printLine({}, { gramsPerUnit: "100.1", printMinutesPerUnit: "0.0001" }), bareContext({}, { priceRoundingStep: "0" }));
    expect(r.production?.unitPrice).toBe("20.02");
  });
  it("prices with the margin method", () => {
    const r = priceLine(printLine(), bareContext({}, { method: "MARGIN", marginPercent: "0.4" }));
    expect(r.production?.unitPrice).toBe("25.00"); // 15 / 0.6
    expect(r.marginPercent).toBe("0.4000");
  });
  it("rejects a 100% target margin", () => {
    const r = priceLine(printLine(), bareContext({}, { method: "MARGIN", marginPercent: "1" }));
    expect(r.complete).toBe(false);
    expect(codes(r)).toContain("INVALID_POLICY");
  });
});

describe("priceLine — services", () => {
  it("charges modeling once, not per unit", () => {
    const r = priceLine(printLine({ serviceType: "MODELING_AND_PRINTING", quantity: 10, modeling: { mode: "HOURLY", hours: "2", fixedFee: null, waived: false } }), bareContext());
    expect(r.services.modeling?.price).toBe("360.00");
    expect(r.gross).toBe("660.00"); // 10 × 30 + 360
    expect(r.cost).toBe("270.00"); // 150 production + 2 h × 60 internal
  });
  it("supports a fixed modeling fee and warns when hours are unknown", () => {
    const r = priceLine(printLine({ serviceType: "MODELING_AND_PRINTING", modeling: { mode: "FIXED", hours: null, fixedFee: "500", waived: false } }), bareContext());
    expect(r.services.modeling?.price).toBe("500.00");
    expect(codes(r)).toContain("MODELING_COST_UNKNOWN");
  });
  it("waives the design fee for a reorder of an existing design", () => {
    const r = priceLine(
      printLine({ serviceType: "MODELING_AND_PRINTING", quantity: 5, modeling: { mode: "HOURLY", hours: "3", fixedFee: null, waived: true, waivedReason: "Reorder of D-0001" } }),
      bareContext(),
    );
    expect(r.services.price).toBe("0.00");
    expect(r.gross).toBe("150.00");
    expect(codes(r)).toContain("DESIGN_FEE_WAIVED");
  });
  it("requires modeling hours for hourly modeling", () => {
    const r = priceLine({ ...printLine({ serviceType: "MODELING_ONLY", modeling: { mode: "HOURLY", hours: null, fixedFee: null, waived: false } }), print: null }, bareContext());
    expect(r.complete).toBe(false);
    expect(codes(r)).toContain("MODELING_HOURS_REQUIRED");
  });
  it("prices scanning, cleanup and reverse engineering separately", () => {
    const r = priceLine({ ...printLine({ serviceType: "SCANNING_ONLY", scanning: { scanHours: "1.5", cleanupHours: "2", reverseEngineeringHours: "1" } }), print: null }, bareContext());
    expect(r.services.scanning).toMatchObject({ scanPrice: "300.00", cleanupPrice: "300.00", reverseEngineeringPrice: "220.00", price: "820.00" });
    // (1.5 + 2 + 1) h × 60 + 1.5 h × 10 scanner = 285
    expect(r.cost).toBe("285.00");
    expect(r.net).toBe("820.00");
  });
  it("requires quantity 1 for service-only items", () => {
    const r = priceLine({ ...printLine({ serviceType: "MODELING_ONLY", quantity: 2, modeling: { mode: "FIXED", hours: "1", fixedFee: "100", waived: false } }), print: null }, bareContext());
    expect(codes(r)).toContain("QUANTITY_MUST_BE_ONE");
  });
  it("combines scanning and printing", () => {
    const r = priceLine(printLine({ serviceType: "SCANNING_AND_PRINTING", quantity: 2, scanning: { scanHours: "1", cleanupHours: null, reverseEngineeringHours: null } }), bareContext());
    expect(r.gross).toBe("260.00"); // 2 × 30 + 200
  });
});

describe("priceLine — validation & failure cases", () => {
  it("refuses to price when the material price is unknown", () => {
    const r = priceLine(printLine({}, { material: { ...pla, pricePerKg: null } }), bareContext());
    expect(r.complete).toBe(false);
    expect(r.net).toBeNull();
    expect(codes(r)).toContain("MATERIAL_PRICE_MISSING");
  });
  it("refuses to price without a material", () => {
    const r = priceLine(printLine({}, { material: null }), bareContext());
    expect(codes(r)).toContain("MATERIAL_REQUIRED");
    expect(r.complete).toBe(false);
  });
  it.each([
    ["missing", null],
    ["zero", "0"],
    ["negative", "-5"],
    ["garbage", "abc"],
  ])("rejects %s grams", (_label, grams) => {
    const r = priceLine(printLine({}, { gramsPerUnit: grams }), bareContext());
    expect(codes(r)).toContain("GRAMS_REQUIRED");
    expect(r.complete).toBe(false);
  });
  it("rejects missing print time", () => {
    expect(codes(priceLine(printLine({}, { printMinutesPerUnit: null }), bareContext()))).toContain("PRINT_TIME_REQUIRED");
  });
  it.each([0, -1, 1.5, 2_000_000])("rejects quantity %s", (q) => {
    const r = priceLine(printLine({ quantity: q }), bareContext());
    expect(codes(r)).toContain("INVALID_QUANTITY");
  });
  it("rejects negative optional values instead of ignoring them", () => {
    expect(codes(priceLine(printLine({}, { supportGramsPerUnit: "-1" }), bareContext()))).toContain("NEGATIVE_VALUE");
  });
  it("requires print details for print services", () => {
    expect(codes(priceLine({ ...printLine(), print: null }, bareContext()))).toContain("PRINT_DETAILS_REQUIRED");
  });
  it("handles large quantities exactly", () => {
    const r = priceLine(printLine({ quantity: 100_000 }, { gramsPerUnit: "12.34", printMinutesPerUnit: "7.5" }), bareContext());
    expect(r.complete).toBe(true);
    // material 1234 kg × 100 = 123400 ; machine 12500 h × 5 = 62500 ; total 185900 ; unit 1.859 ×2 = 3.718 → 4
    expect(r.production?.costs.total).toBe("185900.00");
    expect(r.production?.unitPrice).toBe("4.00");
    expect(r.net).toBe("400000.00");
  });
});

describe("priceLine — discounts & overrides", () => {
  it("applies a percentage line discount on the full line", () => {
    const r = priceLine(
      printLine({ serviceType: "MODELING_AND_PRINTING", quantity: 10, modeling: { mode: "HOURLY", hours: "2", fixedFee: null, waived: false }, discount: { type: "PERCENT", value: "0.1" } }),
      bareContext(),
    );
    expect(r.discount).toBe("66.00");
    expect(r.net).toBe("594.00");
  });
  it("caps an amount discount at the line total and flags the loss", () => {
    const r = priceLine(printLine({ discount: { type: "AMOUNT", value: "1000" } }), bareContext());
    expect(r.net).toBe("0.00");
    expect(codes(r)).toEqual(expect.arrayContaining(["DISCOUNT_CAPPED", "BELOW_COST"]));
    expect(r.marginPercent).toBeNull();
  });
  it("rejects percentage discounts above 100%", () => {
    expect(codes(priceLine(printLine({ discount: { type: "PERCENT", value: "1.5" } }), bareContext()))).toContain("INVALID_DISCOUNT");
  });
  it("warns when a discount pushes margin under the policy minimum", () => {
    const r = priceLine(printLine({ discount: { type: "PERCENT", value: "0.4" } }), bareContext());
    // net 18, cost 15, margin 16.67% < 25%
    expect(codes(r)).toContain("LOW_MARGIN");
  });
  it("accepts a manual unit price only with a reason", () => {
    const without = priceLine(printLine({ manualUnitPrice: { price: "25", reason: "" } }), bareContext());
    expect(codes(without)).toContain("MANUAL_PRICE_REASON_REQUIRED");
    expect(without.complete).toBe(false);
    const withReason = priceLine(printLine({ quantity: 2, manualUnitPrice: { price: "25", reason: "Loyal customer" } }), bareContext());
    expect(withReason.production?.priceSource).toBe("MANUAL");
    expect(withReason.production?.suggestedUnitPrice).toBe("30.00");
    expect(withReason.net).toBe("50.00");
    expect(codes(withReason)).toContain("MANUAL_PRICE");
  });
  it("warns on a manual price below unit cost", () => {
    const r = priceLine(printLine({ manualUnitPrice: { price: "10", reason: "Sample for marketing" } }), bareContext());
    expect(codes(r)).toEqual(expect.arrayContaining(["MANUAL_BELOW_COST", "BELOW_COST"]));
  });
  it("is deterministic and JSON-serializable", () => {
    const a = priceLine(printLine({ quantity: 7 }), bareContext());
    const b = priceLine(JSON.parse(JSON.stringify(printLine({ quantity: 7 }))), JSON.parse(JSON.stringify(bareContext())));
    expect(JSON.parse(JSON.stringify(a))).toEqual(b);
  });
});

describe("priceOrder", () => {
  const scanLine: LineInput = {
    ...printLine({ serviceType: "SCANNING_ONLY", scanning: { scanHours: "1.5", cleanupHours: "2", reverseEngineeringHours: "1" } }),
    print: null,
  };

  it("applies order discount, shipping and VAT in the documented order", () => {
    const r = priceOrder(
      order([printLine({ quantity: 10 }), scanLine], {
        orderDiscount: { type: "PERCENT", value: "0.05" },
        shippingCharge: "30",
        shippingCost: "25",
        depositPercent: "0.3",
      }),
      bareContext({ packingCostPerOrder: "5" }),
    );
    expect(r.complete).toBe(true);
    expect(r.totals).toMatchObject({
      itemsNet: "1120.00",
      orderDiscount: "56.00",
      merchandiseNet: "1064.00",
      shippingCharge: "30.00",
      taxableAmount: "1094.00",
      vatAmount: "196.92",
      total: "1290.92",
      depositAmount: "387.28",
    });
    expect(r.costs).toMatchObject({ lines: "435.00", shipping: "25.00", packing: "5.00", total: "465.00" });
    // Revenue excludes VAT: 1094 − 465
    expect(r.grossProfit).toBe("629.00");
    expect(r.marginPercent).toBe("0.5750");
  });

  it("does not apply the order discount to shipping", () => {
    const r = priceOrder(order([printLine()], { orderDiscount: { type: "PERCENT", value: "0.5" }, shippingCharge: "20" }), bareContext());
    expect(r.totals?.orderDiscount).toBe("15.00");
    expect(r.totals?.taxableAmount).toBe("35.00");
  });

  it("applies the minimum order charge after discounts", () => {
    const r = priceOrder(order([printLine()]), bareContext({}, { minimumOrderCharge: "50" }));
    expect(r.totals?.minimumAdjustment).toBe("20.00");
    expect(r.totals?.taxableAmount).toBe("50.00");
    expect(r.totals?.vatAmount).toBe("9.00");
    expect(r.totals?.total).toBe("59.00");
    expect(codes(r)).toContain("MINIMUM_ORDER_APPLIED");
  });

  it("omits VAT for exempt dealers and exempt customers", () => {
    const exemptDealer = priceOrder(order([printLine()]), { ...bareContext(), vatMode: "EXEMPT" });
    expect(exemptDealer.totals?.vatAmount).toBe("0.00");
    expect(exemptDealer.totals?.total).toBe("30.00");
    const exemptCustomer = priceOrder(order([printLine()], { customerVatExempt: true }), bareContext());
    expect(exemptCustomer.totals?.vatAmount).toBe("0.00");
    expect(codes(exemptCustomer)).toContain("CUSTOMER_VAT_EXEMPT");
  });

  it("rounds VAT once on the taxable total, not per line", () => {
    // three lines of 5.01 → 15.03 × 18% = 2.7054 → 2.71 (rounding per line would give 3 × 0.90 = 2.70)
    const line = printLine({}, { gramsPerUnit: "50.05", printMinutesPerUnit: "0.0001" });
    const r = priceOrder(order([line, line, line]), bareContext({}, { markupPercent: "0", priceRoundingStep: "0" }));
    expect(r.totals?.taxableAmount).toBe("15.03");
    expect(r.totals?.vatAmount).toBe("2.71");
  });

  it("includes estimated transaction fees and packing in cost but not in revenue", () => {
    const r = priceOrder(order([printLine()]), bareContext({ transactionFeePercent: "0.02", transactionFeeFixed: "1", packingCostPerOrder: "3" }));
    // total 35.40 → fee 0.708 + 1 = 1.71 ; cost 15 + 3 + 1.71
    expect(r.costs?.transactionFees).toBe("1.71");
    expect(r.costs?.total).toBe("19.71");
    expect(r.grossProfit).toBe("10.29");
  });

  it("does not charge packing for service-only orders", () => {
    const r = priceOrder(order([scanLine]), bareContext({ packingCostPerOrder: "5" }));
    expect(r.costs?.packing).toBe("0.00");
  });

  it("is incomplete if any line is incomplete and exposes no misleading totals", () => {
    const bad = printLine({}, { material: { ...pla, pricePerKg: null } });
    const r = priceOrder(order([printLine(), bad]), bareContext());
    expect(r.complete).toBe(false);
    expect(r.totals).toBeNull();
    expect(r.issues.find((i) => i.code === "MATERIAL_PRICE_MISSING")?.line).toBe(1);
  });

  it("requires at least one line", () => {
    expect(codes(priceOrder(order([]), bareContext()))).toContain("NO_LINES");
  });

  it("sums awkward decimal amounts exactly (no floating point drift)", () => {
    // unit prices 0.10 and 0.20 must total 0.30 exactly
    const ctx = bareContext({}, { markupPercent: "0", priceRoundingStep: "0" });
    const a = printLine({}, { gramsPerUnit: "1", printMinutesPerUnit: "0.0001" }); // 0.10
    const b = printLine({}, { gramsPerUnit: "2", printMinutesPerUnit: "0.0001" }); // 0.20
    const r = priceOrder(order([a, b]), { ...ctx, vatMode: "EXEMPT" });
    expect(r.totals?.total).toBe("0.30");
  });

  it("caps an order amount discount at the items total", () => {
    const r = priceOrder(order([printLine()], { orderDiscount: { type: "AMOUNT", value: "999" }, shippingCharge: "10" }), bareContext());
    expect(r.totals?.merchandiseNet).toBe("0.00");
    expect(r.totals?.taxableAmount).toBe("10.00");
    expect(codes(r)).toContain("DISCOUNT_CAPPED");
  });

  it("rejects negative shipping and an invalid deposit percentage", () => {
    expect(codes(priceOrder(order([printLine()], { shippingCharge: "-1" }), bareContext()))).toContain("NEGATIVE_VALUE");
    expect(codes(priceOrder(order([printLine()], { depositPercent: "1.2" }), bareContext()))).toContain("INVALID_DEPOSIT");
  });

  it("uses the context default deposit when none is set on the order", () => {
    const r = priceOrder(order([printLine()]), { ...bareContext(), defaultDepositPercent: "0.5" });
    expect(r.totals?.depositAmount).toBe("17.70");
  });

  it("flags an order-level margin below the minimum", () => {
    const r = priceOrder(order([printLine()], { orderDiscount: { type: "PERCENT", value: "0.45" } }), bareContext());
    expect(codes(r)).toContain("ORDER_LOW_MARGIN");
  });
});
