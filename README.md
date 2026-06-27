# etf-research-mcp

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

## Install in Claude Code

```bash
claude mcp add etf-research --scope user -- npx -y etf-research-mcp
```

## Example prompts

> "Find me AI-focused ETFs"

> "Compare QQQM, VOO, and VUG expense ratios and YTD returns"

> "What are the top 10 holdings of IJR?"

> "How has QQQM performed over the last year?"

> "What ETFs are similar to QQQM?"

## No API key required

Data comes from Yahoo Finance via [yahoo-finance2](https://github.com/gadicc/yahoo-finance2). No sign-up, no key.

## Built with

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [yahoo-finance2](https://github.com/gadicc/yahoo-finance2)
- TypeScript + Node 18+

## Author

Myan Patel — [GitHub](https://github.com/myanptl)
