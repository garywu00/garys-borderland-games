"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PortraitPair, Portrait } from "@/components/Portrait";
import {
  recordClubsOutcome,
  recordDiamondsPass,
  adjustHeartsManual,
  confirmArrival,
  verifyWinner,
  createRandomMatchups,
  resetGameState,
  updatePlayerName,
  deleteTeam,
  addPlayer,
} from "@/lib/actions/manager";

type Team = { id: string; name: string; hearts_cached: number; status: string; event_id: string };
type Finalist = { team_id: string; slot: number };
type Player = { id: string; display_name: string; claim_status: string };
type Tab = "clubs" | "diamonds" | "overview";

export function ManagerDashboard({ role, displayName }: { role: "ajan" | "michelle" | "gary"; displayName: string }) {
  const supabase = createClient();
  const [teams, setTeams] = useState<Team[]>([]);
  const [finalists, setFinalists] = useState<Finalist[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [toast, setToastMsg] = useState<string | null>(null);
  const [selectedClubsTeam, setSelectedClubsTeam] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(role === "ajan" ? "clubs" : role === "michelle" ? "diamonds" : "overview");

  function notify(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("teams").select("id, name, hearts_cached, status, event_id");
    setTeams(data ?? []);
    const { data: f } = await supabase.from("finalists").select("team_id, slot");
    setFinalists(f ?? []);
    const { data: p } = await supabase.from("players").select("id, display_name, claim_status").order("display_name");
    setPlayers(p ?? []);
  }, [supabase]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("manager-app")
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "finalists" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, refresh]);

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "clubs", label: "Clubs" },
    { id: "diamonds", label: "Diamonds" },
    { id: "overview", label: "Overview" },
  ];

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 40px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 4px", borderBottom: "1px solid rgba(10,10,10,0.15)", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16 }}>{displayName}</div>
          <div className="label">{role}</div>
        </div>
        <button className="btn btn-outline" style={{ width: "auto", minHeight: "auto", padding: "8px 14px", fontSize: 13 }} onClick={signOut}>
          Sign out
        </button>
      </header>

      <nav style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            aria-current={activeTab === t.id}
            style={{
              flex: 1,
              padding: "10px 8px",
              fontSize: 14,
              border: "1.6px solid var(--line)",
              background: activeTab === t.id ? "var(--btn-bg)" : "transparent",
              color: activeTab === t.id ? "var(--btn-fg)" : "var(--fg)",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 16, textAlign: "center" }}>
        Any manager can work any tab — swap freely if someone needs to cover another checkpoint.
      </p>

      {toast && (
        <div style={{ background: "var(--fg)", color: "var(--bg)", padding: "12px 16px", fontSize: 14, textAlign: "center", marginBottom: 16 }}>
          {toast}
        </div>
      )}

      {activeTab === "clubs" && (
        <ClubsView
          teams={teams.filter((t) => t.status === "round2")}
          selected={selectedClubsTeam}
          onSelect={setSelectedClubsTeam}
          onOutcome={async (a, b, outcome) => {
            await recordClubsOutcome(a, b, outcome);
            setSelectedClubsTeam(null);
            notify(`Recorded ${outcome.toUpperCase()} — both teams advanced.`);
          }}
        />
      )}

      {activeTab === "diamonds" && (
        <DiamondsView
          teams={teams.filter((t) => t.status === "round3")}
          onPass={async (id) => {
            await recordDiamondsPass(id);
            notify("Marked Pass — advanced to final checkpoint.");
          }}
          onAdjust={async (id, delta) => {
            await adjustHeartsManual(id, delta);
            notify(`Adjusted by ${delta > 0 ? "+" : ""}${delta}.`);
          }}
        />
      )}

      {activeTab === "overview" && (
        <OverviewView
          teams={teams}
          finalists={finalists}
          players={players}
          onCreateMatchups={async () => {
            const result = await createRandomMatchups();
            notify(result.ok ? `Created ${result.created} matchup(s).` : "Could not create matchups.");
          }}
          onConfirmArrival={async (id) => {
            const result = await confirmArrival(id);
            notify(result.ok ? `Confirmed as Finalist #${result.slot}.` : "Slots are already full.");
          }}
          onVerifyWinner={async (id) => {
            await verifyWinner(id);
            notify("Winner verified.");
          }}
          onAdjust={async (id, delta) => {
            await adjustHeartsManual(id, delta);
            notify(`Adjusted by ${delta > 0 ? "+" : ""}${delta}.`);
          }}
          onResetGame={async () => {
            await resetGameState();
            notify("Game state reset. Roster, event, and manager PINs kept.");
          }}
          onRenamePlayer={async (id, name) => {
            const result = await updatePlayerName(id, name);
            notify(result.ok ? "Name updated." : "Could not update name.");
          }}
          onRemoveTeam={async (id) => {
            const result = await deleteTeam(id);
            notify(result.ok ? "Team removed. Members are available again." : "Could not remove team.");
          }}
          onAddPlayer={async (name) => {
            const result = await addPlayer(name);
            notify(result.ok ? "Player added to roster." : "That name is already on the roster.");
          }}
        />
      )}
    </main>
  );
}

