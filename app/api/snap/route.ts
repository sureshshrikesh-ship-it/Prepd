import { photoFrom, readReceiptImage } from "@/lib/readReceipt";
import { SNAP_PROMPT_VERSION, resolveSnap, snapPrompt, type StockRef } from "@/lib/snap";
import type { Unit } from "@/lib/pantry";
import { askClaude, fail, gate } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 180;

// One photo, any kind. Receipts go to the receipt reader (same result as /api/read-receipt);
// shopping and fridge photos come back as items for the user to confirm. Nothing is saved here.
export async function POST(req: Request) {
  const g = await gate(req);
  if (g instanceof Response) return g;
  const photo = await photoFrom(req);
  if (photo instanceof Response) return photo;

  const { data: stockRows } = await g.db.from("pantry_items")
    .select("id,name,qty,unit,unit_label").eq("status", "active").gt("qty", 0)
    .order("storage").limit(120);
  const stock: StockRef[] = (stockRows ?? []).map((s, i) => ({
    code: `F${i + 1}`, id: s.id, name: s.name, qty: Number(s.qty), unit: s.unit as Unit, unit_label: s.unit_label,
  }));

  const started = Date.now();
  const res = await askClaude(
    [
      { type: "image", source: { type: "base64", media_type: photo.mediaType, data: photo.data } },
      { type: "text", text: snapPrompt(new Date().toISOString().slice(0, 10), stock) },
    ],
    16000,
  );
  if (res instanceof Response) return res;

  let result;
  try {
    result = resolveSnap(res.text, stock);
  } catch (e) {
    console.error("Unparseable snap", e instanceof Error ? e.message : e, res.text.slice(0, 300));
    return fail(502, "Couldn't make sense of that photo. Try again with the food spread out and labels facing up.");
  }
  const meta = { model: res.model, promptVersion: SNAP_PROMPT_VERSION, ms: Date.now() - started, inputTokens: res.inputTokens, outputTokens: res.outputTokens };

  if (result.kind === "receipt") {
    const out = await readReceiptImage(g.db, photo.data, photo.mediaType);
    return out instanceof Response ? out : Response.json({ kind: "receipt", ...out });
  }
  if (result.kind === "other") return fail(422, "That doesn't look like food, a fridge or a receipt. Try another photo.");
  if (!result.items.length) return fail(422, "No food found in that photo. Spread the shopping out with labels facing up and try again.");
  return Response.json({ ...result, meta });
}
