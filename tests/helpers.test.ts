import { describe, expect, it } from "vitest";
import { McpError } from "@modelcontextprotocol/sdk/types.js";

import {
  DEFAULT_PERIOD,
  PERIODS,
  currency,
  formatAum,
  get,
  pct,
  periodToDate,
  returns,
  sampleBars,
} from "../src/index.js";

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

describe("DEFAULT_PERIOD", () => {
  it("is a member of the advertised period enum", () => {
    expect(PERIODS).toContain(DEFAULT_PERIOD);
  });

  it("resolves to a real past date", () => {
    // get_etf_performance used to hard-fail with `Unsupported period
    // "undefined"` whenever a caller omitted the optional period, which is the
    // common case for an LLM asking "how has IJR done?". The handler now falls
    // back to DEFAULT_PERIOD, so that fallback has to be a valid period.
    const d = periodToDate(DEFAULT_PERIOD);
    expect(d.getTime()).toBeLessThan(Date.now());
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  it("still rejects a genuinely invalid period", () => {
    // Defaulting must not swallow a real mistake such as "99y".
    expect(() => periodToDate("99y")).toThrow(McpError);
  });
});

describe("server version", () => {
  it("matches the published package version", async () => {
    // The server advertised a hardcoded "1.0.0" while npm served 1.1.2.
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    const { SERVER_VERSION } = await import("../src/index.js");
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});

describe("returns", () => {
  const bar = (d: string, close: number, adjclose?: number) => ({ date: new Date(d), close, high: close, low: close, adjclose });

  it("reports price return, and total return from adjusted closes", () => {
    const r = returns([bar("2025-09-23", 100, 90), bar("2026-09-23", 110, 103.5)]);
    expect(r.price).toBeCloseTo(10);
    expect(r.total).toBeCloseTo(15);
  });

  it("omits total return when Yahoo sends no adjusted close", () => {
    expect(returns([bar("2025-09-23", 100), bar("2026-09-23", 120)])).toEqual({ price: 20 });
  });
});

describe("sampleBars", () => {
  const bar = (d: string) => ({ date: new Date(`${d}T00:00:00Z`), close: 1, high: 1, low: 1 });
  const days = ["2026-08-28", "2026-08-31", "2026-09-01", "2026-09-04", "2026-09-08"].map(bar);

  it("keeps the last bar of each month", () => {
    expect(sampleBars(days, "1mo").map((b) => b.date.toISOString().slice(0, 10))).toEqual(["2026-08-31", "2026-09-08"]);
  });

  it("keeps the last bar of each ISO week", () => {
    // Aug 31 to Sep 4 is one Monday-to-Friday week.
    expect(sampleBars(days, "1wk").map((b) => b.date.toISOString().slice(0, 10))).toEqual(["2026-08-28", "2026-09-04", "2026-09-08"]);
  });

  it("returns daily bars untouched", () => {
    expect(sampleBars(days, "1d")).toHaveLength(5);
  });
});
