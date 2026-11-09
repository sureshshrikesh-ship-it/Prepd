"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/browser";
import { formatQty, type PantryItem } from "@/lib/pantry";
import { atHomeText, type Settings } from "@/lib/plan";
import {
  RECIPES, checkRecipe, deductions, formatAmount, rankRecipes, scaled,
  type Check, type Line, type Ranked, type Recipe,
} from "@/lib/recipes";

type Filter = "all" | "quick" | "batch" | "veg" | "breakfast";
const FILTERS: [Filter, string, (r: Recipe) => boolean][] = [
  ["all", "All", () => true],
  ["quick", "Under 20 min", (r) => r.minutes <= 20],
  ["batch", "Batch cook", (r) => r.serves >= 3],
  ["veg", "Veggie", (r) => r.veg],
  ["breakfast", "Breakfast", (r) => r.meal === "breakfast"],
];

type View =
  | { at: "list" }
  | { at: "ready"; recipe: Recipe; servings: number }
  | { at: "cook"; recipe: Recipe; servings: number; step: number }
  | { at: "done"; recipe: Recipe; servings: number };

export function TonightView({ settings, onAddFood }: { settings: Settings; onAddFood: () => void }) {
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [view, setView] = useState<View>({ at: "list" });
  const [filter, setFilter] = useState<Filter>("all");
  const [flash, setFlash] = useState<{ text: string; undo?: () => Promise<void> } | null>(null);
  const atHome = useMemo(() => atHomeText(settings).split(",").map((s) => s.trim()).filter(Boolean), [settings]);

  const load = useCallback(async () => {
    const { data } = await supabase().from("pantry_items").select("*").eq("status", "active").gt("qty", 0).limit(300);
    setItems((data ?? []).map((d) => ({ ...d, qty: Number(d.qty), start_qty: Number(d.start_qty) })) as PantryItem[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (items === null) return <section className="panel"><p className="muted">Checking your fridge…</p></section>;

  if (view.at === "ready") {
    return <KeepReady recipe={view.recipe} servings={view.servings} items={items} atHome={atHome}
      onServings={(s) => setView({ ...view, servings: s })}
      onBack={() => setView({ at: "list" })}
      onStart={() => setView({ at: "cook", recipe: view.recipe, servings: view.servings, step: 0 })} />;
  }
  if (view.at === "cook") {
    return <CookMode recipe={view.recipe} servings={view.servings} step={view.step}
      onStep={(step) => setView({ ...view, step })}
      onExit={() => setView({ at: "ready", recipe: view.recipe, servings: view.servings })}
      onDone={() => setView({ at: "done", recipe: view.recipe, servings: view.servings })} />;
  }
  if (view.at === "done") {
    return <Cooked recipe={view.recipe} servings={view.servings} check={checkRecipe(view.recipe, view.servings, items, atHome)}
      onFinish={(text, undo) => { setFlash({ text, undo }); setView({ at: "list" }); load(); }} />;
  }

  const ranked = rankRecipes(RECIPES, items, atHome, settings.avoid).filter((r) => FILTERS.find((f) => f[0] === filter)![2](r.recipe));
  const now = ranked.filter((r) => r.check.missing.length === 0);
  const nearly = ranked.filter((r) => r.check.missing.length > 0 && r.check.missing.length <= 2);
  const rest = ranked.filter((r) => r.check.missing.length > 2);
  const fridgeEmpty = items.length === 0;

  return (
    <section className="panel" aria-labelledby="tonight-h">
      <div className="top">
        <h2 id="tonight-h">What can I cook tonight?</h2>
        <span className="muted small">{items.length} in your fridge</span>
      </div>

      {flash && (
        <div className="check ok cooked-row" role="status">
          <span>{flash.text}</span>
          {flash.undo && <button type="button" className="link small" onClick={async () => { await flash.undo!(); setFlash({ text: "Undone. Your fridge is back as it was." }); load(); }}>Undo</button>}
        </div>
      )}

      {fridgeEmpty && (
        <div className="quicklog">
          <b>Your fridge is empty in Prepd</b>
          <span className="muted small">Snap your fridge or your shopping and these become recipes you can cook right now.</span>
          <button type="button" className="btn" onClick={onAddFood}>Snap your food</button>
        </div>
      )}

      <div className="pills" role="group" aria-label="Filter recipes">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={"pill" + (filter === k ? " on" : "")} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {!fridgeEmpty && <Section title="Cook now" hint="You have everything" list={now} empty="Nothing complete yet. Check “Grab one or two things” below." onPick={(r) => setView({ at: "ready", recipe: r, servings: r.serves })} />}
      <Section title={fridgeEmpty ? "Recipes" : "Grab one or two things"} hint={fridgeEmpty ? "" : "On the way home"} list={fridgeEmpty ? ranked : nearly} empty="" onPick={(r) => setView({ at: "ready", recipe: r, servings: r.serves })} />
      {!fridgeEmpty && rest.length > 0 && (
        <details className="more">
          <summary>More recipes ({rest.length}) need a shop</summary>
          <Section title="" hint="" list={rest} empty="" onPick={(r) => setView({ at: "ready", recipe: r, servings: r.serves })} />
        </details>
      )}
      <p className="muted small">Protein and calories are estimates per serving. Recipes count your Settings › At home staples as in stock.</p>
    </section>
  );
}

function Section({ title, hint, list, empty, onPick }: { title: string; hint: string; list: Ranked[]; empty: string; onPick: (r: Recipe) => void }) {
  if (!list.length && !empty) return null;
  return (
    <div className="block">
      {title && <h3>{title} {hint && <span className="muted small">· {hint}</span>}</h3>}
      {!list.length ? <p className="muted small">{empty}</p> : (
        <div className="recipe-list">
          {list.map(({ recipe: r, check }) => (
            <button key={r.id} type="button" className="recipe-card" onClick={() => onPick(r)}>
              <span className="name">{r.title}</span>
              <span className="chips">
                <span className="chip high">{r.protein} g protein</span>
                <span className="chip">{r.minutes} min</span>
                <span className="chip">serves {r.serves}</span>
                {check.soon.length > 0 && <span className="chip use-warn">Uses your {check.soon[0].name.toLowerCase()}</span>}
              </span>
              {check.missing.length > 0 && <span className="muted small">Grab: {check.missing.map((l) => l.ing.name.toLowerCase()).join(", ")}</span>}
              {check.missing.length === 0 && check.short.length > 0 && <span className="muted small">Low on {check.short.map((l) => l.ing.name.toLowerCase()).join(", ")}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Keep these ready ────────────────────────────────────────────────────────

function lineStatus(l: Line): { text: string; tone: "ok" | "warn" | "bad" | "calm" } {
  if (l.from === "home") return { text: "at home", tone: "calm" };
  if (l.from === "fridge" && l.item) {
    const left = formatQty(l.item.qty, l.item.unit, l.item.unit_label);
    return l.enough ? { text: `in fridge · ${left}`, tone: "ok" } : { text: `only ${left} left`, tone: "warn" };
  }
  return l.ing.staple ? { text: "check you have it", tone: "calm" } : l.ing.optional ? { text: "optional", tone: "calm" } : { text: "grab on the way", tone: "bad" };
}

function KeepReady({ recipe: r, servings, items, atHome, onServings, onBack, onStart }: {
  recipe: Recipe; servings: number; items: PantryItem[]; atHome: string[];
  onServings: (n: number) => void; onBack: () => void; onStart: () => void;
}) {
  const check = checkRecipe(r, servings, items, atHome);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const isTicked = (l: Line) => ticked[l.ing.k] ?? (!!l.from && l.enough);
  const mains = check.lines.filter((l) => !l.ing.staple);
  const staples = check.lines.filter((l) => l.ing.staple);
  const toBuy = check.lines.filter((l) => !l.ing.staple && !l.ing.optional && !isTicked(l));
  const allReady = mains.every((l) => isTicked(l) || l.ing.optional);
  const protein = r.protein;

  const row = (l: Line) => {
    const s = lineStatus(l);
    return (
      <label key={l.ing.k} className="ready-row">
        <input type="checkbox" checked={isTicked(l)} onChange={() => setTicked((t) => ({ ...t, [l.ing.k]: !isTicked(l) }))} />
        <span className="ready-name">{l.ing.name}<span className="muted"> · {formatAmount(l.qty, l.ing.unit, l.ing.label)}</span></span>
        <span className={"chip use-" + s.tone}>{s.text}</span>
      </label>
    );
  };

  return (
    <section className="panel" aria-labelledby="ready-h">
      <button type="button" className="link small back" onClick={onBack}>← All recipes</button>
      <div>
        <h2 id="ready-h">{r.title}</h2>
        <p className="muted">{r.blurb}</p>
      </div>
      <div className="stats">
        <div className="stat"><b>{r.minutes}</b><span>minutes</span></div>
        <div className="stat"><b>{protein} g</b><span>protein each</span></div>
        <div className="stat"><b>{r.kcal}</b><span>kcal each</span></div>
        <div className="stat"><b>{servings}</b><span>servings</span></div>
      </div>
      <div className="stepper" role="group" aria-label="Servings">
        <span className="q-text">Servings</span>
        <button type="button" className="mini" aria-label="Fewer servings" disabled={servings <= 1} onClick={() => onServings(servings - 1)}>−</button>
        <span className="qty">{servings}</span>
        <button type="button" className="mini" aria-label="More servings" disabled={servings >= 8} onClick={() => onServings(servings + 1)}>+</button>
      </div>

      <div className="block">
        <h3>Keep these ready</h3>
        <div className="ready-list">{mains.map(row)}</div>
      </div>
      <div className="block">
        <h3>From the cupboard</h3>
        <div className="ready-list">{staples.map(row)}</div>
      </div>

      {toBuy.length > 0 && (
        <div className="check warn">Grab on the way: {toBuy.map((l) => `${l.ing.name.toLowerCase()} (${formatAmount(l.qty, l.ing.unit, l.ing.label)})`).join(", ")}</div>
      )}
      {r.keeps && <p className="muted small">{r.keeps}</p>}

      <div className="actions stack-actions">
        <button type="button" className="btn full" onClick={onStart}>{allReady ? "I have everything, start cooking" : "Start anyway"}</button>
      </div>
    </section>
  );
}

// ── Cook mode ───────────────────────────────────────────────────────────────

function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, []);
}

function Timer({ minutes, label }: { minutes: number; label: string }) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [endsAt]);
  const left = endsAt ? Math.max(0, Math.round((endsAt - now) / 1000)) : minutes * 60;
  const done = endsAt != null && left === 0;
  useEffect(() => { if (done) navigator.vibrate?.([300, 150, 300]); }, [done]);
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  return (
    <div className={"timer" + (done ? " done" : "")} role="timer" aria-label={label}>
      <span className="timer-time">{done ? "Time's up" : `${mm}:${ss}`}</span>
      {endsAt == null ? <button type="button" className="mini" onClick={() => { setEndsAt(Date.now() + minutes * 60_000); setNow(Date.now()); }}>Start {minutes} min timer</button>
        : <button type="button" className="mini" onClick={() => setEndsAt(null)}>{done ? "Reset" : "Stop"}</button>}
    </div>
  );
}

function CookMode({ recipe: r, servings, step, onStep, onExit, onDone }: {
  recipe: Recipe; servings: number; step: number; onStep: (n: number) => void; onExit: () => void; onDone: () => void;
}) {
  useWakeLock();
  const s = r.steps[step];
  const last = step === r.steps.length - 1;
  const uses = (s.uses ?? []).map((k) => r.ingredients.find((i) => i.k === k)!).filter(Boolean);
  return (
    <section className="panel cook" aria-labelledby="cook-h">
      <div className="top">
        <button type="button" className="link small" onClick={onExit}>← Ingredients</button>
        <span className="eyebrow">Step {step + 1} of {r.steps.length}</span>
      </div>
      <div className="bar" aria-hidden="true"><div style={{ width: `${((step + 1) / r.steps.length) * 100}%` }} /></div>
      <h2 id="cook-h" className="sr-only">{r.title}</h2>
      <p className="step-text">{s.text}</p>
      {uses.length > 0 && (
        <div className="chips">
          {uses.map((i) => <span key={i.k} className="chip ing-chip">{i.name} · {formatAmount(scaled(i, r.serves, servings), i.unit, i.label)}</span>)}
        </div>
      )}
      {s.timer && <Timer key={step} minutes={s.timer} label={`Timer for step ${step + 1}`} />}
      <div className="cook-nav">
        <button type="button" className="btn ghost" disabled={step === 0} onClick={() => onStep(step - 1)}>Back</button>
        {last ? <button type="button" className="btn" onClick={onDone}>I cooked it</button>
          : <button type="button" className="btn" onClick={() => onStep(step + 1)}>Next step</button>}
      </div>
      <p className="muted small">Your screen stays on while you cook.</p>
    </section>
  );
}

// ── I cooked it ─────────────────────────────────────────────────────────────

function Cooked({ recipe: r, servings, check, onFinish }: {
  recipe: Recipe; servings: number; check: Check; onFinish: (text: string, undo?: () => Promise<void>) => void;
}) {
  const [rows, setRows] = useState(() => deductions(check).map((d) => ({ ...d, on: d.amount > 0 })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save(update: boolean) {
    setBusy(true); setErr("");
    const db = supabase();
    const events = update ? rows.filter((x) => x.on && x.amount > 0).map((x) => ({
      item_id: x.item.id, kind: "used", delta: -x.amount, note: `cooked: ${r.title}`, ref: `recipe:${r.id}`,
    })) : [];
    if (events.length) {
      const { error } = await db.rpc("apply_pantry_events", { p_events: events });
      if (error) { setBusy(false); setErr("Couldn't update your fridge. Try again."); return; }
    }
    const { data: cook } = await db.from("cooks").insert({ recipe_id: r.id, title: r.title, servings, events }).select("id").maybeSingle();
    setBusy(false);
    const undo = async () => {
      if (events.length) {
        await db.rpc("apply_pantry_events", { p_events: events.map((e) => ({ ...e, kind: "adjusted", delta: -e.delta, note: `undo: ${e.note}` })) });
      }
      if (cook?.id) await db.from("cooks").delete().eq("id", cook.id);
    };
    onFinish(events.length ? `Nice. ${r.title} logged and ${events.length} item${events.length === 1 ? "" : "s"} taken off your fridge.` : `Nice. ${r.title} logged.`, undo);
  }

  return (
    <section className="panel" aria-labelledby="done-h">
      <h2 id="done-h">Enjoy it 🍽️</h2>
      <p className="muted">About {r.protein * servings} g protein across {servings} serving{servings === 1 ? "" : "s"}.</p>
      {rows.length > 0 ? (
        <>
          <div className="block">
            <h3>Take these off your fridge?</h3>
            <div className="items">
              {rows.map((x, i) => {
                const step = x.item.unit === "g" ? 50 : x.item.unit === "ml" ? 50 : x.item.unit === "pack" ? 0.5 : 1;
                const set = (amount: number) => setRows((all) => all.map((y, j) => j === i ? { ...y, amount: Math.max(0, Math.min(y.item.qty, Math.round(amount * 10) / 10)), on: true } : y));
                return (
                  <div key={x.item.id} className={"item" + (x.on ? "" : " excluded")}>
                    <label className="change">
                      <input type="checkbox" checked={x.on} onChange={() => setRows((all) => all.map((y, j) => j === i ? { ...y, on: !y.on } : y))} />
                      <span className="name">{x.item.name}</span>
                    </label>
                    <div className="stepper" role="group" aria-label={`Amount of ${x.item.name} used`}>
                      <button type="button" className="mini" aria-label="Less" onClick={() => set(x.amount - step)}>−</button>
                      <span className="qty">{formatQty(x.amount, x.item.unit, x.item.unit_label)}</span>
                      <button type="button" className="mini" aria-label="More" onClick={() => set(x.amount + step)}>+</button>
                      <span className="muted small">of {formatQty(x.item.qty, x.item.unit, x.item.unit_label)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {err && <div className="status err" role="alert">{err}</div>}
          <button type="button" className="btn full" disabled={busy} onClick={() => save(true)}>{busy ? "Updating…" : "Update my fridge"}</button>
          <button type="button" className="btn ghost full" disabled={busy} onClick={() => save(false)}>Just log it</button>
        </>
      ) : (
        <button type="button" className="btn full" disabled={busy} onClick={() => save(false)}>Log it</button>
      )}
    </section>
  );
}
