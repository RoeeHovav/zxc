/**
 * PrintForge pricing engine.
 *
 * Pure and deterministic: identical inputs + context always produce identical
 * outputs. All arithmetic uses Decimal; money is rounded only at the defined
 * boundaries documented in docs/PRICING.md:
 *   1. line production cost (2 dp)          4. line discount (2 dp)
 *   2. unit price (commercial step, then 2dp) 5. order discount (2 dp)
 *   3. service fees (2 dp)                   6. VAT on the taxable total (2 dp), deposit (2 dp)
 *
 * Missing inputs that would change the price are reported as errors and the
 * line is marked incomplete; they are never silently treated as zero.
 */
import { D, ZERO, ONE, type Dec, dec, decOrNull, roundMoney, roundToStep, sum } from "../money";
import type {
  Discount,
  LineInput,
  LineResult,
  OrderInput,
  OrderResult,
  PricingContext,
  PricingIssue,
  ProductionResult,
  ResolvedPrinter,
  ServicesResult,
  Step,
} from "./types";

const PRINT_SERVICES = new Set(["PRINT_ONLY", "MODELING_AND_PRINTING", "SCANNING_AND_PRINTING"]);
const MODELING_SERVICES = new Set(["MODELING_AND_PRINTING", "MODELING_ONLY"]);
const SCANNING_SERVICES = new Set(["SCANNING_ONLY", "SCANNING_AND_PRINTING"]);
const SERVICE_ONLY = new Set(["MODELING_ONLY", "SCANNING_ONLY"]);

export const MAX_QUANTITY = 1_000_000;

export function requiresPrint(serviceType: string): boolean {
  return PRINT_SERVICES.has(serviceType);
}
export function requiresModeling(serviceType: string): boolean {
  return MODELING_SERVICES.has(serviceType);
}
export function requiresScanning(serviceType: string): boolean {
  return SCANNING_SERVICES.has(serviceType);
}

const f2 = (d: Dec) => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const f4 = (d: Dec) => d.toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);
const fg = (d: Dec) => d.toDecimalPlaces(2, D.ROUND_HALF_UP).toString();
const pct = (d: Dec) => `${d.times(100).toDecimalPlaces(2, D.ROUND_HALF_UP).toString()}%`;

class Collector {
  issues: PricingIssue[] = [];
  steps: Step[] = [];
  error(code: string, message: string, field?: string) {
    this.issues.push({ severity: "error", code, message, field });
  }
  warn(code: string, message: string, field?: string) {
    this.issues.push({ severity: "warning", code, message, field });
  }
  info(code: string, message: string, field?: string) {
    this.issues.push({ severity: "info", code, message, field });
  }
  step(key: string, label: string, formula: string, amount: Dec) {
    this.steps.push({ key, label, formula, amount: f2(amount) });
  }
  get hasErrors() {
    return this.issues.some((i) => i.severity === "error");
  }
}

function ctxDec(value: string, name: string): Dec {
  const d = decOrNull(value);
  if (d === null) throw new Error(`Pricing context value "${name}" is invalid: ${value}`);
  return d;
}

/** Validate the pricing policy itself; returns error messages (empty if valid). */
export function validatePolicy(ctx: PricingContext): string[] {
  const errors: string[] = [];
  const p = ctx.policy;
  const markup = decOrNull(p.markupPercent);
  const margin = decOrNull(p.marginPercent);
  if (p.method === "MARKUP" && (markup === null || markup.lt(0))) errors.push("Markup must be zero or positive.");
  if (p.method === "MARGIN" && (margin === null || margin.lt(0) || margin.gte(1)))
    errors.push("Target margin must be at least 0% and below 100%.");
  const step = decOrNull(p.priceRoundingStep);
  if (step === null || step.lt(0)) errors.push("Rounding step must be zero or positive.");
  return errors;
}

/** Suggested price from cost according to the policy (unrounded). */
export function priceFromCost(cost: Dec, ctx: PricingContext): Dec {
  if (ctx.policy.method === "MARKUP") return cost.times(ONE.plus(dec(ctx.policy.markupPercent)));
  return cost.div(ONE.minus(dec(ctx.policy.marginPercent)));
}

