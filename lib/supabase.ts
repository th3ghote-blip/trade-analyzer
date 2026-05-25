import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server",
    );
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export interface AccountRow {
  id: string;
  owner_id: string;
  mt4_number: string | null;
  label: string;
  crm_link: string | null;
  csv_data: string;
  chat_history: Array<{ role: "user" | "assistant"; content: string }>;
  trade_count: number;
  net_pnl: number | null;
  date_from: string | null;
  date_to: string | null;
  created_at: string;
  updated_at: string;
}
