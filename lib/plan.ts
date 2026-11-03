// Week plan: settings, the prompt that turns a pantry into a workweek of meals, and the plan's shape.
import { z } from "zod";
import { extractJson } from "./receipt.ts";

export const PLAN_PROMPT_VERSION = "p4";
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MEALS = ["breakfast", "lunch", "snack", "dinner"] as const;

/** Staples people keep at home, grouped for tapping in Settings. */
export const AT_HOME_GROUPS: { label: string; items: string[] }[] = [
  { label: "Carbs", items: ["Rice", "Pasta", "Oats", "Bread", "Potatoes", "Atta / flour", "Noodles", "Wraps"] },
  { label: "Protein", items: ["Eggs", "Tinned tuna", "Lentils", "Chickpeas", "Beans", "Peanut butter", "Protein powder"] },
  { label: "Dairy", items: ["Milk", "Yogurt", "Cheese", "Butter"] },
  { label: "Cooking", items: ["Cooking oil", "Olive oil", "Ghee", "Salt & pepper", "Stock cubes"] },
  { label: "Flavour", items: ["Onions", "Garlic", "Ginger", "Chilli", "Spices", "Soy sauce", "Tomato puree", "Tinned tomatoes", "Honey"] },
  { label: "Freezer", items: ["Frozen veg", "Frozen chicken", "Frozen fish"] },
];
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
  at_home_items: z.array(z.string().max(40)).max(80).catch([]),
  at_home: z.string().max(300).catch(""),
  avoid: z.string().max(300).catch(""),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

export function atHomeText(s: Pick<Settings, "at_home_items" | "at_home">): string {
  return [...s.at_home_items, ...s.at_home.split(",").map((x) => x.trim()).filter(Boolean)].join(", ");
}

/** One fridge item as the planner sees it. `code` (F1, F2…) is how meals refer back to it. */
export type FridgeLine = {
  code: string;
  name: string;
  category: string | null;
  storage: string;
  amount: string;      // "800 g", "6 eggs"
  unit: string;        // unit the planner must use in `uses`: g, ml, piece, pack
  qty: number;
  use_by: string | null;
  cost_per_unit: number | null;
  protein_per_unit: number | null;
  per100: string | null;
};

