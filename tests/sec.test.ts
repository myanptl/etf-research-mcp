import { describe, expect, it } from "vitest";

import { type Holding, analyze, buildTickerMap, overlap, parseNport, pickLatest, secUserAgent } from "../src/sec.js";
import { formatFull, formatOverlap, handleSecTool, ticker } from "../src/secTools.js";

const XML = `<?xml version="1.0"?>
<edgarSubmission><formData><genInfo><seriesName>TEST GROWTH FUND</seriesName><seriesId>S000000001</seriesId>
<repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>1000000.50</netAssets></fundInfo>
<invstOrSecs>
  <invstOrSec><name>Apple Inc</name><title>APPLE</title><cusip>037833100</cusip>
    <identifiers><isin value="US0378331005"/></identifiers><balance>100</balance><units>NS</units>
    <valUSD>60000</valUSD><pctVal>60.0</pctVal><payoffProfile>Long</payoffProfile><assetCat>EC</assetCat><invCountry>US</invCountry></invstOrSec>
  <invstOrSec><name>AT&amp;T Inc</name><cusip>00206R102</cusip><identifiers><isin value="US00206R1023"/></identifiers>
    <valUSD>30000</valUSD><pctVal>30.0</pctVal><assetCat>EC</assetCat><invCountry>US</invCountry></invstOrSec>
  <invstOrSec><name>Money Market</name><valUSD>10000</valUSD><pctVal>10.0</pctVal><assetCat>STIV</assetCat><invCountry>US</invCountry></invstOrSec>
  <invstOrSec><name>S&amp;P Future</name><valUSD>-500</valUSD><pctVal>-0.05</pctVal><assetCat>DE</assetCat></invstOrSec>
</invstOrSecs></formData></edgarSubmission>`;

describe("parseNport", () => {
  it("reads the header and every position", () => {
    const f = parseNport(XML);
    expect(f.seriesName).toBe("TEST GROWTH FUND");
    expect(f.seriesId).toBe("S000000001");
    expect(f.reportDate).toBe("2026-06-30");
    expect(f.netAssets).toBe(1000000.5);
    expect(f.holdings).toHaveLength(4);
    expect(f.holdings[0]).toMatchObject({ name: "Apple Inc", isin: "US0378331005", cusip: "037833100", pct: 60, valueUsd: 60000, assetCat: "EC", country: "US" });
    expect(f.holdings[1].name).toBe("AT&T Inc");
  });
});

describe("analyze", () => {
  it("measures concentration and groups by asset type, ignoring negative positions", () => {
    const a = analyze(parseNport(XML).holdings);
    expect(a.count).toBe(4);
    expect(a.holdingsToHalf).toBe(1);
    expect(a.top10).toBeCloseTo(100);
    // weights 0.6, 0.3, 0.1 -> HHI 0.46 -> 2.17 effective holdings
    expect(a.effectiveHoldings).toBeCloseTo(1 / 0.46, 2);
    expect(a.byAsset[0]).toEqual(["Equity", 90]);
    expect(a.byAsset.find(([k]) => k === "Derivatives")).toBeUndefined();
  });
});

describe("overlap", () => {
  const h = (name: string, pct: number, isin?: string): Holding => ({ name, pct, valueUsd: pct, isin });

  it("sums the smaller weight of every shared position", () => {
    const o = overlap(
      [h("Apple", 10, "A"), h("Microsoft", 8, "M"), h("Only A", 5, "X")],
      [h("Apple Inc.", 12, "A"), h("Microsoft Corp", 4, "M"), h("Only B", 9, "Y")]
    );
    expect(o.weighted).toBe(14);
    expect(o.shared.map((s) => s.name)).toEqual(["Apple", "Microsoft"]);
    expect(o.countA).toBe(3);
  });

  it("merges duplicate lines for the same security and falls back to name", () => {
    const o = overlap([h("Tesla", 2), h("TESLA", 1)], [h("tesla", 5)]);
    expect(o.weighted).toBe(3);
    expect(o.shared).toHaveLength(1);
  });

  it("formats a verdict", () => {
    const f = parseNport(XML);
    expect(formatOverlap("AAA", f, "BBB", f)).toContain("Mostly the same fund");
  });
});

describe("SEC plumbing", () => {
  it("maps tickers to series", () => {
    const m = buildTickerMap({ fields: ["cik", "seriesId", "classId", "symbol"], data: [[36405, "S000002839", "C000092055", "voo"]] });
    expect(m.get("VOO")).toEqual({ cik: 36405, seriesId: "S000002839", classId: "C000092055", symbol: "VOO" });
  });

  it("picks the newest filing and builds its archive URL", () => {
    const latest = pickLatest([
      { _id: "0000036405-26-000325:primary_doc.xml", _source: { period_ending: "2026-03-31", ciks: ["0000036405"] } },
      { _id: "0000036405-26-000473:primary_doc.xml", _source: { period_ending: "2026-06-30", ciks: ["0000036405"] } },
    ]);
    expect(latest).toEqual({
      url: "https://www.sec.gov/Archives/edgar/data/36405/000003640526000473/primary_doc.xml",
      period: "2026-06-30",
    });
    expect(pickLatest([])).toBeUndefined();
  });

  it("requires a contact in SEC_USER_AGENT", () => {
    expect(() => secUserAgent({})).toThrow(/SEC_USER_AGENT/);
    expect(() => secUserAgent({ SEC_USER_AGENT: "just a name" })).toThrow(/SEC_USER_AGENT/);
    expect(secUserAgent({ SEC_USER_AGENT: " Jane Doe jane@example.com " })).toBe("Jane Doe jane@example.com");
  });

  it("validates tickers before any request", async () => {
    expect(ticker(" qqqm ")).toBe("QQQM");
    expect(() => ticker("../etc")).toThrow(/not a valid ticker/);
    await expect(handleSecTool("get_etf_overlap", { symbols: ["VOO"] })).rejects.toThrow(/exactly two/);
    await expect(handleSecTool("get_etf_overlap", { symbols: ["VOO", "voo"] })).rejects.toThrow(/two different/);
    expect(await handleSecTool("get_etf_quote", {})).toBeUndefined();
  });

  it("formats full holdings with the source date", () => {
    const text = formatFull("TEST", parseNport(XML), 2);
    expect(text).toContain("all 4 holdings");
    expect(text).toContain("1. **Apple Inc** 60.00%");
    expect(text).not.toContain("Money Market");
    expect(text).toContain("as of 2026-06-30");
    expect(text).toContain("Negative positions:** 1");
  });
});
