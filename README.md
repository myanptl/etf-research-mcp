# etf-research-mcp

[![npm version](https://img.shields.io/npm/v/etf-research-mcp)](https://www.npmjs.com/package/etf-research-mcp)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](#license)
[![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

MCP server for real-time ETF research. Gives Claude tools to look up quotes, holdings, expense ratios, and fund comparisons using Yahoo Finance — no API key required.

## Tools

| Tool | What it does |
|------|-------------|
| `search_etfs` | Discover ETFs by keyword or theme ("AI ETF", "dividend growth") |
| `get_etf_quote` | Current price, change, volume, 52-week range, moving averages |
| `get_etf_summary` | Expense ratio, AUM, NAV, fund family, beta, dividend yield |
| `get_etf_holdings` | Top holdings with portfolio weight percentages |
| `compare_etfs` | Side-by-side comparison of 2–5 ETFs |
| `get_etf_performance` | Historical price data over 1m / 3m / 6m / 1y / 3y / 5y |
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

## No API key required

Data comes from Yahoo Finance via [yahoo-finance2](https://github.com/gadicc/yahoo-finance2). No sign-up, no key. Quotes are near-real-time; fundamentals update on Yahoo's schedule.

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
- TypeScript + Node 18+

## Disclaimer

Market data is provided for research and education. Not investment advice.

## License

MIT © [Myan Patel](https://github.com/myanptl)
