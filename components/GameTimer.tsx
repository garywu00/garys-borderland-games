"use client";

import { useEffect, useState } from "react";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function GameTimer({ startsAt }: { startsAt: string | null }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!startsAt) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startsAt]);

  if (!startsAt || now === null) return null;

  return (
    <div
      style={{
        textAlign: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        letterSpacing: "0.08em",
        color: "var(--muted)",
        padding: "0 0 10px",
      }}
    >
      {formatElapsed(now - new Date(startsAt).getTime())}
    </div>
  );
}
