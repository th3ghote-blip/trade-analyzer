import type { Trade, Anomaly } from "./types";

// --- helpers ---
const MINUTE = 60_000;

function isWeekendUTC(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

// --- A: exploit-style detectors ---

/** Dealer fills with rapid profit. The "Benefit Trade" pattern. */
export function detectDealerFills(trades: Trade[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of trades) {
    if (!/dealer/i.test(t.reason)) continue;
    const fast = t.holdMinutes <= 2;
    const profit = t.total > 0;
    const flaggedComment = /benefit|gift|credit|adjust|comp/i.test(t.comment);
    const severity =
      flaggedComment && profit ? "high" : fast && profit ? "high" : profit ? "warn" : "info";
    out.push({
      ticket: t.ticket,
      category: "dealer_fill",
      severity,
      summary:
        `${t.symbol} ${t.side} ${t.volume}, dealer-routed, held ${formatHold(t.holdMinutes)}, ` +
        `P&L $${t.total.toFixed(2)}` +
        (t.comment ? ` — "${t.comment}"` : ""),
      trade: t,
    });
  }
  return out;
}

/** Any non-dealer trade with very rapid profit on a non-trivial volume. */
export function detectRapidProfit(trades: Trade[], opts = { maxMinutes: 1, minProfit: 100 }): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of trades) {
    if (/dealer/i.test(t.reason)) continue; // covered by dealer detector
    if (!t.isClosed || t.isPending) continue;
    if (t.holdMinutes > opts.maxMinutes) continue;
    if (t.total < opts.minProfit) continue;
    out.push({
      ticket: t.ticket,
      category: "rapid_profit",
      severity: t.total > 500 ? "high" : "warn",
      summary: `${t.symbol} ${t.side} ${t.volume} closed in ${formatHold(t.holdMinutes)} for +$${t.total.toFixed(2)}`,
      trade: t,
    });
  }
  return out;
}

/** Margin call / stop-out cascade events tagged by the platform (`so: ...`). */
export function detectStopOuts(trades: Trade[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of trades) {
    if (!t.isStopOut) continue;
    out.push({
      ticket: t.ticket,
      category: "stop_out_cascade",
      severity: "high",
      summary:
        `Stop-out: ${t.symbol} ${t.side} ${t.volume} closed at ${t.closePrice} ` +
        `for $${t.total.toFixed(2)} — ${t.comment}`,
      trade: t,
    });
  }
  return out;
}

/** Hedge-pair closes (volume=0 with "close hedge by #" comment). */
export function detectHedgeEvents(trades: Trade[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of trades) {
    if (!t.isHedgeClose) continue;
    out.push({
      ticket: t.ticket,
      category: "hedge_event",
      severity: "info",
      summary: `Hedge close on ${t.symbol} — ${t.comment}`,
      trade: t,
    });
  }
  return out;
}

/** Outsized volume relative to account median — possible all-in / FOMO. */
export function detectOutsized(trades: Trade[]): Anomaly[] {
  const vols = trades
    .filter((t) => t.isClosed && !t.isPending && t.volume > 0)
    .map((t) => t.volume)
    .sort((a, b) => a - b);
  if (vols.length < 20) return [];
  const median = vols[Math.floor(vols.length / 2)];
  const threshold = Math.max(median * 20, 1);
  const out: Anomaly[] = [];
  for (const t of trades) {
    if (!t.isClosed || t.isPending) continue;
    if (t.volume < threshold) continue;
    out.push({
      ticket: t.ticket,
      category: "outsized_position",
      severity: t.volume > threshold * 5 ? "high" : "warn",
      summary:
        `Outsized: ${t.symbol} ${t.side} ${t.volume} lots ` +
        `(${(t.volume / median).toFixed(0)}× median ${median}) — P&L $${t.total.toFixed(2)}`,
      trade: t,
    });
  }
  return out;
}

