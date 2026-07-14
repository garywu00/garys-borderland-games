"use client";

import { createClient } from "@/lib/supabase/client";

export function NotAManager() {
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <main style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", maxWidth: 320 }}>
        <p style={{ textAlign: "center", color: "var(--muted)" }}>
          You&apos;re signed in, but this account isn&apos;t set up as a manager. Ask Gary to add you to
          manager_profiles.
        </p>
        <button className="btn" onClick={signOut}>
          Sign out and try again
        </button>
      </div>
    </main>
  );
}