export function planPrompt(items: FridgeLine[], s: Settings, today: string, startDay: string): string {
  const lines = items.map((i) =>
    `${i.code}. ${i.name} | ${i.amount} left (unit: ${i.unit}) | ${i.storage}${i.use_by ? `, use by ${i.use_by}` : ""}${i.category ? ` | ${i.category}` : ""}${i.cost_per_unit != null ? ` | £${i.cost_per_unit.toFixed(4)} per ${i.unit}` : ""}${i.protein_per_unit != null ? ` | ${i.protein_per_unit.toFixed(3)} g protein per ${i.unit}` : ""}${i.per100 ? ` | per 100 g: ${i.per100}` : ""}`,
  ).join("\n");

  return `You plan a UK office worker's weekday meals from what is in their fridge, freezer and cupboard right now. They go to the gym and want to hit a protein target with as little thinking and cooking time as possible.

Today: ${today}. Plan starts: ${startDay}.
Daily protein target: ${s.protein_g} g.
Days to plan: ${s.plan_days.join(", ")}.
Meals to plan each day: ${s.meals.join(", ")}.
Batch-prep days: ${s.prep_days.length ? s.prep_days.join(", ") : "none (cook each meal fresh)"}.
Staples at home, amounts unknown (use freely, cost £0): ${atHomeText(s) || "salt, pepper, cooking oil"}.
Avoid: ${s.avoid || "nothing stated"}.

In stock (code. name | amount left | where, estimated use-by | category | cost | protein | nutrition):
${lines}

Rules:
- Use only the stock listed plus the staples. Never plan more of an item than is left. Use whatever is closest to its use-by first; freeze raw meat or fish on the first prep day if it can't be cooked by its use-by.
- Food safety (UK FSA): raw meat and fish are cooked or frozen by their use-by; cooked leftovers are eaten within 2 days of cooking; cooked rice within 24 hours or frozen once cool; thawing happens in the fridge overnight. Plan prep sessions so every prepped portion is eaten in time. Never tell them to rely on smell or a guess.
- Lunches are boxed and portable (cooked on a prep day or the night before). Weekday dinners take 20 minutes or less of active work.
- For every meal list uses: each stock item it eats, by code, with qty in that item's unit (grams for g, millilitres for ml, a count for piece or pack). Count only that meal's portion, not the whole batch it was prepped in. Staples are not listed in uses.
- amounts is the same thing for a person to read, one short line ("200 g chicken breast, 150 g rice, 2 eggs").
- protein_g and cost_gbp per meal come from the per-unit figures times the qty used; staples count £0.
- Nutrition: estimate fibre_g for each meal, and for each day the totals of fibre_g, fat_g, sat_fat_g, sugar_g and salt_g across the planned meals, from the per-100 g values (typical UK values for staples). Prefer swaps that add fibre (veg, pulses, oats, wholegrain) when the stock allows.
- If the stock can't reach the protein target on a day, say so in that day's gap_g and suggest the cheapest top-up in top_up.
- List items not used this week in leftover.
- Be brief, the screen is a phone: summary one sentence; meal names under 7 words; prep steps under 18 words, at most 8 per session; use_first at most 6 most urgent items; top_up at most 3; leftover names only; notes at most 2.

Reply with only minified JSON in exactly this shape:
{"summary":string,"use_first":[{"item":string,"by":string,"action":string}],"prep":[{"day":string,"minutes":number,"steps":[string]}],"days":[{"day":string,"meals":[{"slot":string,"name":string,"amounts":string,"uses":[{"f":string,"qty":number}],"protein_g":number,"fibre_g":number,"cost_gbp":number,"minutes":number,"from_prep":boolean}],"protein_g":number,"fibre_g":number,"fat_g":number,"sat_fat_g":number,"sugar_g":number,"salt_g":number,"cost_gbp":number,"gap_g":number}],"top_up":[string],"leftover":[string],"notes":[string]}`;
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
      uses: z.array(z.object({ f: z.string().max(8).optional(), pantry_id: z.string().max(40).optional(), qty: n, name: z.string().max(200).optional() }))
        .max(15).catch([]),
      protein_g: n, fibre_g: n, cost_gbp: n, minutes: n, from_prep: z.boolean().catch(false),
    })).max(6),
    protein_g: n, fibre_g: n, fat_g: n, sat_fat_g: n, sugar_g: n, salt_g: n, cost_gbp: n, gap_g: n,
  })).min(1).max(7),
  top_up: z.array(s(160)).max(12).catch([]),
  leftover: z.array(s(160)).max(40).catch([]),
  notes: z.array(s(240)).max(10).catch([]),
});
export type Plan = z.infer<typeof PlanSchema>;

export function parsePlanReply(text: string): Plan {
  return PlanSchema.parse(extractJson(text));
}

/** The first planned weekday after `from` (or from `from` itself when includeSameDay). */
export function startDayAfter(shopDate: Date, planDays: readonly string[], includeSameDay = false): string {
  for (let i = includeSameDay ? 0 : 1; i <= 7; i++) {
    const d = new Date(shopDate);
    d.setDate(d.getDate() + i);
    const name = WEEKDAYS[(d.getDay() + 6) % 7];
    if (planDays.includes(name)) return `${name} ${d.toISOString().slice(0, 10)}`;
  }
  return "Mon";
}

/**
 * Replace the planner's F-codes with real pantry ids, drop codes it invented, and cap each
 * use at what is in stock so "Cooked it" can never subtract more than the fridge holds.
 */
export function resolveUses(plan: Plan, items: { code: string; id: string; name: string; qty: number }[]): Plan {
  const byCode = new Map(items.map((i) => [i.code.toUpperCase(), i]));
  return {
    ...plan,
    days: plan.days.map((d) => ({
      ...d,
      meals: d.meals.map((m) => ({
        ...m,
        uses: m.uses.flatMap((u) => {
          const it = u.f ? byCode.get(u.f.trim().toUpperCase()) : undefined;
          if (!it || !(u.qty > 0)) return [];
          return [{ pantry_id: it.id, name: it.name, qty: Math.min(Math.round(u.qty * 10) / 10, it.qty) }];
        }),
      })),
    })),
  };
}
