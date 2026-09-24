# etf-research-mcp

[![npm version](https://img.shields.io/npm/v/etf-research-mcp)](https://www.npmjs.com/package/etf-research-mcp)
[![npm downloads](https://img.shields.io/npm/dm/etf-research-mcp)](https://www.npmjs.com/package/etf-research-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](#license)
[![node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

MCP server for ETF research. Gives Claude tools for quotes, expense ratios, performance and fund comparisons from Yahoo Finance, plus every holding a fund owns straight from its SEC filing. Nothing to sign up for.

## Tools

| Tool | What it does |
|------|-------------|
| `search_etfs` | Discover ETFs by keyword or theme ("AI ETF", "dividend growth") |
| `get_etf_quote` | Current price, change, volume, 52-week range, moving averages |
| `get_etf_summary` | Expense ratio, AUM, NAV, fund family, beta, dividend yield |
| `get_etf_holdings` | Top 10 holdings with weights, from Yahoo |
| `get_etf_full_holdings` | Every holding, from the fund's latest SEC N-PORT filing, with concentration: how many stocks make up half the fund, top-10 and top-25 weight, asset and country mix |
| `get_etf_overlap` | How much two ETFs hold the same stocks, weighted. Tells you whether owning both actually diversifies |
| `compare_etfs` | Side-by-side comparison of 2–5 ETFs |
| `get_etf_performance` | Price return and total return with dividends reinvested, over 1m / 3m / 6m / 1y / 3y / 5y |
| `get_similar_etfs` | Find alternative ETFs similar to a given ticker |

## Install

### Claude Code

```bash
claude mcp add etf-research --scope user -- npx -y etf-research-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "etf-research": {
      "command": "npx",
      "args": ["-y", "etf-research-mcp"]
    }
  }
}
```

### Any MCP client

The server speaks MCP over stdio, so any client that can launch a command works:

```bash
npx -y etf-research-mcp
```

## Example prompts

> "Find me AI-focused ETFs"

> "Compare QQQM, VOO, and VUG expense ratios and YTD returns"

> "What are the top 10 holdings of IJR?"

> "How has QQQM performed over the last year?"

> "What ETFs are similar to QQQM?"

> "How much do QQQM and VUG overlap?"

> "List every holding in SCHG and tell me how concentrated it is"

## Data sources

Quotes, summaries and performance come from Yahoo Finance via [yahoo-finance2](https://github.com/gadicc/yahoo-finance2). No sign-up, no key. Quotes are near-real-time.

Full holdings and overlap come from [SEC Form N-PORT](https://www.sec.gov/about/divisions-offices/division-investment-management/n-port), the quarterly report where every US fund lists every position it holds. It's free and official, but public filings are about 60 days behind the quarter they cover, and funds set up as unit investment trusts (SPY, DIA) don't file it.

SEC asks every automated tool to identify itself with a contact, so these two tools need one setting, `SEC_USER_AGENT`, with your name and email. It's sent only to sec.gov:

```bash
claude mcp add etf-research --scope user -e SEC_USER_AGENT="Jane Doe jane@example.com" -- npx -y etf-research-mcp
```

```json
"etf-research": {
  "command": "npx",
  "args": ["-y", "etf-research-mcp"],
  "env": { "SEC_USER_AGENT": "Jane Doe jane@example.com" }
}
```

Every other tool works without it.

## Development

```bash
git clone https://github.com/myanptl/etf-research-mcp
cd etf-research-mcp
npm install
npm run build     # compile TypeScript to dist/
npm start         # run the stdio server
npm run dev       # recompile on change
```

Test against a local build in Claude Code:

```bash
claude mcp add etf-research-dev -- node /path/to/etf-research-mcp/dist/index.js
```

## Built with

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [yahoo-finance2](https://github.com/gadicc/yahoo-finance2)
- [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- TypeScript + Node 22+

## Disclaimer

Market data is provided for research and education. Not investment advice.

## License

MIT © [Myan Patel](https://github.com/myanptl)
