import { logPrompt, resolveLog, type StockLine } from "@/lib/log";
import type { Unit } from "@/lib/pantry";
import { askClaude, fail, gate } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Reads a free-text note against the user's own fridge (RLS) and returns proposed changes.
// Nothing is written here: the app shows the changes and applies them only when the user confirms.
export async function POST(req: Request) {
  const g = await gate(req);
  if (g instanceof Response) return g;

  let body: { note?: string } = {};
  try { body = await req.json(); } catch { return fail(400, "Send JSON with a note."); }
  const note = (body.note ?? "").trim();
  if (note.length < 3) return fail(400, "Write what you used, cooked or binned.");
  if (note.length > 1500) return fail(400, "That note is too long. Keep it to a few sentences.");

  const { data, error } = await g.db.from("pantry_items")
    .select("id,name,qty,unit,unit_label").eq("status", "active").gt("qty", 0)
    .order("use_by", { ascending: true, nullsFirst: false }).limit(150);
  if (error) return fail(500, "Couldn't load your fridge.");
  const stock: StockLine[] = (data ?? []).map((s, i) => ({
    code: `F${i + 1}`, id: s.id, name: s.name, qty: Number(s.qty), unit: s.unit as Unit, unit_label: s.unit_label,
  }));

  const res = await askClaude(logPrompt(note, stock, new Date().toISOString().slice(0, 10)), 4000);
  if (res instanceof Response) return res;
  try {
    return Response.json(resolveLog(res.text, stock));
  } catch (e) {
    console.error("Unparseable log", e instanceof Error ? e.message : e, res.text.slice(0, 300));
    return fail(502, "Couldn't make sense of that. Try saying it a different way.");
  }
}
