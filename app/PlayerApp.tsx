"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Portrait, PortraitPair } from "@/components/Portrait";
import { CardDisplay, ProgressTrack } from "@/components/CardDisplay";
import { CARD_META, NON_FINALIST_MESSAGE, type CardCode } from "@/lib/game/rules";
import {
  claimPlayer,
  recoverWithPin,
  sendInvite,
  cancelInvite,
  declineInvite,
  acceptInvite,
  inviteThirdPlayer,
  setReady,
  submitShareSteal,
} from "@/lib/actions/player";

type Player = { id: string; display_name: string; claim_status: string; selfie_path: string | null };
type Team = { id: string; name: string; hearts_cached: number; status: string };
type Invite = { id: string; from_player_id: string; to_player_id: string; status: string };
type Matchup = {
  id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  team_a_ready: boolean;
  team_b_ready: boolean;
  deadline_at: string | null;
};

const LOCAL_KEY = "gbb_player_local";

function loadLocal(): { playerId: string | null; teamId: string | null } {
  if (typeof window === "undefined") return { playerId: null, teamId: null };
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : { playerId: null, teamId: null };
  } catch {
    return { playerId: null, teamId: null };
  }
}
function saveLocal(v: { playerId: string | null; teamId: string | null }) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

export function PlayerApp({ eventId }: { eventId: string }) {
  const supabase = createClient();
  const [ready, setReadyState] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [pairedPlayerIds, setPairedPlayerIds] = useState<Set<string>>(new Set());
  const [teamMemberCount, setTeamMemberCount] = useState(2);
  const [me, setMe] = useState<Player | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [collectedCards, setCollectedCards] = useState<CardCode[]>([]);
  const [finalistSlot, setFinalistSlot] = useState<number | null>(null);
  const [isWinner, setIsWinner] = useState(false);
  const [uiStep, setUiStep] = useState<"landing" | "selfie" | "select-name" | "confirm" | "recovery">("landing");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [pinShown, setPinShown] = useState<string | null>(null);
  const [claimPinShown, setClaimPinShown] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<"share" | "steal" | null>(null);
  const [toast, setToastMsg] = useState<string | null>(null);

  function notify(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  }

  // bootstrap: anonymous auth + local ids
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        await supabase.auth.signInAnonymously();
      }
      const local = loadLocal();
      setPlayerId(local.playerId);
      setTeamId(local.teamId);
      setReadyState(true);
    })();
  }, [supabase]);

  const refreshRoster = useCallback(async () => {
    const { data } = await supabase
      .from("players")
      .select("id, display_name, claim_status, selfie_path")
      .eq("event_id", eventId)
      .order("display_name");
    setPlayers(data ?? []);
    if (playerId) setMe((data ?? []).find((p) => p.id === playerId) ?? null);
  }, [supabase, eventId, playerId]);

  const refreshPairedPlayers = useCallback(async () => {
    const { data } = await supabase.from("team_members").select("player_id");
    setPairedPlayerIds(new Set((data ?? []).map((m) => m.player_id)));
  }, [supabase]);

  // Discovers a team the *other* pair member didn't create themselves — e.g.
  // the inviter's device never calls acceptInvite, so it has no other way to
  // learn a team now exists for them once the invitee accepts.
  const refreshMyTeamMembership = useCallback(async () => {
    if (!playerId || teamId) return;
    const { data } = await supabase.from("team_members").select("team_id").eq("player_id", playerId).maybeSingle();
    if (data) {
      setTeamId(data.team_id);
      saveLocal({ playerId, teamId: data.team_id });
    }
  }, [supabase, playerId, teamId]);

  const refreshTeam = useCallback(async () => {
    if (!teamId) return;
    const { data } = await supabase
      .from("teams")
      .select("id, name, hearts_cached, status")
      .eq("id", teamId)
      .maybeSingle();
    setTeam(data ?? null);
  }, [supabase, teamId]);

  const refreshTeamMemberCount = useCallback(async () => {
    if (!teamId) return;
    const { count } = await supabase.from("team_members").select("id", { count: "exact", head: true }).eq("team_id", teamId);
    setTeamMemberCount(count ?? 2);
  }, [supabase, teamId]);

  const refreshInvites = useCallback(async () => {
    if (!playerId) return;
    const { data } = await supabase
      .from("pair_invites")
      .select("id, from_player_id, to_player_id, status")
      .eq("status", "pending")
      .or(`from_player_id.eq.${playerId},to_player_id.eq.${playerId}`);
    setInvites(data ?? []);
  }, [supabase, playerId]);

  const refreshMatchup = useCallback(async () => {
    if (!teamId || !team) return;
    if (!["round1"].includes(team.status)) {
      setMatchup(null);
      return;
    }
    const { data } = await supabase
      .from("matchups")
      .select("id, team_a_id, team_b_id, status, team_a_ready, team_b_ready, deadline_at")
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setMatchup(data ?? null);
    if (data) {
      const oppId = data.team_a_id === teamId ? data.team_b_id : data.team_a_id;
      const { data: opp } = await supabase.from("teams").select("id, name, hearts_cached, status").eq("id", oppId).maybeSingle();
      setOpponentTeam(opp ?? null);
    }
  }, [supabase, teamId, team]);

  const refreshCards = useCallback(async () => {
    if (!teamId) return;
    const { data } = await supabase.from("collected_cards").select("card_code").eq("team_id", teamId);
    setCollectedCards((data ?? []).map((c) => c.card_code as CardCode));
  }, [supabase, teamId]);

  const refreshFinalist = useCallback(async () => {
    if (!teamId) return;
    const { data } = await supabase.from("finalists").select("slot").eq("team_id", teamId).maybeSingle();
    setFinalistSlot(data?.slot ?? null);
  }, [supabase, teamId]);

  const refreshWinner = useCallback(async () => {
    if (!teamId) return;
    const { data } = await supabase
      .from("winner_results")
      .select("id")
      .eq("team_id", teamId)
      .eq("reversed", false)
      .maybeSingle();
    setIsWinner(!!data);
  }, [supabase, teamId]);

  useEffect(() => {
    if (!ready) return;
    refreshRoster();
    refreshPairedPlayers();
    refreshMyTeamMembership();
    refreshTeam();
    refreshTeamMemberCount();
    refreshInvites();
    refreshCards();
    refreshFinalist();
    refreshWinner();
  }, [
    ready,
    refreshRoster,
    refreshPairedPlayers,
    refreshMyTeamMembership,
    refreshTeam,
    refreshTeamMemberCount,
    refreshInvites,
    refreshCards,
    refreshFinalist,
    refreshWinner,
  ]);

  useEffect(() => {
    refreshMatchup();
  }, [refreshMatchup]);

  // Realtime: keep everything live
  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel("player-app")
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, refreshRoster)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, () => {
        refreshPairedPlayers();
        refreshMyTeamMembership();
        refreshTeamMemberCount();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pair_invites" }, refreshInvites)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, refreshTeam)
      .on("postgres_changes", { event: "*", schema: "public", table: "matchups" }, refreshMatchup)
      .on("postgres_changes", { event: "*", schema: "public", table: "collected_cards" }, refreshCards)
      .on("postgres_changes", { event: "*", schema: "public", table: "finalists" }, refreshFinalist)
      .on("postgres_changes", { event: "*", schema: "public", table: "winner_results" }, refreshWinner)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    ready,
    supabase,
    refreshRoster,
    refreshPairedPlayers,
    refreshMyTeamMembership,
    refreshTeamMemberCount,
    refreshInvites,
    refreshTeam,
    refreshMatchup,
    refreshCards,
    refreshFinalist,
    refreshWinner,
  ]);

  if (!ready) return null;

  // ---------- Registration ----------
  if (!playerId || !me) {
    if (claimPinShown && me) {
      return (
        <Screen>
          <Stack>
            <Portrait name={me.display_name} photoUrl={selfie} size={96} />
            <h2 style={{ fontWeight: 400, fontSize: 24 }}>Save this, just in case</h2>
            <p style={{ fontSize: 15, textAlign: "center", maxWidth: 320 }}>
              If you ever picked the wrong name by mistake, tell a manager this PIN and they can fix it for you.
            </p>
            <div className="label">Your recovery PIN</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 40, letterSpacing: "0.3em" }}>{claimPinShown}</div>
            <button
              className="btn btn-outline"
              style={{ width: "100%" }}
              onClick={() => {
                navigator.clipboard?.writeText(claimPinShown);
                notify("PIN copied.");
              }}
            >
              Copy PIN
            </button>
            <button
              className="btn"
              style={{ width: "100%" }}
              onClick={() => {
                setPlayerId(me.id);
                saveLocal({ playerId: me.id, teamId: null });
                setClaimPinShown(null);
              }}
            >
              Got it, continue
            </button>
          </Stack>
        </Screen>
      );
    }
    return (
      <Screen>
        {uiStep === "landing" && (
          <Stack>
            <div style={{ textAlign: "center" }}>
              <img
                src="/Gary_logo.svg"
                alt="Gary's 26th Borderland Games"
                style={{ width: "100%", maxWidth: 340, height: "auto" }}
              />
            </div>
            <button className="btn" style={{ width: "100%" }} onClick={() => setUiStep("selfie")}>
              Enter Borderland
            </button>
          </Stack>
        )}
        {uiStep === "selfie" && (
          <SelfieStep
            onDone={(photo) => {
              setSelfie(photo);
              setUiStep("select-name");
            }}
          />
        )}
        {uiStep === "select-name" && (
          <NameSelectStep
            players={players}
            onSelectAvailable={(p) => {
              setMe(p);
              setUiStep("confirm");
            }}
            onSelectClaimed={(p) => {
              setMe(p);
              setUiStep("recovery");
            }}
          />
        )}
        {uiStep === "confirm" && me && (
          <Stack>
            <Portrait name={me.display_name} photoUrl={selfie} size={120} />
            <h2 style={{ fontWeight: 400, fontSize: 28 }}>Hi, {me.display_name.split(" ")[0]}!</h2>
            <button
              className="btn"
              style={{ width: "100%" }}
              onClick={async () => {
                const result = await claimPlayer(me.id);
                if (result.ok) {
                  setClaimPinShown(result.recoveryPin);
                } else {
                  notify("That name was just claimed by someone else.");
                  setUiStep("select-name");
                }
              }}
            >
              Yes, continue
            </button>
            <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => setUiStep("select-name")}>
              Not me
            </button>
          </Stack>
        )}
        {uiStep === "recovery" && me && (
          <RecoveryStep
            playerName={me.display_name}
            onRecovered={(recoveredTeamId) => {
              setPlayerId(me.id);
              setTeamId(recoveredTeamId);
              saveLocal({ playerId: me.id, teamId: recoveredTeamId });
              notify("This pair has continued on this device.");
            }}
            onBack={() => setUiStep("select-name")}
          />
        )}
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Pairing lobby ----------
  if (!teamId || !team) {
    return (
      <Screen>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 16, borderBottom: "1px solid rgba(10,10,10,0.15)", marginBottom: 20 }}>
          <Portrait name={me.display_name} photoUrl={selfie} size={40} />
          <div style={{ fontSize: 16 }}>{me.display_name}</div>
        </div>
        <PairingLobby
          me={me}
          players={players}
          pairedPlayerIds={pairedPlayerIds}
          invites={invites}
          onPaired={(newTeamId, pin) => {
            setTeamId(newTeamId);
            saveLocal({ playerId, teamId: newTeamId });
            setPinShown(pin);
          }}
          notify={notify}
        />
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Rules + PIN (shown once right after pairing) ----------
  if (pinShown) {
    return (
      <Screen>
        <Stack>
          <h2 style={{ fontWeight: 400, fontSize: 24 }}>Rules & Recovery</h2>
          <p style={{ fontSize: 15, textAlign: "center", maxWidth: 320 }}>
            You and your partner start with <strong style={{ color: "var(--accent)" }}>7 hearts</strong>. Only one of
            you needs to stay logged in — your partner can take over on another device with this PIN if your phone
            dies.
          </p>
          <div className="label">Your recovery PIN</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 40, letterSpacing: "0.3em" }}>{pinShown}</div>
          <button
            className="btn btn-outline"
            style={{ width: "100%" }}
            onClick={() => {
              navigator.clipboard?.writeText(pinShown);
              notify("PIN copied.");
            }}
          >
            Copy PIN
          </button>
          <button className="btn" style={{ width: "100%" }} onClick={() => setPinShown(null)}>
            Start Game
          </button>
        </Stack>
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- In-game ----------
  return (
    <Screen>
      <PlayerHeader team={team} />
      {teamMemberCount < 3 && !["finalist", "non_finalist"].includes(team.status) && (
        <AddThirdPlayer teamId={teamId} players={players} pairedPlayerIds={pairedPlayerIds} notify={notify} />
      )}
      {team.status === "round1" && (
        <Round1Flow
          teamId={teamId}
          team={team}
          matchup={matchup}
          opponentTeam={opponentTeam}
          myChoice={myChoice}
          setMyChoice={setMyChoice}
          notify={notify}
        />
      )}
      {team.status === "round2" && (
        <CheckpointWait
          label="8 of Clubs"
          personName="Ajan"
          direction={CARD_META.heart4.direction}
        />
      )}
      {team.status === "round3" && (
        <CheckpointWait
          label="2 of Diamonds"
          personName="Michelle"
          direction={CARD_META.club8.direction}
        />
      )}
      {team.status === "final_waiting" && (
        <CheckpointWait label="Final checkpoint" personName="Gary" direction={CARD_META.diamond2.direction} />
      )}
      {team.status === "non_finalist" && (
        <Stack>
          <p className="label">【 Game Failed 】</p>
          <p style={{ fontSize: 20, textAlign: "center", maxWidth: 300 }}>{NON_FINALIST_MESSAGE}</p>
        </Stack>
      )}
      {team.status === "finalist" && isWinner && (
        <Stack>
          <p className="label">【 Game Clear 】</p>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 700, textAlign: "center" }}>
            You won!
          </h2>
          <p style={{ fontSize: 16, textAlign: "center", maxWidth: 300 }}>
            {team.name} takes Gary&apos;s 26th Borderland Games. Congratulations!
          </p>
          <div style={{ fontSize: 24 }}>♥ {team.hearts_cached} remaining</div>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            {collectedCards.map((c) => (
              <CardDisplay key={c} code={c} width={90} />
            ))}
          </div>
        </Stack>
      )}
      {team.status === "finalist" && !isWinner && (
        <Stack>
          <p className="label">You qualified!</p>
          <h2 style={{ fontSize: 40, fontWeight: 400 }}>Finalist #{finalistSlot ?? "—"}</h2>
          <div style={{ fontSize: 24 }}>♥ {team.hearts_cached} remaining</div>
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            {collectedCards.map((c) => (
              <CardDisplay key={c} code={c} width={90} />
            ))}
          </div>
        </Stack>
      )}
      <div style={{ marginTop: 24 }}>
        <ProgressTrack collected={collectedCards} finalist={team.status === "finalist"} />
      </div>
      <Toast msg={toast} />
    </Screen>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: 428,
        margin: "0 auto",
        minHeight: "100dvh",
        padding: "max(16px, env(safe-area-inset-top)) 20px 40px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </main>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center", flex: 1, justifyContent: "center" }}>
      {children}
    </div>
  );
}

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        right: 12,
        maxWidth: 428,
        margin: "0 auto",
        background: "var(--fg)",
        color: "var(--bg)",
        padding: "12px 16px",
        fontSize: 14,
        textAlign: "center",
      }}
    >
      {msg}
    </div>
  );
}

