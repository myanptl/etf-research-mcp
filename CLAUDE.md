# etf-research-mcp — Claude Code Config

Published npm MCP server for ETF research (v1.1.1). Exposes ETF quote/holdings/
performance/compare tools over the Model Context Protocol.

## Stack
- TypeScript (ESM), compiled with `tsc` → `dist/`
- `@modelcontextprotocol/sdk` (server), `yahoo-finance2` (data source)
- Published to npm as `etf-research-mcp`

## Layout
- `src/` — MCP server + tool definitions
- `dist/` — compiled output (published + run via `node dist/index.js`)

## Commands
```bash
npm run build    # tsc → dist/
npm run dev      # tsc --watch
npm start        # node dist/index.js
npm publish      # runs prepublishOnly (build) first
```

## Conventions
- Tools are the public contract — validate every input (ticker format, ranges) before calling `yahoo-finance2`. Never trust MCP client input.
- Return structured MCP errors, not thrown/unhandled exceptions; don't leak stack traces to clients.
- yahoo-finance2 is unofficial and can rate-limit or change shape — handle failures and null fields defensively.
- Keep `dist/` in sync before publishing; bump version per semver on any tool-schema change.

## Deploy / Release
`npm version <patch|minor> && npm publish` (build runs automatically via `prepublishOnly`).

## Tooling available
- MCP `context7` (global) — pull live @modelcontextprotocol/sdk + yahoo-finance2 docs.
- Project agent `mcp-contract-reviewer` — tool schemas, validation, MCP compliance.
- Global agents: `typescript-reviewer`, `security-reviewer`.
