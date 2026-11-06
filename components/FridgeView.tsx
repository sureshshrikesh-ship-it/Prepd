"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/browser";
import { QuickLog } from "@/components/QuickLog";
import { daysLeft, formatQty, stepFor, useByFrom, useByLabel, type PantryItem, type Storage, type Unit } from "@/lib/pantry";

const PLACES: { key: Storage; label: string }[] = [
  { key: "fridge", label: "Fridge" },
  { key: "freezer", label: "Freezer" },
  { key: "cupboard", label: "Cupboard" },
  { key: "counter", label: "Counter" },
];

export function FridgeView({ onPlan }: { onPlan: () => void }) {
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase().from("pantry_items").select("*")
      .eq("status", "active").gt("qty", 0).order("use_by", { ascending: true, nullsFirst: false }).limit(300);
    if (error) setMsg({ text: "Couldn't load your fridge.", err: true });
    setItems((data ?? []).map((d) => ({ ...d, qty: Number(d.qty), start_qty: Number(d.start_qty) })) as PantryItem[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function change(it: PantryItem, kind: "used" | "adjusted" | "binned", delta: number, note: string) {
    setBusy(it.id);
    setMsg(null);
    const { error } = await supabase().rpc("apply_pantry_events", { p_events: [{ item_id: it.id, kind, delta, note }] });
    setBusy(null);
    if (error) { setMsg({ text: "Couldn't update. Try again.", err: true }); return; }
    if (kind === "binned" || it.qty + delta <= 0) setMsg({ text: `${it.name} ${kind === "binned" ? "binned" : "finished"}.` });
    load();
  }

  if (items === null) return <section className="panel"><p className="muted">Loading your fridge…</p></section>;

  const soon = items.filter((i) => { const n = daysLeft(i.use_by); return n != null && n <= 2; });

  return (
    <section className="panel" aria-labelledby="fridge-h">
      <div className="top">
        <h2 id="fridge-h">Your fridge</h2>
        <span className="muted small">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>

      <QuickLog onApplied={load} />

      {items.length === 0 ? (
        <p className="muted">Empty for now. Snap your fridge or your shopping on the Add food tab, tell it below what you have, or add items one by one.</p>
      ) : (
        <>
          {soon.length > 0 && (
            <div className="check warn">Use soon: {soon.map((i) => i.name).join(", ")}</div>
          )}
          {PLACES.map((p) => {
            const list = items.filter((i) => i.storage === p.key);
            if (!list.length) return null;
            return (
              <div key={p.key} className="block">
                <h3>{p.label}</h3>
                <div className="items">
                  {list.map((it) => {
                    const left = useByLabel(daysLeft(it.use_by));
                    const step = stepFor(it.unit, it.qty);
                    const pct = it.start_qty > 0 ? Math.min(100, (it.qty / it.start_qty) * 100) : 100;
                    return (
                      <div key={it.id} className="item pantry">
                        <div className="top">
                          <span className="name">{it.name}</span>
                          {left.text && <span className={"chip use-" + left.tone}>{left.text}</span>}
                        </div>
                        <div className="stock-row">
                          <span className="qty">{formatQty(it.qty, it.unit, it.unit_label)}</span>
                          <div className="bar small-bar" aria-hidden="true"><div style={{ width: `${pct}%` }} /></div>
                        </div>
                        <div className="pantry-actions">
                          <button type="button" className="mini" aria-label={`Used ${formatQty(step, it.unit, it.unit_label)} of ${it.name}`} disabled={busy === it.id}
                            onClick={() => change(it, "used", -step, "used by hand")}>−{formatQty(step, it.unit, it.unit_label)}</button>
                          <button type="button" className="mini" aria-label={`Add ${formatQty(step, it.unit, it.unit_label)} of ${it.name}`} disabled={busy === it.id}
                            onClick={() => change(it, "adjusted", step, "added by hand")}>+</button>
                          <button type="button" className="mini" disabled={busy === it.id} onClick={() => change(it, "used", -it.qty, "finished")}>Finished</button>
                          <button type="button" className="mini warn" disabled={busy === it.id} onClick={() => change(it, "binned", 0, "binned")}>Binned</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      )}

      {msg && <div className={"status" + (msg.err ? " err" : "")} role="status">{msg.text}</div>}

      {adding ? <AddItem onDone={() => { setAdding(false); load(); }} /> : (
        <button type="button" className="btn ghost full" onClick={() => setAdding(true)}>Add something you already have</button>
      )}
      {items.length > 0 && <button type="button" className="btn full" onClick={onPlan}>Plan my week from this</button>}
      <p className="muted small">Use-by dates are estimates from typical shelf life. The date on the pack always wins.</p>
    </section>
  );
}

function AddItem({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [storage, setStorage] = useState<Storage>("fridge");
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<Unit>("pack");
  const [keeps, setKeeps] = useState("1 week");
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(amount);
    if (!name.trim() || !(qty > 0)) { setErr("Add a name and an amount above zero."); return; }
    const { error } = await supabase().from("pantry_items").insert({
      name: name.trim(), storage, unit, qty, start_qty: qty, use_by: useByFrom(keeps, storage, new Date()),
    });
    if (error) { setErr("Couldn't add it. Try again."); return; }
    onDone();
  }

  return (
    <form className="edit" onSubmit={save}>
      <label className="field" htmlFor="add-name">What is it?
        <input id="add-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken thighs" autoFocus />
      </label>
      <div className="grid2">
        <label className="field" htmlFor="add-amount">Amount
          <input id="add-amount" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="field" htmlFor="add-unit">Unit
          <select id="add-unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="pack">packs</option><option value="piece">pieces</option><option value="g">grams</option><option value="ml">ml</option>
          </select>
        </label>
        <label className="field" htmlFor="add-where">Where
          <select id="add-where" value={storage} onChange={(e) => setStorage(e.target.value as Storage)}>
            {PLACES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="field" htmlFor="add-keeps">Keeps about
          <select id="add-keeps" value={keeps} onChange={(e) => setKeeps(e.target.value)}>
            {["1-2 days", "3-5 days", "1 week", "1-2 weeks", "2-4 weeks", "months"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      {err && <div className="status err" role="alert">{err}</div>}
      <div className="actions">
        <button type="submit" className="btn">Add to fridge</button>
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