/** Fills that landed outside typical market hours for that symbol (weekend on FX/equities). */
export function detectWeekendFills(trades: Trade[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of trades) {
    if (!isWeekendUTC(t.openTime)) continue;
    // Crypto trades on weekends — exclude obvious crypto symbols.
    if (/BTC|ETH|XRP|SOL|LTC|ADA|AVAX|DOT|AAVE/i.test(t.symbol)) continue;
    out.push({
      ticket: t.ticket,
      category: "weekend_fill",
      severity: "warn",
      summary: `Weekend fill on ${t.symbol} at ${t.openTime.toISOString().replace("T", " ").slice(0, 16)} UTC`,
      trade: t,
    });
  }
  return out;
}

// --- B: behavioural / pattern detectors ---

/** Martingale-style escalation: increasing volume on the same symbol after a loss. */
export function detectMartingale(trades: Trade[]): Anomaly[] {
  const closed = trades
    .filter((t) => t.isClosed && !t.isPending)
    .sort((a, b) => a.openTime.getTime() - b.openTime.getTime());

  const lastPerSymbol = new Map<string, Trade>();
  const out: Anomaly[] = [];
  for (const t of closed) {
    const prev = lastPerSymbol.get(t.symbol);
    if (prev && prev.total < 0 && t.volume >= prev.volume * 3 && t.openTime.getTime() - prev.openTime.getTime() < 7 * 24 * 60 * MINUTE) {
      out.push({
        ticket: t.ticket,
        category: "martingale_escalation",
        severity: t.volume >= prev.volume * 10 ? "high" : "warn",
        summary:
          `Volume escalation on ${t.symbol}: prev ${prev.volume} → ${t.volume} ` +
          `(${(t.volume / prev.volume).toFixed(1)}×) after $${prev.total.toFixed(2)} loss`,
        trade: t,
      });
    }
    lastPerSymbol.set(t.symbol, t);
  }
  return out;
}

/** Holds vastly longer than the trader's typical hold — often a "won't admit it's wrong" loser. */
export function detectLongHolds(trades: Trade[]): Anomaly[] {
  const closed = trades.filter((t) => t.isClosed && !t.isPending);
  if (closed.length < 30) return [];
  const sorted = closed.map((t) => t.holdMinutes).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(median * 50, 24 * 60);
  const out: Anomaly[] = [];
  for (const t of closed) {
    if (t.holdMinutes < threshold) continue;
    if (t.total >= 0) continue; // only losers — winners holding long are fine
    out.push({
      ticket: t.ticket,
      category: "unusually_long_hold",
      severity: t.total < -500 ? "high" : "warn",
      summary:
        `Held loser ${formatHold(t.holdMinutes)} (median ${formatHold(median)}): ` +
        `${t.symbol} ${t.side} ${t.volume} → $${t.total.toFixed(2)}`,
      trade: t,
    });
  }
  return out;
}

/** Stop / take-profit was set after entry (Sl != 0 *and* the comment shows `[sl]`/`[tp]` or similar). */
export function detectStopMods(trades: Trade[]): Anomaly[] {
  const out: Anomaly[] = [];
  for (const t of trades) {
    if (!/\[sl\]|\[tp\]/i.test(t.comment)) continue;
    out.push({
      ticket: t.ticket,
      category: "stop_modified_post_entry",
      severity: "info",
      summary: `${t.symbol}: closed via ${t.comment} — SL=${t.sl} TP=${t.tp}`,
      trade: t,
    });
  }
  return out;
}

// --- Aggregate ---

export function detectAll(trades: Trade[]): Anomaly[] {
  return [
    ...detectDealerFills(trades),
    ...detectRapidProfit(trades),
    ...detectStopOuts(trades),
    ...detectHedgeEvents(trades),
    ...detectOutsized(trades),
    ...detectWeekendFills(trades),
    ...detectMartingale(trades),
    ...detectLongHolds(trades),
    ...detectStopMods(trades),
  ].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: Anomaly["severity"]): number {
  return s === "high" ? 3 : s === "warn" ? 2 : 1;
}

function formatHold(min: number): string {
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min.toFixed(1)}m`;
  if (min < 60 * 24) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 60 / 24).toFixed(1)}d`;
}
