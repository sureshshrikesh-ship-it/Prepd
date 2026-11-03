"use client";
// Browser-side Supabase client and small helpers shared by the screens.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      // Implicit flow: the sign-in link works even when opened in a mail app's own browser.
      auth: { flowType: "implicit", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

const PASS_KEY = "prepd.passcode";
export function getPasscode(): string {
  try { return localStorage.getItem(PASS_KEY) ?? ""; } catch { return ""; }
}
export function setPasscode(v: string) {
  try { localStorage.setItem(PASS_KEY, v); } catch { /* storage blocked: re-enter next visit */ }
}

/** POST to one of our API routes with the passcode and the user's session token. */
export async function callApi<T>(path: string, body: BodyInit, json = false, signal?: AbortSignal): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first.");
  const headers: Record<string, string> = { "x-passcode": getPasscode(), authorization: `Bearer ${token}` };
  if (json) headers["content-type"] = "application/json";
  const res = await fetch(path, { method: "POST", body, headers, signal });
  const out = await res.json().catch(() => ({ error: "The server sent back something unreadable." }));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status}).`);
  return out as T;
}

export const money = (n: number | null | undefined) => "£" + (Number(n) || 0).toFixed(2);

/**
 * Put a saved receipt's food into the fridge. Safe to call twice: lines already added are skipped
 * (receipt_item_id is unique). Returns how many items were added.
 */
export async function addReceiptToPantry(receiptId: string): Promise<number> {
  const { parsePack, useByFrom } = await import("./pantry");
  const db = supabase();
  const [{ data: r }, { data: items, error }] = await Promise.all([
    db.from("receipts").select("receipt_date,created_at").eq("id", receiptId).maybeSingle(),
    db.from("receipt_items")
      .select("id,name,category,qty,pack_size,units_per_pack,unit_name,line_total,storage,keeps,protein_g,is_food,fat_100,saturates_100,sugars_100,salt_100,fibre_100")
      .eq("receipt_id", receiptId).eq("is_food", true).order("position"),
  ]);
  if (error) throw new Error(error.message);
  if (!r || !items?.length) return 0;
  const { data: existing } = await db.from("pantry_items").select("receipt_item_id").in("receipt_item_id", items.map((i) => i.id));
  const done = new Set((existing ?? []).map((e) => e.receipt_item_id));
  const shop = new Date(r.receipt_date ?? r.created_at);
  const rows = items.filter((i) => !done.has(i.id)).map((i) => {
    const amt = parsePack(i.pack_size, i.qty, i.units_per_pack == null ? null : Number(i.units_per_pack), i.unit_name);
    const storage = (["fridge", "freezer", "cupboard", "counter"].includes(i.storage) ? i.storage : "cupboard") as "fridge";
    return {
      name: i.name, category: i.category, storage, unit: amt.unit, unit_label: amt.label,
      qty: amt.amount, start_qty: amt.amount, use_by: useByFrom(i.keeps, storage, shop),
      cost_gbp: i.line_total, protein_g_total: i.protein_g,
      fat_100: i.fat_100, saturates_100: i.saturates_100, sugars_100: i.sugars_100, salt_100: i.salt_100, fibre_100: i.fibre_100,
      receipt_item_id: i.id,
    };
  });
  if (!rows.length) return 0;
  const { error: insErr } = await db.from("pantry_items").insert(rows);
  if (insErr) throw new Error(insErr.message);
  return rows.length;
}
