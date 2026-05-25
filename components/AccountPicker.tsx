"use client";

import { useEffect, useState } from "react";

export interface AccountListItem {
  id: string;
  label: string;
  mt4_number: string | null;
  crm_link: string | null;
  trade_count: number;
  net_pnl: number | null;
  date_from: string | null;
  date_to: string | null;
  updated_at: string;
}

interface Props {
  currentId: string | null;
  currentDirty: boolean;
  canSave: boolean;
  saving: boolean;
  saveError: string | null;
  onLoad: (id: string) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  /** Bump this from the parent to force a list refresh. */
  refreshKey: number;
}

export default function AccountPicker(props: Props) {
  const [accounts, setAccounts] = useState<AccountListItem[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setListError(null);
    fetch("/api/accounts")
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setListError(data.error ?? `HTTP ${r.status}`);
          setAccounts([]);
          return;
        }
        setAccounts(data.accounts ?? []);
      })
      .catch((err) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.refreshKey]);

  const current = accounts.find((a) => a.id === props.currentId) ?? null;

  return (
    <section className="mb-6 border border-neutral-800 rounded bg-neutral-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">
          Saved accounts
        </h2>
        <div className="flex gap-2 text-xs">
          <button
            onClick={props.onNew}
            className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
          >
            + New account
          </button>
          <button
            onClick={props.onSave}
            disabled={!props.canSave || props.saving}
            className="px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-40"
            title={
              !props.canSave
                ? "Need a label and at least one parsed trade before saving"
                : props.currentId
                  ? "Update this saved account"
                  : "Save as a new account"
            }
          >
            {props.saving
              ? "Saving…"
              : props.currentId
                ? props.currentDirty
                  ? "Save changes"
                  : "Saved"
                : "Save as new"}
          </button>
          {props.currentId ? (
            confirmDelete === props.currentId ? (
              <>
                <button
                  onClick={() => {
                    props.onDelete(props.currentId!);
                    setConfirmDelete(null);
                  }}
                  className="px-3 py-1 rounded bg-red-700 hover:bg-red-600"
                >
                  Confirm delete
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(props.currentId)}
                className="px-3 py-1 rounded bg-neutral-800 hover:bg-red-700"
              >
                Delete
              </button>
            )
          ) : null}
        </div>
      </div>

      {listError ? (
        <p className="text-xs text-amber-400 mb-2">
          Saved accounts unavailable: {listError}. Local-only mode — changes won&rsquo;t persist
          across devices.
        </p>
      ) : null}

      {props.saveError ? (
        <p className="text-xs text-red-400 mb-2">Save failed: {props.saveError}</p>
      ) : null}

      {accounts.length === 0 && !loading && !listError ? (
        <p className="text-sm text-neutral-500">
          No saved accounts yet. Paste a ledger, fill in the label / MT4 number below, then click
          <strong> Save as new</strong>.
        </p>
      ) : null}

      {accounts.length > 0 ? (
        <ul className="space-y-1">
          {accounts.map((a) => {
            const isCurrent = a.id === props.currentId;
            return (
              <li
                key={a.id}
                className={`flex items-center gap-3 px-3 py-2 rounded text-sm cursor-pointer ${
                  isCurrent
                    ? "bg-blue-900/30 border border-blue-700/40"
                    : "border border-transparent hover:bg-neutral-900/60"
                }`}
                onClick={() => !isCurrent && props.onLoad(a.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    <span className="font-semibold">{a.label}</span>
                    {a.mt4_number ? (
                      <span className="ml-2 text-neutral-500 font-mono text-xs">
                        {a.mt4_number}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-500 truncate">
                    {a.trade_count.toLocaleString()} trades
                    {a.net_pnl != null ? ` · net ${fmtCompactMoney(a.net_pnl)}` : ""}
                    {a.date_from && a.date_to
                      ? ` · ${a.date_from.slice(0, 10)} → ${a.date_to.slice(0, 10)}`
                      : ""}
                    {a.crm_link ? (
                      <a
                        href={a.crm_link}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-blue-400 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        CRM ↗
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-neutral-500 whitespace-nowrap">
                  {timeAgo(a.updated_at)}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {current && props.currentDirty ? (
        <p className="text-xs text-amber-400 mt-3">
          Unsaved changes for &ldquo;{current.label}&rdquo;. Click <strong>Save changes</strong> to
          persist.
        </p>
      ) : null}
    </section>
  );
}

function fmtCompactMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}