/** markup = profit / cost ; margin = profit / price. */
export function markupToMargin(markup: Dec): Dec {
  return markup.div(ONE.plus(markup));
}
export function marginToMarkup(margin: Dec): Dec {
  return margin.div(ONE.minus(margin));
}

function readPositive(c: Collector, raw: string | null, code: string, message: string, field: string): Dec | null {
  const v = decOrNull(raw);
  if (v === null || v.lte(0)) {
    c.error(code, message, field);
    return null;
  }
  return v;
}

function readNonNegative(c: Collector, raw: string | null, field: string, label: string): Dec {
  const v = decOrNull(raw);
  if (v === null) return ZERO;
  if (v.lt(0)) {
    c.error("NEGATIVE_VALUE", `${label} cannot be negative.`, field);
    return ZERO;
  }
  return v;
}

function applyDiscount(c: Collector, base: Dec, discount: Discount | null, label: string, field: string): Dec {
  if (!discount) return ZERO;
  const value = decOrNull(discount.value);
  if (value === null || value.lt(0)) {
    c.error("INVALID_DISCOUNT", `${label} must be a positive number.`, field);
    return ZERO;
  }
  if (discount.type === "PERCENT") {
    if (value.gt(1)) {
      c.error("INVALID_DISCOUNT", `${label} cannot exceed 100%.`, field);
      return ZERO;
    }
    return roundMoney(base.times(value));
  }
  const amount = roundMoney(value);
  if (amount.gt(base)) {
    c.warn("DISCOUNT_CAPPED", `${label} of ${f2(amount)} exceeds the amount it applies to and was capped at ${f2(base)}.`, field);
    return base;
  }
  return amount;
}

export interface MachineRateBreakdown {
  rate: Dec;
  source: "OVERRIDE" | "COMPONENTS" | "DEFAULT";
  perHour: Record<"energy" | "depreciation" | "maintenance" | "consumables", Dec>;
  missing: string[];
}

/** Machine cost per hour for a printer; shared by pricing and the printers page. */
export function machineRateBreakdown(printer: ResolvedPrinter | null, tariffPerKwh: Dec, fallback: Dec): MachineRateBreakdown {
  const zeroes = { energy: ZERO, depreciation: ZERO, maintenance: ZERO, consumables: ZERO };
  if (!printer) return { rate: fallback, source: "DEFAULT", perHour: zeroes, missing: [] };
  const override = decOrNull(printer.hourlyRateOverride);
  if (override !== null) return { rate: override, source: "OVERRIDE", perHour: zeroes, missing: [] };
  const missing: string[] = [];
  const purchase = decOrNull(printer.purchasePrice);
  const lifetime = decOrNull(printer.expectedLifetimeHours);
  let depreciation = ZERO;
  if (purchase !== null && lifetime !== null && lifetime.gt(0)) depreciation = purchase.div(lifetime);
  else missing.push("depreciation (purchase price / lifetime hours)");
  const watts = decOrNull(printer.powerWatts);
  let energy = ZERO;
  if (watts !== null) energy = watts.div(1000).times(tariffPerKwh);
  else missing.push("energy (power draw)");
  const maintenance = decOrNull(printer.maintenancePerHour);
  if (maintenance === null) missing.push("maintenance reserve");
  const consumables = decOrNull(printer.consumablesPerHour);
  if (consumables === null) missing.push("consumables");
  if (missing.length === 4) return { rate: fallback, source: "DEFAULT", perHour: zeroes, missing };
  const perHour = { energy, depreciation, maintenance: maintenance ?? ZERO, consumables: consumables ?? ZERO };
  return { rate: sum(Object.values(perHour)), source: "COMPONENTS", perHour, missing };
}

