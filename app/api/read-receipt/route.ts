import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";
import { PROMPT_VERSION, RECEIPT_PROMPT, parseReceiptReply } from "@/lib/receipt";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB; the client shrinks photos well below this.
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function passcodeOk(given: string | null): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return process.env.NODE_ENV !== "production"; // never run open in production
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function POST(req: Request) {
  if (!passcodeOk(req.headers.get("x-passcode"))) return fail(401, "Wrong passcode.");
  if (!process.env.ANTHROPIC_API_KEY) return fail(500, "The server has no ANTHROPIC_API_KEY set.");

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("image");
    file = f instanceof File ? f : null;
  } catch {
    return fail(400, "Send the photo as form data under the name 'image'.");
  }
  if (!file) return fail(400, "No photo received.");
  if (!TYPES.has(file.type)) return fail(415, "Use a JPEG, PNG or WebP photo.");
  if (file.size > MAX_BYTES) return fail(413, "Photo is over 4 MB. Try again; the app should shrink it first.");

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  const client = new Anthropic();
  const started = Date.now();

  let reply;
  try {
    reply = await client.messages.create({
      model,
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg" | "image/png" | "image/webp", data } },
            { type: "text", text: RECEIPT_PROMPT },
          ],
        },
      ],
    });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.error("Claude API error", status, e instanceof Error ? e.message : e);
    if (status === 429) return fail(429, "Too many requests right now. Wait a minute and try again.");
    return fail(502, "Couldn't reach Claude. Try again in a moment.");
  }

  const text = reply.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    const receipt = parseReceiptReply(text);
    return Response.json({
      receipt,
      meta: {
        model: reply.model,
        promptVersion: PROMPT_VERSION,
        ms: Date.now() - started,
        inputTokens: reply.usage.input_tokens,
        outputTokens: reply.usage.output_tokens,
        truncated: reply.stop_reason === "max_tokens",
      },
    });
  } catch (e) {
    console.error("Unparseable reply", e instanceof Error ? e.message : e, text.slice(0, 500));
    return fail(502, "The reading came back in the wrong format. Try again.");
  }
}
