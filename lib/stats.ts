import type { Trade } from "./types";

export interface SymbolStat {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  totalVolume: number;
}

export interface HourBucket {
  hour: number; // 0-23 UTC of openTime
  trades: number;
  pnl: number;
  winRate: number;
}

export interface DayBucket {
  dow: number; // 0=Sun..6=Sat
  label: string;
  trades: number;
  pnl: number;
  winRate: number;
}

export interface HoldBucket {
  bucket: string;
  trades: number;
  pnl: number;
  winRate: number;
}

export interface EquityPoint {
  t: number; // ms timestamp of closeTime
  equity: number;
  drawdown: number;
}

export interface DrawdownStat {
  peak: number;
  trough: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
}

export interface SummaryStat {
  totalTrades: number;
  closedTrades: number;
  pendingTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  largestWin: number;
  largestLoss: number;
  totalVolume: number;
  totalSwaps: number;
  dateFrom: Date | null;
  dateTo: Date | null;
  uniqueSymbols: number;
  dealerCount: number;
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function summarize(trades: Trade[]): SummaryStat {
  const closed = trades.filter((t) => t.isClosed && !t.isPending);
  const wins = closed.filter((t) => t.total > 0);
  const losses = closed.filter((t) => t.total < 0);
  const breakeven = closed.filter((t) => t.total === 0);

  const grossProfit = wins.reduce((s, t) => s + t.total, 0);
  const grossLoss = losses.reduce((s, t) => s + t.total, 0);
  const netPnl = closed.reduce((s, t) => s + t.total, 0);
  const totalVolume = closed.reduce((s, t) => s + t.volume, 0);
  const totalSwaps = closed.reduce((s, t) => s + t.swaps, 0);

  const dates = closed
    .map((t) => t.openTime.getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  const symbols = new Set(closed.map((t) => t.symbol));
  const dealer = closed.filter((t) => /dealer/i.test(t.reason)).length;

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const winRate = closed.length ? wins.length / closed.length : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    pendingTrades: trades.filter((t) => t.isPending || !t.isClosed).length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate,
    grossProfit,
    grossLoss,
    netPnl,
    profitFactor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0,
    avgWin,
    avgLoss,
    expectancy,
    largestWin: wins.reduce((m, t) => Math.max(m, t.total), 0),
    largestLoss: losses.reduce((m, t) => Math.min(m, t.total), 0),
    totalVolume,
    totalSwaps,
    dateFrom: dates.length ? new Date(dates[0]) : null,
    dateTo: dates.length ? new Date(dates[dates.length - 1]) : null,
    uniqueSymbols: symbols.size,
    dealerCount: dealer,
  };
}

export function bySymbol(trades: Trade[]): SymbolStat[] {
  const map = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!t.isClosed || t.isPending) continue;
    const arr = map.get(t.symbol) ?? [];
    arr.push(t);
    map.set(t.symbol, arr);
  }

  const out: SymbolStat[] = [];
  for (const [symbol, arr] of map) {
    const wins = arr.filter((t) => t.total > 0);
    const losses = arr.filter((t) => t.total < 0);
    const totalPnl = arr.reduce((s, t) => s + t.total, 0);
    const grossProfit = wins.reduce((s, t) => s + t.total, 0);
    const grossLoss = losses.reduce((s, t) => s + t.total, 0);
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const winRate = arr.length ? wins.length / arr.length : 0;
    out.push({
      symbol,
      trades: arr.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnl,
      avgPnl: arr.length ? totalPnl / arr.length : 0,
      avgWin,
      avgLoss,
      expectancy: winRate * avgWin + (1 - winRate) * avgLoss,
      totalVolume: arr.reduce((s, t) => s + t.volume, 0),
    });
  }
  return out.sort((a, b) => b.totalPnl - a.totalPnl);
}

