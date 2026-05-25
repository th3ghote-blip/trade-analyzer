"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { parseTradesCsv } from "@/lib/parser";
import {
  applyFilters,
  byDow,
  byHold,
  byHour,
  bySymbol,
  equityCurve,
  summarize,
} from "@/lib/stats";
import { detectAll } from "@/lib/detectors";
import { fmtDate, fmtHold, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import type { AccountMeta, Anomaly, Trade } from "@/lib/types";

const META_KEY = "trade-analyzer.account-meta";
const CSV_KEY = "trade-analyzer.last-csv";

const SAMPLE_CSV = `#\tOpenTime\tOpenPrice\tCloseTime\tClosePrice\tReason\tComment\tSymbol\tSide\tVolume\tSl\tTp\tSwaps\tProfit\tTotal
77186346\t2024-09-23 21:58:38\t1.11131\t2024-09-27 01:54:48\t1.1177\tMobile\t\tEURUSD\tSell\t0.01\t0\t0\t0.00\t-6.39\t-6.39
77389053\t2024-10-14 15:26:40\t730.65\t2024-10-14 15:26:53\t722.85\tDealer\tBenefit Trade\tNETFLIX\tSell\t1.50\t730.66\t718\t0.00\t1170.00\t1170.00`;

export default function TradeAnalyzer() {
  const [meta, setMeta] = useState<AccountMeta>({ label: "", mt4Number: "", crmLink: "" });
  const [rawCsv, setRawCsv] = useState("");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [parseInfo, setParseInfo] = useState<{ skipped: number; errors: string[] } | null>(null);
  const [includeDealer, setIncludeDealer] = useState(false);
  const [includePending, setIncludePending] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState<string>("");
  const [aiState, setAiState] = useState<{
    loading: boolean;
    text: string | null;
    error: string | null;
    tokens?: { input: number; output: number };
  }>({ loading: false, text: null, error: null });

  // Load persisted meta + csv
  useEffect(() => {
    try {
      const m = localStorage.getItem(META_KEY);
      if (m) setMeta(JSON.parse(m));
      const c = localStorage.getItem(CSV_KEY);
      if (c) {
        setRawCsv(c);
        const res = parseTradesCsv(c);
        setTrades(res.trades);
        setParseInfo({ skipped: res.skipped, errors: res.errors });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {}
  }, [meta]);

  function loadCsv(text: string) {
    setRawCsv(text);
    try {
      localStorage.setItem(CSV_KEY, text);
    } catch {}
    const res = parseTradesCsv(text);
    setTrades(res.trades);
    setParseInfo({ skipped: res.skipped, errors: res.errors });
    setAiState({ loading: false, text: null, error: null });
  }

  function clearAll() {
    setRawCsv("");
    setTrades([]);
    setParseInfo(null);
    setAiState({ loading: false, text: null, error: null });
    try {
      localStorage.removeItem(CSV_KEY);
    } catch {}
  }

  const filtered = useMemo(
    () =>
      applyFilters(trades, {
        includeDealer,
        includePending,
        symbols: symbolFilter ? [symbolFilter] : undefined,
      }),
    [trades, includeDealer, includePending, symbolFilter],
  );

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const symbolStats = useMemo(() => bySymbol(filtered), [filtered]);
  const hourBuckets = useMemo(() => byHour(filtered), [filtered]);
  const dowBuckets = useMemo(() => byDow(filtered), [filtered]);
  const holdBuckets = useMemo(() => byHold(filtered), [filtered]);
  const equity = useMemo(() => equityCurve(filtered), [filtered]);
  const anomalies = useMemo(() => detectAll(filtered), [filtered]);

  const allSymbols = useMemo(() => {
    const s = new Set(trades.map((t) => t.symbol));
    return Array.from(s).sort();
  }, [trades]);

  async function runAi() {
    setAiState({ loading: true, text: null, error: null });
    try {
      const payload = {
        accountLabel: meta.label,
        mt4Number: meta.mt4Number,
        summary: {
          ...summary,
          dateFrom: summary.dateFrom?.toISOString() ?? null,
          dateTo: summary.dateTo?.toISOString() ?? null,
        },
        topSymbols: symbolStats.slice(0, 10).map((s) => ({
          symbol: s.symbol,
          trades: s.trades,
          pnl: s.totalPnl,
          winRate: s.winRate,
        })),
        anomalies: anomalies.map((a) => ({
          ticket: a.ticket,
          category: a.category,
          severity: a.severity,
          summary: a.summary,
          symbol: a.trade.symbol,
          side: a.trade.side,
          volume: a.trade.volume,
          openTime: a.trade.openTime.toISOString(),
          closeTime: a.trade.closeTime.toISOString(),
          holdMinutes: a.trade.holdMinutes,
          profit: a.trade.profit,
          total: a.trade.total,
          comment: a.trade.comment,
          reason: a.trade.reason,
        })),
      };

      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAiState({ loading: false, text: null, error: data.error ?? "Unknown error" });
        return;
      }
      setAiState({
        loading: false,
        text: data.analysis,
        error: null,
        tokens: { input: data.inputTokens, output: data.outputTokens },
      });
    } catch (err) {
      setAiState({
        loading: false,
        text: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-8 max-w-[1400px] mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Trade Analyzer</h1>
        <p className="text-sm text-neutral-400">
          Paste an MT4 trade ledger. Detects platform-exploit candidates and trading-style patterns.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Field
          label="Account label"
          value={meta.label}
          onChange={(v) => setMeta({ ...meta, label: v })}
          placeholder="e.g. Account A"
        />
        <Field
          label="MT4 number / user"
          value={meta.mt4Number}
          onChange={(v) => setMeta({ ...meta, mt4Number: v })}
          placeholder="e.g. 77123456"
        />
        <Field
          label="CRM link"
          value={meta.crmLink}
          onChange={(v) => setMeta({ ...meta, crmLink: v })}
          placeholder="https://..."
        />
      </section>

      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Trade ledger</h2>
          <div className="flex gap-2 text-xs">
            <button
              className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
              onClick={() => loadCsv(SAMPLE_CSV)}
            >
              Load sample
            </button>
            <label className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 cursor-pointer">
              Upload CSV
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const text = await f.text();
                  loadCsv(text);
                }}
              />
            </label>
            <button
              className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
              onClick={clearAll}
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          value={rawCsv}
          onChange={(e) => loadCsv(e.target.value)}
          placeholder="Paste tab- or comma-separated trade rows here (with or without header)"
          className="w-full h-32 bg-neutral-900 border border-neutral-800 rounded p-3 text-xs font-mono"
        />
        {parseInfo ? (
          <p className="text-xs text-neutral-500 mt-1">
            Parsed {trades.length} trades · skipped {parseInfo.skipped} non-trade rows
            {parseInfo.errors.length ? ` · ${parseInfo.errors.length} errors` : ""}
          </p>
        ) : null}
      </section>

      {trades.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="flex flex-wrap items-center gap-4 mb-6 p-3 rounded border border-neutral-800 bg-neutral-900/50">
            <Toggle
              label="Include dealer trades"
              checked={includeDealer}
              onChange={setIncludeDealer}
            />
            <Toggle
              label="Include pending / cancelled"
              checked={includePending}
              onChange={setIncludePending}
            />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-neutral-400">Symbol:</span>
              <select
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
              >
                <option value="">All ({allSymbols.length})</option>
                {allSymbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="ml-auto text-xs text-neutral-500">
              Showing {filtered.length.toLocaleString()} of {trades.length.toLocaleString()} trades
            </div>
          </section>

          <SummaryCards summary={summary} />

          <Section title="Equity curve">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equity.points}>
                  <CartesianGrid stroke="#222" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(t) => new Date(t).toISOString().slice(0, 10)}
                    stroke="#888"
                    fontSize={11}
                  />
                  <YAxis
                    stroke="#888"
                    fontSize={11}
                    tickFormatter={(v) => fmtMoney(v)}
                  />
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid #333" }}
                    labelFormatter={(t) => new Date(Number(t)).toISOString().slice(0, 16)}
                    formatter={(v) => fmtMoney(Number(v))}
                  />
                  <Line type="monotone" dataKey="equity" stroke="#60a5fa" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="drawdown" stroke="#ef4444" dot={false} strokeWidth={1} />
                  <Legend wrapperStyle={{ color: "#aaa", fontSize: 12 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-neutral-500 mt-2">
              Max drawdown: {fmtMoney(equity.dd.maxDrawdown)} ({fmtPct(equity.dd.maxDrawdownPct)}) from
              peak {fmtMoney(equity.dd.peak)}
            </p>
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Section title="P&L by hour (UTC of open)">
              <BarBlock data={hourBuckets} xKey="hour" />
            </Section>
            <Section title="P&L by day of week">
              <BarBlock data={dowBuckets} xKey="label" />
            </Section>
            <Section title="P&L by hold time">
              <BarBlock data={holdBuckets} xKey="bucket" />
            </Section>
            <Section title="P&L by symbol (top 15)">
              <SymbolTable rows={symbolStats.slice(0, 15)} />
            </Section>
          </div>

          <Section title={`Flagged anomalies (${anomalies.length})`}>
            <AnomalyList anomalies={anomalies} />
          </Section>

          <Section
            title="AI analysis"
            right={
              <button
                onClick={runAi}
                disabled={aiState.loading || anomalies.length === 0}
                className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-sm"
              >
                {aiState.loading ? "Analyzing…" : "Run AI analysis"}
              </button>
            }
          >
            {aiState.error ? (
              <p className="text-sm text-red-400">Error: {aiState.error}</p>
            ) : aiState.text ? (
              <>
                <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans">
                  {aiState.text}
                </pre>
                {aiState.tokens ? (
                  <p className="text-xs text-neutral-500 mt-3">
                    Tokens: {aiState.tokens.input} in / {aiState.tokens.output} out
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-neutral-500">
                Click &ldquo;Run AI analysis&rdquo; to send the flagged anomalies and account summary to
                Claude. Trade rows themselves are not sent &mdash; only the detector findings and
                aggregate stats.
              </p>
            )}
          </Section>
        </>
      )}

      <footer className="text-xs text-neutral-600 mt-12 pb-4 text-center">
        Trade Analyzer · all parsing happens in your browser · AI analysis sends only flagged
        anomalies + aggregate stats.
      </footer>
    </main>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-neutral-400 mb-1">
        {props.label}
      </span>
      <input
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm"
      />
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mb-6 border border-neutral-800 rounded bg-neutral-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function SummaryCards({ summary: s }: { summary: ReturnType<typeof summarize> }) {
  const cards: Array<[string, string, string?]> = [
    ["Net P&L", fmtMoney(s.netPnl), s.netPnl >= 0 ? "text-emerald-400" : "text-red-400"],
    ["Win rate", fmtPct(s.winRate), s.winRate >= 0.5 ? "text-emerald-400" : "text-amber-400"],
    ["Profit factor", Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "n/a"],
    ["Expectancy", fmtMoney(s.expectancy), s.expectancy >= 0 ? "text-emerald-400" : "text-red-400"],
    ["Closed trades", fmtNum(s.closedTrades)],
    ["Largest loss", fmtMoney(s.largestLoss), "text-red-400"],
    ["Largest win", fmtMoney(s.largestWin), "text-emerald-400"],
    ["Total volume", fmtNum(s.totalVolume, 2)],
    ["Dealer trades", fmtNum(s.dealerCount)],
    ["Range", `${fmtDate(s.dateFrom)} → ${fmtDate(s.dateTo)}`],
  ];
  return (
    <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
      {cards.map(([label, value, cls]) => (
        <div key={label} className="border border-neutral-800 rounded p-3 bg-neutral-900/40">
          <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
          <div className={`text-lg font-semibold mt-1 ${cls ?? ""}`}>{value}</div>
        </div>
      ))}
    </section>
  );
}

function BarBlock<T extends { trades: number; pnl: number }>({
  data,
  xKey,
}: {
  data: T[];
  xKey: keyof T;
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="#222" />
          <XAxis dataKey={xKey as string} stroke="#888" fontSize={11} />
          <YAxis stroke="#888" fontSize={11} tickFormatter={(v) => fmtMoney(v)} />
          <Tooltip
            contentStyle={{ background: "#111", border: "1px solid #333" }}
            formatter={(v, name) =>
              name === "pnl" ? fmtMoney(Number(v)) : fmtNum(Number(v))
            }
          />
          <Bar dataKey="pnl">
            {data.map((d, i) => (
              <Cell key={i} fill={d.pnl >= 0 ? "#10b981" : "#ef4444"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SymbolTable({ rows }: { rows: ReturnType<typeof bySymbol> }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 text-xs uppercase">
            <th className="py-1 pr-2">Symbol</th>
            <th className="py-1 pr-2 text-right">Trades</th>
            <th className="py-1 pr-2 text-right">Win %</th>
            <th className="py-1 pr-2 text-right">P&L</th>
            <th className="py-1 pr-2 text-right">Expectancy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-t border-neutral-800">
              <td className="py-1 pr-2 font-mono">{r.symbol}</td>
              <td className="py-1 pr-2 text-right">{r.trades}</td>
              <td className="py-1 pr-2 text-right">{fmtPct(r.winRate)}</td>
              <td
                className={`py-1 pr-2 text-right ${r.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {fmtMoney(r.totalPnl)}
              </td>
              <td className="py-1 pr-2 text-right">{fmtMoney(r.expectancy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  if (anomalies.length === 0) {
    return <p className="text-sm text-neutral-500">No anomalies flagged for the current filter set.</p>;
  }

  const grouped = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    const arr = grouped.get(a.category) ?? [];
    arr.push(a);
    grouped.set(a.category, arr);
  }

  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([cat, items]) => (
        <details key={cat} open className="border border-neutral-800 rounded">
          <summary className="cursor-pointer px-3 py-2 bg-neutral-900 text-sm">
            <span className="font-semibold capitalize">{cat.replace(/_/g, " ")}</span>
            <span className="ml-2 text-neutral-500">{items.length}</span>
          </summary>
          <ul className="divide-y divide-neutral-800">
            {items.slice(0, 50).map((a) => (
              <li key={`${a.category}-${a.ticket}`} className="px-3 py-2 text-sm flex gap-3">
                <SeverityDot s={a.severity} />
                <div className="flex-1">
                  <div>
                    <span className="font-mono text-xs text-neutral-500">#{a.ticket}</span>{" "}
                    {a.summary}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {fmtDate(a.trade.openTime)} → {fmtDate(a.trade.closeTime)} · hold{" "}
                    {fmtHold(a.trade.holdMinutes)} · {a.trade.symbol} {a.trade.side} {a.trade.volume}
                  </div>
                </div>
              </li>
            ))}
            {items.length > 50 ? (
              <li className="px-3 py-2 text-xs text-neutral-500">+{items.length - 50} more…</li>
            ) : null}
          </ul>
        </details>
      ))}
    </div>
  );
}

function SeverityDot({ s }: { s: Anomaly["severity"] }) {
  const cls =
    s === "high" ? "bg-red-500" : s === "warn" ? "bg-amber-400" : "bg-neutral-500";
  return <span className={`mt-1.5 inline-block w-2 h-2 rounded-full ${cls}`} aria-label={s} />;
}

function EmptyState() {
  return (
    <div className="border border-dashed border-neutral-800 rounded p-8 text-center text-neutral-500 text-sm">
      No trades loaded yet. Paste a ledger above or click <strong>Load sample</strong>.
    </div>
  );
}
