/**
 * Full fund holdings from SEC Form N-PORT, the quarterly filing where every
 * registered fund lists every position it holds. Free and official, so it does
 * not break when Yahoo changes an endpoint. Public filings lag the quarter they
 * cover by about 60 days.
 */

import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

const TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers_mf.json";
const SEARCH_URL = "https://efts.sec.gov/LATEST/search-index";
const TIMEOUT_MS = 20_000;
const MAX_DOC_BYTES = 60 * 1024 * 1024;

export interface Holding {
  name: string;
  title?: string;
  cusip?: string;
  isin?: string;
  balance?: number;
  units?: string;
  valueUsd: number;
  /** Percent of net assets, e.g. 7.1 means 7.1% */
  pct: number;
  assetCat?: string;
  country?: string;
  payoff?: string;
}

export interface Filing {
  seriesName?: string;
  seriesId?: string;
  reportDate?: string;
  netAssets?: number;
  holdings: Holding[];
  url?: string;
}

export interface SeriesRef {
  cik: number;
  seriesId: string;
  classId: string;
  symbol: string;
}

/** SEC blocks automated requests that do not name a real contact. */
export function secUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const ua = env.SEC_USER_AGENT?.trim();
  if (!ua || !/\S+@\S+\.\S+/.test(ua)) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'SEC requires every automated request to name a contact. Set SEC_USER_AGENT to your name and email, e.g. "Jane Doe jane@example.com", in this server\'s env config. It is sent only to sec.gov.'
    );
  }
  return ua;
}

async function secFetch(url: string, ua: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "user-agent": ua, accept: "application/json, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 403) {
    throw new McpError(
      ErrorCode.InternalError,
      "SEC refused the request (403). Check SEC_USER_AGENT is a real name and email, then wait 10 minutes: SEC blocks for a while after a refusal."
    );
  }
  if (!res.ok) throw new McpError(ErrorCode.InternalError, `SEC returned HTTP ${res.status} for ${url}`);
  return res;
}

let tickerMap: Map<string, SeriesRef> | undefined;

export function buildTickerMap(json: { fields: string[]; data: unknown[][] }): Map<string, SeriesRef> {
  const i = (f: string) => json.fields.indexOf(f);
  const [c, s, k, y] = [i("cik"), i("seriesId"), i("classId"), i("symbol")];
  const map = new Map<string, SeriesRef>();
  for (const row of json.data) {
    const symbol = String(row[y] ?? "").toUpperCase();
    if (symbol) map.set(symbol, { cik: Number(row[c]), seriesId: String(row[s]), classId: String(row[k]), symbol });
  }
  return map;
}

export async function resolveSeries(symbol: string, ua: string): Promise<SeriesRef> {
  if (!tickerMap) {
    const res = await secFetch(TICKER_MAP_URL, ua);
    tickerMap = buildTickerMap((await res.json()) as { fields: string[]; data: unknown[][] });
  }
  const ref = tickerMap.get(symbol.toUpperCase());
  if (!ref) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${symbol} is not in SEC's fund list. Funds organised as unit investment trusts (SPY, DIA) and non-US funds do not file N-PORT, so full holdings are not available. get_etf_holdings may still have the top 10.`
    );
  }
  return ref;
}

interface SearchHit {
  _id: string;
  _source: { period_ending?: string; ciks?: string[] };
}