function machineRate(c: Collector, input: NonNullable<LineInput["print"]>, ctx: PricingContext): MachineRateBreakdown {
  const fallback = ctxDec(ctx.rates.defaultMachineCostPerHour, "defaultMachineCostPerHour");
  const printer = input.printer;
  const r = machineRateBreakdown(printer, ctxDec(ctx.rates.electricityTariffPerKwh, "electricityTariffPerKwh"), fallback);
  if (!printer) {
    c.warn("PRINTER_NOT_ASSIGNED", `No printer selected; using the default machine cost of ${f4(fallback)}/h.`, "printerId");
  } else if (r.source === "OVERRIDE") {
    if (r.rate.lt(0)) c.error("NEGATIVE_VALUE", "Printer hourly rate override cannot be negative.", "printerId");
  } else if (r.source === "DEFAULT") {
    c.warn("PRINTER_COST_MISSING", `Printer "${printer.name}" has no cost data; using the default machine cost of ${f4(fallback)}/h.`, "printerId");
  } else if (r.missing.length > 0) {
    c.warn("PRINTER_COST_PARTIAL", `Printer "${printer.name}" is missing: ${r.missing.join(", ")}. Those components are excluded from machine cost.`, "printerId");
  }
  return r;
}

function priceProduction(c: Collector, input: LineInput, ctx: PricingContext): { result: ProductionResult; cost: Dec } | null {
  const p = input.print;
  if (!p) {
    c.error("PRINT_DETAILS_REQUIRED", "Print details are required for this service.", "print");
    return null;
  }
  const qty = new D(input.quantity);
  const unitsPerBatch = Number.isInteger(p.unitsPerBatch) && p.unitsPerBatch >= 1 ? p.unitsPerBatch : 1;
  if (!(Number.isInteger(p.unitsPerBatch) && p.unitsPerBatch >= 1)) {
    c.error("INVALID_BATCH", "Units per batch must be a whole number of at least 1.", "unitsPerBatch");
  }
  const batches = Math.ceil(input.quantity / unitsPerBatch);

  // Material
  const material = p.material;
  let price: Dec | null = null;
  if (!material) c.error("MATERIAL_REQUIRED", "Select a material.", "materialId");
  else {
    price = decOrNull(material.pricePerKg);
    if (price === null || price.lt(0)) {
      c.error("MATERIAL_PRICE_MISSING", `Material "${material.label}" has no price per kg. Set it in Materials before pricing.`, "materialId");
      price = null;
    }
  }
  const supportMaterial = p.supportMaterial ?? material;
  let supportPrice: Dec | null = price;
  if (p.supportMaterial) {
    supportPrice = decOrNull(p.supportMaterial.pricePerKg);
    if (supportPrice === null || supportPrice.lt(0)) {
      c.error("MATERIAL_PRICE_MISSING", `Support material "${p.supportMaterial.label}" has no price per kg.`, "supportMaterialId");
      supportPrice = null;
    }
  }
  const grams = readPositive(c, p.gramsPerUnit, "GRAMS_REQUIRED", "Estimated grams per unit must be greater than zero.", "gramsPerUnit");
  const minutes = readPositive(c, p.printMinutesPerUnit, "PRINT_TIME_REQUIRED", "Estimated print time per unit must be greater than zero.", "printMinutesPerUnit");
  const supportGrams = readNonNegative(c, p.supportGramsPerUnit, "supportGramsPerUnit", "Support grams");
  const purgeGrams = readNonNegative(c, p.purgeGramsPerBatch, "purgeGramsPerBatch", "Purge grams");
  const postMinutes = readNonNegative(c, p.postProcessMinutesPerUnit, "postProcessMinutesPerUnit", "Post-processing minutes");
  const extraPerUnit = readNonNegative(c, p.extraCostPerUnit, "extraCostPerUnit", "Extra cost per unit");
  const setupRaw = decOrNull(p.setupMinutesPerBatch);
  const setupMinutes = setupRaw ?? ctxDec(ctx.rates.defaultSetupMinutes, "defaultSetupMinutes");
  if (setupMinutes.lt(0)) c.error("NEGATIVE_VALUE", "Setup minutes cannot be negative.", "setupMinutesPerBatch");

  const machine = machineRate(c, p, ctx);
  if (price === null || supportPrice === null || grams === null || minutes === null) return null;

  const wastePct = decOrNull(material?.wastePercent ?? null) ?? ctxDec(ctx.rates.materialWastePercent, "materialWastePercent");
  const supportWastePct = decOrNull(supportMaterial?.wastePercent ?? null) ?? wastePct;

  const modelG = grams.times(qty);
  const supportG = supportGrams.times(qty);
  const purgeG = purgeGrams.times(batches);
  const modelWasteG = modelG.times(wastePct);
  const supportWasteG = supportG.times(supportWastePct);
  const primaryG = modelG.plus(modelWasteG).plus(purgeG);
  const supportTotalG = supportG.plus(supportWasteG);

  const materialCost = primaryG.times(price).div(1000);
  const supportCost = supportTotalG.times(supportPrice).div(1000);
  c.step(
    "material",
    "Material",
    `(${fg(modelG)} g model + ${fg(modelWasteG)} g waste @ ${pct(wastePct)} + ${fg(purgeG)} g purge) × ${f2(price)}/kg`,
    materialCost,
  );
  if (supportTotalG.gt(0))
    c.step("support", "Support material", `(${fg(supportG)} g + ${fg(supportWasteG)} g waste) × ${f2(supportPrice)}/kg`, supportCost);

  const machineHours = minutes.times(qty).div(60);
  const machineCost = machineHours.times(machine.rate);
  const energyCost = machineHours.times(machine.perHour.energy);
  const depreciationCost = machineHours.times(machine.perHour.depreciation);
  const maintenanceCost = machineHours.times(machine.perHour.maintenance);
  const consumablesCost = machineHours.times(machine.perHour.consumables);
  c.step(
    "machine",
    machine.source === "OVERRIDE" ? "Machine time (printer rate override)" : machine.source === "DEFAULT" ? "Machine time (default rate)" : "Machine time (energy + depreciation + maintenance + consumables)",
    `${fg(machineHours)} h × ${f4(machine.rate)}/h`,
    machineCost,
  );

  const laborRate = ctxDec(ctx.rates.laborCostPerHour, "laborCostPerHour");
  const setupHours = setupMinutes.times(batches).div(60);
  const postHours = postMinutes.times(qty).div(60);
  const setupLabor = setupHours.times(laborRate);
  const postLabor = postHours.times(laborRate);
  c.step("setup", "Setup labor", `${fg(setupMinutes)} min × ${batches} batch(es) × ${f2(laborRate)}/h`, setupLabor);
  if (postHours.gt(0)) c.step("post", "Post-processing labor", `${fg(postMinutes)} min × ${qty} unit(s) × ${f2(laborRate)}/h`, postLabor);

  const extras = extraPerUnit.times(qty);
  if (extras.gt(0)) c.step("extras", "Extra parts/costs", `${f2(extraPerUnit)} × ${qty}`, extras);

  const failurePct = ctxDec(ctx.rates.failureAllowancePercent, "failureAllowancePercent");
  const failure = materialCost.plus(supportCost).plus(machineCost).times(failurePct);
  c.step("failure", "Failure allowance", `(material + machine) × ${pct(failurePct)}`, failure);

  const subtotal = sum([materialCost, supportCost, machineCost, setupLabor, postLabor, extras, failure]);
  const contingencyPct = ctxDec(ctx.rates.contingencyPercent, "contingencyPercent");
  const contingency = subtotal.times(contingencyPct);
  c.step("contingency", "Contingency", `${f2(subtotal)} × ${pct(contingencyPct)}`, contingency);
  const total = roundMoney(subtotal.plus(contingency));
  c.step("productionCost", "Production cost", "sum of the above (rounded to 0.01)", total);

  const unitCost = total.div(qty);
  const suggested = priceFromCost(unitCost, ctx);
  const step = decOrNull(ctx.policy.priceRoundingStep);
  const rounded = roundToStep(suggested, step, ctx.policy.roundingMode);
  const policyLabel =
    ctx.policy.method === "MARKUP"
      ? `unit cost ${f4(unitCost)} × (1 + ${pct(dec(ctx.policy.markupPercent))} markup)`
      : `unit cost ${f4(unitCost)} ÷ (1 − ${pct(dec(ctx.policy.marginPercent))} margin)`;
  c.step("suggested", "Suggested unit price", `${policyLabel}, rounded ${ctx.policy.roundingMode === "UP" ? "up" : ""} to ${step?.toString() ?? "0.01"}`, rounded);

  let unitPrice = rounded;
  let priceSource: "POLICY" | "MANUAL" = "POLICY";
  if (input.manualUnitPrice) {
    const manual = decOrNull(input.manualUnitPrice.price);
    if (manual === null || manual.lt(0)) c.error("INVALID_MANUAL_PRICE", "Manual unit price must be zero or positive.", "manualUnitPrice");
    else if (!input.manualUnitPrice.reason || input.manualUnitPrice.reason.trim().length < 3)
      c.error("MANUAL_PRICE_REASON_REQUIRED", "A reason is required when overriding the unit price.", "manualPriceReason");
    else {
      unitPrice = roundMoney(manual);
      priceSource = "MANUAL";
      c.info("MANUAL_PRICE", `Unit price manually set to ${f2(unitPrice)} (suggested ${f2(rounded)}). Reason: ${input.manualUnitPrice.reason.trim()}`, "manualUnitPrice");
      if (unitPrice.lt(unitCost)) c.warn("MANUAL_BELOW_COST", `Manual unit price is below the unit cost of ${f2(unitCost)}.`, "manualUnitPrice");
    }
  }
  const productionSubtotal = roundMoney(unitPrice.times(qty));
  c.step("productionPrice", "Print price", `${f2(unitPrice)} × ${qty}`, productionSubtotal);

  return {
    cost: total,
    result: {
      batches,
      grams: {
        model: fg(modelG),
        support: fg(supportG),
        purge: fg(purgeG),
        waste: fg(modelWasteG.plus(supportWasteG)),
        total: fg(primaryG.plus(supportTotalG)),
        primaryTotal: fg(primaryG),
        supportTotal: fg(supportTotalG),
      },
      machineHours: machineHours.toDecimalPlaces(4).toString(),
      laborHours: setupHours.plus(postHours).toDecimalPlaces(4).toString(),
      machineRatePerHour: f4(machine.rate),
      machineRateSource: machine.source,
      costs: {
        material: f2(materialCost),
        supportMaterial: f2(supportCost),
        energy: f2(energyCost),
        depreciation: f2(depreciationCost),
        maintenance: f2(maintenanceCost),
        consumables: f2(consumablesCost),
        machine: f2(machineCost),
        setupLabor: f2(setupLabor),
        postProcessingLabor: f2(postLabor),
        extras: f2(extras),
        failureAllowance: f2(failure),
        subtotal: f2(subtotal),
        contingency: f2(contingency),
        total: f2(total),
      },
      unitCost: f4(unitCost),
      suggestedUnitPrice: f2(rounded),
      unitPrice: f2(unitPrice),
      priceSource,
      subtotal: f2(productionSubtotal),
    },
  };
}