export function byHour(trades: Trade[]): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    trades: 0,
    pnl: 0,
    winRate: 0,
  }));
  const wins = Array<number>(24).fill(0);
  for (const t of trades) {
    if (!t.isClosed || t.isPending) continue;
    const h = t.openTime.getUTCHours();
    if (Number.isNaN(h)) continue;
    buckets[h].trades++;
    buckets[h].pnl += t.total;
    if (t.total > 0) wins[h]++;
  }
  for (let h = 0; h < 24; h++) {
    buckets[h].winRate = buckets[h].trades ? wins[h] / buckets[h].trades : 0;
  }
  return buckets;
}

export function byDow(trades: Trade[]): DayBucket[] {
  const buckets: DayBucket[] = DOW_LABELS.map((label, dow) => ({
    dow,
    label,
    trades: 0,
    pnl: 0,
    winRate: 0,
  }));
  const wins = Array<number>(7).fill(0);
  for (const t of trades) {
    if (!t.isClosed || t.isPending) continue;
    const d = t.openTime.getUTCDay();
    if (Number.isNaN(d)) continue;
    buckets[d].trades++;
    buckets[d].pnl += t.total;
    if (t.total > 0) wins[d]++;
  }
  for (let d = 0; d < 7; d++) {
    buckets[d].winRate = buckets[d].trades ? wins[d] / buckets[d].trades : 0;
  }
  return buckets;
}

const HOLD_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "<1m", max: 1 },
  { label: "1-5m", max: 5 },
  { label: "5-30m", max: 30 },
  { label: "30m-2h", max: 120 },
  { label: "2-8h", max: 480 },
  { label: "8-24h", max: 1440 },
  { label: "1-7d", max: 1440 * 7 },
  { label: ">7d", max: Infinity },
];

export function byHold(trades: Trade[]): HoldBucket[] {
  const buckets = HOLD_BUCKETS.map((b) => ({ bucket: b.label, trades: 0, pnl: 0, winRate: 0 }));
  const wins = Array<number>(HOLD_BUCKETS.length).fill(0);
  for (const t of trades) {
    if (!t.isClosed || t.isPending) continue;
    const idx = HOLD_BUCKETS.findIndex((b) => t.holdMinutes < b.max);
    const i = idx === -1 ? HOLD_BUCKETS.length - 1 : idx;
    buckets[i].trades++;
    buckets[i].pnl += t.total;
    if (t.total > 0) wins[i]++;
  }
  for (let i = 0; i < buckets.length; i++) {
    buckets[i].winRate = buckets[i].trades ? wins[i] / buckets[i].trades : 0;
  }
  return buckets;
}

export function equityCurve(trades: Trade[]): { points: EquityPoint[]; dd: DrawdownStat } {
  const closed = trades
    .filter((t) => t.isClosed && !t.isPending)
    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());

  const points: EquityPoint[] = [];
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let maxDdPct = 0;

  for (const t of closed) {
    equity += t.total;
    if (equity > peak) peak = equity;
    const dd = equity - peak;
    if (dd < maxDd) maxDd = dd;
    if (peak > 0 && dd / peak < maxDdPct) maxDdPct = dd / peak;
    points.push({ t: t.closeTime.getTime(), equity, drawdown: dd });
  }

  return {
    points,
    dd: {
      peak,
      trough: peak + maxDd,
      maxDrawdown: maxDd,
      maxDrawdownPct: maxDdPct,
    },
  };
}

export type OutcomeFilter = "all" | "wins" | "losses" | "breakeven";
export type SideFilter = "all" | "buy" | "sell";

export interface AdvancedFilters {
  includeDealer: boolean;
  includePending: boolean;
  symbols?: string[];
  dateFrom?: Date | null;
  dateTo?: Date | null;
  minPnl?: number | null;
  maxPnl?: number | null;
  minHoldMinutes?: number | null;
  maxHoldMinutes?: number | null;
  minVolume?: number | null;
  maxVolume?: number | null;
  outcome?: OutcomeFilter;
  side?: SideFilter;
}

