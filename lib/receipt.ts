// Receipt reading: the prompt, the expected shape, and tolerant parsing of the model's reply.
// Self-contained (only imports zod) so it can be unit-tested with plain Node.
import { z } from "zod";
import { fromArray, type Nutrition } from "./nutrition.ts";

export const PROMPT_VERSION = "v3";

export const CATEGORIES = [
  "meat", "fish", "dairy", "eggs", "veg", "fruit", "bakery", "grains_pasta", "pulses_dried",
  "frozen", "tins_jars", "condiments", "snacks_treats", "drinks", "non_food",
] as const;
export type Category = (typeof CATEGORIES)[number];

export function receiptPrompt(today: string): string {
  return `You are reading a photo of a UK supermarket receipt for a meal-planning app. Today is ${today}. Extract every purchased product line.

Rules:
- One item per distinct product. If the same product appears on several lines, merge them and set qty to the count.
- Expand abbreviations into the product name a shopper would recognise ("LARGE VINE" -> "Vine tomatoes, large"). Names cut short by the till: give your best guess and set confidence "low".
- Generic till keys that do not name a product ("GROCERY NON VAT", "MISC", "DEPT 3", "HARDWARE" and similar): name them as printed, set needs_input true and confidence "low". Never invent a product for them.
- Apply discount, multibuy and price-cut lines to their item. Never list them as items.
- is_food false for flowers, cleaning, toiletries, bags, homeware and generic non-food keys. A VAT code unlike most lines is only a hint.
- Ignore payment, card, terminal, loyalty, change and VAT summary lines. Never output card numbers or merchant or terminal IDs.
- pack: copy the printed size ("1KG", "4PT", "7PK"); otherwise the usual pack for that store with pack_est true; null if unknown.
- units: how many countable pieces one pack holds when people count them (eggs, slices, fillets, tins, rolls, bananas, bars), with unit as the singular noun ("slice", "egg"). Null for things measured by weight or volume (rice, milk, spinach).
- Category pulses_dried for dried beans, lentils, chickpeas and split peas; tins_jars only for tinned or jarred goods.
- storage: "fridge", "freezer", "cupboard" or "counter". keeps: unopened shelf life at home, one of "1-2 days", "3-5 days", "1 week", "1-2 weeks", "2-4 weeks", "months", or "use-by on pack" for raw meat, raw fish and chilled ready food.
- protein: estimated total grams of protein in everything bought on that line (all units), typical UK values; null when negligible.
- n: for food only, typical UK nutrition per 100 g (per 100 ml for drinks and milk) as [fat, saturates, sugars, salt, fibre] in grams, e.g. [3.6,2.3,4.7,0.1,0]; null for non-food and generic keys.
- conf: "high" clear and certain; "medium" name or size inferred; "low" hard to read or a guess.
- note: only when something needs flagging, under 12 words; otherwise null.
- If the year is hard to read, assume the most recent date not after today.
- Do not invent lines you cannot see. If part of the receipt is cut off, folded or blurred, say so in warnings.

Reply with only minified JSON (no spaces or line breaks between tokens) in exactly this shape:
{"store":string|null,"branch":string|null,"date":"YYYY-MM-DD"|null,"total":number|null,"items":[{"raw":string,"name":string,"cat":${CATEGORIES.map((c) => `"${c}"`).join("|")},"qty":number,"pack":string|null,"pack_est":boolean,"units":number|null,"unit":string|null,"price":number,"food":boolean,"needs_input":boolean,"storage":string,"keeps":string,"protein":number|null,"n":[number,number,number,number,number]|null,"conf":"high"|"medium"|"low","note":string|null}],"warnings":[string]}`;
}

const num = z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/[£,]/g, "")) : v), z.number().finite());
const nullableNum = z.preprocess((v) => (v === "" || v === undefined ? null : v), num.nullable()).catch(null);
const nullableStr = z.string().max(300).nullable().catch(null);

// Wire format from the model (short keys) -> the app's item shape.
const WireItem = z.object({
  raw: z.string().max(200).catch(""),
  name: z.string().min(1).max(200).catch("Unknown item"),
  cat: z.enum(CATEGORIES).catch("snacks_treats"),
  qty: num.pipe(z.number().int().min(1).max(99)).catch(1),
  pack: nullableStr,
  pack_est: z.boolean().catch(true),
  units: nullableNum,
  unit: nullableStr,
  price: num.pipe(z.number().min(-500).max(500)).catch(0),
  food: z.boolean().catch(true),
  needs_input: z.boolean().catch(false),
  storage: z.enum(["fridge", "freezer", "cupboard", "counter"]).catch("cupboard"),
  keeps: z.string().max(40).catch("unknown"),
  protein: nullableNum,
  n: z.array(z.coerce.number()).length(5).nullable().catch(null),
  conf: z.enum(["high", "medium", "low"]).catch("low"),
  note: nullableStr,
});