function priceServices(c: Collector, input: LineInput, ctx: PricingContext): ServicesResult | null {
  const laborRate = ctxDec(ctx.rates.laborCostPerHour, "laborCostPerHour");
  let ok = true;
  let modeling: ServicesResult["modeling"] = null;
  let scanning: ServicesResult["scanning"] = null;

  if (requiresModeling(input.serviceType)) {
    const m = input.modeling;
    if (!m) {
      c.error("MODELING_REQUIRED", "Modeling details are required for this service.", "modeling");
      ok = false;
    } else if (m.waived) {
      modeling = { mode: m.mode, hours: null, price: "0.00", cost: "0.00", waived: true };
      c.info("DESIGN_FEE_WAIVED", `Design fee not charged: ${m.waivedReason?.trim() || "existing design reused"}.`, "modeling");
      c.step("modeling", "Modeling (existing design reused)", "fee waived", ZERO);
    } else if (m.mode === "HOURLY") {
      const hours = readPositive(c, m.hours, "MODELING_HOURS_REQUIRED", "Estimated modeling hours must be greater than zero.", "modelingHours");
      if (hours) {
        const rate = ctxDec(ctx.rates.modelingRatePerHour, "modelingRatePerHour");
        const price = roundMoney(hours.times(rate));
        const cost = roundMoney(hours.times(laborRate));
        modeling = { mode: "HOURLY", hours: hours.toString(), price: f2(price), cost: f2(cost), waived: false };
        c.step("modeling", "Modeling (one-time, not multiplied by quantity)", `${hours} h × ${f2(rate)}/h`, price);
      } else ok = false;
    } else {
      const fee = decOrNull(m.fixedFee);
      if (fee === null || fee.lt(0)) {
        c.error("MODELING_FEE_REQUIRED", "Enter the fixed modeling fee.", "modelingFee");
        ok = false;
      } else {
        const hours = decOrNull(m.hours);
        let cost = ZERO;
        if (hours === null || hours.lte(0))
          c.warn("MODELING_COST_UNKNOWN", "No modeling hours estimate: internal modeling cost is excluded, so profit is overstated.", "modelingHours");
        else cost = roundMoney(hours.times(laborRate));
        const price = roundMoney(fee);
        modeling = { mode: "FIXED", hours: hours?.toString() ?? null, price: f2(price), cost: f2(cost), waived: false };
        c.step("modeling", "Modeling (fixed fee, one-time)", `fixed ${f2(price)}`, price);
      }
    }
  }

  if (requiresScanning(input.serviceType)) {
    const s = input.scanning;
    const scanHours = s ? readPositive(c, s.scanHours, "SCAN_HOURS_REQUIRED", "Estimated scanning hours must be greater than zero.", "scanHours") : null;
    if (!s) c.error("SCANNING_REQUIRED", "Scanning details are required for this service.", "scanning");
    if (s && scanHours) {
      const cleanup = readNonNegative(c, s.cleanupHours, "scanCleanupHours", "Cleanup hours");
      const reverse = readNonNegative(c, s.reverseEngineeringHours, "reverseEngineeringHours", "Reverse-engineering hours");
      const scanRate = ctxDec(ctx.rates.scanningRatePerHour, "scanningRatePerHour");
      const cleanupRate = ctxDec(ctx.rates.scanCleanupRatePerHour, "scanCleanupRatePerHour");
      const reverseRate = ctxDec(ctx.rates.reverseEngineeringRatePerHour, "reverseEngineeringRatePerHour");
      const scannerRate = ctxDec(ctx.rates.scannerCostPerHour, "scannerCostPerHour");
      const scanPrice = roundMoney(scanHours.times(scanRate));
      const cleanupPrice = roundMoney(cleanup.times(cleanupRate));
      const reversePrice = roundMoney(reverse.times(reverseRate));
      const price = scanPrice.plus(cleanupPrice).plus(reversePrice);
      const cost = roundMoney(scanHours.plus(cleanup).plus(reverse).times(laborRate).plus(scanHours.times(scannerRate)));
      scanning = { scanPrice: f2(scanPrice), cleanupPrice: f2(cleanupPrice), reverseEngineeringPrice: f2(reversePrice), price: f2(price), cost: f2(cost) };
      c.step("scan", "3D scanning (one-time)", `${scanHours} h × ${f2(scanRate)}/h`, scanPrice);
      if (cleanup.gt(0)) c.step("scanCleanup", "Scan cleanup", `${cleanup} h × ${f2(cleanupRate)}/h`, cleanupPrice);
      if (reverse.gt(0)) c.step("reverse", "Reverse engineering", `${reverse} h × ${f2(reverseRate)}/h`, reversePrice);
    } else ok = false;
  }
  if (!ok) return null;
  const price = sum([dec(modeling?.price ?? "0"), dec(scanning?.price ?? "0")]);
  const cost = sum([dec(modeling?.cost ?? "0"), dec(scanning?.cost ?? "0")]);
  return { modeling, scanning, price: f2(price), cost: f2(cost) };
}

