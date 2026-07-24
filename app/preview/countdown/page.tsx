"use client";

import { useState } from "react";
import { GameStartCountdown } from "../../../components/GameStartCountdown";

// Dev-only preview of the pre-game countdown screen — not linked from
// anywhere in the real player flow.
export default function CountdownPreviewPage() {
  const [key, setKey] = useState(0);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());

  function replay() {
    setStartedAt(new Date().toISOString());
    setKey((k) => k + 1);
  }

  return (
    <main style={{ maxWidth: 428, margin: "0 auto", minHeight: "100dvh", padding: "16px 20px 40px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p className="label" style={{ margin: 0 }}>
          Countdown preview — dev only
        </p>
        <button className="btn-outline" style={{ width: "auto", minHeight: "auto", padding: "6px 10px", fontSize: 12 }} onClick={replay}>
          Replay
        </button>
      </div>
      <GameStartCountdown key={key} countdownStartedAt={startedAt} onComplete={() => {}} />
    </main>
  );
}