export function applyFilters(trades: Trade[], opts: AdvancedFilters): Trade[] {
  return trades.filter((t) => {
    if (!opts.includeDealer && /dealer/i.test(t.reason)) return false;
    if (!opts.includePending && t.isPending) return false;
    if (opts.symbols && opts.symbols.length && !opts.symbols.includes(t.symbol)) return false;

    if (opts.dateFrom && t.openTime.getTime() < opts.dateFrom.getTime()) return false;
    if (opts.dateTo && t.openTime.getTime() > opts.dateTo.getTime()) return false;

    if (opts.minPnl != null && t.total < opts.minPnl) return false;
    if (opts.maxPnl != null && t.total > opts.maxPnl) return false;

    if (opts.minHoldMinutes != null && t.holdMinutes < opts.minHoldMinutes) return false;
    if (opts.maxHoldMinutes != null && t.holdMinutes > opts.maxHoldMinutes) return false;

    if (opts.minVolume != null && t.volume < opts.minVolume) return false;
    if (opts.maxVolume != null && t.volume > opts.maxVolume) return false;

    if (opts.outcome === "wins" && t.total <= 0) return false;
    if (opts.outcome === "losses" && t.total >= 0) return false;
    if (opts.outcome === "breakeven" && t.total !== 0) return false;

    if (opts.side === "buy" && !/^Buy/i.test(t.side)) return false;
    if (opts.side === "sell" && !/^Sell/i.test(t.side)) return false;

    return true;
  });
}

// --- Time-series + drawdown events ---

export interface DailyPoint {
  date: string; // YYYY-MM-DD (UTC)
  trades: number;
  wins: number;
  pnl: number;
  cumulativePnl: number;
}

export function dailySeries(trades: Trade[]): DailyPoint[] {
  const closed = trades
    .filter((t) => t.isClosed && !t.isPending)
    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());

  const map = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of closed) {
    const key = t.closeTime.toISOString().slice(0, 10);
    const prev = map.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    prev.trades++;
    prev.pnl += t.total;
    if (t.total > 0) prev.wins++;
    map.set(key, prev);
  }

  const out: DailyPoint[] = [];
  let cum = 0;
  for (const [date, agg] of Array.from(map.entries()).sort()) {
    cum += agg.pnl;
    out.push({ date, ...agg, cumulativePnl: cum });
  }
  return out;
}

export interface MonthlyPoint {
  month: string; // YYYY-MM
  trades: number;
  pnl: number;
  winRate: number;
}

export function monthlySeries(trades: Trade[]): MonthlyPoint[] {
  const closed = trades.filter((t) => t.isClosed && !t.isPending);
  const map = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of closed) {
    const key = t.closeTime.toISOString().slice(0, 7);
    const prev = map.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    prev.trades++;
    prev.pnl += t.total;
    if (t.total > 0) prev.wins++;
    map.set(key, prev);
  }
  return Array.from(map.entries())
    .sort()
    .map(([month, a]) => ({
      month,
      trades: a.trades,
      pnl: a.pnl,
      winRate: a.trades ? a.wins / a.trades : 0,
    }));
}

export interface DrawdownEvent {
  peakDate: string;
  peakEquity: number;
  troughDate: string;
  troughEquity: number;
  recoveryDate: string | null;
  recoveryDays: number | null;
  magnitude: number; // negative number
  magnitudePct: number; // negative number, fraction of peak
  durationDays: number;
}

/**
 * Identify drawdown cycles in the equity curve.
 * A new event starts when equity makes a new all-time high then drops; it ends
 * when equity returns to or exceeds the prior peak. The final (open) drawdown
 * is included with recoveryDate=null.
 */
