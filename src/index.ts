#!/usr/bin/env node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import YahooFinance from "yahoo-finance2";

// Must use `new YahooFinance()` — calling methods on the default export directly is deprecated.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// Read the version from package.json so it can never drift from the published
// package the way a hardcoded literal did (served 1.0.0 while npm was on 1.1.2).
const { version: PKG_VERSION } = createRequire(import.meta.url)(
  "../package.json"
) as { version: string };
export const SERVER_VERSION = PKG_VERSION;

const server = new Server(
  { name: "etf-research-mcp", version: PKG_VERSION },
  { capabilities: { tools: {} } }
);

// ─── Tool Definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_etf_quote",
      description:
        "Get the current price, change, volume, and key stats for any ETF ticker (e.g. QQQM, VOO, VUG).",
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "ETF ticker symbol (e.g. QQQM)",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_etf_summary",
      description:
        "Get detailed fund info for an ETF: expense ratio, category, AUM, NAV, fund family, and inception date.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "ETF ticker symbol (e.g. VUG)",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "get_etf_holdings",
      description:
        "Get the top holdings of an ETF with their portfolio weight percentages.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "ETF ticker symbol (e.g. VOO)",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "compare_etfs",
      description:
        "Compare 2–5 ETFs side by side: price, expense ratio, AUM, YTD return, category.",
      inputSchema: {
        type: "object",
        properties: {
          symbols: {
            type: "array",
            items: { type: "string" },
            description:
              'List of 2–5 ETF ticker symbols (e.g. ["QQQM", "VOO", "VUG"])',
            minItems: 2,
            maxItems: 5,
          },
        },
        required: ["symbols"],
      },
    },
    {
      name: "get_etf_performance",
      description:
        "Get historical price performance for an ETF over a given period (1m, 3m, 6m, 1y, 3y, 5y).",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "ETF ticker symbol" },
          period: {
            type: "string",
            enum: ["1m", "3m", "6m", "1y", "3y", "5y"],
            description: "Time period for performance data. Defaults to 1y.",
          },
        },
        required: ["symbol"],
      },
    },
    {
      name: "search_etfs",
      description:
        "Search for ETFs by keyword or theme (e.g. 'AI', 'clean energy', 'small cap value'). Returns matching tickers and fund names.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term (e.g. 'technology ETF', 'dividend growth')",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 10, max 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_similar_etfs",
      description:
        "Find ETFs similar to a given ticker based on Yahoo Finance's recommendation engine. Useful for discovering alternatives.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description: "ETF ticker to find alternatives for (e.g. QQQM)",
          },
        },
        required: ["symbol"],
      },
    },
  ],
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

type LooseRecord = Record<string, unknown>;

export function get<T>(obj: unknown, key: string): T | undefined {
  return (obj as LooseRecord)?.[key] as T | undefined;
}

export function pct(value: number | null | undefined): string {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(2)}%`;
}

export function currency(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "N/A";
  return `$${value.toFixed(decimals)}`;
}

export function formatAum(value: number | null | undefined): string {
  if (value == null) return "N/A";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString()}`;
}

export const PERIODS = ["1m", "3m", "6m", "1y", "3y", "5y"] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = "1y";

