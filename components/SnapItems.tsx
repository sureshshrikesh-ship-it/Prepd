"use client";
import { useState } from "react";
import { supabase } from "@/lib/browser";
import { formatQty, useByFrom, type Unit } from "@/lib/pantry";
import type { SnapItem } from "@/lib/snap";

type Row = SnapItem & { include: boolean };

/** Confirm what a shopping or fridge photo found, answer the few questions, then update the fridge. */
export function SnapItems({ kind, items: initial, notes, onDone }: {
  kind: "shopping" | "fridge"; items: SnapItem[]; notes: string[]; onDone: (msg: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>(initial.map((i) => ({ ...i, include: true })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setQty = (i: number, qty: number, unit?: Unit) => setRows((r) => r.map((x, j) => {
    if (j !== i) return x;
    const u = unit ?? x.unit;
    const protein = x.protein_per_unit != null && u === x.unit ? Math.round(x.protein_per_unit * qty) : x.protein_g;
    return { ...x, qty, unit: u, protein_g: protein };
  }));

  const questions = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.question && r.include);

  async function save() {
    setBusy(true); setErr("");
    const db = supabase();
    const chosen = rows.filter((r) => r.include && r.qty > 0);
    const fresh = chosen.filter((r) => !r.match).map((r) => ({
      name: r.name, category: r.category, storage: r.storage, unit: r.unit, unit_label: r.unit_label,
      qty: r.qty, start_qty: r.qty, use_by: useByFrom(r.keeps, r.storage, new Date()),
      protein_g_total: r.protein_g,
      fat_100: r.nutrition?.fat ?? null, saturates_100: r.nutrition?.saturates ?? null, sugars_100: r.nutrition?.sugars ?? null,
      salt_100: r.nutrition?.salt ?? null, fibre_100: r.nutrition?.fibre ?? null,
    }));
    const updates = chosen.filter((r) => r.match && r.qty !== r.match.before).map((r) => ({
      item_id: r.match!.id, kind: "adjusted", delta: Math.round((r.qty - r.match!.before) * 10) / 10, note: "fridge photo check",
    }));
    const results = await Promise.all([
      fresh.length ? db.from("pantry_items").insert(fresh) : Promise.resolve({ error: null }),
      updates.length ? db.rpc("apply_pantry_events", { p_events: updates }) : Promise.resolve({ error: null }),
    ]);
    setBusy(false);
    if (results.some((x) => x.error)) { setErr("Couldn't update your fridge. Try again."); return; }
    const parts = [fresh.length ? `${fresh.length} added` : "", updates.length ? `${updates.length} updated` : ""].filter(Boolean);
    onDone(parts.length ? `Fridge updated: ${parts.join(", ")}.` : "Nothing changed.");
  }

  return (
    <section className="panel" aria-labelledby="snap-h">
      <h2 id="snap-h">{kind === "shopping" ? "Your shopping" : "What's in your fridge"}</h2>

      {questions.length > 0 && (
        <div className="questions">
          <span className="eyebrow">A few quick questions</span>
          {questions.map(({ r, i }) => (
            <div key={i} className="question">
              <span className="q-text">{r.question!.q}</span>
              {r.question!.type === "count" ? (
                <div className="stepper" role="group" aria-label={r.question!.q}>
                  <button type="button" className="mini" aria-label="One fewer" onClick={() => setQty(i, Math.max(0, r.qty - 1))}>−</button>
                  <span className="qty">{formatQty(r.qty, r.unit, r.unit_label)}</span>
                  <button type="button" className="mini" aria-label="One more" onClick={() => setQty(i, r.qty + 1)}>+</button>
                </div>
              ) : (
                <div className="pills">
                  {r.question!.options.map((o) => {
                    const on = r.qty === o.qty && r.unit === o.unit;
                    return (
                      <button key={o.label} type="button" className={"pill" + (on ? " on" : "")} aria-pressed={on}
                        onClick={() => setQty(i, o.qty, o.unit)}>{o.label}</button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <p className="muted small">Skip any you're not sure of; the best guess is already filled in.</p>
        </div>
      )}

      <div className="items">
        {rows.map((r, i) => (
          <div key={i} className={"item" + (r.include ? "" : " excluded") + (r.confidence === "low" ? " low" : "")}>
            <div className="top">
              <label className="change">
                <input type="checkbox" checked={r.include} onChange={() => set(i, { include: !r.include })} aria-label={`Include ${r.name}`} />
                <input className="name-input" value={r.name} aria-label="Item name" onChange={(e) => set(i, { name: e.target.value })} />
              </label>
            </div>
            <div className="chips">
              <span className="chip">{r.match ? `${formatQty(r.match.before, r.match.unit, r.match.unit_label)} → ${formatQty(r.qty, r.unit, r.unit_label)}` : formatQty(r.qty, r.unit, r.unit_label)}</span>
              <span className="chip">{r.storage} · {r.keeps}</span>
              {r.protein_g != null && <span className="chip">~{Math.round(r.protein_g)} g protein</span>}
              {r.match ? <span className="chip high">in your fridge</span> : <span className="chip">new</span>}
              {r.confidence !== "high" && <span className={"chip " + r.confidence}>{r.confidence === "low" ? "check this" : "best guess"}</span>}
            </div>
          </div>
        ))}
      </div>
      {notes.length > 0 && <p className="muted small">{notes.join(" ")}</p>}
      {err && <div className="status err" role="alert">{err}</div>}
      <button type="button" className="btn full" disabled={busy} onClick={save}>{busy ? "Updating…" : "Add to my fridge"}</button>
      <p className="muted small">Untick anything that isn't yours or is wrong. You can change amounts later on the Fridge tab.</p>
    </section>
  );
}
