"use client";
import { useState } from "react";
import type { Plan } from "@/lib/plan";
import { money, supabase } from "@/lib/browser";
import { DAILY, dayWarnings } from "@/lib/nutrition";

type Cooked = Record<string, string>;

export function PlanView({ plan, target, planId, cooked: cookedIn, onCooked }: {
  plan: Plan; target: number; planId?: string; cooked?: Cooked; onCooked?: () => void;
}) {
  const [day, setDay] = useState(0);
  const [cooked, setCooked] = useState<Cooked>(cookedIn ?? {});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [cookMsg, setCookMsg] = useState("");

  async function cook(key: string, undo: boolean) {
    if (!planId || planId === "new") return;
    setBusyKey(key);
    setCookMsg("");
    const { data, error } = await supabase().rpc("cook_meal", { p_plan: planId, p_key: key, p_undo: undo });
    setBusyKey(null);
    if (error) { setCookMsg("Couldn't update your fridge. Try again."); return; }
    setCooked((data ?? {}) as Cooked);
    onCooked?.();
  }
  const d = plan.days[Math.min(day, plan.days.length - 1)];
  const avgCost = plan.days.length ? plan.days.reduce((a, x) => a + x.cost_gbp, 0) / Math.max(1, plan.days.reduce((a, x) => a + x.meals.length, 0)) : 0;
  const daysHit = plan.days.filter((x) => x.protein_g >= target * 0.95).length;

  return (
    <section className="panel" aria-labelledby="plan-h">
      <h2 id="plan-h">Your week</h2>
      {plan.summary && <p>{plan.summary}</p>}
      <div className="stats three">
        <div className="stat"><b>{daysHit}/{plan.days.length}</b><span>days on target</span></div>
        <div className="stat"><b>{money(avgCost)}</b><span>avg per meal</span></div>
        <div className="stat"><b>{plan.prep.reduce((a, p) => a + p.minutes, 0)} min</b><span>prep this week</span></div>
      </div>

      {plan.use_first.length > 0 && (
        <div className="block">
          <h3>Use first</h3>
          <ul className="list">
            {plan.use_first.map((u, i) => (
              <li key={i}><span className="pill-tag">{u.by}</span> <b>{u.item}</b>: {u.action}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="block">
        <h3>Meals</h3>
        <div className="tabs" role="tablist" aria-label="Day">
          {plan.days.map((x, i) => (
            <button key={i} role="tab" type="button" aria-selected={i === day} className={"tab" + (i === day ? " on" : "")} onClick={() => setDay(i)}>
              {x.day.split(" ")[0]}
            </button>
          ))}
        </div>
        {d && (
          <div role="tabpanel" className="stack">
            {d.meals.map((m, i) => {
              const key = `${day}-${i}`;
              const done = Boolean(cooked[key]);
              return (
              <article key={i} className={"meal" + (done ? " done" : "")}>
                <div className="top">
                  <span className="eyebrow">{m.slot}{m.from_prep ? " · prepped" : m.minutes ? ` · ${m.minutes} min` : ""}</span>
                  <span className="muted small">{Math.round(m.protein_g)} g protein{m.fibre_g ? ` · ${Math.round(m.fibre_g)} g fibre` : ""} · {money(m.cost_gbp)}</span>
                </div>
                <div className="name">{m.name}</div>
                {m.amounts && <p className="muted small">{m.amounts}</p>}
                {planId && planId !== "new" && (m.uses ?? []).length > 0 && (
                  done ? (
                    <div className="cooked-row">
                      <span className="cooked-tag">Cooked · fridge updated</span>
                      <button type="button" className="link small" disabled={busyKey === key} onClick={() => cook(key, true)}>Undo</button>
                    </div>
                  ) : (
                    <button type="button" className="btn ghost cook-btn" disabled={busyKey === key} onClick={() => cook(key, false)}>
                      {busyKey === key ? "Updating…" : "Cooked it"}
                    </button>
                  )
                )}
              </article>
              );
            })}
            {cookMsg && <div className="status err" role="alert">{cookMsg}</div>}
            <div className="bar-row">
              <div className="top small"><span>{d.day} protein</span><span>{Math.round(d.protein_g)} / {target} g</span></div>
              <div className="bar"><div style={{ width: `${Math.min(100, (d.protein_g / target) * 100)}%` }} /></div>
              {d.gap_g > 0 && <p className="warn-text small">{Math.round(d.gap_g)} g short. See top-ups below.</p>}
              <div className="top small"><span>Fibre from these meals</span><span>{Math.round(d.fibre_g)} g · daily guide {DAILY.fibre} g</span></div>
              <div className="bar fibre"><div style={{ width: `${Math.min(100, (d.fibre_g / DAILY.fibre) * 100)}%` }} /></div>
              {dayWarnings(d).map((w) => <p key={w} className="warn-text small">{w}</p>)}
            </div>
          </div>
        )}
      </div>

      {plan.prep.map((p, i) => (
        <div className="block" key={i}>
          <h3>{p.day} prep · about {p.minutes} min</h3>
          <ol className="steps">{p.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
        </div>
      ))}

      {plan.top_up.length > 0 && (
        <div className="block">
          <h3>Top-ups to buy</h3>
          <ul className="list">{plan.top_up.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      {plan.leftover.length > 0 && (
        <div className="block">
          <h3>Left for next week</h3>
          <p className="muted small">{plan.leftover.join(" · ")}</p>
        </div>
      )}
      {plan.notes.length > 0 && <ul className="list muted small">{plan.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <p className="muted small">Shelf lives and nutrition are typical estimates, not your pack&apos;s label. The use-by date on the pack always wins.</p>
    </section>
  );
}
