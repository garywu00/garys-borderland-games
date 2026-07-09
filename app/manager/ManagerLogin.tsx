"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function ManagerLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function sendLink() {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/manager` },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 360, alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700 }}>GARY</h1>
        <p className="label">Manager sign in</p>
        {sent ? (
          <p style={{ textAlign: "center", fontSize: 15 }}>Check {email} for a sign-in link.</p>
        ) : (
          <>
            <input
              type="text"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
            {error && <p style={{ color: "var(--accent)", fontSize: 14 }}>{error}</p>}
            <button className="btn" onClick={sendLink} disabled={!email}>
              Send magic link
            </button>
          </>
        )}
      </div>
    </main>
  );
}
