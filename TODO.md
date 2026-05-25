# Trade Analyzer — TODO

## v0.1 — shipped
- [x] CSV/TSV parser with comma-numbers + footer skip
- [x] Stats engine (summary, symbol, hour, dow, hold, equity, drawdown)
- [x] Detectors (dealer fills, rapid profit, stop-out, hedge, outsized, weekend, martingale, long holds, stop mods)
- [x] /api/analyze with Claude Sonnet, anomaly-only payload
- [x] Single-page UI with filters, charts, anomaly list, AI panel
- [x] Account metadata (label / MT4 number / CRM link) persisted to localStorage
- [x] Dealer filter toggle (default OFF)

## Next
- [ ] Persist accounts in Supabase (multi-account workspace)
- [ ] Compare-mode: load two ledgers side-by-side
- [ ] Drill-down: click a symbol/hour bar to filter the trade list
- [ ] Per-anomaly "investigate" button — Sonnet writes a one-trade brief
- [ ] Detect price-vs-market gap (needs market data source — Polygon/AlphaVantage)
- [ ] Detect grouped opens (same symbol, < 5s apart, same side) → arbitrage attempt
- [ ] Export anomaly list to CSV
- [ ] Toast / banner for parse errors
- [ ] Tests for parser edge cases (cancelled, deleted, hedge volume=0)
- [ ] Server-side request size limit + abuse rate limit