export function periodToDate(period: string): Date {
  const d = new Date();
  const offsets: Record<Period, () => void> = {
    "1m": () => d.setMonth(d.getMonth() - 1),
    "3m": () => d.setMonth(d.getMonth() - 3),
    "6m": () => d.setMonth(d.getMonth() - 6),
    "1y": () => d.setFullYear(d.getFullYear() - 1),
    "3y": () => d.setFullYear(d.getFullYear() - 3),
    "5y": () => d.setFullYear(d.getFullYear() - 5),
  };
  const offset = offsets[period as Period];
  if (!offset) {
    // The tool schema declares an enum, but MCP does not enforce schemas at
    // runtime, so an unknown period reaches this function. It used to fall
    // through and return TODAY, which silently produced a zero-length range and
    // an empty performance report instead of an error.
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unsupported period "${period}". Use one of: ${PERIODS.join(", ")}.`
    );
  }
  offset();
  return d;
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── get_etf_quote ─────────────────────────────────────────────────────
      case "get_etf_quote": {
        const symbol = (args as { symbol: string }).symbol.toUpperCase();
        const q = (await yf.quote(symbol)) as LooseRecord;

        const changeRaw = get<number>(q, "regularMarketChangePercent");
        const changeFmt =
          changeRaw != null ? `${changeRaw.toFixed(2)}%` : "N/A";

        const lines = [
          `## ${get<string>(q, "longName") ?? get<string>(q, "shortName") ?? symbol} (${symbol})`,
          ``,
          `**Price:** ${currency(get<number>(q, "regularMarketPrice"))}`,
          `**Change:** ${currency(get<number>(q, "regularMarketChange"))} (${changeFmt})`,
          `**Previous Close:** ${currency(get<number>(q, "regularMarketPreviousClose"))}`,
          `**Day Range:** ${currency(get<number>(q, "regularMarketDayLow"))} – ${currency(get<number>(q, "regularMarketDayHigh"))}`,
          `**52-Week Range:** ${currency(get<number>(q, "fiftyTwoWeekLow"))} – ${currency(get<number>(q, "fiftyTwoWeekHigh"))}`,
          `**Volume:** ${(get<number>(q, "regularMarketVolume") ?? 0).toLocaleString() || "N/A"}`,
          `**Avg Volume (3m):** ${(get<number>(q, "averageDailyVolume3Month") ?? 0).toLocaleString() || "N/A"}`,
          `**AUM (Net Assets):** ${formatAum(get<number>(q, "netAssets") ?? get<number>(q, "marketCap"))}`,
          `**50-Day MA:** ${currency(get<number>(q, "fiftyDayAverage"))}`,
          `**200-Day MA:** ${currency(get<number>(q, "twoHundredDayAverage"))}`,
          `**YTD Return:** ${get<number>(q, "ytdReturn") != null ? `${get<number>(q, "ytdReturn")!.toFixed(2)}%` : "N/A"}`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ── get_etf_summary ───────────────────────────────────────────────────
      case "get_etf_summary": {
        const symbol = (args as { symbol: string }).symbol.toUpperCase();
        const summary = (await yf.quoteSummary(symbol, {
          modules: ["fundProfile", "defaultKeyStatistics", "summaryDetail"],
        })) as LooseRecord;

        const fp = get<LooseRecord>(summary, "fundProfile");
        const ks = get<LooseRecord>(summary, "defaultKeyStatistics");
        const sd = get<LooseRecord>(summary, "summaryDetail");
        const fei = get<LooseRecord>(fp, "feesExpensesInvestment");

        const lines = [
          `## ${symbol} — Fund Summary`,
          ``,
          `**Category:** ${get<string>(fp, "categoryName") ?? "N/A"}`,
          `**Fund Family:** ${get<string>(fp, "family") ?? "N/A"}`,
          `**Expense Ratio:** ${pct(get<number>(fei, "annualReportExpenseRatio"))}`,
          `**AUM:** ${formatAum(get<number>(ks, "totalAssets"))}`,
          `**NAV:** ${currency(get<number>(sd, "navPrice"))}`,
          `**Beta (3Y):** ${(get<number>(ks, "beta3Year") ?? get<number>(ks, "beta"))?.toFixed(2) ?? "N/A"}`,
          `**Dividend Yield:** ${pct(get<number>(sd, "dividendYield") ?? get<number>(sd, "yield"))}`,
          `**52-Week High:** ${currency(get<number>(sd, "fiftyTwoWeekHigh"))}`,
          `**52-Week Low:** ${currency(get<number>(sd, "fiftyTwoWeekLow"))}`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ── get_etf_holdings ──────────────────────────────────────────────────
      case "get_etf_holdings": {
        const symbol = (args as { symbol: string }).symbol.toUpperCase();
        const summary = (await yf.quoteSummary(symbol, {
          modules: ["topHoldings"],
        })) as LooseRecord;

        const th = get<LooseRecord>(summary, "topHoldings");
        const holdings = get<LooseRecord[]>(th, "holdings");

        if (!holdings?.length) {
          return {
            content: [
              {
                type: "text",
                text: `No holdings data available for ${symbol}. This ticker may not be an ETF or mutual fund.`,
              },
            ],
          };
        }

        const sc = get<LooseRecord>(th, "stockConcentration");
        const concentration = get<number>(sc, "tenHoldingsPercentage");

        const holdingLines = holdings.map((h, i) => {
          const weight = get<number>(h, "holdingPercent");
          const weightFmt = weight != null ? pct(weight) : "N/A";
          return `${i + 1}. **${get<string>(h, "symbol") ?? "N/A"}** — ${get<string>(h, "holdingName") ?? ""} (${weightFmt})`;
        });

        const lines = [
          `## ${symbol} — Top Holdings`,
          ``,
          `**Top-10 Concentration:** ${pct(concentration)}`,
          ``,
          ...holdingLines,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ── compare_etfs ──────────────────────────────────────────────────────
      case "compare_etfs": {
        const symbols = (args as { symbols: string[] }).symbols.map((s) =>
          s.toUpperCase()
        );

        const results = await Promise.all(
          symbols.map(async (sym) => {
            const [q, summary] = await Promise.all([
              yf.quote(sym) as Promise<LooseRecord>,
              yf.quoteSummary(sym, {
                modules: ["fundProfile", "defaultKeyStatistics"],
              }) as Promise<LooseRecord>,
            ]);
            const fp = get<LooseRecord>(summary, "fundProfile");
            const ks = get<LooseRecord>(summary, "defaultKeyStatistics");
            const fei = get<LooseRecord>(fp, "feesExpensesInvestment");
            return { sym, q, fp, ks, fei };
          })
        );

        const row = (label: string, fn: (r: (typeof results)[0]) => string) =>
          `| ${label} | ${results.map(fn).join(" | ")} |`;

        const table = [
          `## ETF Comparison: ${symbols.join(" vs ")}`,
          ``,
          `| Metric | ${symbols.join(" | ")} |`,
          `|--------|${symbols.map(() => "--------|").join("")}`,
          row("Price", ({ q }) => currency(get<number>(q, "regularMarketPrice"))),
          row("1-Day Change", ({ q }) => {
            const v = get<number>(q, "regularMarketChangePercent");
            return v != null ? `${v.toFixed(2)}%` : "N/A";
          }),
          row("YTD Return", ({ q }) => {
            const v = get<number>(q, "ytdReturn");
            return v != null ? `${v.toFixed(2)}%` : "N/A";
          }),
          row("AUM", ({ ks }) => formatAum(get<number>(ks, "totalAssets"))),
          row("Expense Ratio", ({ fei }) =>
            pct(get<number>(fei, "annualReportExpenseRatio"))
          ),
          row("Category", ({ fp }) => get<string>(fp, "categoryName") ?? "N/A"),
          row("Fund Family", ({ fp }) => get<string>(fp, "family") ?? "N/A"),
          row(
            "Beta (3Y)",
            ({ ks }) =>
              (get<number>(ks, "beta3Year") ?? get<number>(ks, "beta"))?.toFixed(
                2
              ) ?? "N/A"
          ),
          row("52W High", ({ q }) => currency(get<number>(q, "fiftyTwoWeekHigh"))),
          row("52W Low", ({ q }) => currency(get<number>(q, "fiftyTwoWeekLow"))),
        ].join("\n");

        return { content: [{ type: "text", text: table }] };
      }

      // ── get_etf_performance ───────────────────────────────────────────────
      case "get_etf_performance": {
        const { symbol, period = DEFAULT_PERIOD } = args as {
          symbol: string;
          period?: string;
        };
        const sym = symbol.toUpperCase();

        const intervalMap: Record<string, "1d" | "1wk" | "1mo"> = {
          "1m": "1d",
          "3m": "1wk",
          "6m": "1wk",
          "1y": "1mo",
          "3y": "1mo",
          "5y": "1mo",
        };

        // Yahoo removed the endpoint behind historical(); yahoo-finance2 now
        // rejects the call outright, which left this tool dead for every
        // period. chart() is the supported replacement.
        const { quotes } = await yf.chart(sym, {
          period1: periodToDate(period),
          interval: intervalMap[period] ?? "1mo",
        });

        // chart() emits an in-progress candle with null OHLC; those rows turn
        // the min/max and return math into NaN, so drop them.
        const historical = quotes.filter(
          (q): q is typeof q & { close: number; high: number; low: number } =>
            q.close != null && q.high != null && q.low != null
        );

        if (!historical.length) {
          return {
            content: [
              { type: "text", text: `No historical data found for ${sym}.` },
            ],
          };
        }

        const first = historical[0];
        const last = historical[historical.length - 1];
        const totalReturn = ((last.close - first.close) / first.close) * 100;
        const highPrice = Math.max(...historical.map((d) => d.high));
        const lowPrice = Math.min(...historical.map((d) => d.low));

        const recentRows = historical
          .slice(-10)
          .reverse()
          .map(
            (d) =>
              `| ${d.date.toISOString().split("T")[0]} | ${currency(d.close)} | ${currency(d.high)} | ${currency(d.low)} |`
          );

        const lines = [
          `## ${sym} — ${period.toUpperCase()} Performance`,
          ``,
          `**Period:** ${first.date.toISOString().split("T")[0]} → ${last.date.toISOString().split("T")[0]}`,
          `**Total Return:** ${totalReturn.toFixed(2)}%`,
          `**Start Price:** ${currency(first.close)}`,
          `**End Price:** ${currency(last.close)}`,
          `**Period High:** ${currency(highPrice)}`,
          `**Period Low:** ${currency(lowPrice)}`,
          ``,
          `### Most Recent Data Points`,
          `| Date | Close | High | Low |`,
          `|------|-------|------|-----|`,
          ...recentRows,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ── search_etfs ───────────────────────────────────────────────────────
      case "search_etfs": {
        const { query, limit = 10 } = args as { query: string; limit?: number };
        const cap = Math.min(limit, 20);

        // Yahoo's search ranks mutual funds and futures above ETFs for plain
        // theme words, so a bare "growth" came back with a single obscure ETF
        // and none of VUG/SCHG/MGK. Biasing the query toward ETFs and asking
        // for a wider result set fixes the recall.
        const biased = /\betfs?\b/i.test(query) ? query : `${query} ETF`;
        const result = (await yf.search(biased, {
          quotesCount: 30,
        })) as LooseRecord;

        const quotes = get<LooseRecord[]>(result, "quotes") ?? [];
        const etfs = quotes
          .filter((q) => q && get<string>(q, "quoteType") === "ETF")
          // A US-listed ticker carries no exchange suffix. Foreign cross-listings
          // (GWTH.AX, 2638.T, ...) are rarely what the caller wants, so rank them last.
          .sort((a, b) => {
            const foreign = (q: LooseRecord) =>
              (get<string>(q, "symbol") ?? "").includes(".") ? 1 : 0;
            return foreign(a) - foreign(b);
          })
          .slice(0, cap);

        if (!etfs.length) {
          return {
            content: [
              {
                type: "text",
                text: `No ETFs found for "${query}". Try a different search term.`,
              },
            ],
          };
        }

        const rows = etfs.map((e, i) => {
          const sym = get<string>(e, "symbol") ?? "N/A";
          const name = get<string>(e, "longname") ?? get<string>(e, "shortname") ?? "N/A";
          const exchange = get<string>(e, "exchange") ?? "";
          return `${i + 1}. **${sym}** — ${name}${exchange ? ` (${exchange})` : ""}`;
        });

        const lines = [
          `## ETF Search: "${query}"`,
          ``,
          `Found ${etfs.length} result${etfs.length === 1 ? "" : "s"}:`,
          ``,
          ...rows,
          ``,
          `_Use \`get_etf_quote\`, \`get_etf_summary\`, or \`compare_etfs\` to dig into any of these._`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ── get_similar_etfs ──────────────────────────────────────────────────
      case "get_similar_etfs": {
        const symbol = (args as { symbol: string }).symbol.toUpperCase();
        const result = (await yf.recommendationsBySymbol(symbol)) as LooseRecord;

        const recommended = get<LooseRecord[]>(result, "recommendedSymbols") ?? [];

        if (!recommended.length) {
          return {
            content: [
              {
                type: "text",
                text: `No similar ETFs found for ${symbol}.`,
              },
            ],
          };
        }

        const symbols = recommended.map((r) => get<string>(r, "symbol")).filter(Boolean) as string[];

        // Fetch a quick quote for each to show name + price
        const quotes = await Promise.all(
          symbols.map(async (sym) => {
            try {
              const q = (await yf.quote(sym)) as LooseRecord;
              return { sym, q };
            } catch {
              return { sym, q: null };
            }
          })
        );

        const rows = quotes.map((item, i) => {
          const name = item.q
            ? (get<string>(item.q, "longName") ?? get<string>(item.q, "shortName") ?? item.sym)
            : item.sym;
          const price = item.q ? currency(get<number>(item.q, "regularMarketPrice")) : "N/A";
          const ytd = item.q ? get<number>(item.q, "ytdReturn") : null;
          const ytdFmt = ytd != null ? ` | YTD: ${ytd.toFixed(2)}%` : "";
          return `${i + 1}. **${item.sym}** — ${name} (${price}${ytdFmt})`;
        });

        const lines = [
          `## ETFs Similar to ${symbol}`,
          ``,
          ...rows,
          ``,
          `_Use \`compare_etfs\` to run a side-by-side with any of these._`,
        ];

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new McpError(
      ErrorCode.InternalError,
      `Yahoo Finance error: ${message}`
    );
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only start the server when run as the binary. Importing this module (tests, or
// anything reusing the helpers) must not connect a stdio transport as a side effect.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
  });
}
