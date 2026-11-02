// Shared server-side helpers for API routes: the passcode gate, the signed-in user, and the Claude call.
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { DEFAULT_MODEL, SUPABASE_KEY, SUPABASE_URL } from "./config";

export function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

export function passcodeOk(given: string | null): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return process.env.NODE_ENV !== "production"; // never run open in production
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Checks the passcode and the Supabase session; returns a client that acts as that user (RLS applies). */
export async function gate(req: Request): Promise<{ user: User; db: SupabaseClient } | Response> {
  if (!passcodeOk(req.headers.get("x-passcode"))) return fail(401, "Wrong passcode.");
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return fail(401, "Sign in first.");
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return fail(401, "Your sign-in has expired. Sign in again.");
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "The server has no ANTHROPIC_API_KEY set.");
  return { user: data.user, db };
}

export type ClaudeResult = { text: string; model: string; inputTokens: number; outputTokens: number; truncated: boolean };

export async function askClaude(content: Anthropic.MessageParam["content"], maxTokens: number): Promise<ClaudeResult | Response> {
  const client = new Anthropic();
  try {
    const reply = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    });
    return {
      text: reply.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
      model: reply.model,
      inputTokens: reply.usage.input_tokens,
      outputTokens: reply.usage.output_tokens,
      truncated: reply.stop_reason === "max_tokens",
    };
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    const msg = e instanceof Error ? e.message : "";
    console.error("Claude API error", status, msg);
    if (status === 401) return fail(502, "The server's API key was rejected (401). Check ANTHROPIC_API_KEY in Vercel: a Console API key starting sk-ant-api03-, no spaces.");
    if (status === 403) return fail(502, "The API key isn't allowed to use this model (403). Check the key's workspace in the Anthropic Console.");
    if (status === 404) return fail(502, "Model not found (404). Check ANTHROPIC_MODEL in Vercel, or remove it to use the default.");
    if (status === 400 && /credit|billing|balance/i.test(msg)) return fail(502, "The Anthropic account is out of credit. Add credit in the Anthropic Console under Billing.");
    if (status === 429) return fail(429, "Too many requests right now. Wait a minute and try again.");
    if (status) return fail(502, `Claude returned an error (${status}). Try again in a moment.`);
    return fail(502, "Couldn't reach Claude. Try again in a moment.");
  }
}