function TeamRow({ team, right }: { team: Team; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, border: "1.6px solid var(--line)", marginBottom: 10 }}>
      <PortraitPair names={team.name.split(" + ")} size={36} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17 }}>{team.name}</div>
        <div style={{ fontSize: 14 }}>♥ {team.hearts_cached}</div>
      </div>
      {right}
    </div>
  );
}

function ClubsView({
  teams,
  selected,
  onSelect,
  onOutcome,
}: {
  teams: Team[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onOutcome: (a: string, b: string, outcome: "pass" | "fail") => void;
}) {
  const [pendingPair, setPendingPair] = useState<[string, string] | null>(null);
  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, textAlign: "center", marginBottom: 16 }}>8 of Clubs Game</h2>
      <p className="label">Pairs at this round ({teams.length})</p>
      {teams.length === 0 && <p style={{ color: "var(--muted)", padding: "16px 0" }}>No pairs currently at the Clubs checkpoint.</p>}
      {teams.map((t) => (
        <TeamRow
          key={t.id}
          team={t}
          right={
            <button
              className="btn"
              style={{ width: "auto", minHeight: "auto", padding: "10px 16px", fontSize: 14 }}
              onClick={() => {
                if (selected === t.id) return onSelect(null);
                if (!selected) return onSelect(t.id);
                setPendingPair([selected, t.id]);
              }}
            >
              {selected === t.id ? "Cancel" : "Select outcome"}
            </button>
          }
        />
      ))}
      {pendingPair && (
        <OutcomeModal
          onClose={() => setPendingPair(null)}
          onPass={() => {
            onOutcome(pendingPair[0], pendingPair[1], "pass");
            setPendingPair(null);
          }}
          onFail={() => {
            onOutcome(pendingPair[0], pendingPair[1], "fail");
            setPendingPair(null);
          }}
        />
      )}
    </div>
  );
}

