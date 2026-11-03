import { PLAN_PROMPT_VERSION, SettingsSchema, parsePlanReply, planPrompt, resolveUses, startDayAfter, type FridgeLine } from "@/lib/plan";
import { formatQty, type Unit } from "@/lib/pantry";
import { askClaude, fail, gate } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Builds a week plan from what is in the user's fridge now (their pantry), read with their own
// session so RLS applies. receiptId, when given, links the plan to the shop that triggered it.
export async function POST(req: Request) {
  const g = await gate(req);
  if (g instanceof Response) return g;

  let body: { receiptId?: string | null } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const receiptId = body.receiptId && /^[0-9a-f-]{36}$/i.test(body.receiptId) ? body.receiptId : null;

  const [{ data: stock, error: stockErr }, { data: settingsRow }] = await Promise.all([
    g.db.from("pantry_items")
      .select("id,name,category,storage,unit,unit_label,qty,start_qty,use_by,cost_gbp,protein_g_total,fat_100,saturates_100,sugars_100,salt_100,fibre_100")
      .eq("status", "active").gt("qty", 0).order("use_by", { ascending: true, nullsFirst: false }).limit(120),
    g.db.from("user_settings").select("*").maybeSingle(),
  ]);
  if (stockErr) return fail(500, "Couldn't load your fridge.");
  if (!stock?.length) return fail(400, "Your fridge is empty. Add a shop first, or add items on the Fridge tab.");

  const items = stock.map((s, i) => {
    const start = Number(s.start_qty) || Number(s.qty) || 1;
    const per100 = s.fat_100 == null ? null
      : `fat ${s.fat_100}, sat ${s.saturates_100}, sugar ${s.sugars_100}, salt ${s.salt_100}, fibre ${s.fibre_100}`;
    const line: FridgeLine = {
      code: `F${i + 1}`,
      name: s.name,
      category: s.category,
      storage: s.storage,
      amount: formatQty(Number(s.qty), s.unit as Unit, s.unit_label),
      unit: s.unit,
      qty: Number(s.qty),
      use_by: s.use_by,
      cost_per_unit: s.cost_gbp == null ? null : Number(s.cost_gbp) / start,
      protein_per_unit: s.protein_g_total == null ? null : Number(s.protein_g_total) / start,
      per100,
    };
    return { line, id: s.id as string };
  });

  const settings = SettingsSchema.parse(settingsRow ?? {});
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const started = Date.now();
  const res = await askClaude(
    planPrompt(items.map((x) => x.line), settings, today, startDayAfter(now, settings.plan_days, now.getUTCHours() < 14)),
    32000,
  );
  if (res instanceof Response) return res;

  let plan;
  try {
    plan = resolveUses(parsePlanReply(res.text), items.map((x) => ({ code: x.line.code, id: x.id, name: x.line.name, qty: x.line.qty })));
  } catch (e) {
    console.error("Unparseable plan", e instanceof Error ? e.message : e, res.text.slice(0, 500));
    return fail(502, res.truncated ? "The plan was too long and got cut off. Try planning fewer meals." : "The plan came back in the wrong format. Try again.");
  }

  const meta = { model: res.model, promptVersion: PLAN_PROMPT_VERSION, ms: Date.now() - started, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  const { data: saved, error } = await g.db.from("plans")
    .insert({ receipt_id: receiptId, settings, plan: { ...plan, meta } })
    .select("id,created_at").single();
  if (error) console.error("Saving plan failed", error.message);

  return Response.json({ plan, meta, planId: saved?.id ?? null });
}
