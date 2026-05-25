import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

interface AnomalyPayload {
  ticket: string;
  category: string;
  severity: string;
  summary: string;
  symbol: string;
  side: string;
  volume: number;
  openTime: string;
  closeTime: string;
  holdMinutes: number;
  profit: number;
  total: number;
  comment: string;
  reason: string;
}

interface AnalyzeBody {
  accountLabel?: string;
  mt4Number?: string;
  summary: {
    totalTrades: number;
    closedTrades: number;
    netPnl: number;
    winRate: number;
    profitFactor: number;
    largestLoss: number;
    largestWin: number;
    avgWin: number;
    avgLoss: number;
    expectancy: number;
    dateFrom: string | null;
    dateTo: string | null;
    uniqueSymbols: number;
    dealerCount: number;
  };
  topSymbols: Array<{ symbol: string; trades: number; pnl: number; winRate: number }>;
  anomalies: AnomalyPayload[];
}

const MAX_ANOMALIES_TO_AI = 60;

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on server" },
      { status: 500 },
    );
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: key });

  // Cap input. Take the most severe anomalies first.
  const ranked = [...body.anomalies].sort((a, b) => severity(b.severity) - severity(a.severity));
  const flagged = ranked.slice(0, MAX_ANOMALIES_TO_AI);

  const accountId = body.mt4Number || body.accountLabel || "(unspecified)";

  const prompt = buildPrompt(body, flagged, accountId);

  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return NextResponse.json({
      analysis: text,
      anomaliesAnalyzed: flagged.length,
      totalAnomalies: body.anomalies.length,
      model: resp.model,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function severity(s: string): number {
  return s === "high" ? 3 : s === "warn" ? 2 : 1;
}

function buildPrompt(body: AnalyzeBody, anomalies: AnomalyPayload[], accountId: string): string {
  const s = body.summary;
  const topSyms = body.topSymbols
    .slice(0, 10)
    .map(
      (x) =>
        `  - ${x.symbol}: ${x.trades} trades, P&L $${x.pnl.toFixed(2)}, win rate ${(x.winRate * 100).toFixed(1)}%`,
    )
    .join("\n");

  const anomalyLines = anomalies
    .map(
      (a) =>
        `  [${a.severity.toUpperCase()}] #${a.ticket} ${a.category}: ${a.summary}` +
        (a.comment ? ` (comment: "${a.comment}", reason: ${a.reason})` : ""),
    )
    .join("\n");

  return `You are reviewing an MT4-style trade ledger for account ${accountId}. The analyst wants to find:
1. Possible platform-exploit patterns the trader may be running (dealer-routed gift fills, rapid-profit scalps, off-market fills, hedge games).
2. Behavioural patterns / trading-style "leaks" (martingale escalation, holding losers, revenge sizing, no SL discipline).

ACCOUNT SUMMARY
- Trades: ${s.totalTrades} total, ${s.closedTrades} closed
- Date range: ${s.dateFrom ?? "?"} → ${s.dateTo ?? "?"}
- Net P&L: $${s.netPnl.toFixed(2)}
- Win rate: ${(s.winRate * 100).toFixed(1)}% (avg win $${s.avgWin.toFixed(2)}, avg loss $${s.avgLoss.toFixed(2)})
- Profit factor: ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "n/a"}
- Expectancy per trade: $${s.expectancy.toFixed(2)}
- Largest win $${s.largestWin.toFixed(2)} / largest loss $${s.largestLoss.toFixed(2)}
- Unique symbols: ${s.uniqueSymbols}
- Dealer-routed trades: ${s.dealerCount}

TOP SYMBOLS BY P&L
${topSyms}

FLAGGED ANOMALIES (${anomalies.length} of ${body.anomalies.length} shown, ranked by severity)
${anomalyLines || "  (none flagged)"}

Write a concise report with these sections, using plain headings (no markdown bold/italics):

1. Headline assessment — one paragraph: is this an exploit-seeking account, an undisciplined retail account, or something else? Cite evidence.
2. Possible platform exploits — list specific tickets and what they suggest. If nothing exploit-like, say so plainly.
3. Trading style / behavioural patterns — what's the trader actually doing? Martingale? Trend-following? Revenge? Cite tickets.
4. Risk profile — how the account blew up or could blow up. Reference largest losses / stop-outs.
5. Recommended follow-ups — 3-5 bullets for the analyst, in priority order.

Be direct, no flattery, no padding. Refer to trades by ticket number. Do not invent tickets that are not in the list above.`;
}