function OutcomeModal({ onClose, onPass, onFail }: { onClose: () => void; onPass: () => void; onFail: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg)", width: "100%", maxWidth: 560, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontWeight: 400, fontSize: 22 }}>Record outcome</h2>
          <button className="btn-outline" style={{ width: 36, height: 36, border: "1.6px solid var(--line)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <button className="btn-outline" style={{ border: "2px solid var(--line)", padding: 20 }} onClick={onPass}>
            Pass
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Both teams +1 ♥, collect 8♣</div>
          </button>
          <button className="btn-outline" style={{ border: "2px solid var(--line)", padding: 20 }} onClick={onFail}>
            Fail
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Both teams -2 ♥, collect 8♣</div>
          </button>
        </div>
      </div>
    </div>
  );
}

function DiamondsView({
  teams,
  onPass,
  onAdjust,
}: {
  teams: Team[];
  onPass: (id: string) => void;
  onAdjust: (id: string, delta: number) => void;
}) {
  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, textAlign: "center", marginBottom: 16 }}>2 of Diamonds Game</h2>
      <p className="label">Pairs at this round ({teams.length})</p>
      {teams.length === 0 && <p style={{ color: "var(--muted)", padding: "16px 0" }}>No pairs currently at the Diamonds checkpoint.</p>}
      {teams.map((t) => (
        <TeamRow
          key={t.id}
          team={t}
          right={
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button className="btn" style={{ width: "auto", minHeight: "auto", padding: "10px 16px", fontSize: 14 }} onClick={() => onPass(t.id)}>
                Mark Pass
              </button>
              <button
                className="btn-outline"
                style={{ width: "auto", minHeight: "auto", padding: "6px 10px", fontSize: 12, border: "1.6px solid var(--line)" }}
                onClick={() => {
                  const delta = Number(prompt("Heart adjustment (e.g. -1 or 2)"));
                  if (!Number.isNaN(delta) && delta !== 0) onAdjust(t.id, delta);
                }}
              >
                Adjust
              </button>
            </div>
          }
        />
      ))}
    </div>
  );
}

