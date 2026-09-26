import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("neutralizes formula injection but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell("-foo")).toBe("'-foo");
  });
  it("writes a BOM and CRLF rows", () => {
    expect(toCsv(["a", "b"], [[1, null]])).toBe("﻿a,b\r\n1,\r\n");
  });
  it("keeps Hebrew text intact", () => {
    expect(csvCell("דנה לוי")).toBe("דנה לוי");
  });
});
