"use client";
import { useState } from "react";
import { callApi, getPasscode, supabase } from "@/lib/browser";
import type { ProposedLog } from "@/lib/log";
import { formatQty, useByFrom, type Storage } from "@/lib/pantry";

const KIND_LABEL = { used: "Used", finished: "Finished", binned: "Binned" } as const;

export function QuickLog({ onApplied }: { onApplied: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [proposal, setProposal] = useState<ProposedLog | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [done, setDone] = useState("");

  async function read(e: React.FormEvent) {
    e.preventDefault();
    if (!getPasscode()) { setErr("Enter the test passcode in Settings first."); return; }
    setBusy(true); setErr(""); setDone(""); setProposal(null); setSkip(new Set());
    try {
      const out = await callApi<ProposedLog>("/api/log", JSON.stringify({ note }), true);
      if (!out.changes.length && !out.new_items.length) setErr(out.unclear.length ? `Couldn't match: ${out.unclear.join(", ")}.` : "Nothing in that note matched your fridge.");
      else setProposal(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true); setErr("");
    const db = supabase();
    const events = proposal.changes.filter((_, i) => !skip.has(i))
      .map((c) => ({ item_id: c.item_id, kind: c.kind === "finished" ? "used" : c.kind, delta: c.delta, note: note.slice(0, 280) }));
    const fresh = proposal.new_items.filter((_, i) => !skip.has(1000 + i)).map((n) => ({
      name: n.name, qty: n.qty, start_qty: n.qty, unit: n.unit, unit_label: n.unit_label, storage: n.storage,
      use_by: useByFrom(n.keeps, n.storage as Storage, new Date()),
    }));
    const results = await Promise.all([
      events.length ? db.rpc("apply_pantry_events", { p_events: events }) : Promise.resolve({ error: null }),
      fresh.length ? db.from("pantry_items").insert(fresh) : Promise.resolve({ error: null }),
    ]);
    setBusy(false);
    if (results.some((r) => r.error)) { setErr("Couldn't update your fridge. Try again."); return; }
    const n = events.length + fresh.length;
    setDone(`Fridge updated: ${n} change${n === 1 ? "" : "s"}.`);
    setProposal(null); setNote("");
    onApplied();
  }

  const toggle = (k: number) => setSkip((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="quicklog">
      <form onSubmit={read} className="stack">
        <label className="field" htmlFor="quicklog">What did you use, cook, bin or buy?
          <textarea id="quicklog" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="Made an omelette with 3 eggs and some spinach. Binned the coriander. Bought milk." />
        </label>
        <p className="muted small">Tip: tap the microphone on your keyboard to say it instead of typing.</p>
        <button className="btn full" type="submit" disabled={busy || note.trim().length < 3}>{busy && !proposal ? "Reading…" : "Update my fridge"}</button>
      </form>

      {proposal && (
        <div className="edit">
          <span className="eyebrow">Check these changes</span>
          <ul className="changes">
            {proposal.changes.map((c, i) => (
              <li key={c.item_id}>
                <label className="change">
                  <input type="checkbox" checked={!skip.has(i)} onChange={() => toggle(i)} />
                  <span><b>{c.name}</b>: {KIND_LABEL[c.kind]}{c.kind === "used" ? `, ${c.before} → ${c.after}` : ""}</span>
                </label>
              </li>
            ))}
            {proposal.new_items.map((n, i) => (
              <li key={"new" + i}>
                <label className="change">
                  <input type="checkbox" checked={!skip.has(1000 + i)} onChange={() => toggle(1000 + i)} />
                  <span><b>{n.name}</b>: Added, {formatQty(n.qty, n.unit, n.unit_label)} ({n.storage})</span>
                </label>
              </li>
            ))}
          </ul>
          {proposal.unclear.length > 0 && <p className="muted small">Not matched: {proposal.unclear.join(", ")}</p>}
          <div className="actions">
            <button type="button" className="btn" disabled={busy} onClick={apply}>{busy ? "Updating…" : "Apply"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setProposal(null)}>Cancel</button>
          </div>
        </div>
      )}
      {err && <div className="status err" role="alert">{err}</div>}
      {done && <div className="status" role="status">{done}</div>}
    </div>
  );
}
