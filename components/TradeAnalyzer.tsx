"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  AdvancedFilters,
  applyFilters,
  byDow,
  byHold,
  byHour,
  bySymbol,
  equityCurve,
  OutcomeFilter,
  SideFilter,
  summarize,
} from "@/lib/stats";
import { detectAll } from "@/lib/detectors";
import { fmtDate, fmtHold, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { buildChatContext } from "@/lib/contextBundle";
import type { AccountMeta, Anomaly, Trade } from "@/lib/types";
import AccountPicker from "./AccountPicker";

const META_KEY = "trade-analyzer.account-meta";
const CSV_KEY = "trade-analyzer.last-csv";

const SAMPLE_CSV = `#\tOpenTime\tOpenPrice\tCloseTime\tClosePrice\tReason\tComment\tSymbol\tSide\tVolume\tSl\tTp\tSwaps\tProfit\tTotal
77186346\t2024-09-23 21:58:38\t1.11131\t2024-09-27 01:54:48\t1.1177\tMobile\t\tEURUSD\tSell\t0.01\t0\t0\t0.00\t-6.39\t-6.39
77389053\t2024-10-14 15:26:40\t730.65\t2024-10-14 15:26:53\t722.85\tDealer\tBenefit Trade\tNETFLIX\tSell\t1.50\t730.66\t718\t0.00\t1170.00\t1170.00`;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

type SortKey = "openTime" | "closeTime" | "symbol" | "volume" | "holdMinutes" | "total";

interface AdvFilterState {
  dateFrom: string;
  dateTo: string;
  minPnl: string;
  maxPnl: string;
  minHold: string;
  maxHold: string;
  minVolume: string;
  maxVolume: string;
  outcome: OutcomeFilter;
  side: SideFilter;
}

const EMPTY_ADV: AdvFilterState = {
  dateFrom: "",
  dateTo: "",
  minPnl: "",
  maxPnl: "",
  minHold: "",
  maxHold: "",
  minVolume: "",
  maxVolume: "",
  outcome: "all",
  side: "all",
};

const SAMPLE_QUESTIONS = [
  "Since the last drawdown, what's the win rate and is it abnormal?",
  "Which symbols carry most of the net P&L?",
  "Are there clusters of dealer-routed trades that look suspicious?",
  "What changed after the biggest loss?",
  "Is there evidence of martingale recovery attempts?",
];

export default function TradeAnalyzer() {
  const [meta, setMeta] = useState<AccountMeta>({ label: "", mt4Number: "", crmLink: "" });
  const [rawCsv, setRawCsv] = useState("");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [parseInfo, setParseInfo] = useState<{ skipped: number; errors: string[] } | null>(null);

  const [includeDealer, setIncludeDealer] = useState(false);
  const [includePending, setIncludePending] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState<string>("");
  const [adv, setAdv] = useState<AdvFilterState>(EMPTY_ADV);
  const [advOpen, setAdvOpen] = useState(false);

  const [aiState, setAiState] = useState<{
    loading: boolean;
    text: string | null;
    error: string | null;
    tokens?: { input: number; output: number };
  }>({ loading: false, text: null, error: null });

  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatUsage, setChatUsage] = useState<{
    input: number;
    output: number;
    cacheRead: number;
    cacheCreated: number;
  } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Saved-account state ---
  const [currentAccountId, setCurrentAccountId] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [accountsRefreshKey, setAccountsRefreshKey] = useState(0);

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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, chatLoading]);

  function loadCsv(text: string) {
    setRawCsv(text);
    try {
      localStorage.setItem(CSV_KEY, text);
    } catch {}
    const res = parseTradesCsv(text);
    setTrades(res.trades);
    setParseInfo({ skipped: res.skipped, errors: res.errors });
    setAiState({ loading: false, text: null, error: null });
    setChatHistory([]);
    setChatError(null);
    setChatUsage(null);
  }

  function clearAll() {
    setRawCsv("");
    setTrades([]);
    setParseInfo(null);
    setAiState({ loading: false, text: null, error: null });
    setChatHistory([]);
    setChatError(null);
    setChatUsage(null);
    try {
      localStorage.removeItem(CSV_KEY);
    } catch {}
  }

  const builtFilters = useMemo<AdvancedFilters>(() => {
    const num = (s: string) => (s === "" ? null : Number(s));
    const dt = (s: string) => (s ? new Date(s + "T00:00:00Z") : null);
    const dtEnd = (s: string) => (s ? new Date(s + "T23:59:59Z") : null);
    return {
      includeDealer,
      includePending,
      symbols: symbolFilter ? [symbolFilter] : undefined,
      dateFrom: dt(adv.dateFrom),
      dateTo: dtEnd(adv.dateTo),
      minPnl: num(adv.minPnl),
      maxPnl: num(adv.maxPnl),
      minHoldMinutes: num(adv.minHold),
      maxHoldMinutes: num(adv.maxHold),
      minVolume: num(adv.minVolume),
      maxVolume: num(adv.maxVolume),
      outcome: adv.outcome,
      side: adv.side,
    };
  }, [includeDealer, includePending, symbolFilter, adv]);

  const filtered = useMemo(() => applyFilters(trades, builtFilters), [trades, builtFilters]);

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const symbolStats = useMemo(() => bySymbol(filtered), [filtered]);
  const hourBuckets = useMemo(() => byHour(filtered), [filtered]);
  const dowBuckets = useMemo(() => byDow(filtered), [filtered]);
  const holdBuckets = useMemo(() => byHold(filtered), [filtered]);
  const equity = useMemo(() => equityCurve(filtered), [filtered]);
  const anomalies = useMemo(() => detectAll(filtered), [filtered]);

  const chatContext = useMemo(
    () => buildChatContext(filtered, anomalies),
    [filtered, anomalies],
  );

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

  // ---------- Saved-account handlers ----------

  function snapshot(meta: AccountMeta, csv: string, history: ChatTurn[], aiText: string | null): string {
    return JSON.stringify({ meta, csv, history, aiText });
  }

  const currentSnapshot = snapshot(meta, rawCsv, chatHistory, aiState.text);
  const isDirty =
    currentAccountId !== null && savedSnapshot !== "" && currentSnapshot !== savedSnapshot;
  const canSave =
    rawCsv.trim().length > 0 &&
    trades.length > 0 &&
    (meta.label.trim().length > 0 || meta.mt4Number.trim().length > 0);

  async function loadAccount(id: string) {
    setSaveError(null);
    try {
      const resp = await fetch(`/api/accounts/${id}`);
      const data = await resp.json();
      if (!resp.ok) {
        setSaveError(data.error ?? `HTTP ${resp.status}`);
        return;
      }
      const a = data.account;
      const nextMeta: AccountMeta = {
        label: a.label ?? "",
        mt4Number: a.mt4_number ?? "",
        crmLink: a.crm_link ?? "",
      };
      const nextHistory = Array.isArray(a.chat_history) ? a.chat_history : [];
      setMeta(nextMeta);
      setRawCsv(a.csv_data ?? "");
      const res = parseTradesCsv(a.csv_data ?? "");
      setTrades(res.trades);
      setParseInfo({ skipped: res.skipped, errors: res.errors });
      setChatHistory(nextHistory);
      setChatError(null);
      setChatUsage(null);
      const nextAiText = a.ai_analysis ?? null;
      setAiState({ loading: false, text: nextAiText, error: null });
      setCurrentAccountId(a.id);
      setSavedSnapshot(snapshot(nextMeta, a.csv_data ?? "", nextHistory, nextAiText));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveAccount() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        id: currentAccountId ?? undefined,
        label: meta.label.trim() || meta.mt4Number.trim() || "Untitled",
        mt4Number: meta.mt4Number,
        crmLink: meta.crmLink,
        csvData: rawCsv,
        chatHistory,
        aiAnalysis: aiState.text,
        tradeCount: trades.length,
        netPnl: summary.netPnl,
        dateFrom: summary.dateFrom?.toISOString() ?? null,
        dateTo: summary.dateTo?.toISOString() ?? null,
      };
      const resp = await fetch("/api/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setSaveError(data.error ?? `HTTP ${resp.status}`);
        return;
      }
      setCurrentAccountId(data.account.id);
      setSavedSnapshot(currentSnapshot);
      setAccountsRefreshKey((k) => k + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(id: string) {
    setSaveError(null);
    try {
      const resp = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setSaveError(data.error ?? `HTTP ${resp.status}`);
        return;
      }
      if (currentAccountId === id) {
        setCurrentAccountId(null);
        setSavedSnapshot("");
      }
      setAccountsRefreshKey((k) => k + 1);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  function newAccount() {
    setMeta({ label: "", mt4Number: "", crmLink: "" });
    setRawCsv("");
    setTrades([]);
    setParseInfo(null);
    setChatHistory([]);
    setChatError(null);
    setChatUsage(null);
    setAiState({ loading: false, text: null, error: null });
    setCurrentAccountId(null);
    setSavedSnapshot("");
    setSaveError(null);
    try {
      localStorage.removeItem(CSV_KEY);
    } catch {}
  }

  async function askQuestion(q: string) {
    const question = q.trim();
    if (!question || chatLoading) return;
    const nextHistory: ChatTurn[] = [...chatHistory, { role: "user", content: question }];
    setChatHistory(nextHistory);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);
    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          history: chatHistory,
          contextBlock: chatContext,
          accountLabel: meta.label,
          mt4Number: meta.mt4Number,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setChatError(data.error ?? "Unknown error");
        return;
      }
      setChatHistory([...nextHistory, { role: "assistant", content: data.answer }]);
      setChatUsage(data.usage);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      setChatLoading(false);
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

      <AccountPicker
        currentId={currentAccountId}
        currentDirty={isDirty}
        canSave={canSave}
        saving={saving}
        saveError={saveError}
        onLoad={loadAccount}
        onSave={saveAccount}
        onDelete={deleteAccount}
        onNew={newAccount}
        refreshKey={accountsRefreshKey}
      />

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
          <section className="mb-6 p-3 rounded border border-neutral-800 bg-neutral-900/50">
            <div className="flex flex-wrap items-center gap-4">
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
              <button
                onClick={() => setAdvOpen((v) => !v)}
                className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
              >
                {advOpen ? "Hide" : "Show"} advanced filters
              </button>
              <button
                onClick={() => setAdv(EMPTY_ADV)}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                Reset advanced
              </button>
              <div className="ml-auto text-xs text-neutral-500">
                Showing {filtered.length.toLocaleString()} of {trades.length.toLocaleString()} trades
              </div>
            </div>
            {advOpen ? (
              <div className="mt-3 pt-3 border-t border-neutral-800 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <AdvField
                  label="Date from"
                  type="date"
                  value={adv.dateFrom}
                  onChange={(v) => setAdv({ ...adv, dateFrom: v })}
                />
                <AdvField
                  label="Date to"
                  type="date"
                  value={adv.dateTo}
                  onChange={(v) => setAdv({ ...adv, dateTo: v })}
                />
                <AdvField
                  label="Min P&L ($)"
                  type="number"
                  value={adv.minPnl}
                  onChange={(v) => setAdv({ ...adv, minPnl: v })}
                />
                <AdvField
                  label="Max P&L ($)"
                  type="number"
                  value={adv.maxPnl}
                  onChange={(v) => setAdv({ ...adv, maxPnl: v })}
                />
                <AdvField
                  label="Min hold (min)"
                  type="number"
                  value={adv.minHold}
                  onChange={(v) => setAdv({ ...adv, minHold: v })}
                />
                <AdvField
                  label="Max hold (min)"
                  type="number"
                  value={adv.maxHold}
                  onChange={(v) => setAdv({ ...adv, maxHold: v })}
                />
                <AdvField
                  label="Min volume (lots)"
                  type="number"
                  value={adv.minVolume}
                  onChange={(v) => setAdv({ ...adv, minVolume: v })}
                />
                <AdvField
                  label="Max volume (lots)"
                  type="number"
                  value={adv.maxVolume}
                  onChange={(v) => setAdv({ ...adv, maxVolume: v })}
                />
                <AdvSelect
                  label="Outcome"
                  value={adv.outcome}
                  onChange={(v) => setAdv({ ...adv, outcome: v as OutcomeFilter })}
                  options={[
                    ["all", "All"],
                    ["wins", "Wins only"],
                    ["losses", "Losses only"],
                    ["breakeven", "Breakeven"],
                  ]}
                />
                <AdvSelect
                  label="Side"
                  value={adv.side}
                  onChange={(v) => setAdv({ ...adv, side: v as SideFilter })}
                  options={[
                    ["all", "All"],
                    ["buy", "Buy"],
                    ["sell", "Sell"],
                  ]}
                />
              </div>
            ) : null}
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
                  <YAxis stroke="#888" fontSize={11} tickFormatter={(v) => fmtMoney(v)} />
                  <Tooltip
                    contentStyle={{ background: "#111", border: "1px solid #333", color: "#e5e5e5" }}
                    labelStyle={{ color: "#a3a3a3" }}
                    itemStyle={{ color: "#e5e5e5" }}
                    labelFormatter={(t) => new Date(Number(t)).toISOString().slice(0, 16)}
                    formatter={(v) => fmtMoney(Number(v))}
                  />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="#60a5fa"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="drawdown"
                    stroke="#ef4444"
                    dot={false}
                    strokeWidth={1}
                  />
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

          <TradesTable trades={filtered} />

          <Section
            title="AI report"
            right={
              <button
                onClick={runAi}
                disabled={aiState.loading || anomalies.length === 0}
                className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-sm"
              >
                {aiState.loading ? "Analyzing…" : "Run AI report"}
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
                One-shot narrative report on the flagged anomalies. Click &ldquo;Run AI
                report&rdquo; — only detector findings and aggregate stats are sent, not raw trades.
              </p>
            )}
          </Section>

          <Section
            title="Ask a question"
            right={
              chatUsage ? (
                <span className="text-xs text-neutral-500">
                  last turn: {chatUsage.input} in
                  {chatUsage.cacheRead ? ` (${chatUsage.cacheRead} cached)` : ""} /{" "}
                  {chatUsage.output} out
                </span>
              ) : null
            }
          >
            <ChatPanel
              history={chatHistory}
              loading={chatLoading}
              error={chatError}
              input={chatInput}
              setInput={setChatInput}
              onSend={(q) => askQuestion(q)}
              endRef={chatEndRef}
            />
          </Section>
        </>
      )}

      <footer className="text-xs text-neutral-600 mt-12 pb-4 text-center">
        Trade Analyzer · all parsing happens in your browser · AI calls send only aggregated
        context, not raw trades.
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

