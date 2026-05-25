import type { Anomaly, Trade } from "./types";
import {
  bySymbol,
  dailySeries,
  drawdownEvents,
  findStreaks,
  monthlySeries,
  summarize,
  windowStats,
} from "./stats";
import { fmtDate, fmtMoney } from "./format";

/**
 * Build a compact text block summarising the account for the chat model.
 * Optimized for token efficiency — we ship aggregates and notable events
 * rather than every trade. Daily series is the most expensive part but is
 * the one the model needs to answer "since X date" questions accurately.
 */
export function buildChatContext(trades: Trade[], anomalies: Anomaly[]): string {
  if (trades.length === 0) return "(no trades loaded)";

  const closed = trades.filter((t) => t.isClosed && !t.isPending);
  const s = summarize(trades);
  const sym = bySymbol(trades).slice(0, 15);
  const daily = dailySeries(trades);
  const monthly = monthlySeries(trades);
  const dds = drawdownEvents(trades, 200);
  const { longestWin, longestLoss } = findStreaks(trades);

  // Post-largest-drawdown window stats (the "since last blowup" question)
  let postWorstDd = "";
  if (dds.length > 0) {
    const worst = dds[0];
    if (worst.troughDate) {
      const from = new Date(Date.parse(worst.troughDate + "T23:59:59Z"));
      const stat = windowStats(trades, from, null);
      postWorstDd = `\nAfter worst drawdown trough ${worst.troughDate}: ${stat.closedTrades} trades, win rate ${(stat.winRate * 100).toFixed(1)}%, net ${fmtMoney(stat.netPnl)}, expectancy ${fmtMoney(stat.expectancy)}/trade.`;
    }
  }

  const lines: string[] = [];

  lines.push(`ACCOUNT SUMMARY`);
  lines.push(`- Trades: ${s.totalTrades} total, ${s.closedTrades} closed (${s.dealerCount} dealer-routed)`);
  lines.push(`- Range: ${fmtDate(s.dateFrom)} → ${fmtDate(s.dateTo)}`);
  lines.push(`- Net P&L: ${fmtMoney(s.netPnl)} (gross profit ${fmtMoney(s.grossProfit)} / gross loss ${fmtMoney(s.grossLoss)})`);
  lines.push(`- Win rate: ${(s.winRate * 100).toFixed(1)}% (avg win ${fmtMoney(s.avgWin)}, avg loss ${fmtMoney(s.avgLoss)})`);
  lines.push(`- Profit factor: ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "n/a"}`);
  lines.push(`- Expectancy: ${fmtMoney(s.expectancy)}/trade`);
  lines.push(`- Largest win ${fmtMoney(s.largestWin)} / largest loss ${fmtMoney(s.largestLoss)}`);
  lines.push(`- Total swaps paid: ${fmtMoney(s.totalSwaps)}`);
  lines.push(`- Unique symbols: ${s.uniqueSymbols}`);

  lines.push(`\nTOP SYMBOLS BY ABSOLUTE P&L`);
  for (const r of sym) {
    lines.push(
      `- ${r.symbol}: ${r.trades} trades, win ${(r.winRate * 100).toFixed(1)}%, net ${fmtMoney(r.totalPnl)}, expectancy ${fmtMoney(r.expectancy)}`,
    );
  }

  lines.push(`\nMONTHLY P&L`);
  for (const m of monthly) {
    lines.push(`- ${m.month}: ${m.trades} trades, win ${(m.winRate * 100).toFixed(1)}%, ${fmtMoney(m.pnl)}`);
  }

  if (dds.length > 0) {
    lines.push(`\nDRAWDOWN EVENTS (most negative first, min $200 magnitude)`);
    for (const d of dds.slice(0, 10)) {
      lines.push(
        `- ${d.peakDate} (peak ${fmtMoney(d.peakEquity)}) → ${d.troughDate} (trough ${fmtMoney(d.troughEquity)}), ` +
          `magnitude ${fmtMoney(d.magnitude)} (${(d.magnitudePct * 100).toFixed(1)}%), ` +
          `${d.recoveryDate ? `recovered ${d.recoveryDate} in ${d.recoveryDays}d` : `NOT RECOVERED at end of sample`}`,
      );
    }
  }

  if (longestWin || longestLoss) {
    lines.push(`\nNOTABLE STREAKS`);
    if (longestWin) {
      lines.push(
        `- Longest win streak: ${longestWin.length} trades, ${longestWin.startDate} → ${longestWin.endDate}, net ${fmtMoney(longestWin.totalPnl)}`,
      );
    }
    if (longestLoss) {
      lines.push(
        `- Longest loss streak: ${longestLoss.length} trades, ${longestLoss.startDate} → ${longestLoss.endDate}, net ${fmtMoney(longestLoss.totalPnl)}`,
      );
    }
  }

  if (postWorstDd) lines.push(`\nPOST-WORST-DRAWDOWN WINDOW${postWorstDd}`);

  // Daily series — most token-heavy section, keep concise: only days with trades
  lines.push(`\nDAILY P&L (closed-trade days only, ${daily.length} days)`);
  for (const d of daily) {
    lines.push(`- ${d.date}: ${d.trades} trades, ${d.wins} wins, ${fmtMoney(d.pnl)}, cum ${fmtMoney(d.cumulativePnl)}`);
  }

  // Anomalies — keep tickets so the model can cite them
  if (anomalies.length > 0) {
    lines.push(`\nFLAGGED ANOMALIES (${anomalies.length})`);
    for (const a of anomalies.slice(0, 80)) {
      lines.push(`- [${a.severity}] #${a.ticket} ${a.category}: ${a.summary}`);
    }
  }

  // Outliers — biggest 10 losses and wins
  const sortedByLoss = closed.slice().sort((a, b) => a.total - b.total).slice(0, 10);
  const sortedByWin = closed.slice().sort((a, b) => b.total - a.total).slice(0, 10);
  lines.push(`\nTOP 10 LOSSES`);
  for (const t of sortedByLoss) {
    lines.push(
      `- #${t.ticket} ${fmtDate(t.closeTime)} ${t.symbol} ${t.side} ${t.volume} → ${fmtMoney(t.total)}` +
        (t.comment ? ` "${t.comment}"` : ""),
    );
  }
  lines.push(`\nTOP 10 WINS`);
  for (const t of sortedByWin) {
    lines.push(
      `- #${t.ticket} ${fmtDate(t.closeTime)} ${t.symbol} ${t.side} ${t.volume} → ${fmtMoney(t.total)}` +
        (t.comment ? ` "${t.comment}"` : ""),
    );
  }

  return lines.join("\n");
}
