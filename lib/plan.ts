// Week plan: settings, the prompt that turns a pantry into a workweek of meals, and the plan's shape.
import { z } from "zod";
import { extractJson, type ReceiptItem } from "./receipt.ts";

export const PLAN_PROMPT_VERSION = "p2";
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MEALS = ["breakfast", "lunch", "snack", "dinner"] as const;
type Weekday = (typeof WEEKDAYS)[number];

/** Mon..Sun order, no duplicates, whatever order the days were tapped in. */
export function inWeekOrder(days: Weekday[]): Weekday[] {
  return WEEKDAYS.filter((d) => days.includes(d));
}

export const SettingsSchema = z.object({
  protein_g: z.coerce.number().int().min(40).max(400).catch(150),
  budget_gbp: z.coerce.number().min(0).max(500).nullable().catch(null),
  prep_days: z.array(z.enum(WEEKDAYS)).max(7).transform(inWeekOrder).catch(["Sun", "Wed"]),
  meals: z.array(z.enum(MEALS)).min(1).max(4).catch(["lunch", "dinner"]),
  plan_days: z.array(z.enum(WEEKDAYS)).min(1).max(7).transform(inWeekOrder).catch(["Mon", "Tue", "Wed", "Thu", "Fri"]),
  at_home: z.string().max(300).catch(""),
  avoid: z.string().max(300).catch(""),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export type PantryLine = Pick<ReceiptItem,
  "name" | "category" | "qty" | "pack_size" | "units_per_pack" | "unit_name" | "line_total" | "storage" | "keeps" | "protein_g">;

export function planPrompt(items: PantryLine[], s: Settings, shopDate: string, startDay: string): string {
  const lines = items.map((i, n) =>
    `${n + 1}. ${i.name} | qty ${i.qty}${i.pack_size ? ` x ${i.pack_size}` : ""}${i.units_per_pack ? ` (~${i.units_per_pack} ${i.unit_name ?? "units"} each)` : ""} | £${i.line_total.toFixed(2)} | ${i.category} | ${i.storage}, keeps ${i.keeps}${i.protein_g != null ? ` | ~${Math.round(i.protein_g)} g protein total` : ""}`,
  ).join("\n");

  return `You plan a UK office worker's weekday meals from the food they just bought. They go to the gym and want to hit a protein target with as little thinking and cooking time as possible.

Shop date: ${shopDate}. Plan starts: ${startDay}.
Daily protein target: ${s.protein_g} g.
Days to plan: ${s.plan_days.join(", ")}.
Meals to plan each day: ${s.meals.join(", ")}.
Batch-prep days: ${s.prep_days.length ? s.prep_days.join(", ") : "none (cook each meal fresh)"}.
Already at home (use freely, cost £0): ${s.at_home || "salt, pepper, cooking oil"}.
Avoid: ${s.avoid || "nothing stated"}.

Food bought:
${lines}

Rules:
- Use only the food bought plus what is at home. Use perishables first: anything that keeps "1-2 days", "3-5 days" or "use-by on pack" goes early in the week or is frozen on the first prep day.
- Food safety (UK FSA): raw meat and fish are cooked or frozen by their use-by; cooked leftovers are eaten within 2 days of cooking; cooked rice within 24 hours or frozen once cool; thawing happens in the fridge overnight. Plan prep sessions so every prepped portion is eaten in time. Never tell them to rely on smell or a guess.
- Lunches are boxed and portable (cooked on a prep day or the night before). Weekday dinners take 20 minutes or less of active work.
- Count protein only for the amounts eaten in each meal, not whole packs. Give amounts in grams or simple units ("200 g chicken breast", "2 eggs", "half the pack").
- cost_gbp per meal is the share of the purchase price used; at-home items count £0.
- If the food can't reach the protein target on a day, say so in that day's gap_g and suggest the cheapest top-up in top_up.
- Leave unused items alone; list anything bought but not used this week in leftover.
- Be brief, the screen is a phone: summary one sentence; meal names under 7 words; amounts one short line per meal; prep steps under 18 words, at most 8 per session; use_first at most 6 most urgent items; top_up at most 3; leftover names only; notes at most 2.

Reply with only minified JSON in exactly this shape:
{"summary":string,"use_first":[{"item":string,"by":string,"action":string}],"prep":[{"day":string,"minutes":number,"steps":[string]}],"days":[{"day":string,"meals":[{"slot":string,"name":string,"amounts":string,"protein_g":number,"cost_gbp":number,"minutes":number,"from_prep":boolean}],"protein_g":number,"cost_gbp":number,"gap_g":number}],"top_up":[string],"leftover":[string],"notes":[string]}`;
}

const n = z.coerce.number().finite().catch(0);
const s = (max: number) => z.string().max(max).catch("");
const PlanSchema = z.object({
  summary: s(400),
  use_first: z.array(z.object({ item: s(120), by: s(40), action: s(160) })).max(40).catch([]),
  prep: z.array(z.object({ day: s(20), minutes: n, steps: z.array(s(240)).max(20).catch([]) })).max(7).catch([]),
  days: z.array(z.object({
    day: s(20),
    meals: z.array(z.object({
      slot: s(20), name: s(120),
      amounts: z.union([z.string().max(300), z.array(z.string().max(120)).max(12).transform((a) => a.join(" · "))]).catch(""),
      protein_g: n, cost_gbp: n, minutes: n, from_prep: z.boolean().catch(false),
    })).max(6),
    protein_g: n, cost_gbp: n, gap_g: n,
  })).min(1).max(7),
  top_up: z.array(s(160)).max(12).catch([]),
  leftover: z.array(s(160)).max(40).catch([]),
  notes: z.array(s(240)).max(10).catch([]),
});
export type Plan = z.infer<typeof PlanSchema>;

export function parsePlanReply(text: string): Plan {
  return PlanSchema.parse(extractJson(text));
}

/** The weekday the plan starts on: the first planned day on or after the day after the shop. */
export function startDayAfter(shopDate: Date, planDays: readonly string[]): string {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(shopDate);
    d.setDate(d.getDate() + i);
    const name = WEEKDAYS[(d.getDay() + 6) % 7];
    if (planDays.includes(name)) return `${name} ${d.toISOString().slice(0, 10)}`;
  }
  return "Mon";
}