export function priceLine(input: LineInput, ctx: PricingContext): LineResult {
  const c = new Collector();
  for (const e of validatePolicy(ctx)) c.error("INVALID_POLICY", e, "pricingPolicy");

  const qtyValid = Number.isInteger(input.quantity) && input.quantity >= 1 && input.quantity <= MAX_QUANTITY;
  if (!qtyValid) c.error("INVALID_QUANTITY", `Quantity must be a whole number between 1 and ${MAX_QUANTITY.toLocaleString("en")}.`, "quantity");
  if (qtyValid && SERVICE_ONLY.has(input.serviceType) && input.quantity !== 1)
    c.error("QUANTITY_MUST_BE_ONE", "Modeling-only and scanning-only items must have quantity 1.", "quantity");

  const empty: LineResult = {
    complete: false,
    issues: c.issues,
    quantity: input.quantity,
    production: null,
    services: { modeling: null, scanning: null, price: "0.00", cost: "0.00" },
    gross: null,
    discount: null,
    net: null,
    cost: null,
    profit: null,
    marginPercent: null,
    markupPercent: null,
    steps: c.steps,
  };
  if (c.hasErrors) return empty;

  const production = requiresPrint(input.serviceType) ? priceProduction(c, input, ctx) : null;
  const services = priceServices(c, input, ctx);
  if (c.hasErrors || !services || (requiresPrint(input.serviceType) && !production)) {
    return { ...empty, production: production?.result ?? null, services: services ?? empty.services };
  }

  const gross = dec(production?.result.subtotal ?? "0").plus(dec(services.price));
  const discount = applyDiscount(c, gross, input.discount, "Line discount", "discount");
  if (discount.gt(0)) c.step("lineDiscount", "Line discount", input.discount?.type === "PERCENT" ? `${f2(gross)} × ${pct(dec(input.discount.value))}` : "fixed amount", discount.neg());
  const net = gross.minus(discount);
  const cost = (production?.cost ?? ZERO).plus(dec(services.cost));
  const profit = net.minus(cost);
  const margin = net.gt(0) ? profit.div(net) : null;
  const markup = cost.gt(0) ? profit.div(cost) : null;
  c.step("lineNet", "Line total (excl. VAT)", `${f2(gross)} − ${f2(discount)} discount`, net);

  const minMargin = dec(ctx.policy.minimumMarginPercent);
  if (profit.lt(0)) c.warn("BELOW_COST", `This line loses ${f2(profit.neg())} at the estimated cost.`);
  else if (margin !== null && margin.lt(minMargin))
    c.warn("LOW_MARGIN", `Gross margin ${pct(margin)} is below the policy minimum of ${pct(minMargin)}.`);

  if (c.hasErrors) return { ...empty, production: production?.result ?? null, services };
  return {
    complete: true,
    issues: c.issues,
    quantity: input.quantity,
    production: production?.result ?? null,
    services,
    gross: f2(gross),
    discount: f2(discount),
    net: f2(net),
    cost: f2(cost),
    profit: f2(profit),
    marginPercent: margin ? f4(margin) : null,
    markupPercent: markup ? f4(markup) : null,
    steps: c.steps,
  };
}

