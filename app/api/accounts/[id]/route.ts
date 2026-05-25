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

// GET /api/accounts/[id] — fetch full row including csv_data and chat_history
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return unconfigured();
  const owner = getAuthedUser(req);
  const { data, error } = await supabaseAdmin()
    .from("accounts")
    .select("*")
    .eq("id", params.id)
    .eq("owner_id", owner)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ account: data });
}

// DELETE /api/accounts/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return unconfigured();
  const owner = getAuthedUser(req);
  const { error } = await supabaseAdmin()
    .from("accounts")
    .delete()
    .eq("id", params.id)
    .eq("owner_id", owner);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
