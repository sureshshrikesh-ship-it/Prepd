"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, MEALS, SettingsSchema, WEEKDAYS, type Settings } from "@/lib/plan";
import { getPasscode, setPasscode, supabase } from "@/lib/browser";

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function SettingsPanel({ userId, onSaved }: { userId: string; onSaved?: (s: Settings) => void }) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [pass, setPass] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setPass(getPasscode());
    supabase().from("user_settings").select("*").maybeSingle().then(({ data }) => {
      if (data) setS(SettingsSchema.parse(data));
    });
  }, []);

  async function save() {
    setPasscode(pass);
    setMsg("Saving…");
    const clean = SettingsSchema.parse(s);
    const { error } = await supabase().from("user_settings").upsert({ user_id: userId, ...clean, updated_at: new Date().toISOString() });
    setMsg(error ? "Couldn't save. Try again." : "Saved.");
    if (!error) onSaved?.(clean);
  }

  return (
    <section className="panel" aria-labelledby="set-h">
      <h2 id="set-h">Your week</h2>
      <div className="grid2">
        <label className="field" htmlFor="protein">Protein per day (g)
          <input id="protein" type="number" inputMode="numeric" min={40} max={400} value={s.protein_g}
            onChange={(e) => setS({ ...s, protein_g: Number(e.target.value) })} />
        </label>
        <label className="field" htmlFor="pass">Test passcode
          <input id="pass" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
        </label>
      </div>

      <fieldset className="field">
        <legend>Days to plan</legend>
        <div className="pills">
          {WEEKDAYS.map((d) => (
            <button key={d} type="button" className={"pill" + (s.plan_days.includes(d) ? " on" : "")} aria-pressed={s.plan_days.includes(d)}
              onClick={() => setS({ ...s, plan_days: toggle(s.plan_days, d) })}>{d}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Prep days</legend>
        <div className="pills">
          {WEEKDAYS.map((d) => (
            <button key={d} type="button" className={"pill" + (s.prep_days.includes(d) ? " on" : "")} aria-pressed={s.prep_days.includes(d)}
              onClick={() => setS({ ...s, prep_days: toggle(s.prep_days, d) })}>{d}</button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Meals to plan</legend>
        <div className="pills">
          {MEALS.map((m) => (
            <button key={m} type="button" className={"pill" + (s.meals.includes(m) ? " on" : "")} aria-pressed={s.meals.includes(m)}
              onClick={() => setS({ ...s, meals: toggle(s.meals, m) })}>{m}</button>
          ))}
        </div>
      </fieldset>
      <label className="field" htmlFor="athome">Already at home
        <input id="athome" value={s.at_home} placeholder="e.g. rice, oats, spices, oil" onChange={(e) => setS({ ...s, at_home: e.target.value })} />
      </label>
      <label className="field" htmlFor="avoid">Avoid
        <input id="avoid" value={s.avoid} placeholder="e.g. pork, mushrooms" onChange={(e) => setS({ ...s, avoid: e.target.value })} />
      </label>
      <button className="btn full" type="button" onClick={save}>Save</button>
      {msg && <div className="status" role="status">{msg}</div>}
    </section>
  );
}
