# Trade Analyzer

Single-account MT4 ledger analyzer. Paste a trade export, get back:

- Account summary (P&L, win rate, profit factor, expectancy, drawdown).
- Symbol / hour / day-of-week / hold-time breakdowns.
- Anomaly detectors for **possible platform exploits** (dealer fills, rapid-profit scalps, hedge games, weekend fills, outsized positions, stop-out cascades).
- Anomaly detectors for **trading-style patterns** (martingale escalation, holding losers, post-entry SL mods).
- Optional Claude analysis that takes the flagged subset + account aggregates and writes a short report.

Trade data is parsed in the browser. The AI route sends only the detector findings and aggregate stats — never the full ledger.

## Local dev

```bash
cp .env.example .env.local
# fill in ANTHROPIC_API_KEY in .env.local
npm install
npm run dev
```

Then open http://localhost:3000.

## Deploy to Vercel

1. Push this repo to GitHub (public is fine — secrets live only in `.env.local` which is gitignored).
2. On Vercel: New Project → Import → select the repo.
3. Environment Variables → add the following for Production and Preview:
   - `ANTHROPIC_API_KEY`
   - `BASIC_AUTH_USER`
   - `BASIC_AUTH_PASSWORD`
4. Deploy.

## Auth

Deployed instances are gated by HTTP Basic Auth via `middleware.ts`. Credentials come from `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`. If either is missing on a Vercel deployment, every request returns 503 (fail-closed). Local dev (`npm run dev` with no `VERCEL` env var) skips auth.

## Input format

Tab- or comma-separated, with or without header. Expected columns (MT4 export order):

```
#  OpenTime  OpenPrice  CloseTime  ClosePrice  Reason  Comment  Symbol  Side  Volume  Sl  Tp  Swaps  Profit  Total
```

Non-trade rows (footer totals, blank lines) are skipped automatically.

## Filters

- **Include dealer trades** — OFF by default. Toggle on to surface dealer-routed fills (the "Benefit Trade" pattern).
- **Include pending / cancelled** — OFF by default. Toggle on to include `BuyStop` / `SellStop` and rows with `cancelled` / `deleted` comments.
- **Symbol** — narrow to one symbol.

## Account metadata

Label, MT4 number, and CRM link are stored in browser localStorage and sent to the AI route as context (so the report can refer to "account 77123456" instead of an anonymous account). No server-side persistence yet.

## What it does NOT do

- No market-data comparison (yet) — exploit detection is purely from the ledger.
- No multi-account workspace — one ledger at a time.
- No write-back to MT4 or CRM.
