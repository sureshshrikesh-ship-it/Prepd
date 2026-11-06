"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { SignIn } from "@/components/SignIn";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ScanReview } from "@/components/ScanReview";
import { PlanView } from "@/components/PlanView";
import { FridgeView } from "@/components/FridgeView";
import { DEFAULT_SETTINGS, type Plan, type Settings } from "@/lib/plan";
import { addReceiptToPantry, callApi, money, supabase } from "@/lib/browser";

type Tab = "week" | "fridge" | "shop" | "history" | "settings";
type PlanRow = { id: string; created_at: string; plan: Plan; settings: Settings; receipt_id: string | null; cooked?: Record<string, string> };
type ReceiptRow = { id: string; store: string | null; receipt_date: string | null; sum_of_lines: number | null; accuracy: number | null; created_at: string };

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("week");
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [planning, setPlanning] = useState<{ text: string; err?: boolean } | null>(null);
  const [history, setHistory] = useState<{ receipts: ReceiptRow[]; plans: PlanRow[] }>({ receipts: [], plans: [] });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [histMsg, setHistMsg] = useState("");
  const [fridgeMsg, setFridgeMsg] = useState("");

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadLatest = useCallback(async () => {
    const sb = supabase();
    const [{ data: plans }, { data: receipts }, { data: set }] = await Promise.all([
      sb.from("plans").select("id,created_at,plan,settings,receipt_id,cooked").order("created_at", { ascending: false }).limit(10),
      sb.from("receipts").select("id,store,receipt_date,sum_of_lines,accuracy,created_at").order("created_at", { ascending: false }).limit(20),
      sb.from("user_settings").select("*").maybeSingle(),
    ]);
    const p = (plans ?? []) as PlanRow[];
    setHistory({ plans: p, receipts: (receipts ?? []) as ReceiptRow[] });
    setPlan((cur) => cur ?? p[0] ?? null);
    if (set) setSettings((s) => ({ ...s, ...set }));
    if (!p.length) setTab((t) => (t === "week" ? "shop" : t));
  }, []);

  useEffect(() => { if (session) loadLatest(); }, [session, loadLatest]);

  async function buildPlan(receiptId: string | null) {
    setTab("week");
    setPlan(null);
    setPlanning({ text: "Building your week… this can take 1–3 minutes. Keep this screen open." });
    try {
      const out = await callApi<{ plan: Plan; planId: string | null }>("/api/plan", JSON.stringify({ receiptId }), true);
      setPlan({ id: out.planId ?? "new", created_at: new Date().toISOString(), plan: out.plan, settings, receipt_id: receiptId, cooked: {} });
      setPlanning(null);
      loadLatest();
    } catch (e) {
      setPlanning({ text: (e instanceof Error ? e.message : "Couldn't build the plan.") + " Your food is saved; try again from the Fridge tab.", err: true });
    }
  }

  async function toFridge(receiptId: string) {
    setHistMsg("Adding to your fridge…");
    try {
      const n = await addReceiptToPantry(receiptId);
      setHistMsg(n ? `${n} items added to your fridge.` : "That shop is already in your fridge.");
    } catch {
      setHistMsg("Couldn't add it. Try again.");
    }
  }

  if (!ready) return <main className="wrap"><p className="muted">Loading…</p></main>;

  return (
    <main className="wrap">
      <header className="head">
        <div>
          <div className="eyebrow">Prepd · test build</div>
          <h1>Snap your shop. Get your week.</h1>
        </div>
        {session && (
          <button className="link small" type="button" onClick={() => supabase().auth.signOut()}>Sign out</button>
        )}
      </header>

      {!session ? <SignIn /> : (
        <>
          <nav className="tabs main" aria-label="Sections">
            {([["week", "Week"], ["fridge", "Fridge"], ["shop", "Add food"], ["history", "History"], ["settings", "Settings"]] as [Tab, string][]).map(([k, label]) => (
              <button key={k} type="button" className={"tab" + (tab === k ? " on" : "")} aria-current={tab === k ? "page" : undefined} onClick={() => { setTab(k); setFridgeMsg(""); }}>{label}</button>
            ))}
          </nav>

          {tab === "week" && (
            <>
              {planning && <div className={"status" + (planning.err ? " err" : "")} role="status">{planning.text}</div>}
              {plan ? <PlanView key={plan.id} plan={plan.plan} planId={plan.id} cooked={plan.cooked} target={plan.settings?.protein_g ?? settings.protein_g} />
                : !planning && (
                  <section className="panel">
                    <h2>No plan yet</h2>
                    <p className="muted">Snap your shopping, your fridge or a receipt, and Prepd builds your meals, prep sessions and protein from what you have.</p>
                    <button className="btn" type="button" onClick={() => setTab("shop")}>Snap your food</button>
                  </section>
                )}
            </>
          )}

          {tab === "fridge" && (
            <>
              {fridgeMsg && <div className="check ok" role="status">{fridgeMsg}</div>}
              <FridgeView onPlan={() => buildPlan(null)} />
            </>
          )}

          {tab === "shop" && <ScanReview userId={session.user.id} onSaved={buildPlan}
            onFridgeUpdated={(msg) => { setFridgeMsg(msg); setTab("fridge"); }} />}

          {tab === "history" && (
            <section className="panel" aria-labelledby="hist-h">
              <h2 id="hist-h">History</h2>
              {histMsg && <div className="status" role="status">{histMsg}</div>}
              {history.receipts.length === 0 ? <p className="muted small">No receipts saved yet.</p> : history.receipts.map((r) => {
                const p = history.plans.find((x) => x.receipt_id === r.id);
                return (
                  <div className="hist" key={r.id}>
                    <div>
                      <div>{r.store ?? "Unknown store"} · {r.receipt_date ?? r.created_at.slice(0, 10)}</div>
                      <div className="muted small">{money(r.sum_of_lines)}{r.accuracy != null ? ` · read ${r.accuracy}% right` : ""}</div>
                    </div>
                    <div className="hist-actions">
                      {p && <button className="link small" type="button" onClick={() => { setPlan(p); setTab("week"); }}>Plan</button>}
                      <button className="link small" type="button" onClick={() => toFridge(r.id)}>Add to fridge</button>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {tab === "settings" && <SettingsPanel userId={session.user.id} onSaved={setSettings} />}
        </>
      )}
    </main>
  );
}
