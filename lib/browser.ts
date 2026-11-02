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
