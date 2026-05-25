import Papa from "papaparse";
import type { Trade, TradeSide } from "./types";

const HEADERS = [
  "#",
  "OpenTime",
  "OpenPrice",
  "CloseTime",
  "ClosePrice",
  "Reason",
  "Comment",
  "Symbol",
  "Side",
  "Volume",
  "Sl",
  "Tp",
  "Swaps",
  "Profit",
  "Total",
];

function parseNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const s = String(raw).replace(/,/g, "").trim();
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw: unknown): Date {
  const s = String(raw ?? "").trim();
  if (!s) return new Date(NaN);
  const iso = s.replace(" ", "T");
  const d = new Date(iso);
  return d;
}

function normalizeSide(raw: unknown): TradeSide {
  const s = String(raw ?? "").trim();
  if (
    s === "Buy" ||
    s === "Sell" ||
    s === "BuyStop" ||
    s === "SellStop" ||
    s === "BuyLimit" ||
    s === "SellLimit"
  ) {
    return s;
  }
  return s.startsWith("Sell") ? "Sell" : "Buy";
}

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  const winner = Math.max(tabs, commas, semis);
  if (winner === 0) return "\t";
  if (winner === tabs) return "\t";
  if (winner === semis) return ";";
  return ",";
}

export interface ParseResult {
  trades: Trade[];
  skipped: number;
  errors: string[];
}

export function parseTradesCsv(raw: string): ParseResult {
  const text = raw.trim();
  if (!text) return { trades: [], skipped: 0, errors: ["Empty input"] };

  const delimiter = detectDelimiter(text);

  // Some exports have no header — detect by checking if first non-empty token is "#".
  const looksHeadered = /^\s*#\s*[\t,;]/.test(text) || text.startsWith("#\t");

  const parsed = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: "greedy",
    header: false,
    transform: (v) => v,
  });

  const rows = parsed.data as string[][];
  if (!rows.length) return { trades: [], skipped: 0, errors: ["No rows parsed"] };

  const startIdx = looksHeadered ? 1 : 0;
  const trades: Trade[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < HEADERS.length - 2) {
      skipped++;
      continue;
    }

    const ticket = String(row[0] ?? "").trim();
    if (!ticket || !/^\d+$/.test(ticket)) {
      // Footer/summary lines like "3,051   2,584.21  -60,713.44  ..."
      skipped++;
      continue;
    }

    const openTime = parseDate(row[1]);
    const closeTime = parseDate(row[3]);
    const side = normalizeSide(row[8]);
    const comment = String(row[6] ?? "").trim();
    const reason = String(row[5] ?? "").trim();

    const isPending =
      side === "BuyStop" || side === "SellStop" || side === "BuyLimit" || side === "SellLimit";
    const closedSentinel = /^cancelled|deleted/i.test(comment);

    const profit = parseNumber(row[13]);
    const total = parseNumber(row[14]);

    const trade: Trade = {
      ticket,
      openTime,
      openPrice: parseNumber(row[2]),
      closeTime,
      closePrice: parseNumber(row[4]),
      reason,
      comment,
      symbol: String(row[7] ?? "").trim(),
      side,
      volume: parseNumber(row[9]),
      sl: parseNumber(row[10]),
      tp: parseNumber(row[11]),
      swaps: parseNumber(row[12]),
      profit,
      total,
      holdMinutes:
        Number.isFinite(openTime.getTime()) && Number.isFinite(closeTime.getTime())
          ? Math.max(0, (closeTime.getTime() - openTime.getTime()) / 60000)
          : 0,
      isClosed: !closedSentinel && Number.isFinite(closeTime.getTime()),
      isPending,
      isHedgeClose: /close hedge by/i.test(comment),
      isStopOut: /^so:/i.test(comment),
      isMarginCallTagged: /\bso:\s*\d+/i.test(comment),
    };

    if (!Number.isFinite(trade.openTime.getTime())) {
      errors.push(`Row ${i + 1}: invalid openTime`);
      skipped++;
      continue;
    }

    trades.push(trade);
  }

  return { trades, skipped, errors };
}
