import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseAdmin } from "@/lib/supabase";
import { getAuthedUser } from "@/lib/authedUser";

export const runtime = "nodejs";

function unconfigured() {
  return NextResponse.json(
    { error: "Supabase is not configured on the server" },
    { status: 503 },
  );
}

// GET /api/accounts — list saved accounts for the authed user.
// Returns only metadata (no csv_data / chat_history) to keep the list page light.
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured()) return unconfigured();
  const owner = getAuthedUser(req);
  const { data, error } = await supabaseAdmin()
    .from("accounts")
    .select(
      "id, label, mt4_number, crm_link, trade_count, net_pnl, date_from, date_to, updated_at",
    )
    .eq("owner_id", owner)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data ?? [] });
}

// POST /api/accounts — save (create-or-update) an account.
// Dedup key: (owner_id, mt4_number). If mt4_number is empty and no id is
// supplied, a new row is created; if an id is supplied that row is updated.
interface SaveBody {
  id?: string;
  label: string;
  mt4Number?: string;
  crmLink?: string;
  csvData: string;
  chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  aiAnalysis?: string | null;
  tradeCount?: number;
  netPnl?: number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return unconfigured();
  const owner = getAuthedUser(req);

  let body: SaveBody;
  try {
    body = (await req.json()) as SaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (!body.csvData) {
    return NextResponse.json({ error: "csvData is required" }, { status: 400 });
  }

  const payload = {
    owner_id: owner,
    label: body.label.trim(),
    mt4_number: body.mt4Number?.trim() || null,
    crm_link: body.crmLink?.trim() || null,
    csv_data: body.csvData,
    chat_history: body.chatHistory ?? [],
    ai_analysis: body.aiAnalysis ?? null,
    trade_count: body.tradeCount ?? 0,
    net_pnl: body.netPnl ?? null,
    date_from: body.dateFrom ?? null,
    date_to: body.dateTo ?? null,
  };

  const db = supabaseAdmin();

  if (body.id) {
    const { data, error } = await db
      .from("accounts")
      .update(payload)
      .eq("id", body.id)
      .eq("owner_id", owner)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ account: data });
  }

  // No id supplied. If mt4_number is set, upsert on (owner_id, mt4_number).
  if (payload.mt4_number) {
    const { data, error } = await db
      .from("accounts")
      .upsert(payload, { onConflict: "owner_id,mt4_number" })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ account: data });
  }

  // Brand-new row without mt4 number.
  const { data, error } = await db.from("accounts").insert(payload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}