function PlayerHeader({ team }: { team: Team }) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid rgba(10,10,10,0.15)", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <PortraitPair names={team.name.split(" + ")} size={32} />
        <div>
          <div style={{ fontSize: 16 }}>{team.name}</div>
          <div style={{ fontSize: 14 }}>♥ {team.hearts_cached}</div>
        </div>
      </div>
      <button
        className="btn-outline"
        style={{ width: 40, height: 40, minHeight: 40, padding: 0, border: "1.6px solid var(--line)" }}
        aria-label="Leaderboard"
        onClick={() => setShowLeaderboard(true)}
      >
        🏆
      </button>
      {showLeaderboard && <LeaderboardModal myTeamId={team.id} onClose={() => setShowLeaderboard(false)} />}
    </header>
  );
}

function LeaderboardModal({ myTeamId, onClose }: { myTeamId: string; onClose: () => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("teams")
      .select("id, name, hearts_cached, status")
      .then(({ data }) => setTeams(data ?? []));
  }, []);

  const sorted = [...teams].sort((a, b) => b.hearts_cached - a.hearts_cached);
  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg)", width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontWeight: 400, fontSize: 22 }}>Leaderboard</h2>
          <button className="btn-outline" style={{ width: 36, height: 36, border: "1.6px solid var(--line)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="label">Top 3</p>
        {top3.map((t) => (
          <LeaderboardRow key={t.id} team={t} highlight={t.id === myTeamId} />
        ))}
        {rest.length > 0 && (
          <>
            <p className="label" style={{ marginTop: 20 }}>
              Remaining pairs
            </p>
            {rest.map((t) => (
              <LeaderboardRow key={t.id} team={t} highlight={t.id === myTeamId} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function LeaderboardRow({ team, highlight }: { team: Team; highlight: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 4px",
        borderBottom: "1px solid rgba(10,10,10,0.1)",
        borderLeft: highlight ? "3px solid var(--accent)" : "3px solid transparent",
      }}
    >
      <PortraitPair names={team.name.split(" + ")} size={32} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: highlight ? 700 : 400 }}>
          {team.name}
          {highlight && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--accent)" }}>YOU</span>}
        </div>
        <div style={{ fontSize: 13 }}>♥ {team.hearts_cached}</div>
      </div>
    </div>
  );
}

function SelfieStep({ onDone }: { onDone: (photo: string | null) => void }) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!videoEl) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then((s) => {
        stream = s;
        videoEl.srcObject = s;
        setStreaming(true);
      })
      .catch(() => setStreaming(false));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [videoEl]);

  function capture() {
    if (!videoEl || !streaming) {
      onDone(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    const side = Math.min(videoEl.videoWidth, videoEl.videoHeight);
    // Mirror the capture to match the mirrored preview — this is what a
    // "selfie" is expected to look like, not the raw front-camera feed.
    ctx?.translate(240, 0);
    ctx?.scale(-1, 1);
    ctx?.drawImage(videoEl, (videoEl.videoWidth - side) / 2, (videoEl.videoHeight - side) / 2, side, side, 0, 0, 240, 240);
    onDone(canvas.toDataURL("image/jpeg", 0.7));
  }

  return (
    <Stack>
      <p className="label">Smile :)</p>
      <div style={{ width: 240, height: 240, border: "2px solid var(--line)", background: "var(--portrait-bg)", overflow: "hidden" }}>
        <video
          ref={setVideoEl}
          playsInline
          autoPlay
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "grayscale(1)",
            transform: "scaleX(-1)",
            display: streaming ? "block" : "none",
          }}
        />
      </div>
      <button className="btn" style={{ width: "100%" }} onClick={capture}>
        Take Photo
      </button>
      <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => onDone(null)}>
        Use a placeholder instead
      </button>
    </Stack>
  );
}