export function drawdownEvents(trades: Trade[], minMagnitude = 50): DrawdownEvent[] {
  const closed = trades
    .filter((t) => t.isClosed && !t.isPending)
    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());

  const events: DrawdownEvent[] = [];
  let equity = 0;
  let peak = 0;
  let peakDate = closed[0]?.closeTime.toISOString().slice(0, 10) ?? "";
  let troughEquity = 0;
  let troughDate = peakDate;
  let inDrawdown = false;

  for (const t of closed) {
    equity += t.total;
    const day = t.closeTime.toISOString().slice(0, 10);

    if (equity >= peak) {
      // recovery or new peak
      if (inDrawdown && peak - troughEquity >= minMagnitude) {
        events.push({
          peakDate,
          peakEquity: peak,
          troughDate,
          troughEquity,
          recoveryDate: day,
          recoveryDays: daysBetween(peakDate, day),
          magnitude: troughEquity - peak,
          magnitudePct: peak ? (troughEquity - peak) / peak : 0,
          durationDays: daysBetween(peakDate, day),
        });
      }
      peak = equity;
      peakDate = day;
      troughEquity = equity;
      troughDate = day;
      inDrawdown = false;
    } else {
      if (!inDrawdown) {
        inDrawdown = true;
        troughEquity = equity;
        troughDate = day;
      } else if (equity < troughEquity) {
        troughEquity = equity;
        troughDate = day;
      }
    }
  }

  // Open drawdown at end of sample.
  if (inDrawdown && peak - troughEquity >= minMagnitude) {
    const lastDay = closed[closed.length - 1].closeTime.toISOString().slice(0, 10);
    events.push({
      peakDate,
      peakEquity: peak,
      troughDate,
      troughEquity,
      recoveryDate: null,
      recoveryDays: null,
      magnitude: troughEquity - peak,
      magnitudePct: peak ? (troughEquity - peak) / peak : 0,
      durationDays: daysBetween(peakDate, lastDay),
    });
  }

  return events.sort((a, b) => a.magnitude - b.magnitude); // most negative first
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + "T00:00:00Z");
  const tb = Date.parse(b + "T00:00:00Z");
  return Math.round((tb - ta) / 86_400_000);
}

export interface Streak {
  type: "win" | "loss";
  length: number;
  startDate: string;
  endDate: string;
  totalPnl: number;
}

export function findStreaks(trades: Trade[]): { longestWin: Streak | null; longestLoss: Streak | null } {
  const closed = trades
    .filter((t) => t.isClosed && !t.isPending)
    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());

  let curType: "win" | "loss" | null = null;
  let curLen = 0;
  let curStart = "";
  let curEnd = "";
  let curPnl = 0;
  let longestWin: Streak | null = null;
  let longestLoss: Streak | null = null;

  const commit = () => {
    if (!curType || curLen === 0) return;
    const s: Streak = {
      type: curType,
      length: curLen,
      startDate: curStart,
      endDate: curEnd,
      totalPnl: curPnl,
    };
    if (curType === "win" && (!longestWin || s.length > longestWin.length)) longestWin = s;
    if (curType === "loss" && (!longestLoss || s.length > longestLoss.length)) longestLoss = s;
  };

  for (const t of closed) {
    const day = t.closeTime.toISOString().slice(0, 10);
    const type: "win" | "loss" | null = t.total > 0 ? "win" : t.total < 0 ? "loss" : null;
    if (type === null) continue; // breakeven doesn't break streaks

    if (type === curType) {
      curLen++;
      curPnl += t.total;
      curEnd = day;
    } else {
      commit();
      curType = type;
      curLen = 1;
      curStart = day;
      curEnd = day;
      curPnl = t.total;
    }
  }
  commit();

  return { longestWin, longestLoss };
}

export function windowStats(
  trades: Trade[],
  from: Date | null,
  to: Date | null,
): SummaryStat & { startedFrom: string; startedTo: string } {
  const slice = trades.filter((t) => {
    const ts = t.closeTime.getTime();
    if (from && ts < from.getTime()) return false;
    if (to && ts > to.getTime()) return false;
    return true;
  });
  return {
    ...summarize(slice),
    startedFrom: from ? from.toISOString().slice(0, 10) : "open",
    startedTo: to ? to.toISOString().slice(0, 10) : "open",
  };
}