function OverviewView({
  teams,
  finalists,
  players,
  onCreateMatchups,
  onConfirmArrival,
  onVerifyWinner,
  onAdjust,
  onResetGame,
  onRenamePlayer,
  onRemoveTeam,
  onAddPlayer,
}: {
  teams: Team[];
  finalists: Finalist[];
  players: Player[];
  onCreateMatchups: () => void;
  onConfirmArrival: (id: string) => void;
  onVerifyWinner: (id: string) => void;
  onAdjust: (id: string, delta: number) => void;
  onResetGame: () => void;
  onRenamePlayer: (id: string, name: string) => void;
  onRemoveTeam: (id: string) => void;
  onAddPlayer: (name: string) => void;
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const waiting = teams.filter((t) => t.status === "final_waiting");
  const finalistTeams = finalists
    .map((f) => ({ ...f, team: teams.find((t) => t.id === f.team_id) }))
    .filter((f): f is Finalist & { team: Team } => !!f.team)
    .sort((a, b) => b.team.hearts_cached - a.team.hearts_cached || a.slot - b.slot);

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 28, textAlign: "center", marginBottom: 16 }}>Overview</h2>

      <button className="btn btn-outline" style={{ marginBottom: 20 }} onClick={onCreateMatchups}>
        Create random Round 1 matchups
      </button>

      <p className="label">Top 3 — Finalists ({finalists.length} / 3)</p>
      {finalistTeams.length === 0 && <p style={{ color: "var(--muted)", padding: "16px 0" }}>No finalists confirmed yet.</p>}
      {finalistTeams.map((f) => (
        <TeamRow
          key={f.team.id}
          team={f.team}
          right={
            <button className="btn" style={{ width: "auto", minHeight: "auto", padding: "10px 16px", fontSize: 13 }} onClick={() => onVerifyWinner(f.team.id)}>
              Mark winner
            </button>
          }
        />
      ))}

      <p className="label" style={{ marginTop: 20 }}>
        Awaiting arrival confirmation ({waiting.length})
      </p>
      {waiting.map((t) => (
        <TeamRow
          key={t.id}
          team={t}
          right={
            <button
              className="btn"
              disabled={finalists.length >= 3}
              style={{ width: "auto", minHeight: "auto", padding: "10px 16px", fontSize: 14 }}
              onClick={() => onConfirmArrival(t.id)}
            >
              {finalists.length >= 3 ? "Slots full" : "Confirm arrival"}
            </button>
          }
        />
      ))}

      <p className="label" style={{ marginTop: 20 }}>
        All teams ({teams.length})
      </p>
      {teams.length === 0 && <p style={{ color: "var(--muted)", padding: "16px 0" }}>No teams yet.</p>}
      {teams
        .slice()
        .sort((a, b) => b.hearts_cached - a.hearts_cached)
        .map((t) => (
          <TeamRow
            key={t.id}
            team={t}
            right={
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  className="btn-outline"
                  style={{ width: "auto", minHeight: "auto", padding: "8px 10px", fontSize: 12, border: "1.6px solid var(--line)" }}
                  onClick={() => {
                    const delta = Number(prompt("Heart adjustment (e.g. -1 or 2)"));
                    if (!Number.isNaN(delta) && delta !== 0) onAdjust(t.id, delta);
                  }}
                >
                  Adjust
                </button>
                <button
                  className="btn-outline"
                  style={{ width: "auto", minHeight: "auto", padding: "8px 10px", fontSize: 12, border: "1.6px solid var(--accent)", color: "var(--accent)" }}
                  onClick={() => {
                    if (confirm(`Remove team "${t.name}"? Members become available to re-pair.`)) onRemoveTeam(t.id);
                  }}
                >
                  Remove
                </button>
              </div>
            }
          />
        ))}

      <p className="label" style={{ marginTop: 20 }}>
        Roster ({players.length})
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Add a name…"
          value={newPlayerName}
          onChange={(e) => setNewPlayerName(e.target.value)}
          aria-label="New player name"
          style={{ flex: 1 }}
        />
        <button
          className="btn"
          style={{ width: "auto", minHeight: "auto", padding: "0 16px", fontSize: 14 }}
          disabled={!newPlayerName.trim()}
          onClick={() => {
            onAddPlayer(newPlayerName.trim());
            setNewPlayerName("");
          }}
        >
          Add
        </button>
      </div>
      {players.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderBottom: "1px solid rgba(10,10,10,0.1)" }}>
          <Portrait name={p.display_name} size={32} />
          <div style={{ flex: 1, fontSize: 15 }}>{p.display_name}</div>
          <span className="label" style={{ marginRight: 8 }}>{p.claim_status}</span>
          <button
            className="btn-outline"
            style={{ width: "auto", minHeight: "auto", padding: "6px 10px", fontSize: 12, border: "1.6px solid var(--line)" }}
            onClick={() => {
              const newName = prompt("New name", p.display_name);
              if (newName && newName.trim() && newName.trim() !== p.display_name) onRenamePlayer(p.id, newName.trim());
            }}
          >
            Edit name
          </button>
        </div>
      ))}

      <button
        className="btn"
        style={{ marginTop: 28, width: "100%", background: "var(--accent)", borderColor: "var(--accent)" }}
        onClick={() => setShowResetConfirm(true)}
      >
        Reset game
      </button>
      {showResetConfirm && (
        <ResetConfirmModal
          onClose={() => setShowResetConfirm(false)}
          onConfirm={() => {
            onResetGame();
            setShowResetConfirm(false);
          }}
        />
      )}
    </div>
  );
}

function ResetConfirmModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg)", width: "100%", maxWidth: 560, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontWeight: 400, fontSize: 22 }}>Reset game?</h2>
          <button className="btn-outline" style={{ width: 36, height: 36, border: "1.6px solid var(--line)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <p style={{ fontSize: 14, marginBottom: 16 }}>
          This clears every team, pairing, matchup, heart, card, checkpoint, finalist, winner result, and the audit
          log. It keeps the roster, the event, and manager PINs. This cannot be undone.
        </p>
        <p className="label" style={{ textAlign: "left" }}>
          Type RESET to confirm
        </p>
        <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ marginTop: 8, marginBottom: 16 }} />
        <button className="btn" style={{ width: "100%", background: "var(--accent)", borderColor: "var(--accent)" }} disabled={typed !== "RESET"} onClick={onConfirm}>
          Reset game
        </button>
      </div>
    </div>
  );
}