function NameSelectStep({
  players,
  onSelectAvailable,
  onSelectClaimed,
}: {
  players: Player[];
  onSelectAvailable: (p: Player) => void;
  onSelectClaimed: (p: Player) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = players.filter((p) => p.display_name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <h2 style={{ fontWeight: 400, fontSize: 24, marginBottom: 16 }}>Select your name</h2>
      <input type="text" placeholder="Search roster…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ marginTop: 8, flex: 1, overflowY: "auto" }}>
        {filtered.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: "1px solid rgba(10,10,10,0.1)" }}>
            <Portrait name={p.display_name} size={36} />
            <div style={{ flex: 1 }}>{p.display_name}</div>
            <button className="btn" style={{ width: "auto", minHeight: "auto", padding: "10px 18px", fontSize: 15 }} onClick={() => (p.claim_status === "available" ? onSelectAvailable(p) : onSelectClaimed(p))}>
              {p.claim_status === "available" ? "Select" : "Recover"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecoveryStep({
  playerName,
  onRecovered,
  onBack,
}: {
  playerName: string;
  onRecovered: (teamId: string) => void;
  onBack: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function submit() {
    // find the team this player belongs to
    const { data: membership } = await supabase
      .from("team_members")
      .select("team_id, players!inner(display_name)")
      .eq("players.display_name", playerName)
      .maybeSingle();
    if (!membership) {
      setError("Could not find that player's team.");
      return;
    }
    const result = await recoverWithPin(membership.team_id, pin);
    if (result.ok) {
      onRecovered(membership.team_id);
    } else {
      setError("Recovery PIN incorrect. Try again.");
    }
  }

  return (
    <Stack>
      <h2 style={{ fontWeight: 400, fontSize: 24 }}>Recover {playerName}</h2>
      <p className="label">Enter 4-digit recovery PIN</p>
      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        style={{ textAlign: "center", letterSpacing: "0.5em", fontSize: 24, width: 160 }}
      />
      {error && <p style={{ color: "var(--accent)", fontSize: 14 }}>{error}</p>}
      <button className="btn" style={{ width: "100%" }} onClick={submit}>
        Continue
      </button>
      <button className="btn btn-outline" style={{ width: "100%" }} onClick={onBack}>
        Back
      </button>
    </Stack>
  );
}

function PairingLobby({
  me,
  players,
  pairedPlayerIds,
  invites,
  onPaired,
  notify,
}: {
  me: Player;
  players: Player[];
  pairedPlayerIds: Set<string>;
  invites: Invite[];
  onPaired: (teamId: string, pin: string) => void;
  notify: (msg: string) => void;
}) {
  const incoming = invites.filter((i) => i.to_player_id === me.id);
  const outgoing = invites.find((i) => i.from_player_id === me.id);
  // Only people who've actually signed in (claimed their identity) and
  // aren't already on a team show up as invitable — not the whole roster.
  const available = players.filter(
    (p) => p.claim_status === "claimed" && p.id !== me.id && !pairedPlayerIds.has(p.id),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <h2 style={{ fontWeight: 400, fontSize: 24, textAlign: "center", marginBottom: 12 }}>Pair up</h2>
      <p className="label" style={{ textAlign: "left", marginTop: 16 }}>
        Invites
      </p>
      {incoming.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14, padding: "8px 0" }}>No pending invites.</p>}
      {incoming.map((inv) => {
        const fromPlayer = players.find((p) => p.id === inv.from_player_id);
        if (!fromPlayer) return null;
        return (
          <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0" }}>
            <Portrait name={fromPlayer.display_name} size={36} />
            <div style={{ flex: 1 }}>{fromPlayer.display_name}</div>
            <button
              className="btn btn-outline"
              style={{ width: 40, minHeight: 40, padding: 0 }}
              disabled={pendingId === inv.id}
              onClick={async () => {
                setPendingId(inv.id);
                try {
                  await declineInvite(inv.id);
                } finally {
                  setPendingId(null);
                }
              }}
              aria-label={`Decline invite from ${fromPlayer.display_name}`}
            >
              ✕
            </button>
            <button
              className="btn"
              style={{ width: 40, minHeight: 40, padding: 0 }}
              disabled={pendingId === inv.id}
              onClick={async () => {
                setPendingId(inv.id);
                try {
                  const result = await acceptInvite(inv.id);
                  if (result.ok) onPaired(result.teamId, result.pin);
                  else notify("That invite is no longer available.");
                } finally {
                  setPendingId(null);
                }
              }}
              aria-label={`Accept invite from ${fromPlayer.display_name}`}
            >
              ✓
            </button>
          </div>
        );
      })}

      <p className="label" style={{ textAlign: "left", marginTop: 20 }}>
        Available
      </p>
      {available.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0" }}>
          <Portrait name={p.display_name} size={36} />
          <div style={{ flex: 1 }}>{p.display_name}</div>
          <button
            className="btn"
            style={{ width: "auto", minHeight: "auto", padding: "10px 18px", fontSize: 15 }}
            disabled={(!!outgoing && outgoing.to_player_id !== p.id) || pendingId === p.id}
            onClick={async () => {
              setPendingId(p.id);
              try {
                if (outgoing?.to_player_id === p.id) {
                  await cancelInvite(outgoing.id);
                } else {
                  const result = await sendInvite(me.id, p.id);
                  if (!result.ok) notify("You already have an outgoing invite.");
                }
              } finally {
                setPendingId(null);
              }
            }}
          >
            {outgoing?.to_player_id === p.id ? "Cancel" : "Invite"}
          </button>
        </div>
      ))}
    </div>
  );
}

