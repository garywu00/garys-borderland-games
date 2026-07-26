"use client";

import { useEffect, useState } from "react";
import localFont from "next/font/local";
import { GAME_COUNTDOWN_DURATION_MS } from "@/lib/game/rules";

// Not on Google Fonts — self-hosted from public/fonts/ (downloaded from
// cdnfonts.com's mirror) rather than depending on a third-party CDN at
// runtime, which matters for a live event where reliability counts.
const digitalNumbers = localFont({ src: "../public/fonts/DigitalNumbers-Regular.woff", weight: "400" });

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function SuitsGrid() {
  return (
    <div
      className="fade-up"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 6,
        fontSize: 32,
        lineHeight: 1,
        textAlign: "center",
      }}
    >
      <span>♠</span>
      <span style={{ color: "var(--accent)" }}>♥</span>
      <span style={{ color: "var(--accent)" }}>♦</span>
      <span>♣</span>
    </div>
  );
}

function GaryWordmark() {
  return (
    <div className="fade-up" style={{ textAlign: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static self-hosted vector, no benefit from next/image here */}
      <img src="/images/gary-wordmark.svg" alt="GARY" style={{ height: 64, width: "auto", display: "block", margin: "0 auto" }} />
      <p style={{ fontFamily: "var(--font-display)", fontSize: 24, marginTop: 4 }}>IN BORDERLAND</p>
    </div>
  );
}

/** Shown to every player before an admin has hit "Start game" — no timer, nothing to do yet. */
export function GameNotStartedScreen() {
  return (
    <div className="dramatic-panel">
      <SuitsGrid />
      <GaryWordmark />
      <p className="bracket-title">【 GAME 】</p>
    </div>
  );
}

export function GameStartCountdown({
  countdownStartedAt,
  onComplete,
}: {
  countdownStartedAt: string;
  onComplete: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const startMs = new Date(countdownStartedAt).getTime();
  const remainingMs = Math.max(0, startMs + GAME_COUNTDOWN_DURATION_MS - now);

  // Handles both a natural countdown-to-zero and a late joiner loading the
  // page after the window already passed (e.g. a manager forgot to clear
  // it) — either way, skip straight past instead of showing a stuck 00:00.
  useEffect(() => {
    if (remainingMs <= 0) onComplete();
  }, [remainingMs, onComplete]);

  return (
    <div className="dramatic-panel">
      <SuitsGrid />
      <GaryWordmark />
      <p className={digitalNumbers.className} style={{ fontSize: 56, letterSpacing: "0.04em" }}>
        {formatCountdown(remainingMs)}
      </p>
      <p className="label">【 Get Ready 】</p>
    </div>
  );
}
