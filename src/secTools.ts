import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { type Filing, analyze, fullHoldings, overlap } from "./sec.js";

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const DEFAULT_TOP = 25;
const MAX_TOP = 100;
const SHARED_SHOWN = 15;

export const SEC_TOOLS = [
  {
    name: "get_etf_full_holdings",
    description:
      "Every position an ETF holds, from its latest SEC Form N-PORT filing (not Yahoo). Returns the top positions by weight plus concentration: how many holdings make up half the fund, top-10 and top-25 weight, effective number of holdings, and breakdowns by asset type and country. Data is quarterly and about 60 days behind. Needs SEC_USER_AGENT set to a name and email.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "ETF ticker (e.g. VOO)" },
        top: { type: "number", description: `How many positions to list, 1-${MAX_TOP}. Default ${DEFAULT_TOP}.` },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_etf_overlap",
    description:
      "How much two ETFs hold the same things, from their full SEC N-PORT holdings. Returns weighted overlap (the share of each fund that is identical positions), how many holdings they share, and the biggest shared positions with each fund's weight. Use it to check whether owning both actually diversifies. Needs SEC_USER_AGENT set to a name and email.",
    inputSchema: {
      type: "object",
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
          description: 'Exactly two ETF tickers, e.g. ["QQQM", "VUG"]',
        },
      },
      required: ["symbols"],
    },
  },
];

export function ticker(value: unknown): string {
  const s = String(value ?? "").trim().toUpperCase();
  if (!TICKER.test(s)) throw new McpError(ErrorCode.InvalidParams, `"${String(value).slice(0, 20)}" is not a valid ticker.`);
  return s;
}

const p = (n: number) => `${n.toFixed(2)}%`;
const usd = (n?: number) => {
  if (n == null) return "N/A";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n).toLocaleString()}`;
};

/** Skip slices that round to zero, they are noise in a summary line. */
function visible(groups: [string, number][]): string {
  return groups.filter(([, v]) => v >= 0.01).slice(0, 5).map(([k, v]) => `${k} ${p(v)}`).join(", ");
}

function source(f: Filing): string {
  return `Source: SEC Form N-PORT, holdings as of ${f.reportDate ?? "unknown date"}. ${f.url ?? ""}`.trim();
}

export function formatFull(symbol: string, f: Filing, top: number): string {
  const a = analyze(f.holdings);
  const rows = [...f.holdings]
    .filter((h) => h.pct > 0)
    .sort((x, y) => y.pct - x.pct)
    .slice(0, top)
    .map((h, i) => `${i + 1}. **${h.name}** ${p(h.pct)} (${usd(h.valueUsd)})`);
  const shorts = f.holdings.filter((h) => h.pct < 0).length;
  return [
    `## ${symbol}: all ${a.count} holdings${f.seriesName ? ` (${f.seriesName})` : ""}`,
    "",
    `**Net assets:** ${usd(f.netAssets)}`,
    `**Holdings that make up half the fund:** ${a.holdingsToHalf}`,
    `**Top 10:** ${p(a.top10)} · **Top 25:** ${p(a.top25)}`,
    `**Effective number of holdings:** ${a.effectiveHoldings.toFixed(0)} (as concentrated as an equal-weight fund of this many stocks)`,
    `**By asset type:** ${visible(a.byAsset)}`,
    `**By country:** ${visible(a.byCountry)}`,
    ...(shorts ? [`**Negative positions:** ${shorts} (usually futures, swaps or cash owed, not bets against a stock)`] : []),
    "",
    `### Top ${rows.length}`,
    ...rows,
    "",
    `_${source(f)}_`,
  ].join("\n");
}

export function formatOverlap(sa: string, fa: Filing, sb: string, fb: Filing): string {
  const o = overlap(fa.holdings, fb.holdings);
  const verdict =
    o.weighted >= 70 ? "Mostly the same fund. Owning both adds little diversification."
      : o.weighted >= 40 ? "Heavy overlap. A big part of each is the same stocks."
      : o.weighted >= 15 ? "Some overlap, but they are meaningfully different."
      : "Little overlap. They hold mostly different things.";
  const rows = o.shared
    .slice(0, SHARED_SHOWN)
    .map((s, i) => `${i + 1}. **${s.name}** ${sa} ${p(s.a)} · ${sb} ${p(s.b)}`);
  return [
    `## ${sa} vs ${sb}: holdings overlap`,
    "",
    `**Weighted overlap:** ${p(o.weighted)}. ${verdict}`,
    `**Shared holdings:** ${o.shared.length} (${p((o.shared.length / o.countA) * 100)} of ${sa}'s ${o.countA} positions, ${p((o.shared.length / o.countB) * 100)} of ${sb}'s ${o.countB})`,
    "",
    `### Biggest shared positions`,
    ...(rows.length ? rows : ["None."]),
    "",
    `_Weighted overlap adds up the smaller of the two weights for every shared position. ${sa} as of ${fa.reportDate ?? "?"}, ${sb} as of ${fb.reportDate ?? "?"}, from SEC Form N-PORT._`,
  ].join("\n");
}

export async function handleSecTool(name: string, args: Record<string, unknown>) {
  if (name === "get_etf_full_holdings") {
    const symbol = ticker(args.symbol);
    const rawTop = Number(args.top ?? DEFAULT_TOP);
    const top = Number.isFinite(rawTop) ? Math.min(MAX_TOP, Math.max(1, Math.round(rawTop))) : DEFAULT_TOP;
    const filing = await fullHoldings(symbol);
    return { content: [{ type: "text" as const, text: formatFull(symbol, filing, top) }] };
  }
  if (name === "get_etf_overlap") {
    const list = Array.isArray(args.symbols) ? args.symbols : [];
    if (list.length !== 2) throw new McpError(ErrorCode.InvalidParams, "Pass exactly two tickers.");
    const [a, b] = list.map(ticker);
    if (a === b) throw new McpError(ErrorCode.InvalidParams, "Pass two different tickers.");
    const [fa, fb] = await Promise.all([fullHoldings(a), fullHoldings(b)]);
    return { content: [{ type: "text" as const, text: formatOverlap(a, fa, b, fb) }] };
  }
  return undefined;
}