const WireReceipt = z.object({
  store: nullableStr,
  branch: nullableStr,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  total: nullableNum,
  items: z.array(WireItem).max(200),
  warnings: z.array(z.string().max(300)).max(20).catch([]),
});

export type ReceiptItem = {
  raw: string;
  name: string;
  category: Category;
  qty: number;
  pack_size: string | null;
  pack_size_estimated: boolean;
  units_per_pack: number | null;
  unit_name: string | null;
  line_total: number;
  is_food: boolean;
  needs_input: boolean;
  storage: "fridge" | "freezer" | "cupboard" | "counter";
  keeps: string;
  protein_g: number | null;
  nutrition: Nutrition | null;
  confidence: "high" | "medium" | "low";
  note: string | null;
  source: "model" | "map" | "user";
};

export type Receipt = {
  store: string | null;
  branch: string | null;
  date: string | null;
  receipt_total: number | null;
  items: ReceiptItem[];
  warnings: string[];
};

/** Pull one JSON object out of the model's reply (bare, fenced, or with a sentence around it). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in reply");
  return JSON.parse(candidate.slice(start, end + 1));
}

export function parseReceiptReply(text: string): Receipt {
  const w = WireReceipt.parse(extractJson(text));
  return {
    store: w.store,
    branch: w.branch,
    date: w.date,
    receipt_total: w.total,
    warnings: w.warnings,
    items: w.items.map((i) => ({
      raw: i.raw,
      name: i.name,
      category: i.cat,
      qty: i.qty,
      pack_size: i.pack,
      pack_size_estimated: i.pack_est,
      units_per_pack: i.units,
      unit_name: i.unit,
      line_total: i.price,
      is_food: i.food,
      needs_input: i.needs_input,
      storage: i.storage,
      keeps: i.keeps,
      protein_g: i.protein,
      nutrition: i.food ? fromArray(i.n) : null,
      confidence: i.conf,
      note: i.note,
      source: "model",
    })),
  };
}

/** Store key used by the product map: "ALDI STORES" -> "aldi", "Sainsbury's Local" -> "sainsburys". */
export function storeKey(store: string | null | undefined): string {
  const first = (store ?? "").toLowerCase().replace(/[’']/g, "").trim().split(/\s+/)[0] ?? "";
  return first.replace(/[^a-z0-9&]/g, "") || "unknown";
}

/** Receipt-line key used by the product map: trimmed, upper case, single spaces. */
export function rawKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

export type MapRow = {
  raw: string; name: string; category: string; is_food: boolean;
  pack_size: string | null; units_per_pack: number | null; unit_name: string | null;
};

/** Overlay known products from the shared map onto the model's reading. */
export function applyProductMap(r: Receipt, rows: MapRow[]): Receipt {
  const byRaw = new Map(rows.map((m) => [rawKey(m.raw), m]));
  return {
    ...r,
    items: r.items.map((it) => {
      const m = byRaw.get(rawKey(it.raw));
      if (!m) return it;
      const category = (CATEGORIES as readonly string[]).includes(m.category) ? (m.category as Category) : it.category;
      return {
        ...it,
        name: m.name,
        category,
        is_food: m.is_food,
        pack_size: m.pack_size ?? it.pack_size,
        units_per_pack: m.units_per_pack ?? it.units_per_pack,
        unit_name: m.unit_name ?? it.unit_name,
        needs_input: false,
        confidence: "high",
        note: null,
        source: "map",
      };
    }),
  };
}

export function sumOfLines(r: Pick<Receipt, "items">): number {
  return Math.round(r.items.reduce((a, it) => a + it.line_total, 0) * 100) / 100;
}

/** null when the receipt shows no total; otherwise the gap in pounds (0 = matches). */
export function totalGap(r: Receipt): number | null {
  if (r.receipt_total == null) return null;
  return Math.round(Math.abs(r.receipt_total - sumOfLines(r)) * 100) / 100;
}

export type Verdict = "right" | "wrong" | null;

export function accuracy(verdicts: Verdict[], missed: number): number | null {
  const right = verdicts.filter((v) => v === "right").length;
  const marked = verdicts.filter((v) => v !== null).length;
  if (marked === 0) return null;
  return right / (marked + Math.max(0, missed));
}
