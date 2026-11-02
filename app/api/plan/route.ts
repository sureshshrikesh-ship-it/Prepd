import { PLAN_PROMPT_VERSION, SettingsSchema, parsePlanReply, planPrompt, startDayAfter } from "@/lib/plan";
import { askClaude, fail, gate } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Builds a week plan from a receipt the user saved. Reads the receipt with the user's own
// session (RLS), so nobody can plan from someone else's shop.
export async function POST(req: Request) {
  const g = await gate(req);
  if (g instanceof Response) return g;

  let body: { receiptId?: string };
  try { body = await req.json(); } catch { return fail(400, "Send JSON with a receiptId."); }
  if (!body.receiptId || !/^[0-9a-f-]{36}$/i.test(body.receiptId)) return fail(400, "Missing receiptId.");

  const [{ data: receipt }, { data: items, error: itemsErr }, { data: settingsRow }] = await Promise.all([
    g.db.from("receipts").select("id,receipt_date,created_at").eq("id", body.receiptId).maybeSingle(),
    g.db.from("receipt_items")
      .select("name,category,qty,pack_size,units_per_pack,unit_name,line_total,storage,keeps,protein_g,is_food,fat_100,saturates_100,sugars_100,salt_100,fibre_100")
      .eq("receipt_id", body.receiptId).order("position"),
    g.db.from("user_settings").select("*").maybeSingle(),
  ]);
  if (!receipt) return fail(404, "Receipt not found.");
  if (itemsErr) return fail(500, "Couldn't load the receipt's items.");
  const food = (items ?? []).filter((i) => i.is_food).map((i) => ({
    ...i,
    line_total: Number(i.line_total) || 0,
    nutrition: i.fat_100 == null ? null : {
      fat: Number(i.fat_100), saturates: Number(i.saturates_100), sugars: Number(i.sugars_100),
      salt: Number(i.salt_100), fibre: Number(i.fibre_100),
    },
  }));
  if (food.length === 0) return fail(400, "This receipt has no food on it to plan with.");

  const settings = SettingsSchema.parse(settingsRow ?? {});
  const shop = new Date(receipt.receipt_date ?? receipt.created_at);
  const started = Date.now();
  const res = await askClaude(
    planPrompt(food, settings, shop.toISOString().slice(0, 10), startDayAfter(shop, settings.plan_days)),
    32000,
  );
  if (res instanceof Response) return res;

  let plan;
  try {
    plan = parsePlanReply(res.text);
  } catch (e) {
    console.error("Unparseable plan", e instanceof Error ? e.message : e, res.text.slice(0, 500));
    return fail(502, res.truncated ? "The plan was too long and got cut off. Try planning fewer meals." : "The plan came back in the wrong format. Try again.");
  }

  const meta = { model: res.model, promptVersion: PLAN_PROMPT_VERSION, ms: Date.now() - started, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
  const { data: saved, error } = await g.db.from("plans")
    .insert({ receipt_id: receipt.id, settings, plan: { ...plan, meta } })
    .select("id,created_at").single();
  if (error) console.error("Saving plan failed", error.message);

  return Response.json({ plan, meta, planId: saved?.id ?? null });
}
