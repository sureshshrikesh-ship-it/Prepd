// Shared receipt reading: Claude reads the image, then the shared product map corrects known lines.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROMPT_VERSION, applyProductMap, parseReceiptReply, receiptPrompt, storeKey, type MapRow, type Receipt } from "./receipt";
import { askClaude, fail } from "./server";

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export type ReceiptMeta = {
  model: string; promptVersion: string; ms: number; inputTokens: number; outputTokens: number; truncated: boolean; fromMap: number;
};

export async function readReceiptImage(db: SupabaseClient, data: string, mediaType: ImageType): Promise<{ receipt: Receipt; meta: ReceiptMeta } | Response> {
  const today = new Date().toISOString().slice(0, 10);
  const started = Date.now();
  const res = await askClaude(
    [
      { type: "image", source: { type: "base64", media_type: mediaType, data } },
      { type: "text", text: receiptPrompt(today) },
    ],
    20000,
  );
  if (res instanceof Response) return res;

  let receipt: Receipt;
  try {
    receipt = parseReceiptReply(res.text);
  } catch (e) {
    console.error("Unparseable reply", e instanceof Error ? e.message : e, res.text.slice(0, 500));
    return fail(502, "The reading came back in the wrong format. Try again.");
  }

  // Lines other testers have already corrected for this store win over the model's guess.
  const { data: rows, error } = await db
    .from("product_map")
    .select("raw,name,category,is_food,pack_size,units_per_pack,unit_name")
    .eq("store", storeKey(receipt.store))
    .limit(1000);
  if (error) console.error("product_map lookup failed", error.message);
  else receipt = applyProductMap(receipt, (rows ?? []) as MapRow[]);

  return {
    receipt,
    meta: {
      model: res.model, promptVersion: PROMPT_VERSION, ms: Date.now() - started,
      inputTokens: res.inputTokens, outputTokens: res.outputTokens, truncated: res.truncated,
      fromMap: receipt.items.filter((i) => i.source === "map").length,
    },
  };
}

/** Pull the photo out of a multipart request, with the size and type checks every photo route needs. */
export async function photoFrom(req: Request): Promise<{ data: string; mediaType: ImageType } | Response> {
  let file: File | null = null;
  try {
    const f = (await req.formData()).get("image");
    file = f instanceof File ? f : null;
  } catch {
    return fail(400, "Send the photo as form data under the name 'image'.");
  }
  if (!file) return fail(400, "No photo received.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return fail(415, "Use a JPEG, PNG or WebP photo.");
  if (file.size > 4 * 1024 * 1024) return fail(413, "Photo is over 4 MB. Try again; the app should shrink it first.");
  return { data: Buffer.from(await file.arrayBuffer()).toString("base64"), mediaType: file.type as ImageType };
}
