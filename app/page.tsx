"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { accuracy, sumOfLines, totalGap, type Receipt, type Verdict } from "@/lib/receipt";
import { shrinkPhoto } from "@/lib/shrink";

type Meta = { model: string; promptVersion: string; ms: number; inputTokens: number; outputTokens: number; truncated: boolean };
type TestRecord = {
  savedAt: string; promptVersion: string; model: string; store: string | null; receiptDate: string | null;
  seconds: number; inputTokens: number; outputTokens: number; lines: number; right: number; wrong: number;
  missed: number; accuracy: number; receiptTotal: number | null; sumOfLines: number; notes: string;
  items: (Receipt["items"][number] & { verdict: Verdict })[];
};

const LOG_KEY = "prepd.testLog.v1";
const PASS_KEY = "prepd.passcode";
const money = (n: number | null | undefined) => "£" + (Number(n) || 0).toFixed(2);

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: log lives for this visit only */ }
}

export default function ScanPage() {
  const [passcode, setPasscode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: "Lay the receipt flat in good light, with every line in frame." });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [missed, setMissed] = useState(0);
  const [notes, setNotes] = useState("");
  const [log, setLog] = useState<TestRecord[]>([]);
  const [saveMsg, setSaveMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPasscode(load(PASS_KEY, ""));
    setLog(load<TestRecord[]>(LOG_KEY, []));
  }, []);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStatus({ text: "Ready. Tap Read receipt." });
  }

  async function read() {
    if (!file) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setSaveMsg("");
    setStatus({ text: "Reading the receipt… usually 15–45 seconds." });
    try {
      const small = await shrinkPhoto(file);
      const body = new FormData();
      body.append("image", small, "receipt.jpg");
      const res = await fetch("/api/read-receipt", { method: "POST", body, headers: { "x-passcode": passcode }, signal: ctl.signal });
      const json = await res.json().catch(() => ({ error: "The server sent back something unreadable." }));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
      setReceipt(json.receipt);
      setMeta(json.meta);
      setVerdicts(json.receipt.items.map(() => null));
      setMissed(0);
      setNotes("");
      setStatus({ text: `Read ${json.receipt.items.length} items in ${Math.round(json.meta.ms / 1000)}s.` + (json.meta.truncated ? " The reply was cut short; some lines may be missing." : "") });
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

  function mark(i: number, v: Verdict) {
    setVerdicts((prev) => prev.map((x, j) => (j === i ? (x === v ? null : v) : x)));
  }

  function saveTest() {
    if (!receipt || !meta) return;
    if (unmarked > 0) { setSaveMsg(`Mark the remaining ${unmarked} line${unmarked > 1 ? "s" : ""} first.`); return; }
    const record: TestRecord = {
      savedAt: new Date().toISOString(), promptVersion: meta.promptVersion, model: meta.model,
      store: receipt.store, receiptDate: receipt.date, seconds: Math.round(meta.ms / 1000),
      inputTokens: meta.inputTokens, outputTokens: meta.outputTokens,
      lines: verdicts.length, right: verdicts.filter((v) => v === "right").length,
      wrong: verdicts.filter((v) => v === "wrong").length, missed,
      accuracy: Math.round((acc ?? 0) * 1000) / 10, receiptTotal: receipt.receipt_total,
      sumOfLines: sumOfLines(receipt), notes: notes.slice(0, 2000),
      items: receipt.items.map((it, i) => ({ ...it, verdict: verdicts[i] })),
    };
    const next = [record, ...log].slice(0, 50);
    setLog(next);
    save(LOG_KEY, next);
    setSaveMsg("Saved to the test log below.");
  }

  async function copyLog() {
    const text = JSON.stringify(log, null, 1);
    try { await navigator.clipboard.writeText(text); setSaveMsg("Test log copied. Paste it into the chat with Claude."); }
    catch { setSaveMsg("Couldn't copy on this device. Long-press to select the log instead."); }
  }

  const gap = receipt ? totalGap(receipt) : null;

  return (
    <main className="wrap">
      <header>
        <div className="eyebrow">Prepd · receipt reader test</div>
        <h1>Snap your shop</h1>
        <p className="muted" style={{ marginTop: 6 }}>Claude reads every line. Mark each one right or wrong so we can measure accuracy.</p>
      </header>

      <section className="panel" aria-labelledby="add-h">
        <h2 id="add-h">1. Add a receipt</h2>
        <label className="field" htmlFor="passcode">Test passcode
          <input id="passcode" type="password" autoComplete="off" value={passcode}
            onChange={(e) => { setPasscode(e.target.value); save(PASS_KEY, e.target.value); }} />
        </label>
        <div className="drop">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img src={preview} alt="The receipt photo you picked" />}
          <input id="photo" className="file-input" type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="actions">
            <label htmlFor="photo" className="btn ghost">{file ? "Change photo" : "Take or choose photo"}</label>
            <button className="btn" type="button" disabled={!file || busy || !passcode} onClick={read}>Read receipt</button>
            {busy && <button className="btn ghost" type="button" onClick={() => abortRef.current?.abort()}>Stop</button>}
          </div>
          <div className={"status" + (status.err ? " err" : "")} role="status">{status.text}</div>
        </div>
        <p className="muted small">Your photo is read and then discarded. It isn't stored. Card and payment lines are ignored.</p>
      </section>

      {receipt && (
        <section className="panel" aria-labelledby="res-h">
          <h2 id="res-h">2. Check the reading</h2>
          <div className="stats">
            <div className="stat"><b>{receipt.store ?? "?"}</b><span>store</span></div>
            <div className="stat"><b>{receipt.items.reduce((a, it) => a + it.qty, 0)}</b><span>items read</span></div>
            <div className="stat"><b>{money(sumOfLines(receipt))}</b><span>sum of lines</span></div>
            <div className="stat"><b>{acc == null ? "–" : Math.round(acc * 100) + "%"}</b><span>accuracy so far</span></div>
          </div>
          <div className={"check " + (gap === 0 ? "ok" : "warn")}>
            {gap === null ? "No total found on the photo. Check the sum of lines against your receipt."
              : gap === 0 ? `Lines add up to the receipt total (${money(receipt.receipt_total)}).`
              : `Lines add up to ${money(sumOfLines(receipt))} but the receipt says ${money(receipt.receipt_total)}: ${money(gap)} unaccounted for.`}
          </div>
          {receipt.warnings.length > 0 && <ul className="warnings">{receipt.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}

          <div className="items">
            {receipt.items.map((it, i) => (
              <div key={i} className={"item" + (verdicts[i] === "wrong" ? " wrong" : it.confidence === "low" ? " low" : "")}>
                <div className="raw">{it.raw}</div>
                <div className="top">
                  <span className="name">{it.name}{it.qty > 1 ? ` × ${it.qty}` : ""}</span>
                  <span className="price">{money(it.line_total)}</span>
                </div>
                <div className="chips">
                  {!it.is_food ? <span className="chip nonfood">not food</span> : (<>
                    <span className="chip">{it.category.replace("_", " ")}</span>
                    {it.pack_size && <span className="chip">{it.pack_size}{it.pack_size_estimated ? " (est.)" : ""}</span>}
                    <span className="chip">{it.storage} · {it.keeps}</span>
                    {it.protein_g != null && <span className="chip">~{Math.round(it.protein_g)} g protein</span>}
                  </>)}
                  <span className={"chip " + it.confidence}>{it.confidence}</span>
                </div>
                {it.note && <p className="muted small">{it.note}</p>}
                <div className="verdict">
                  <button type="button" className={"yes" + (verdicts[i] === "right" ? " on" : "")} aria-pressed={verdicts[i] === "right"} onClick={() => mark(i, "right")}>Right</button>
                  <button type="button" className={"no" + (verdicts[i] === "wrong" ? " on" : "")} aria-pressed={verdicts[i] === "wrong"} onClick={() => mark(i, "wrong")}>Wrong</button>
                </div>
              </div>
            ))}
          </div>

          <label className="field" htmlFor="missed">Lines it missed completely
            <input id="missed" type="number" min={0} step={1} inputMode="numeric" value={missed}
              onChange={(e) => setMissed(Math.max(0, parseInt(e.target.value, 10) || 0))} />
          </label>
          <label className="field" htmlFor="notes">Notes (what it got wrong, odd abbreviations)
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. read DESSERT ITALIAN as tiramisu, it was panna cotta" />
          </label>
          <button className="btn full" type="button" onClick={saveTest}>Save test result</button>
          {meta && <p className="muted small">{meta.model} · prompt {meta.promptVersion} · {meta.inputTokens.toLocaleString()} in / {meta.outputTokens.toLocaleString()} out tokens</p>}
        </section>
      )}

      <section className="panel" aria-labelledby="log-h">
        <h2 id="log-h">Test log</h2>
        {saveMsg && <div className="status" role="status">{saveMsg}</div>}
        {log.length === 0 ? (
          <p className="muted small">No tests saved yet. Read a receipt, mark each line, then save. Results appear here, newest first.</p>
        ) : (<>
          {log.map((t) => (
            <div className="hist" key={t.savedAt}>
              <div>
                <div>{t.store ?? "Unknown store"} · {t.receiptDate ?? "no date"}</div>
                <div className="muted small">{t.lines} lines · {t.missed} missed · {t.seconds}s · prompt {t.promptVersion}</div>
              </div>
              <b>{t.accuracy}%</b>
            </div>
          ))}
          <button className="btn ghost full" type="button" onClick={copyLog}>Copy log for Claude</button>
        </>)}
      </section>
    </main>
  );
}