function AdvField(props: {
  label: string;
  type: "date" | "number" | "text";
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
        {props.label}
      </span>
      <input
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
      />
    </label>
  );
}

function AdvSelect(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
        {props.label}
      </span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-sm"
      >
        {props.options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
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

function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
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
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            contentStyle={{ background: "#111", border: "1px solid #333", color: "#e5e5e5" }}
            labelStyle={{ color: "#a3a3a3" }}
            itemStyle={{ color: "#e5e5e5" }}
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
  const cls = s === "high" ? "bg-red-500" : s === "warn" ? "bg-amber-400" : "bg-neutral-500";
  return <span className={`mt-1.5 inline-block w-2 h-2 rounded-full ${cls}`} aria-label={s} />;
}

function TradesTable({ trades }: { trades: Trade[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "openTime",
    dir: "desc",
  });
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const sorted = useMemo(() => {
    const arr = [...trades];
    arr.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      switch (sort.key) {
        case "openTime":
          return (a.openTime.getTime() - b.openTime.getTime()) * dir;
        case "closeTime":
          return (a.closeTime.getTime() - b.closeTime.getTime()) * dir;
        case "symbol":
          return a.symbol.localeCompare(b.symbol) * dir;
        case "volume":
          return (a.volume - b.volume) * dir;
        case "holdMinutes":
          return (a.holdMinutes - b.holdMinutes) * dir;
        case "total":
          return (a.total - b.total) * dir;
      }
    });
    return arr;
  }, [trades, sort]);

  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));

  function toggleSort(key: SortKey) {
    setPage(0);
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "openTime" || key === "closeTime" ? "desc" : "desc" },
    );
  }

  function exportCsv() {
    const headers = [
      "ticket",
      "openTime",
      "closeTime",
      "symbol",
      "side",
      "volume",
      "openPrice",
      "closePrice",
      "holdMinutes",
      "profit",
      "swaps",
      "total",
      "reason",
      "comment",
    ];
    const rows = sorted.map((t) =>
      [
        t.ticket,
        t.openTime.toISOString(),
        t.closeTime.toISOString(),
        t.symbol,
        t.side,
        t.volume,
        t.openPrice,
        t.closePrice,
        t.holdMinutes.toFixed(2),
        t.profit,
        t.swaps,
        t.total,
        t.reason,
        `"${t.comment.replace(/"/g, '""')}"`,
      ].join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades-filtered-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Section
      title={`Trades (${trades.length})`}
      right={
        <button
          onClick={exportCsv}
          disabled={trades.length === 0}
          className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40"
        >
          Export CSV
        </button>
      }
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-neutral-500 uppercase">
              <SortHeader col="openTime" sort={sort} onClick={toggleSort}>
                Open
              </SortHeader>
              <SortHeader col="closeTime" sort={sort} onClick={toggleSort}>
                Close
              </SortHeader>
              <SortHeader col="symbol" sort={sort} onClick={toggleSort}>
                Symbol
              </SortHeader>
              <th className="py-1 px-2">Side</th>
              <SortHeader col="volume" sort={sort} onClick={toggleSort} align="right">
                Vol
              </SortHeader>
              <SortHeader col="holdMinutes" sort={sort} onClick={toggleSort} align="right">
                Hold
              </SortHeader>
              <SortHeader col="total" sort={sort} onClick={toggleSort} align="right">
                P&L
              </SortHeader>
              <th className="py-1 px-2">Reason</th>
              <th className="py-1 px-2">Comment</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.ticket} className="border-t border-neutral-800 hover:bg-neutral-900/40">
                <td className="py-1 px-2 font-mono whitespace-nowrap">{fmtDate(t.openTime)}</td>
                <td className="py-1 px-2 font-mono whitespace-nowrap">{fmtDate(t.closeTime)}</td>
                <td className="py-1 px-2 font-mono">{t.symbol}</td>
                <td className="py-1 px-2">{t.side}</td>
                <td className="py-1 px-2 text-right">{t.volume}</td>
                <td className="py-1 px-2 text-right">{fmtHold(t.holdMinutes)}</td>
                <td
                  className={`py-1 px-2 text-right font-mono ${t.total > 0 ? "text-emerald-400" : t.total < 0 ? "text-red-400" : "text-neutral-500"}`}
                >
                  {fmtMoney(t.total)}
                </td>
                <td className="py-1 px-2 text-neutral-400">{t.reason}</td>
                <td className="py-1 px-2 text-neutral-500 max-w-[240px] truncate" title={t.comment}>
                  {t.comment}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-4 text-center text-neutral-500">
                  No trades match the current filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-between mt-3 text-xs">
          <span className="text-neutral-500">
            Page {page + 1} of {pages} ({trades.length.toLocaleString()} trades)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded bg-neutral-800 disabled:opacity-30 hover:bg-neutral-700"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="px-2 py-1 rounded bg-neutral-800 disabled:opacity-30 hover:bg-neutral-700"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function SortHeader({
  col,
  sort,
  onClick,
  align,
  children,
}: {
  col: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onClick: (k: SortKey) => void;
  align?: "right";
  children: React.ReactNode;
}) {
  const active = sort.key === col;
  return (
    <th
      className={`py-1 px-2 cursor-pointer select-none ${align === "right" ? "text-right" : ""}`}
      onClick={() => onClick(col)}
    >
      <span className={active ? "text-neutral-200" : ""}>{children}</span>
      {active ? <span className="ml-1">{sort.dir === "asc" ? "↑" : "↓"}</span> : null}
    </th>
  );
}

