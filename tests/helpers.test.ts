import { describe, expect, it } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

import { PERIODS, currency, formatAum, get, pct, periodToDate } from "../src/index.js";

describe("pct", () => {
  it("formats a rate as a percentage", () => {
    expect(pct(0.0003)).toBe("0.03%");
  });
  it("returns N/A rather than NaN% for missing data", () => {
    // Yahoo omits fields regularly. "NaN%" in a finance tool is worse than "N/A".
    expect(pct(null)).toBe("N/A");
    expect(pct(undefined)).toBe("N/A");
  });
  it("does not treat 0 as missing", () => {
    expect(pct(0)).toBe("0.00%");
  });
});

describe("currency", () => {
  it("formats dollars", () => {
    expect(currency(123.456)).toBe("$123.46");
  });
  it("does not treat 0 as missing", () => {
    expect(currency(0)).toBe("$0.00");
  });
  it("returns N/A for missing data", () => {
    expect(currency(null)).toBe("N/A");
  });
});

describe("formatAum", () => {
  it("scales to T / B / M", () => {
    expect(formatAum(2.5e12)).toBe("$2.50T");
    expect(formatAum(3.2e9)).toBe("$3.20B");
    expect(formatAum(4.7e6)).toBe("$4.70M");
  });
  it("falls back to a plain number below a million", () => {
    expect(formatAum(1000)).toContain("1,000");
  });
  it("returns N/A for missing data", () => {
    expect(formatAum(undefined)).toBe("N/A");
  });
});

describe("periodToDate", () => {
  it("moves the date backwards for every supported period", () => {
    for (const p of PERIODS) {
      expect(periodToDate(p).getTime()).toBeLessThan(Date.now() + 1000);
    }
  });

  it("1y is roughly a year back", () => {
    const d = periodToDate("1y");
    const days = (Date.now() - d.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(360);
    expect(days).toBeLessThan(370);
  });

  it("REJECTS an unsupported period instead of silently returning today", () => {
    // The regression this guards: it used to fall through and return the current
    // date, so a bad period produced a zero-length range and an empty report with
    // no error at all. MCP does not enforce the schema enum at runtime.
    expect(() => periodToDate("10y")).toThrow(McpError);
    expect(() => periodToDate("")).toThrow(/Unsupported period/);
    expect(() => periodToDate("garbage")).toThrow(/1m, 3m, 6m, 1y, 3y, 5y/);
  });
});

describe("get", () => {
  it("reads a key from a loose object", () => {
    expect(get<number>({ a: 1 }, "a")).toBe(1);
  });
  it("survives null/undefined input rather than throwing", () => {
    expect(get<number>(null, "a")).toBeUndefined();
    expect(get<number>(undefined, "a")).toBeUndefined();
  });
});
