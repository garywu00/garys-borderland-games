"use client";

import { CardDisplay } from "../../../components/CardDisplay";
import { LeaderboardRow } from "../../PlayerApp";
import { NON_FINALIST_MESSAGE, type CardCode } from "../../../lib/game/rules";

// Dev-only preview of the eliminated/non-finalist screens (with mock
// leaderboard data, since the live query needs real Supabase env vars this
// sandbox doesn't have) — not linked from anywhere in the real player flow.
const MOCK_TEAMS = [
  { id: "1", name: "Ajan + Anne", hearts_cached: 7 },
  { id: "2", name: "Brandon + Gary", hearts_cached: 6 },
  { id: "me", name: "You + Partner", hearts_cached: 3 },
  { id: "3", name: "Michelle + Sam", hearts_cached: 2 },
  { id: "4", name: "Kai + Jordan", hearts_cached: 0 },
];
const MOCK_CARDS: CardCode[] = ["heart4", "club8"];

export default function EliminationPreviewPage() {
  return (
    <main style={{ maxWidth: 428, margin: "0 auto", minHeight: "100dvh", padding: "16px 20px 40px", display: "flex", flexDirection: "column" }}>
      <p className="label" style={{ marginBottom: 12 }}>
        Elimination preview — dev only
      </p>

      <div className="dramatic-panel">
        <p className="label flicker-in">Your hearts are gone</p>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 34, textAlign: "center" }}>
          You&apos;re out of hearts — you&apos;re eliminated.
        </h2>
        <p style={{ fontSize: 17, textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
          Head to Focal Point Brewery — the others will find you there.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          {MOCK_CARDS.map((c) => (
            <CardDisplay key={c} code={c} width={90} />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 24, marginBottom: 40 }}>
        <p className="label">Standings</p>
        {MOCK_TEAMS.map((t, i) => (
          <LeaderboardRow key={t.id} rank={i + 1} team={t as never} highlight={t.id === "me"} />
        ))}
      </div>

      <div className="dramatic-panel">
        <p className="label flicker-in">Game over</p>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 34, textAlign: "center" }}>
          Three pairs made it through. You weren&apos;t one of them.
        </h2>
        <p style={{ fontSize: 17, textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>{NON_FINALIST_MESSAGE}</p>
        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          {MOCK_CARDS.map((c) => (
            <CardDisplay key={c} code={c} width={90} />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 24 }}>
        <p className="label">Standings</p>
        {MOCK_TEAMS.map((t, i) => (
          <LeaderboardRow key={t.id} rank={i + 1} team={t as never} highlight={t.id === "me"} />
        ))}
      </div>
    </main>
  );
}