function ChatPanel(props: {
  history: ChatTurn[];
  loading: boolean;
  error: string | null;
  input: string;
  setInput: (v: string) => void;
  onSend: (q: string) => void;
  endRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div>
      <div className="space-y-3 max-h-[480px] overflow-y-auto scrollbar-thin mb-3 pr-1">
        {props.history.length === 0 && !props.loading ? (
          <div>
            <p className="text-sm text-neutral-500 mb-3">
              Ask anything about the filtered trades. The model sees aggregates, drawdown events,
              streaks, monthly breakdowns, the top losses/wins, and all flagged anomalies — not the
              raw ticket-by-ticket data.
            </p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => props.onSend(q)}
                  className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {props.history.map((turn, i) => (
          <div key={i} className={turn.role === "user" ? "" : "border-l-2 border-blue-700 pl-3"}>
            <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
              {turn.role === "user" ? "You" : "Claude"}
            </div>
            <div className="whitespace-pre-wrap text-sm">{turn.content}</div>
          </div>
        ))}
        {props.loading ? (
          <div className="border-l-2 border-blue-700 pl-3 text-sm text-neutral-400">Thinking…</div>
        ) : null}
        {props.error ? (
          <div className="text-sm text-red-400">Error: {props.error}</div>
        ) : null}
        <div ref={props.endRef} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSend(props.input);
        }}
      >
        <input
          type="text"
          value={props.input}
          onChange={(e) => props.setInput(e.target.value)}
          placeholder="Ask a question about these trades…"
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm"
          disabled={props.loading}
        />
        <button
          type="submit"
          disabled={props.loading || !props.input.trim()}
          className="px-4 py-2 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-sm"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-neutral-800 rounded p-8 text-center text-neutral-500 text-sm">
      No trades loaded yet. Paste a ledger above or click <strong>Load sample</strong>.
    </div>
  );
}
