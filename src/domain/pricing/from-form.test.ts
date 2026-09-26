import { describe, expect, it } from "vitest";
import { formatMinutes, lineToEngineInput, parseDurationToMinutes } from "./from-form";

describe("parseDurationToMinutes", () => {
  it.each([
    ["155", 155],
    ["2:35", 155],
    ["2h35m", 155],
    ["2h 35m", 155],
    ["2h 35", 155],
    ["2 hours 35 min", 155],
    ["1.5h", 90],
    ["95m", 95],
    ["45 min", 45],
    ["1d 2h", 1560],
    ["12.5", 12.5],
  ])("parses %s", (input, expected) => {
    expect(parseDurationToMinutes(input)).toBe(expected);
  });
  it.each(["", "abc", "2:75", "h", "-5"])("rejects %s", (input) => {
    expect(parseDurationToMinutes(input)).toBeNull();
  });
  it("formats minutes", () => {
    expect(formatMinutes(155)).toBe("2h 35m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(45)).toBe("45m");
  });
});

describe("lineToEngineInput", () => {
  const base = {
    serviceType: "PRINT_ONLY" as const,
    quantity: 2,
    gramsPerUnit: "10",
    supportGramsPerUnit: null,
    purgeGramsPerBatch: null,
    unitsPerBatch: null,
    printMinutesPerUnit: "60",
    setupMinutesPerBatch: null,
    postProcessMinutesPerUnit: null,
    extraCostPerUnit: null,
    extraCostNote: null,
    modelingMode: "HOURLY" as const,
    modelingHours: "3",
    modelingFee: null,
    designFeeWaived: false,
    waivedReason: null,
    scanHours: "1",
    scanCleanupHours: null,
    reverseEngineeringHours: null,
    discountType: "PERCENT" as const,
    discountValue: "12.5",
    manualUnitPrice: "",
    manualPriceReason: null,
  };
  it("drops sections that do not apply to the service type", () => {
    const r = lineToEngineInput(base, { material: null, supportMaterial: null, printer: null });
    expect(r.modeling).toBeNull();
    expect(r.scanning).toBeNull();
    expect(r.print?.unitsPerBatch).toBe(1);
    expect(r.manualUnitPrice).toBeNull();
  });
  it("converts percent discounts to exact fractions", () => {
    expect(lineToEngineInput(base, { material: null, supportMaterial: null, printer: null }).discount).toEqual({ type: "PERCENT", value: "0.125" });
  });
  it("omits print details for service-only lines", () => {
    const r = lineToEngineInput({ ...base, serviceType: "MODELING_ONLY" }, { material: null, supportMaterial: null, printer: null });
    expect(r.print).toBeNull();
    expect(r.modeling?.hours).toBe("3");
  });
});