export function pickLatest(hits: SearchHit[]): { url: string; period?: string } | undefined {
  const best = [...hits].sort((a, b) =>
    (b._source.period_ending ?? "").localeCompare(a._source.period_ending ?? "")
  )[0];
  if (!best) return undefined;
  const [accession, file] = best._id.split(":");
  const cik = Number(best._source.ciks?.[0]);
  if (!accession || !file || !cik) return undefined;
  return {
    url: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${file}`,
    period: best._source.period_ending,
  };
}

async function latestFilingUrl(seriesId: string, ua: string): Promise<string> {
  const q = new URLSearchParams({ q: `"${seriesId}"`, forms: "NPORT-P", from: "0", size: "100" });
  const res = await secFetch(`${SEARCH_URL}?${q}`, ua);
  const body = (await res.json()) as { hits?: { hits?: SearchHit[] } };
  const latest = pickLatest(body.hits?.hits ?? []);
  if (!latest) throw new McpError(ErrorCode.InternalError, `No N-PORT filing found for series ${seriesId}.`);
  return latest.url;
}

const tag = (xml: string, name: string) =>
  xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim();

const decode = (s?: string) =>
  s?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function parseNport(xml: string): Filing {
  const header = xml.slice(0, xml.indexOf("<invstOrSecs>") > 0 ? xml.indexOf("<invstOrSecs>") : 20_000);
  const holdings: Holding[] = [];
  for (const m of xml.matchAll(/<invstOrSec>([\s\S]*?)<\/invstOrSec>/g)) {
    const b = m[1];
    const valueUsd = Number(tag(b, "valUSD"));
    const pct = Number(tag(b, "pctVal"));
    if (!Number.isFinite(valueUsd) || !Number.isFinite(pct)) continue;
    holdings.push({
      name: decode(tag(b, "name")) ?? "Unknown",
      title: decode(tag(b, "title")),
      cusip: tag(b, "cusip"),
      isin: b.match(/<isin value="([^"]+)"/)?.[1],
      balance: Number(tag(b, "balance")) || undefined,
      units: tag(b, "units"),
      valueUsd,
      pct,
      assetCat: tag(b, "assetCat"),
      country: tag(b, "invCountry"),
      payoff: tag(b, "payoffProfile"),
    });
  }
  return {
    seriesName: decode(tag(header, "seriesName")),
    seriesId: tag(header, "seriesId"),
    reportDate: tag(header, "repPdDate"),
    netAssets: Number(tag(header, "netAssets")) || undefined,
    holdings,
  };
}

const cache = new Map<string, Filing>();

export async function fullHoldings(symbol: string, env: NodeJS.ProcessEnv = process.env): Promise<Filing> {
  const ua = secUserAgent(env);
  const ref = await resolveSeries(symbol, ua);
  const cached = cache.get(ref.seriesId);
  if (cached) return cached;
  const url = await latestFilingUrl(ref.seriesId, ua);
  const res = await secFetch(url, ua);
  const text = await res.text();
  if (text.length > MAX_DOC_BYTES) throw new McpError(ErrorCode.InternalError, "Filing too large to parse.");
  const filing = { ...parseNport(text), url };
  cache.set(ref.seriesId, filing);
  return filing;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

const ASSET_LABELS: Record<string, string> = {
  EC: "Equity", EP: "Preferred equity", DBT: "Debt", ABS: "Asset-backed",
  DE: "Derivatives", DIR: "Interest rate derivatives", STIV: "Short-term / cash vehicles",
  RF: "Registered funds", LON: "Loans", COMM: "Commodities", RE: "Real estate", OTHER: "Other",
};

export interface Analysis {
  count: number;
  top10: number;
  top25: number;
  holdingsToHalf: number;
  effectiveHoldings: number;
  byAsset: [string, number][];
  byCountry: [string, number][];
}

export function analyze(holdings: Holding[]): Analysis {
  const longs = holdings.filter((h) => h.pct > 0).sort((a, b) => b.pct - a.pct);
  const sum = (hs: Holding[]) => hs.reduce((s, h) => s + h.pct, 0);
  let running = 0;
  let toHalf = 0;
  for (const h of longs) {
    running += h.pct;
    toHalf++;
    if (running >= 50) break;
  }
  const total = sum(longs) || 1;
  const hhi = longs.reduce((s, h) => s + (h.pct / total) ** 2, 0);
  const group = (key: (h: Holding) => string) => {
    const m = new Map<string, number>();
    for (const h of longs) m.set(key(h), (m.get(key(h)) ?? 0) + h.pct);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  return {
    count: holdings.length,
    top10: sum(longs.slice(0, 10)),
    top25: sum(longs.slice(0, 25)),
    holdingsToHalf: running >= 50 ? toHalf : longs.length,
    effectiveHoldings: hhi > 0 ? 1 / hhi : 0,
    byAsset: group((h) => ASSET_LABELS[h.assetCat ?? ""] ?? h.assetCat ?? "Unclassified"),
    byCountry: group((h) => h.country ?? "Unknown"),
  };
}

/** Same security in both funds: match on ISIN, then CUSIP, then name. */
function key(h: Holding): string {
  return h.isin ?? h.cusip ?? h.name.toUpperCase();
}

export interface Overlap {
  /** Sum of min(weightA, weightB): the share of each fund that is literally the same positions */
  weighted: number;
  shared: { name: string; a: number; b: number }[];
  countA: number;
  countB: number;
}

export function overlap(a: Holding[], b: Holding[]): Overlap {
  const merge = (hs: Holding[]) => {
    const m = new Map<string, Holding>();
    for (const h of hs) {
      if (h.pct <= 0) continue;
      const prev = m.get(key(h));
      m.set(key(h), prev ? { ...prev, pct: prev.pct + h.pct } : h);
    }
    return m;
  };
  const ma = merge(a);
  const mb = merge(b);
  const shared: Overlap["shared"] = [];
  let weighted = 0;
  for (const [k, ha] of ma) {
    const hb = mb.get(k);
    if (!hb) continue;
    weighted += Math.min(ha.pct, hb.pct);
    shared.push({ name: ha.name, a: ha.pct, b: hb.pct });
  }
  shared.sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b));
  return { weighted, shared, countA: ma.size, countB: mb.size };
}