function AddThirdPlayer({
  teamId,
  players,
  pairedPlayerIds,
  notify,
}: {
  teamId: string;
  players: Player[];
  pairedPlayerIds: Set<string>;
  notify: (msg: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const available = players.filter((p) => p.claim_status === "claimed" && !pairedPlayerIds.has(p.id));

  if (!expanded) {
    return (
      <button className="btn-outline" style={{ width: "100%", marginBottom: 20, fontSize: 14 }} onClick={() => setExpanded(true)}>
        + Add a 3rd player
      </button>
    );
  }

  return (
    <div style={{ marginBottom: 20, border: "1px solid var(--line)", padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p className="label" style={{ margin: 0 }}>
          Add a 3rd player
        </p>
        <button
          className="btn-outline"
          style={{ width: 32, height: 32, minHeight: 32, padding: 0, border: "1.6px solid var(--line)" }}
          aria-label="Close"
          onClick={() => setExpanded(false)}
        >
          ✕
        </button>
      </div>
      {available.length === 0 && <p style={{ color: "var(--muted)", fontSize: 14 }}>No unpaired players available.</p>}
      {available.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}>
          <Portrait name={p.display_name} size={32} />
          <div style={{ flex: 1 }}>{p.display_name}</div>
          <button
            className="btn"
            style={{ width: "auto", minHeight: "auto", padding: "8px 16px", fontSize: 14 }}
            disabled={pendingId === p.id}
            onClick={async () => {
              setPendingId(p.id);
              try {
                const result = await inviteThirdPlayer(teamId, p.id);
                if (result.ok) {
                  notify(`${p.display_name} added to your team.`);
                  setExpanded(false);
                } else {
                  notify(result.reason === "team_full" ? "Your team is already full." : "Could not add that player.");
                }
              } finally {
                setPendingId(null);
              }
            }}
          >
            Add
          </button>
        </div>
      ))}
    </div>
  );
}

function Round1Flow({
  teamId,
  matchup,
  opponentTeam,
  myChoice,
  setMyChoice,
  notify,
}: {
  teamId: string;
  team: Team;
  matchup: Matchup | null;
  opponentTeam: Team | null;
  myChoice: "share" | "steal" | null;
  setMyChoice: (c: "share" | "steal" | null) => void;
  notify: (msg: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [rulesSeen, setRulesSeen] = useState(false);

  if (!matchup) {
    return (
      <Stack>
        <CardDisplay code="heart4" width={180} />
        <p className="label">Waiting for Round 1 matchups to be assigned</p>
      </Stack>
    );
  }

  if (!rulesSeen) {
    return (
      <Stack>
        <p className="label">Share or steal — how to play</p>
        <p style={{ fontSize: 15, textAlign: "center", maxWidth: 320 }}>
          You&apos;ll be randomly assigned a pair to play against. Without consulting the opposing pair, decide
          whether you&apos;d like to share or steal a pot of 2 extra hearts. If both pairs select Share, each pair
          gains 1 heart. If only one pair selects Steal, that pair gains 2 hearts and the pair that selected Share
          gains nothing. If both pairs select Steal, both pairs lose 1 heart.
        </p>
        <button className="btn" style={{ width: "100%" }} onClick={() => setRulesSeen(true)}>
          I&apos;m ready
        </button>
      </Stack>
    );
  }

  const isTeamA = matchup.team_a_id === teamId;
  const myReady = isTeamA ? matchup.team_a_ready : matchup.team_b_ready;
  const bothReady = matchup.team_a_ready && matchup.team_b_ready;

  if (matchup.status === "pending_ready") {
    return (
      <Stack>
        <p className="label">Your opponents</p>
        {opponentTeam && <h2 style={{ fontWeight: 400, fontSize: 28, textAlign: "center" }}>{opponentTeam.name}</h2>}
        {!myReady ? (
          <button className="btn" style={{ width: "100%" }} onClick={() => setReady(matchup.id, teamId)}>
            I&apos;m ready
          </button>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Waiting for {opponentTeam?.name ?? "opponents"} to be ready…</p>
        )}
      </Stack>
    );
  }

  if (matchup.status === "active") {
    const mySubmitted = myChoice !== null;
    return (
      <Stack>
        <p className="label">Select your action</p>
        <div style={{ display: "flex", gap: 16, width: "100%" }}>
          {(["share", "steal"] as const).map((choice) => (
            <button
              key={choice}
              className="btn-outline"
              aria-pressed={myChoice === choice}
              disabled={mySubmitted}
              style={{
                flex: 1,
                border: "2px solid var(--line)",
                padding: "36px 12px",
                background: myChoice === choice ? "var(--btn-bg)" : "transparent",
                color: myChoice === choice ? "var(--btn-fg)" : "var(--fg)",
                cursor: mySubmitted ? "not-allowed" : "pointer",
              }}
              onClick={() => setMyChoice(choice)}
            >
              {choice === "share" ? "Share" : "Steal"}
            </button>
          ))}
        </div>
        <button
          className="btn"
          style={{ width: "100%" }}
          disabled={!myChoice || submitting}
          onClick={async () => {
            if (!myChoice) return;
            setSubmitting(true);
            try {
              const result = await submitShareSteal(matchup.id, teamId, myChoice);
              if (!result.ok) notify("Already submitted.");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </Stack>
    );
  }

  // resolved
  return (
    <Stack>
      <p className="label">Result</p>
      <p style={{ fontSize: 18, textAlign: "center" }}>The match has been resolved — check your heart total above.</p>
    </Stack>
  );
}

function CheckpointWait({ label, personName, direction }: { label: string; personName: string; direction: string }) {
  return (
    <Stack>
      <p className="label">{label}</p>
      <div style={{ border: "2px solid var(--line)", padding: 16, width: "100%" }}>
        <p style={{ fontSize: 16, textAlign: "center", fontWeight: 600 }}>{direction}</p>
      </div>
      <p style={{ fontSize: 15, textAlign: "center", color: "var(--muted)" }}>
        Once you&apos;re there, {personName} will explain the game in person, then record your result here.
      </p>
    </Stack>
  );
}
