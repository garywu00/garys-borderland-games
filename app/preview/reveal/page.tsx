"use client";

import { useState } from "react";
import { ShareStealReveal, type Team, type Matchup, type ShareStealSubmission } from "../../PlayerApp";

const MOCK_TEAM: Team = { id: "preview-team-a", name: "Alex + Jordan", hearts_cached: 6, status: "round1" };
const MOCK_OPPONENT: Team = { id: "preview-team-b", name: "Sam + Casey", hearts_cached: 5, status: "round1" };
const MOCK_SUBMISSIONS: ShareStealSubmission[] = [
  { team_id: "preview-team-a", choice: "steal" },
  { team_id: "preview-team-b", choice: "share" },
];

// Dev-only preview of the Share/Steal reveal screen — lets the
// countdown/animation timing be checked in a real browser without needing
// two live devices and a full match to reach this screen. Not linked from
// anywhere in the real player flow.
export default function RevealPreviewPage() {
  const [key, setKey] = useState(0);
  const [resolvedAt, setResolvedAt] = useState(() => new Date().toISOString());

  const matchup: Matchup = {
    id: "preview-matchup",
    team_a_id: MOCK_TEAM.id,
    team_b_id: MOCK_OPPONENT.id,
    status: "resolved",
    team_a_ready: true,
    team_b_ready: true,
    deadline_at: null,
    resolved_at: resolvedAt,
  };

  function replay() {
    setResolvedAt(new Date().toISOString());
    setKey((k) => k + 1);
  }

  return (
    <main style={{ maxWidth: 428, margin: "0 auto", minHeight: "100dvh", padding: "16px 20px 40px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p className="label" style={{ margin: 0 }}>
          Reveal preview — dev only
        </p>
        <button className="btn-outline" style={{ width: "auto", minHeight: "auto", padding: "6px 10px", fontSize: 12 }} onClick={replay}>
          Replay
        </button>
      </div>
      <ShareStealReveal
        key={key}
        team={MOCK_TEAM}
        opponentTeam={MOCK_OPPONENT}
        matchup={matchup}
        submissions={MOCK_SUBMISSIONS}
        onDismiss={replay}
      />
    </main>
  );
}
