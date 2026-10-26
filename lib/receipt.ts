// Receipt reading: the prompt, the expected shape, and tolerant parsing of the model's reply.
// Self-contained (only imports zod) so it can be unit-tested with plain Node.
import { z } from "zod";

export const PROMPT_VERSION = "v1";

export const RECEIPT_PROMPT = `You are reading a photo of a UK supermarket receipt for a meal-planning app. Extract every purchased product line.

Rules:
- One output item per distinct product. If the same product appears on several lines, merge them into one item and set qty to the count.
- Expand abbreviations into the plain product name a shopper would recognise (e.g. "LARGE VINE" -> "Vine tomatoes, large"; "TOM PUREE DBL CONC" -> "Tomato puree, double concentrate"). If you are unsure what the product is, give your best guess and set confidence "low".
- Apply discount, multibuy or price-cut lines to the item they belong to. Never list them as items.
- Mark non-food items (flowers, cleaning, toiletries, bags, homeware) with is_food false. On UK receipts a VAT code that differs from most lines can signal non-food; use it only as a hint.
- Ignore payment, card, terminal, loyalty, change and VAT summary lines. Never output card numbers, merchant or terminal IDs.
- pack_size: copy it if printed (e.g. "1KG", "4PT", "7PK"). Otherwise give the typical pack size for that store's product and set pack_size_estimated true. Use null if you have no idea.
- storage: where it should be kept at home: "fridge", "freezer", "cupboard" or "counter".
- keeps: typical shelf life once home, unopened: "1-2 days", "3-5 days", "1-2 weeks", "2-4 weeks" or "months". For raw meat, raw fish and chilled ready food write "use-by on pack".
- protein_g: estimated total grams of protein in everything bought on that item (all units), from typical UK values. Use null when negligible.
- confidence: "high" if the line was clear and the product is certain; "medium" if you inferred the name or size; "low" if the text was hard to read or the product is a guess.
- Do not invent lines you cannot see. If part of the receipt is cut off, folded or blurred, say so in warnings.

Reply with only JSON in exactly this shape:
{"store": string|null, "branch": string|null, "date": "YYYY-MM-DD"|null, "receipt_total": number|null,
 "items": [{"raw": string, "name": string,
   "category": "meat"|"fish"|"dairy"|"eggs"|"veg"|"fruit"|"bakery"|"grains_pasta"|"frozen"|"tins_jars"|"condiments"|"snacks_treats"|"drinks"|"non_food",
   "qty": number, "pack_size": string|null, "pack_size_estimated": boolean, "line_total": number, "is_food": boolean,
   "storage": "fridge"|"freezer"|"cupboard"|"counter", "keeps": string, "protein_g": number|null,
   "confidence": "high"|"medium"|"low", "note": string|null}],
 "warnings": [string]}`;

const CATEGORIES = [
  "meat", "fish", "dairy", "eggs", "veg", "fruit", "bakery", "grains_pasta",
  "frozen", "tins_jars", "condiments", "snacks_treats", "drinks", "non_food",
] as const;

const num = z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/[£,]/g, "")) : v), z.number().finite());
const nullableNum = z.preprocess((v) => (v === "" || v === undefined ? null : v), num.nullable()).catch(null);
const nullableStr = z.string().max(300).nullable().catch(null);

export const ItemSchema = z.object({
  raw: z.string().max(200).catch(""),
  name: z.string().min(1).max(200).catch("Unknown item"),
  category: z.enum(CATEGORIES).catch("snacks_treats"),
  qty: num.pipe(z.number().int().min(1).max(99)).catch(1),
  pack_size: nullableStr,
  pack_size_estimated: z.boolean().catch(true),
  line_total: num.pipe(z.number().min(-500).max(500)).catch(0),
  is_food: z.boolean().catch(true),
  storage: z.enum(["fridge", "freezer", "cupboard", "counter"]).catch("cupboard"),
  keeps: z.string().max(40).catch("unknown"),
  protein_g: nullableNum,
  confidence: z.enum(["high", "medium", "low"]).catch("low"),
  note: nullableStr,
});

export const ReceiptSchema = z.object({
  store: nullableStr,
  branch: nullableStr,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  receipt_total: nullableNum,
  items: z.array(ItemSchema).max(200),
  warnings: z.array(z.string().max(300)).max(20).catch([]),
});

export type ReceiptItem = z.infer<typeof ItemSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;

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
  return ReceiptSchema.parse(extractJson(text));
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
