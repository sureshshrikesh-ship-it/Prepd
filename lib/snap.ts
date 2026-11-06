// Snap your food: one photo, three kinds. A receipt goes to the receipt reader; shopping laid out
// on a table, or the inside of a fridge, becomes a list of items plus a few tap-to-answer questions
// about what the photo can't show (how many carrots in the bag, which size of pack).
import { z } from "zod";
import { CATEGORIES, extractJson } from "./receipt.ts";
import { fromArray, type Nutrition } from "./nutrition.ts";
import { asCount, formatQty, type Unit } from "./pantry.ts";

export const SNAP_PROMPT_VERSION = "s1";
export const MAX_QUESTIONS = 5;

export type StockRef = { code: string; id: string; name: string; qty: number; unit: Unit; unit_label: string | null };

export function snapPrompt(today: string, stock: StockRef[]): string {
  const lines = stock.map((s) => `${s.code}. ${s.name} | ${formatQty(s.qty, s.unit, s.unit_label)} | unit: ${s.unit}`).join("\n");
  return `You help a UK home cook keep track of the food they have. Today is ${today}. Look at the photo and decide what it shows.

- "receipt": a shop receipt or a printed or on-screen order confirmation. Reply with exactly {"kind":"receipt"} and nothing else.
- "shopping": groceries just bought, laid out on a table or counter, or in open bags.
- "fridge": the inside of a fridge, freezer or cupboard showing what is stored.
- "other": none of these (a person, a meal, a room). Reply with exactly {"kind":"other"}.

For "shopping" and "fridge", list each distinct food product you can see.
- name: what a shopper calls it, with the brand only if clearly printed ("Greek style yogurt", "Chicken thighs").
- qty and unit: count what you can see. Countable things (eggs, tins, fruit and veg such as onions, carrots, peppers, lemons) use unit "piece" with unit_label as the singular noun. Packs with a printed weight or volume use "g" or "ml" with the printed amount; otherwise "pack". Several identical packs: multiply.
- storage: "fridge", "freezer", "cupboard" or "counter". keeps: unopened shelf life, one of "1-2 days", "3-5 days", "1 week", "1-2 weeks", "2-4 weeks", "months", or "use-by on pack" for raw meat, raw fish and chilled ready food.
- protein: estimated total grams of protein in that qty; null when negligible. n: typical nutrition per 100 g as [fat, saturates, sugars, salt, fibre]; null if unsure.
- conf: "high" if clearly visible and identified, "medium" if partly hidden or the variety is a guess, "low" if unsure what it is.
- ask: when a number that matters can't be seen (how many carrots in a bag, how many thighs in an opaque pack, which of two pack sizes, whether a pot is Greek or protein yogurt), add a question. type "count" asks for a number of pieces (your qty is the starting guess). type "choice" offers 2 to 4 options, each with label, qty and unit, the likeliest first. Keep questions under 10 words. Ask at most ${MAX_QUESTIONS} questions across the whole photo, choosing the ones that matter most for protein and for food that goes off soon. Everything else: use your best guess and no question.
- Do not list non-food items, and do not invent items you cannot see.
${stock.length ? `
For "fridge" only: the user's app already tracks this stock (code. name | amount | unit):
${lines}
If an item you see is one of these, set f to its code and give qty as how much is left now, in that item's unit. Leave f null for anything new.` : ""}

Reply with only minified JSON in exactly this shape:
{"kind":"shopping"|"fridge","items":[{"name":string,"cat":${CATEGORIES.map((c) => `"${c}"`).join("|")},"qty":number,"unit":"g"|"ml"|"piece"|"pack","unit_label":string|null,"storage":string,"keeps":string,"protein":number|null,"n":[number,number,number,number,number]|null,"conf":"high"|"medium"|"low","f":string|null,"ask":null|{"q":string,"type":"count"|"choice","options":[{"label":string,"qty":number,"unit":"g"|"ml"|"piece"|"pack"}]}}],"notes":[string]}`;
}

const num = z.coerce.number().finite();
const Option = z.object({
  label: z.string().min(1).max(60),
  qty: num.pipe(z.number().positive().max(100000)),
  unit: z.enum(["g", "ml", "piece", "pack"]).catch("pack"),
});
const Ask = z.object({
  q: z.string().min(1).max(120),
  type: z.enum(["count", "choice"]),
  options: z.array(Option).max(4).catch([]),
}).nullable().catch(null);
const Item = z.object({
  name: z.string().min(1).max(200),
  cat: z.enum(CATEGORIES).catch("snacks_treats"),
  qty: num.pipe(z.number().min(0).max(100000)).catch(1),
  unit: z.enum(["g", "ml", "piece", "pack"]).catch("pack"),
  unit_label: z.string().max(40).nullable().catch(null),
  storage: z.enum(["fridge", "freezer", "cupboard", "counter"]).catch("fridge"),
  keeps: z.string().max(20).catch("1 week"),
  protein: num.nullable().catch(null),
  n: z.array(z.coerce.number()).length(5).nullable().catch(null),
  conf: z.enum(["high", "medium", "low"]).catch("medium"),
  f: z.string().max(8).nullable().catch(null),
  ask: Ask,
});
const Snap = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("receipt") }),
  z.object({ kind: z.literal("other") }),
  z.object({ kind: z.enum(["shopping", "fridge"]), items: z.array(z.unknown()).max(80), notes: z.array(z.string().max(200)).max(10).catch([]) }),
]);

export type Question =
  | { type: "count"; q: string; start: number }
  | { type: "choice"; q: string; options: { label: string; qty: number; unit: Unit }[] };

export type SnapItem = {
  name: string;
  category: string;
  qty: number;
  unit: Unit;
  unit_label: string | null;
  storage: "fridge" | "freezer" | "cupboard" | "counter";
  keeps: string;
  protein_g: number | null;
  /** protein per unit of qty, so a changed answer keeps protein in proportion */
  protein_per_unit: number | null;
  nutrition: Nutrition | null;
  confidence: "high" | "medium" | "low";
  /** Existing fridge item this updates (fridge photos only). */
  match: { id: string; name: string; before: number; unit: Unit; unit_label: string | null } | null;
  question: Question | null;
};

export type SnapResult =
  | { kind: "receipt" }
  | { kind: "other" }
  | { kind: "shopping" | "fridge"; items: SnapItem[]; notes: string[] };

/** Validate the reply, map fridge codes to real items, count produce, and keep at most 5 questions. */
export function resolveSnap(text: string, stock: StockRef[]): SnapResult {
  const top = Snap.parse(extractJson(text));
  if (top.kind === "receipt" || top.kind === "other") return top;
  const byCode = new Map(stock.map((s) => [s.code.toUpperCase(), s]));
  const used = new Set<string>();
  let asked = 0;
  const items: SnapItem[] = [];
  for (const raw of top.items) {
    const parsed = Item.safeParse(raw);
    if (!parsed.success) continue;
    const it = parsed.data;
    let { qty, unit, unit_label } = it;
    const counted = asCount(it.name, qty, unit);
    if (counted) ({ amount: qty, unit, label: unit_label } = counted);

    let match: SnapItem["match"] = null;
    if (top.kind === "fridge" && it.f) {
      const s = byCode.get(it.f.trim().toUpperCase());
      if (s && !used.has(s.id)) {
        used.add(s.id);
        match = { id: s.id, name: s.name, before: s.qty, unit: s.unit, unit_label: s.unit_label };
        unit = s.unit; unit_label = s.unit_label; // keep the tracked item's unit
      }
    }

    let question: Question | null = null;
    if (it.ask && asked < MAX_QUESTIONS) {
      if (it.ask.type === "count") {
        question = { type: "count", q: it.ask.q, start: Math.max(1, Math.round(qty)) };
        if (!match) unit = "piece";
      } else if (it.ask.options.length >= 2 && !match) {
        question = { type: "choice", q: it.ask.q, options: it.ask.options.map((o) => ({ label: o.label, qty: o.qty, unit: o.unit })) };
        qty = it.ask.options[0].qty; unit = it.ask.options[0].unit;
      }
      if (question) asked++;
    }

    items.push({
      name: it.name, category: it.cat, qty: Math.round(qty * 10) / 10, unit, unit_label, storage: it.storage, keeps: it.keeps,
      protein_g: it.protein, protein_per_unit: it.protein != null && qty > 0 ? it.protein / qty : null,
      nutrition: fromArray(it.n), confidence: it.conf, match, question,
    });
  }
  return { kind: top.kind, items, notes: top.notes };
}
