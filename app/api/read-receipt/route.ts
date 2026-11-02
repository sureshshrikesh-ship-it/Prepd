import { PROMPT_VERSION, applyProductMap, parseReceiptReply, receiptPrompt, storeKey, type MapRow } from "@/lib/receipt";
import { askClaude, fail, gate } from "@/lib/server";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB; the client shrinks photos well below this.
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  const g = await gate(req);
  if (g instanceof Response) return g;

  let file: File | null = null;
  try {
    const f = (await req.formData()).get("image");
    file = f instanceof File ? f : null;
  } catch {
    return fail(400, "Send the photo as form data under the name 'image'.");
  }
  if (!file) return fail(400, "No photo received.");
  if (!TYPES.has(file.type)) return fail(415, "Use a JPEG, PNG or WebP photo.");
  if (file.size > MAX_BYTES) return fail(413, "Photo is over 4 MB. Try again; the app should shrink it first.");

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const today = new Date().toISOString().slice(0, 10);
  const started = Date.now();
  const res = await askClaude(
    [
      { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/webp", data } },
      { type: "text", text: receiptPrompt(today) },
    ],
    8000,
  );
  if (res instanceof Response) return res;

  let receipt;
  try {
    receipt = parseReceiptReply(res.text);
  } catch (e) {
    console.error("Unparseable reply", e instanceof Error ? e.message : e, res.text.slice(0, 500));
    return fail(502, "The reading came back in the wrong format. Try again.");
  }

  // Lines other testers have already corrected for this store win over the model's guess.
  const { data: rows, error } = await g.db
    .from("product_map")
    .select("raw,name,category,is_food,pack_size,units_per_pack,unit_name")
    .eq("store", storeKey(receipt.store))
    .limit(1000);
  if (error) console.error("product_map lookup failed", error.message);
  else receipt = applyProductMap(receipt, (rows ?? []) as MapRow[]);

  return Response.json({
    receipt,
    meta: {
      model: res.model,
      promptVersion: PROMPT_VERSION,
      ms: Date.now() - started,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      truncated: res.truncated,
      fromMap: receipt.items.filter((i) => i.source === "map").length,
    },
  });
}
