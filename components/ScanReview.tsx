"use client";
import { useMemo, useRef, useState } from "react";
import {
  CATEGORIES, accuracy, rawKey, storeKey, sumOfLines, totalGap,
  type Category, type Receipt, type ReceiptItem, type Verdict,
} from "@/lib/receipt";
import { callApi, getPasscode, money, supabase } from "@/lib/browser";
import { shrinkPhoto } from "@/lib/shrink";
import { isLiquid, itemFlags } from "@/lib/nutrition";

type Meta = { model: string; promptVersion: string; ms: number; inputTokens: number; outputTokens: number; truncated: boolean; fromMap: number };

export function ScanReview({ userId, onSaved }: { userId: string; onSaved: (receiptId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: "Lay the receipt flat in good light, with every line in frame." });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [missed, setMissed] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setReceipt(null);
    setStatus({ text: "Ready. Tap Read receipt." });
  }

  async function read() {
    if (!file) return;
    if (!getPasscode()) { setStatus({ text: "Enter the test passcode in Your week first.", err: true }); return; }
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setSaveMsg("");
    setStatus({ text: "Reading the receipt… usually 15–45 seconds." });
    try {
      const small = await shrinkPhoto(file);
      const body = new FormData();
      body.append("image", small, "receipt.jpg");
      const out = await callApi<{ receipt: Receipt; meta: Meta }>("/api/read-receipt", body, false, ctl.signal);
      setReceipt(out.receipt);
      setItems(out.receipt.items);
      setMeta(out.meta);
      setVerdicts(out.receipt.items.map((i) => (i.source === "map" ? "right" : null)));
      setMissed(0);
      setNotes("");
      const known = out.meta.fromMap ? ` ${out.meta.fromMap} recognised from earlier corrections.` : "";
      setStatus({ text: `Read ${out.receipt.items.length} lines in ${Math.round(out.meta.ms / 1000)}s.${known}` + (out.meta.truncated ? " The reply was cut short; some lines may be missing." : "") });
    } catch (e) {
      if (ctl.signal.aborted) setStatus({ text: "Stopped." });
      else setStatus({ text: e instanceof Error ? e.message : "Something went wrong. Try again.", err: true });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const acc = useMemo(() => accuracy(verdicts, missed), [verdicts, missed]);
  const unmarked = verdicts.filter((v) => v === null).length;
  const unanswered = items.filter((it) => it.needs_input && it.name === it.raw).length;

  function mark(i: number, v: Verdict) {
    setVerdicts((prev) => prev.map((x, j) => (j === i ? (x === v ? null : v) : x)));
  }
  function edit(i: number, patch: Partial<ReceiptItem>) {
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch, source: "user" } : it)));
  }

  async function save() {
    if (!receipt || !meta) return;
    if (unmarked > 0) { setSaveMsg(`Mark the remaining ${unmarked} line${unmarked > 1 ? "s" : ""} first, or tap “Mark the rest right”.`); return; }
    setSaving(true);
    setSaveMsg("Saving…");
    const db = supabase();
    const final = { ...receipt, items };
    try {
      const { data: r, error } = await db.from("receipts").insert({
        user_id: userId, store: receipt.store, branch: receipt.branch, receipt_date: receipt.date,
        receipt_total: receipt.receipt_total, sum_of_lines: sumOfLines(final), prompt_version: meta.promptVersion,
        model: meta.model, ms: meta.ms, input_tokens: meta.inputTokens, output_tokens: meta.outputTokens,
        accuracy: acc == null ? null : Math.round(acc * 1000) / 10, missed, notes: notes.slice(0, 2000) || null,
      }).select("id").single();
      if (error || !r) throw new Error(error?.message || "no id");

      const { error: itemsErr } = await db.from("receipt_items").insert(items.map((it, i) => ({
        receipt_id: r.id, user_id: userId, position: i, raw: it.raw, name: it.name, category: it.category, qty: it.qty,
        pack_size: it.pack_size, units_per_pack: it.units_per_pack, unit_name: it.unit_name, line_total: it.line_total,
        is_food: it.is_food, storage: it.storage, keeps: it.keeps, protein_g: it.protein_g, confidence: it.confidence,
        fat_100: it.nutrition?.fat ?? null, saturates_100: it.nutrition?.saturates ?? null, sugars_100: it.nutrition?.sugars ?? null,
        salt_100: it.nutrition?.salt ?? null, fibre_100: it.nutrition?.fibre ?? null,
        source: it.source, verdict: verdicts[i],
      })));
      if (itemsErr) throw new Error(itemsErr.message);

      // Teach the shared product map: confirmed and corrected lines, never generic till keys.
      const store = storeKey(receipt.store);
      const teach = items.filter((it, i) => !it.needs_input && it.raw && it.source !== "map" && (verdicts[i] === "right" || it.source === "user"));
      await Promise.all(teach.map((it) => db.rpc("upsert_product_map", {
        p_store: store, p_raw: rawKey(it.raw), p_name: it.name, p_category: it.category, p_is_food: it.is_food,
        p_pack_size: it.pack_size, p_units_per_pack: it.units_per_pack, p_unit_name: it.unit_name,
      })));

      setSaveMsg("Saved.");
      onSaved(r.id);
    } catch (e) {
      console.error(e);
      setSaveMsg("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const gap = receipt ? totalGap({ ...receipt, items }) : null;

  return (
    <>
      <section className="panel" aria-labelledby="add-h">
        <h2 id="add-h">Add this week’s shop</h2>
        <div className="drop">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img src={preview} alt="The receipt photo you picked" />}
          <input id="photo" className="file-input" type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="actions">
            <label htmlFor="photo" className="btn ghost">{file ? "Change photo" : "Take or choose photo"}</label>
            <button className="btn" type="button" disabled={!file || busy} onClick={read}>Read receipt</button>
            {busy && <button className="btn ghost" type="button" onClick={() => abortRef.current?.abort()}>Stop</button>}
          </div>
          <div className={"status" + (status.err ? " err" : "")} role="status">{status.text}</div>
        </div>
        <p className="muted small">Your photo is read and then discarded. Card and payment lines are ignored.</p>
      </section>

      {receipt && (
        <section className="panel" aria-labelledby="res-h">
          <h2 id="res-h">Check the reading</h2>
          <div className="stats">
            <div className="stat"><b>{receipt.store ?? "?"}</b><span>store</span></div>
            <div className="stat"><b>{items.reduce((a, it) => a + it.qty, 0)}</b><span>items</span></div>
            <div className="stat"><b>{money(sumOfLines({ items }))}</b><span>sum of lines</span></div>
            <div className="stat"><b>{acc == null ? "–" : Math.round(acc * 100) + "%"}</b><span>accuracy</span></div>
          </div>
          <div className={"check " + (gap === 0 ? "ok" : "warn")}>
            {gap === null ? "No total found on the photo. Check the sum of lines against your receipt."
              : gap === 0 ? `Lines add up to the receipt total (${money(receipt.receipt_total)}).`
              : `Lines add up to ${money(sumOfLines({ items }))} but the receipt says ${money(receipt.receipt_total)}: ${money(gap)} unaccounted for.`}
          </div>
          {unanswered > 0 && <div className="check warn">{unanswered} line{unanswered > 1 ? "s don’t" : " doesn’t"} say what the product was. Fill in the highlighted boxes so the plan can use {unanswered > 1 ? "them" : "it"}.</div>}
          {receipt.warnings.length > 0 && <ul className="warnings">{receipt.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}

          <div className="items">
            {items.map((it, i) => {
              const editing = verdicts[i] === "wrong" || it.needs_input;
              return (
                <div key={i} className={"item" + (verdicts[i] === "wrong" ? " wrong" : it.needs_input || it.confidence === "low" ? " low" : "")}>
                  <div className="raw">{it.raw}</div>
                  <div className="top">
                    <span className="name">{it.name}{it.qty > 1 ? ` × ${it.qty}` : ""}</span>
                    <span className="price">{money(it.line_total)}</span>
                  </div>
                  <div className="chips">
                    {it.source === "map" && <span className="chip high">known</span>}
                    {!it.is_food ? <span className="chip nonfood">not food</span> : (<>
                      <span className="chip">{it.category.replace("_", " ")}</span>
                      {it.pack_size && <span className="chip">{it.pack_size}{it.pack_size_estimated ? " (est.)" : ""}</span>}
                      {it.units_per_pack && <span className="chip">~{it.units_per_pack} {it.unit_name ?? "units"}{it.units_per_pack > 1 ? "s" : ""}</span>}
                      <span className="chip">{it.storage} · {it.keeps}</span>
                      {it.protein_g != null && <span className="chip">~{Math.round(it.protein_g)} g protein</span>}
                      {itemFlags(it.nutrition, isLiquid(it.category, it.name)).map((f) => (
                        <span key={f.label} className={"chip " + (f.tone === "warn" ? "flag-warn" : "flag-good")}>{f.label}</span>
                      ))}
                    </>)}
                    {it.source !== "map" && <span className={"chip " + it.confidence}>{it.confidence}</span>}
                  </div>
                  {it.note && <p className="muted small">{it.note}</p>}
                  {editing && (
                    <div className="edit">
                      <label className="field" htmlFor={`name-${i}`}>{it.needs_input ? "What was this?" : "Correct name"}
                        <input id={`name-${i}`} value={it.name === it.raw && it.needs_input ? "" : it.name} placeholder={it.needs_input ? "e.g. basmati rice 1kg" : ""}
                          onChange={(e) => edit(i, { name: e.target.value || it.raw })} />
                      </label>
                      <div className="grid2">
                        <label className="field" htmlFor={`cat-${i}`}>Category
                          <select id={`cat-${i}`} value={it.category} onChange={(e) => {
                            const category = e.target.value as Category;
                            edit(i, { category, is_food: category !== "non_food" });
                          }}>
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                          </select>
                        </label>
                        <label className="field" htmlFor={`protein-${i}`}>Protein in total (g)
                          <input id={`protein-${i}`} type="number" inputMode="numeric" min={0} value={it.protein_g ?? ""}
                            onChange={(e) => edit(i, { protein_g: e.target.value === "" ? null : Number(e.target.value) })} />
                        </label>
                      </div>
                    </div>
                  )}
                  <div className="verdict">
                    <button type="button" className={"yes" + (verdicts[i] === "right" ? " on" : "")} aria-pressed={verdicts[i] === "right"} onClick={() => mark(i, "right")}>Right</button>
                    <button type="button" className={"no" + (verdicts[i] === "wrong" ? " on" : "")} aria-pressed={verdicts[i] === "wrong"} onClick={() => mark(i, "wrong")}>Wrong</button>
                  </div>
                </div>
              );
            })}
          </div>
          {unmarked > 0 && (
            <button className="btn ghost full" type="button" onClick={() => setVerdicts((v) => v.map((x) => x ?? "right"))}>Mark the rest right ({unmarked})</button>
          )}
          <label className="field" htmlFor="missed">Lines it missed completely
            <input id="missed" type="number" min={0} step={1} inputMode="numeric" value={missed}
              onChange={(e) => setMissed(Math.max(0, parseInt(e.target.value, 10) || 0))} />
          </label>
          <label className="field" htmlFor="notes">Notes for Claude (optional)
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything odd about this reading" />
          </label>
          <button className="btn full" type="button" disabled={saving} onClick={save}>Save and build my week</button>
          {saveMsg && <div className="status" role="status">{saveMsg}</div>}
          {meta && <p className="muted small">{meta.model} · prompt {meta.promptVersion} · {meta.inputTokens.toLocaleString()} in / {meta.outputTokens.toLocaleString()} out tokens</p>}
        </section>
      )}
    </>
  );
}
