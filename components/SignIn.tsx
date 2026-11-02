"use client";
import { useState } from "react";
import { supabase } from "@/lib/browser";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const { error } = await supabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setState("idle");
      setError(/rate/i.test(error.message) ? "Too many sign-in emails in the last hour. Try again later." : error.message);
    } else setState("sent");
  }

  return (
    <section className="panel" aria-labelledby="signin-h">
      <h2 id="signin-h">Sign in</h2>
      {state === "sent" ? (
        <p>Check <b>{email}</b> for a sign-in link from Supabase and open it on this phone. You can close this tab.</p>
      ) : (
        <form onSubmit={send} className="stack">
          <label className="field" htmlFor="email">Email
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="btn full" type="submit" disabled={state === "sending"}>
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
          {error && <div className="status err" role="alert">{error}</div>}
          <p className="muted small">No password. Your receipts and plans are saved to your account so you can come back to them.</p>
        </form>
      )}
    </section>
  );
}
