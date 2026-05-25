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

export function applyFilters(
  trades: Trade[],
  opts: { includeDealer: boolean; includePending: boolean; symbols?: string[] },
): Trade[] {
  return trades.filter((t) => {
    if (!opts.includeDealer && /dealer/i.test(t.reason)) return false;
    if (!opts.includePending && t.isPending) return false;
    if (opts.symbols && opts.symbols.length && !opts.symbols.includes(t.symbol)) return false;
    return true;
  });
}
