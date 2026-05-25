-- Trade Analyzer — accounts schema
-- Run this in the Supabase SQL editor of your new project.

create extension if not exists "pgcrypto";

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  mt4_number text,
  label text not null,
  crm_link text,
  csv_data text not null,
  chat_history jsonb not null default '[]'::jsonb,
  trade_count integer not null default 0,
  net_pnl numeric,
  date_from timestamptz,
  date_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists accounts_owner_mt4_idx
  on public.accounts(owner_id, mt4_number)
  where mt4_number is not null and mt4_number <> '';

create index if not exists accounts_owner_updated_idx
  on public.accounts(owner_id, updated_at desc);

-- Auto-touch updated_at on row updates.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_touch_updated_at on public.accounts;
create trigger accounts_touch_updated_at
before update on public.accounts
for each row execute function public.touch_updated_at();

-- Row-Level Security: deny everything to anon/auth, allow service role only.
-- The Next.js API routes use the service role and gate every request through
-- HTTP basic auth (middleware.ts), then scope queries by owner_id manually.
alter table public.accounts enable row level security;

drop policy if exists "deny all to anon" on public.accounts;
create policy "deny all to anon" on public.accounts
  for all to anon, authenticated
  using (false)
  with check (false);
