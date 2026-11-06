// Quick log: turn "made an omelette with 3 eggs, binned the coriander" into proposed fridge changes.
// The user confirms before anything is applied, so a misread never silently changes the fridge.
import { z } from "zod";
import { extractJson } from "./receipt.ts";
import { formatQty, type Unit } from "./pantry.ts";

export const LOG_PROMPT_VERSION = "l1";

export type StockLine = { code: string; id: string; name: string; qty: number; unit: Unit; unit_label: string | null };

export function logPrompt(note: string, stock: StockLine[], today: string): string {
  const lines = stock.map((s) => `${s.code}. ${s.name} | ${formatQty(s.qty, s.unit, s.unit_label)} left | unit: ${s.unit}`).join("\n");
  return `You update a home food inventory from a short note the user typed or dictated. Today is ${today}.

Current stock (code. name | amount left | unit):
${lines || "(empty)"}

The user's note:
"""
${note}
"""

Rules:
- For each stock item the note says was eaten, cooked, used, finished or thrown away, add one change with its code.
- kind: "used" for part of an item; "finished" when it is all gone; "binned" when thrown away or gone off.
- qty: for "used", the amount in that item's unit (grams for g, millilitres for ml, a count for piece or pack). Turn vague amounts into sensible numbers: "some" or "a bit" is about a quarter of what is left, "half" is half, "a handful of spinach" is about 30 g, "a splash of milk" is about 30 ml. Never more than what is left. For "finished" and "binned" use null.
- Food the note says was bought or added goes in new_items, with a sensible unit and storage.
- Ignore anything that is not about food in this kitchen. Do not guess items that are not mentioned.
- If something mentioned matches no stock item and was not bought, put it in unclear in a few words.

Reply with only minified JSON in exactly this shape:
{"changes":[{"f":string,"kind":"used"|"finished"|"binned","qty":number|null}],"new_items":[{"name":string,"qty":number,"unit":"g"|"ml"|"piece"|"pack","unit_label":string|null,"storage":"fridge"|"freezer"|"cupboard"|"counter","keeps":"1-2 days"|"3-5 days"|"1 week"|"1-2 weeks"|"2-4 weeks"|"months"}],"unclear":[string]}`;
}

const num = z.coerce.number().finite();
const LogSchema = z.object({
  changes: z.array(z.object({
    f: z.string().max(8),
    kind: z.enum(["used", "finished", "binned"]),
    qty: num.nullable().catch(null),
  })).max(60).catch([]),
  new_items: z.array(z.object({
    name: z.string().min(1).max(200),
    qty: num.pipe(z.number().positive().max(100000)),
    unit: z.enum(["g", "ml", "piece", "pack"]).catch("pack"),
    unit_label: z.string().max(40).nullable().catch(null),
    storage: z.enum(["fridge", "freezer", "cupboard", "counter"]).catch("fridge"),
    keeps: z.string().max(20).catch("1 week"),
  })).max(30).catch([]),
  unclear: z.array(z.string().max(200)).max(10).catch([]),
});

export type ProposedChange = {
  item_id: string; name: string; kind: "used" | "finished" | "binned";
  delta: number; before: string; after: string;
};
export type ProposedLog = {
  changes: ProposedChange[];
  new_items: z.infer<typeof LogSchema>["new_items"];
  unclear: string[];
};

/** Parse the model's reply and resolve codes into concrete, capped changes the user can confirm. */
export function resolveLog(text: string, stock: StockLine[]): ProposedLog {
  const raw = LogSchema.parse(extractJson(text));
  const byCode = new Map(stock.map((s) => [s.code.toUpperCase(), s]));
  const seen = new Set<string>();
  const changes: ProposedChange[] = [];
  for (const c of raw.changes) {
    const s = byCode.get(c.f.trim().toUpperCase());
    if (!s || seen.has(s.id)) continue;
    let use: number;
    if (c.kind === "used") {
      if (!(c.qty != null && c.qty > 0)) continue;
      use = Math.min(Math.round(c.qty * 10) / 10, s.qty);
    } else use = s.qty;
    seen.add(s.id);
    const kind = c.kind === "used" && use >= s.qty ? "finished" : c.kind;
    changes.push({
      item_id: s.id, name: s.name, kind, delta: -use,
      before: formatQty(s.qty, s.unit, s.unit_label),
      after: kind === "binned" ? "binned" : formatQty(Math.max(0, s.qty - use), s.unit, s.unit_label),
    });
  }
  return { changes, new_items: raw.new_items, unclear: raw.unclear };
}
