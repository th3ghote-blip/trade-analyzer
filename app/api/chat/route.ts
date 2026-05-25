import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ChatBody {
  question: string;
  history: ChatTurn[];
  contextBlock: string;
  accountLabel?: string;
  mt4Number?: string;
}

const MAX_HISTORY_TURNS = 10;
const MAX_CONTEXT_CHARS = 120_000; // ~30k tokens safety bound

export async function POST(req: NextRequest) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on server" },
      { status: 500 },
    );
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.question || !body.question.trim()) {
    return NextResponse.json({ error: "Empty question" }, { status: 400 });
  }

  const contextBlock = (body.contextBlock ?? "").slice(0, MAX_CONTEXT_CHARS);
  const history = (body.history ?? []).slice(-MAX_HISTORY_TURNS);

  const accountId = body.mt4Number || body.accountLabel || "(unspecified)";

  const system = `You are an analyst's assistant reviewing the MT4 trade ledger of account ${accountId}. Use only the facts in the precomputed context below. If the answer is not present, say so plainly — do not guess. Refer to trades by ticket number, dates by ISO date (YYYY-MM-DD). Be terse: short paragraphs, no padding, no flattery. When a question references a time window ("since the last drawdown", "the last 30 days", "after Oct 16"), look up the right window in the context and quote the underlying numbers.

PRECOMPUTED CONTEXT:
${contextBlock}`;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: body.question },
  ];

  const client = new Anthropic({ apiKey: key });

  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return NextResponse.json({
      answer: text,
      model: resp.model,
      usage: {
        input: resp.usage.input_tokens,
        output: resp.usage.output_tokens,
        cacheRead: resp.usage.cache_read_input_tokens ?? 0,
        cacheCreated: resp.usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
