export function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const s = abs >= 1000 ? abs.toLocaleString("en-US", { maximumFractionDigits: 0 }) : abs.toFixed(2);
  return `${sign}$${s}`;
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "n/a";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d || !Number.isFinite(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

export function fmtHold(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "—";
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${min.toFixed(1)}m`;
  if (min < 60 * 24) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 60 / 24).toFixed(1)}d`;
}
