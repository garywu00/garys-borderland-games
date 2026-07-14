"use client";

import { useState } from "react";
import { managerPinLogin } from "@/lib/actions/managerAuth";

const ROLES = [
  { role: "ajan" as const, label: "Ajan" },
  { role: "michelle" as const, label: "Michelle" },
  { role: "gary" as const, label: "Gary" },
];

export function ManagerLogin() {
  const [selected, setSelected] = useState<"ajan" | "michelle" | "gary" | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!selected || pin.length !== 4) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await managerPinLogin(selected, pin);
      if (result.ok) {
        window.location.reload();
        return;
      }
      if (result.reason === "incorrect_pin") {
        setError("Incorrect PIN. Try again.");
        setPin("");
      } else {
        setError("Something went wrong. Try again.");
      }
    } catch {
      setError("Connection issue — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 360, alignItems: "center" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 700 }}>GARY</h1>
        <p className="label">Manager sign in</p>

        {!selected ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
            {ROLES.map((r) => (
              <button key={r.role} className="btn btn-outline" onClick={() => setSelected(r.role)}>
                {r.label}
              </button>
            ))}
          </div>
        ) : (
          <>
            <p style={{ fontSize: 16 }}>{ROLES.find((r) => r.role === selected)?.label}</p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              autoFocus
              aria-label="4-digit PIN"
              style={{ textAlign: "center", letterSpacing: "0.5em", fontSize: 24, width: 160 }}
            />
            {error && <p style={{ color: "var(--accent)", fontSize: 14 }}>{error}</p>}
            <button className="btn" onClick={submit} disabled={pin.length !== 4 || submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setSelected(null);
                setPin("");
                setError(null);
              }}
            >
              Back
            </button>
          </>
        )}
      </div>
    </main>
  );
}