export function priceOrder(input: OrderInput, ctx: PricingContext): OrderResult {
  const c = new Collector();
  const lines = input.lines.map((l) => priceLine(l, ctx));
  lines.forEach((l, i) => l.issues.forEach((issue) => c.issues.push({ ...issue, line: i })));
  const base: OrderResult = {
    complete: false,
    issues: c.issues,
    lines,
    totals: null,
    costs: null,
    grossProfit: null,
    marginPercent: null,
    markupPercent: null,
    steps: c.steps,
  };
  if (input.lines.length === 0) c.error("NO_LINES", "Add at least one item.");
  const shippingCharge = readNonNegative(c, input.shippingCharge, "shippingCharge", "Shipping charge");
  const shippingCost = readNonNegative(c, input.shippingCost, "shippingCost", "Shipping cost");
  const depositPctRaw = decOrNull(input.depositPercent) ?? decOrNull(ctx.defaultDepositPercent) ?? ZERO;
  if (depositPctRaw.lt(0) || depositPctRaw.gt(1)) c.error("INVALID_DEPOSIT", "Deposit must be between 0% and 100%.", "depositPercent");
  if (c.hasErrors || lines.some((l) => !l.complete)) return base;

  const itemsGross = sum(lines.map((l) => dec(l.gross!)));
  const lineDiscounts = sum(lines.map((l) => dec(l.discount!)));
  const itemsNet = sum(lines.map((l) => dec(l.net!)));
  c.step("itemsNet", "Items subtotal", `${lines.length} line(s), after line discounts`, itemsNet);

  const orderDiscount = applyDiscount(c, itemsNet, input.orderDiscount, "Order discount", "orderDiscount");
  if (orderDiscount.gt(0)) c.step("orderDiscount", "Order discount", input.orderDiscount?.type === "PERCENT" ? `${f2(itemsNet)} × ${pct(dec(input.orderDiscount.value))}` : "fixed amount", orderDiscount.neg());
  const merchandiseNet = itemsNet.minus(orderDiscount);

  const minCharge = dec(ctx.policy.minimumOrderCharge);
  let minimumAdjustment = ZERO;
  if (minCharge.gt(0) && merchandiseNet.lt(minCharge)) {
    minimumAdjustment = roundMoney(minCharge.minus(merchandiseNet));
    c.info("MINIMUM_ORDER_APPLIED", `Minimum order charge of ${f2(minCharge)} applied (+${f2(minimumAdjustment)}).`);
    c.step("minimum", "Minimum order adjustment", `${f2(minCharge)} − ${f2(merchandiseNet)}`, minimumAdjustment);
  }
  if (shippingCharge.gt(0)) c.step("shipping", "Shipping", "charged to customer", shippingCharge);
  const taxable = roundMoney(merchandiseNet.plus(minimumAdjustment).plus(shippingCharge));

  let vatRate = ZERO;
  if (ctx.vatMode === "EXCLUSIVE" && !input.customerVatExempt) vatRate = dec(ctx.vatRate);
  else if (ctx.vatMode === "EXCLUSIVE" && input.customerVatExempt) c.info("CUSTOMER_VAT_EXEMPT", "Customer is marked VAT-exempt; no VAT added.");
  const vat = roundMoney(taxable.times(vatRate));
  c.step("vat", "VAT", `${f2(taxable)} × ${pct(vatRate)}`, vat);
  const total = taxable.plus(vat);
  c.step("total", "Total", "taxable amount + VAT", total);
  const deposit = roundMoney(total.times(depositPctRaw));

  const linesCost = sum(lines.map((l) => dec(l.cost!)));
  const physical = input.lines.some((l) => requiresPrint(l.serviceType));
  const packing = physical ? roundMoney(dec(ctx.rates.packingCostPerOrder)) : ZERO;
  const feePct = dec(ctx.rates.transactionFeePercent);
  const feeFixed = dec(ctx.rates.transactionFeeFixed);
  const fees = total.gt(0) ? roundMoney(total.times(feePct).plus(feeFixed)) : ZERO;
  const costTotal = linesCost.plus(shippingCost).plus(packing).plus(fees);
  const grossProfit = taxable.minus(costTotal);
  const margin = taxable.gt(0) ? grossProfit.div(taxable) : null;
  const markup = costTotal.gt(0) ? grossProfit.div(costTotal) : null;

  const minMargin = dec(ctx.policy.minimumMarginPercent);
  if (grossProfit.lt(0)) c.warn("ORDER_BELOW_COST", `The order loses ${f2(grossProfit.neg())} at estimated cost.`);
  else if (margin !== null && margin.lt(minMargin))
    c.warn("ORDER_LOW_MARGIN", `Order gross margin ${pct(margin)} is below the policy minimum of ${pct(minMargin)}.`);

  if (c.hasErrors) return base;
  return {
    complete: true,
    issues: c.issues,
    lines,
    totals: {
      itemsGross: f2(itemsGross),
      lineDiscounts: f2(lineDiscounts),
      itemsNet: f2(itemsNet),
      orderDiscount: f2(orderDiscount),
      merchandiseNet: f2(merchandiseNet),
      minimumAdjustment: f2(minimumAdjustment),
      shippingCharge: f2(shippingCharge),
      taxableAmount: f2(taxable),
      vatRate: f4(vatRate),
      vatAmount: f2(vat),
      total: f2(total),
      depositPercent: f4(depositPctRaw),
      depositAmount: f2(deposit),
    },
    costs: {
      lines: f2(linesCost),
      shipping: f2(shippingCost),
      packing: f2(packing),
      transactionFees: f2(fees),
      total: f2(costTotal),
    },
    grossProfit: f2(grossProfit),
    marginPercent: margin ? f4(margin) : null,
    markupPercent: markup ? f4(markup) : null,
    steps: c.steps,
  };
}
