"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Portrait, PortraitPair } from "@/components/Portrait";
import { GameTimer } from "@/components/GameTimer";
import { PhotoCapture } from "@/components/PhotoCapture";
import { TriviaFlow } from "@/components/TriviaFlow";
import { ClubsPairingFlow } from "@/components/ClubsPairingFlow";
import { ChickenPhotoFlow } from "@/components/ChickenPhotoFlow";
import { CongratsScreen } from "@/components/CongratsScreen";
import { CardDisplay, ProgressTrack } from "@/components/CardDisplay";
import { CARD_META, NON_FINALIST_MESSAGE, resolveShareSteal, type CardCode, type ShareStealChoice } from "@/lib/game/rules";
import {
  claimPlayer,
  sendInvite,
  cancelInvite,
  declineInvite,
  acceptInvite,
  inviteThirdPlayer,
  setReady,
  submitShareSteal,
} from "@/lib/actions/player";
import { uploadSelfie, getTeamPortraits } from "@/lib/actions/photos";

type Player = { id: string; display_name: string; claim_status: string; selfie_path: string | null };
type Team = { id: string; name: string; hearts_cached: number; status: string; active_controller_auth_id?: string | null };
type Invite = { id: string; from_player_id: string; to_player_id: string; status: string };
type Matchup = {
  id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  team_a_ready: boolean;
  team_b_ready: boolean;
  deadline_at: string | null;
  resolved_at: string | null;
};
type ShareStealSubmission = { team_id: string; choice: ShareStealChoice };

const SHARE_STEAL_RULES_COPY =
  "You'll face a pair chosen at random — watching you as closely as you watch them. Without a word between you, " +
  "decide: Share, or Steal. Both Share, and each pair gains 1 heart. One Steals while the other Shares, and the " +
  "thief walks away with 2 hearts — the generous pair gets nothing. Both Steal, and you both pay for it: 1 heart " +
  "lost, each.";

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

// Tracked separately from LOCAL_KEY (rather than folded into its shape) so
// the existing saveLocal call sites don't need to thread an extra field
// through every call. Keyed by teamId so recovering onto a different team
// later correctly shows the post-pairing screen again.
const POST_PAIRING_SEEN_KEY = "gbb_post_pairing_seen_team_id";

function loadPostPairingSeenTeamId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(POST_PAIRING_SEEN_KEY);
  } catch {
    return null;
  }
}
function savePostPairingSeenTeamId(teamId: string) {
  try {
    localStorage.setItem(POST_PAIRING_SEEN_KEY, teamId);
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
  const [shareStealSubmissions, setShareStealSubmissions] = useState<ShareStealSubmission[]>([]);
  const [revealMatchupId, setRevealMatchupId] = useState<string | null>(null);
  const [revealDismissed, setRevealDismissed] = useState(true);
  const prevMatchupStatusRef = useRef<string | null>(null);
  const [congrats, setCongrats] = useState<"round2pass" | "round3approved" | null>(null);
  const prevTeamStatusRef = useRef<string | null>(null);
  const prevHeartsRef = useRef<number | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [myTeamPhotos, setMyTeamPhotos] = useState<(string | null)[]>([]);
  const [collectedCards, setCollectedCards] = useState<CardCode[]>([]);
  const [finalistSlot, setFinalistSlot] = useState<number | null>(null);
  const [isWinner, setIsWinner] = useState(false);
  const [uiStep, setUiStep] = useState<"landing" | "selfie" | "select-name" | "confirm">("landing");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [claimPinShown, setClaimPinShown] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<"share" | "steal" | null>(null);
  const [toast, setToastMsg] = useState<string | null>(null);
  const [eventStartsAt, setEventStartsAt] = useState<string | null>(null);
  const [postPairingSeenTeamId, setPostPairingSeenTeamId] = useState<string | null>(null);

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
      setPostPairingSeenTeamId(loadPostPairingSeenTeamId());
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

  const refreshEventStartsAt = useCallback(async () => {
    const { data } = await supabase.from("events").select("starts_at").eq("id", eventId).maybeSingle();
    setEventStartsAt(data?.starts_at ?? null);
  }, [supabase, eventId]);

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
      .select("id, name, hearts_cached, status, active_controller_auth_id")
      .eq("id", teamId)
      .maybeSingle();
    setTeam(data ?? null);
  }, [supabase, teamId]);

  useEffect(() => {
    if (!teamId) return;
    getTeamPortraits(teamId).then((p) => setMyTeamPhotos(p.map((x) => x.url)));
  }, [teamId, teamMemberCount]);

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
    if (!teamId) return;
    // Not gated on team.status — a resolved Round 1 matchup must stay
    // readable after status advances to round2, or the dramatic reveal
    // screen (which renders based on matchup state, not team.status,
    // precisely to survive that transition) would lose its data mid-reveal.
    const { data } = await supabase
      .from("matchups")
      .select("id, team_a_id, team_b_id, status, team_a_ready, team_b_ready, deadline_at, resolved_at")
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
  }, [supabase, teamId]);

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
    refreshEventStartsAt();
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
    refreshEventStartsAt,
  ]);

  useEffect(() => {
    refreshMatchup();
  }, [refreshMatchup]);

  // Detects a LIVE transition into "resolved" (as opposed to loading an
  // already-resolved matchup, e.g. on a page refresh well after Round 1) —
  // only the former should trigger the dramatic reveal screen, so a reload
  // during round2+ doesn't resurrect a reveal the player already saw.
  useEffect(() => {
    if (!matchup) return;
    const prevStatus = prevMatchupStatusRef.current;
    if (matchup.status === "resolved" && prevStatus && prevStatus !== "resolved") {
      setRevealMatchupId(matchup.id);
      setRevealDismissed(false);
    }
    prevMatchupStatusRef.current = matchup.status;
  }, [matchup]);

  // Same "only a live transition, not a page-load state" rule as the
  // reveal screen above — a round2 pass is disambiguated from a mutual
  // fail (which also advances to round3) by whether hearts went up.
  useEffect(() => {
    if (!team) return;
    const prevStatus = prevTeamStatusRef.current;
    const prevHearts = prevHeartsRef.current;
    if (prevStatus === "round2" && team.status === "round3" && prevHearts !== null && team.hearts_cached > prevHearts) {
      setCongrats("round2pass");
    } else if (prevStatus === "round3" && team.status === "final_waiting") {
      setCongrats("round3approved");
    }
    prevTeamStatusRef.current = team.status;
    prevHeartsRef.current = team.hearts_cached;
  }, [team]);

  const refreshShareStealSubmissions = useCallback(async () => {
    if (!matchup || matchup.status !== "resolved") return;
    const { data } = await supabase.from("share_steal_submissions").select("team_id, choice").eq("matchup_id", matchup.id);
    setShareStealSubmissions((data as ShareStealSubmission[] | null) ?? []);
  }, [supabase, matchup]);

  useEffect(() => {
    refreshShareStealSubmissions();
  }, [refreshShareStealSubmissions]);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, refreshEventStartsAt)
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
    refreshEventStartsAt,
  ]);

  if (!ready) return null;

  // ---------- Registration ----------
  if (!playerId || !me) {
    if (claimPinShown && me) {
      return (
        <Screen startsAt={eventStartsAt}>
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
      <Screen startsAt={eventStartsAt}>
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
            onSelectClaimed={async (p) => {
              setMe(p);
              setPlayerId(p.id);
              const { data: membership } = await supabase
                .from("team_members")
                .select("team_id")
                .eq("player_id", p.id)
                .maybeSingle();
              const recoveredTeamId = membership?.team_id ?? null;
              setTeamId(recoveredTeamId);
              saveLocal({ playerId: p.id, teamId: recoveredTeamId });
              notify("Welcome back.");
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
                  if (selfie) await uploadSelfie(me.id, selfie);
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
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Pairing lobby ----------
  if (!teamId || !team) {
    return (
      <Screen startsAt={eventStartsAt}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 16, borderBottom: "1px solid rgba(10,10,10,0.15)", marginBottom: 20 }}>
          <Portrait name={me.display_name} photoUrl={selfie} size={40} />
          <div style={{ fontSize: 16 }}>{me.display_name}</div>
        </div>
        <PairingLobby
          me={me}
          players={players}
          pairedPlayerIds={pairedPlayerIds}
          invites={invites}
          onPaired={(newTeamId) => {
            setTeamId(newTeamId);
            saveLocal({ playerId, teamId: newTeamId });
          }}
          notify={notify}
        />
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Post-pairing rules (shown once per team, identical on every device) ----------
  if (postPairingSeenTeamId !== teamId) {
    return (
      <Screen startsAt={eventStartsAt}>
        <PostPairingScreen
          onContinue={() => {
            savePostPairingSeenTeamId(teamId);
            setPostPairingSeenTeamId(teamId);
          }}
        />
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Share/Steal reveal (takes over the whole screen; gated on the
  // matchup, not team.status, since status advances synchronously the
  // instant resolution happens) ----------
  if (matchup && matchup.id === revealMatchupId && matchup.status === "resolved" && !revealDismissed && opponentTeam) {
    return (
      <Screen startsAt={eventStartsAt}>
        <ShareStealReveal
          team={team}
          opponentTeam={opponentTeam}
          matchup={matchup}
          submissions={shareStealSubmissions}
          onDismiss={() => setRevealDismissed(true)}
        />
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Congratulations (Round 2 pass / Round 3 approval) ----------
  if (congrats) {
    return (
      <Screen startsAt={eventStartsAt}>
        <CongratsScreen
          teamId={team.id}
          teamName={team.name}
          eyebrow={congrats === "round2pass" ? "The bag is empty" : "The chicken approves"}
          title={congrats === "round2pass" ? "You survived the Clubs." : "Michelle lets you through."}
          subtitle={
            congrats === "round2pass"
              ? "One trial down. The next one is already watching you."
              : "Two down. One remains — and it's the one that decides everything."
          }
          onDismiss={() => setCongrats(null)}
        />
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- In-game ----------
  return (
    <Screen startsAt={eventStartsAt}>
      <PlayerHeader team={team} photos={myTeamPhotos} />
      {teamMemberCount < 3 && team.status === "round1" && !matchup && (
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
        <TriviaFlow teamId={teamId} roundNumber={1} notify={notify}>
          <ClubsPairingFlow
            teamId={teamId}
            notify={notify}
            waitingLabel="8 of Clubs"
            waitingDirection={CARD_META.heart4.direction}
          />
        </TriviaFlow>
      )}
      {team.status === "round3" && (
        <TriviaFlow teamId={teamId} roundNumber={2} notify={notify}>
          <ChickenPhotoFlow teamId={teamId} waitingLabel="2 of Diamonds" waitingDirection={CARD_META.club8.direction} />
        </TriviaFlow>
      )}
      {team.status === "final_waiting" && (
        <TriviaFlow teamId={teamId} roundNumber={3} notify={notify}>
          <CheckpointWait label="The last checkpoint" personName="Gary" direction="ONE LAST STOP. FIND GARY." />
        </TriviaFlow>
      )}
      {team.status === "eliminated" && (
        <div className="dramatic-panel">
          <p className="label flicker-in">Your hearts are gone</p>
          <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: 34, textAlign: "center" }}>
            You&apos;re out of hearts — you&apos;re eliminated.
          </h2>
          <p className="fade-up" style={{ fontSize: 17, textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
            Head to Focal Point Brewery — the others will find you there.
          </p>
        </div>
      )}
      {team.status === "non_finalist" && (
        <div className="dramatic-panel">
          <p className="label flicker-in">Game over</p>
          <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: 34, textAlign: "center" }}>
            Three pairs made it through. You weren&apos;t one of them.
          </h2>
          <p className="fade-up" style={{ fontSize: 17, textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
            {NON_FINALIST_MESSAGE}
          </p>
        </div>
      )}
      {team.status === "finalist" && isWinner && (
        <div className="dramatic-panel">
          <p className="label flicker-in">The Borderland has a winner</p>
          <div className="pop-in">
            <PortraitPair names={team.name.split(" + ")} photos={myTeamPhotos} size={92} />
          </div>
          <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 700, textAlign: "center" }}>
            You won.
          </h2>
          <p className="fade-up" style={{ fontSize: 17, textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
            {team.name} claims Gary&apos;s 26th Borderland Games — right here, at Focal Point Brewery.
          </p>
          <div style={{ fontSize: 24 }}>♥ {team.hearts_cached} remaining</div>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {collectedCards.map((c) => (
              <CardDisplay key={c} code={c} width={90} />
            ))}
          </div>
        </div>
      )}
      {team.status === "finalist" && !isWinner && (
        <div className="dramatic-panel">
          <p className="label flicker-in">You made it through</p>
          <div className="pop-in">
            <PortraitPair names={team.name.split(" + ")} photos={myTeamPhotos} size={92} />
          </div>
          <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: 36, textAlign: "center" }}>
            Finalist #{finalistSlot ?? "—"}
          </h2>
          <p className="fade-up" style={{ fontSize: 17, textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
            You&apos;re standing at Focal Point Brewery — one of only three pairs left. One final game decides
            everything.
          </p>
          <div style={{ fontSize: 24 }}>♥ {team.hearts_cached} remaining</div>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {collectedCards.map((c) => (
              <CardDisplay key={c} code={c} width={90} />
            ))}
          </div>
        </div>
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

function Screen({ children, startsAt }: { children: React.ReactNode; startsAt?: string | null }) {
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
      {startsAt !== undefined && <GameTimer startsAt={startsAt} />}
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

function PlayerHeader({ team, photos }: { team: Team; photos: (string | null)[] }) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid rgba(10,10,10,0.15)", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <PortraitPair names={team.name.split(" + ")} photos={photos} size={32} />
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
  return (
    <Stack>
      <PhotoCapture label="Smile :)" onCapture={onDone} onSkip={() => onDone(null)} />
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
  onPaired: (teamId: string) => void;
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
                  if (result.ok) onPaired(result.teamId);
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

function PostPairingScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <Stack>
      <p className="label">The game begins</p>
      <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 28, textAlign: "center" }}>
        You are no longer alone.
      </h2>
      <p style={{ fontSize: 17, lineHeight: 1.7, textAlign: "center", maxWidth: 320 }}>
        You start with <strong style={{ color: "var(--accent)" }}>5 hearts</strong>. Find the final destination
        before the other pairs get there — along the way you&apos;ll gain and lose hearts. Run out, and
        you&apos;re eliminated. The first three pairs to clear all three checkpoints and arrive qualify for one
        final game.
      </p>
      <p style={{ fontSize: 14, lineHeight: 1.6, textAlign: "center", color: "var(--muted)", maxWidth: 320 }}>
        Either of you can play from your own phone — no need to share one.
      </p>
      <button className="btn" style={{ width: "100%" }} onClick={onContinue}>
        Start Game
      </button>
    </Stack>
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

const REVEAL_COUNTDOWN_MS = 3000;

function ShareStealReveal({
  team,
  opponentTeam,
  matchup,
  submissions,
  onDismiss,
}: {
  team: Team;
  opponentTeam: Team;
  matchup: Matchup;
  submissions: ShareStealSubmission[];
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [myPhotos, setMyPhotos] = useState<(string | null)[]>([]);
  const [opponentPhotos, setOpponentPhotos] = useState<(string | null)[]>([]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getTeamPortraits(team.id).then((p) => setMyPhotos(p.map((x) => x.url)));
    getTeamPortraits(opponentTeam.id).then((p) => setOpponentPhotos(p.map((x) => x.url)));
  }, [team.id, opponentTeam.id]);

  // Anchored to the server's resolved_at, not local reveal-start time — a
  // client that loads late (backgrounded app, slow reconnect) computes 0
  // remaining immediately and lands straight on the revealed state instead
  // of rewinding or getting stuck.
  const resolvedAtMs = matchup.resolved_at ? new Date(matchup.resolved_at).getTime() : now;
  const remainingMs = Math.max(0, REVEAL_COUNTDOWN_MS - (now - resolvedAtMs));
  const revealed = remainingMs <= 0;
  const countdownNumber = Math.max(1, Math.ceil(remainingMs / 1000));

  const mySub = submissions.find((s) => s.team_id === team.id);
  const opponentSub = submissions.find((s) => s.team_id === opponentTeam.id);
  const outcome = mySub && opponentSub ? resolveShareSteal(mySub.choice, opponentSub.choice) : null;

  return (
    <div className="dramatic-panel">
      <p className="label flicker-in">{revealed ? "The choices are in" : "Deciding your fate"}</p>
      <div style={{ display: "flex", gap: 20, width: "100%", justifyContent: "center" }}>
        <RevealColumn
          label="YOUR PAIR"
          names={team.name.split(" + ")}
          photos={myPhotos}
          choice={revealed ? mySub?.choice : undefined}
          delta={revealed ? outcome?.deltaA : undefined}
        />
        <RevealColumn
          label="OPPONENTS"
          names={opponentTeam.name.split(" + ")}
          photos={opponentPhotos}
          choice={revealed ? opponentSub?.choice : undefined}
          delta={revealed ? outcome?.deltaB : undefined}
        />
      </div>
      {!revealed && (
        <div
          className="pulse-accent"
          style={{ fontFamily: "var(--font-display)", fontSize: 84, fontWeight: 700, color: "var(--accent)" }}
        >
          {countdownNumber}
        </div>
      )}
      {revealed && outcome && (
        <div className="pop-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%" }}>
          <p style={{ fontSize: 19, lineHeight: 1.6, textAlign: "center", maxWidth: 300 }}>{outcome.copyForA}</p>
          <button className="btn" style={{ width: "100%" }} onClick={onDismiss}>
            Next game
          </button>
        </div>
      )}
    </div>
  );
}

function RevealColumn({
  label,
  names,
  photos,
  choice,
  delta,
}: {
  label: string;
  names: string[];
  photos: (string | null)[];
  choice?: ShareStealChoice;
  delta?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
      <PortraitPair names={names} photos={photos} size={56} />
      <p className="label" style={{ marginTop: 4 }}>
        {label}
      </p>
      {choice !== undefined && delta !== undefined && (
        <div className="pop-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: delta > 0 ? "var(--ok)" : delta < 0 ? "var(--accent)" : "var(--fg)" }}>
            ♥ {delta > 0 ? `+${delta}` : delta}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              border: "1.6px solid var(--line)",
              padding: "4px 10px",
              textTransform: "uppercase",
            }}
          >
            {choice}
          </div>
        </div>
      )}
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
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [opponentPhotos, setOpponentPhotos] = useState<(string | null)[]>([]);

  useEffect(() => {
    if (!opponentTeam) {
      setOpponentPhotos([]);
      return;
    }
    getTeamPortraits(opponentTeam.id).then((portraits) => setOpponentPhotos(portraits.map((p) => p.url)));
  }, [opponentTeam]);

  let content: React.ReactNode;

  if (!matchup) {
    content = (
      <Stack>
        <CardDisplay code="heart4" width={180} />
        <p className="label">Somewhere, an opponent is being chosen</p>
      </Stack>
    );
  } else if (!rulesSeen) {
    content = (
      <Stack>
        <p className="label">4 of hearts</p>
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 26, textAlign: "center" }}>
          Share or Steal.
        </h2>
        <p style={{ fontSize: 17, lineHeight: 1.7, textAlign: "center", maxWidth: 320 }}>{SHARE_STEAL_RULES_COPY}</p>
        <button className="btn" style={{ width: "100%" }} onClick={() => setRulesSeen(true)}>
          I&apos;m ready
        </button>
      </Stack>
    );
  } else if (matchup.status === "pending_ready") {
    const isTeamA = matchup.team_a_id === teamId;
    const myReady = isTeamA ? matchup.team_a_ready : matchup.team_b_ready;
    content = (
      <Stack>
        <p className="label">Your opponents</p>
        {opponentTeam && (
          <>
            <div className="pop-in">
              <PortraitPair names={opponentTeam.name.split(" + ")} photos={opponentPhotos} size={104} />
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 28, textAlign: "center" }}>
              {opponentTeam.name}
            </h2>
          </>
        )}
        {!myReady ? (
          <button className="btn" style={{ width: "100%" }} onClick={() => setReady(matchup.id, teamId)}>
            I&apos;m ready
          </button>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Waiting for {opponentTeam?.name ?? "opponents"} to be ready…</p>
        )}
      </Stack>
    );
  } else if (matchup.status === "active") {
    const mySubmitted = myChoice !== null;
    const locked = mySubmitted;
    content = (
      <Stack>
        <p className="label">Select your action</p>
        <div style={{ display: "flex", gap: 16, width: "100%" }}>
          {(["share", "steal"] as const).map((choice) => (
            <button
              key={choice}
              className="btn-outline"
              aria-pressed={myChoice === choice}
              disabled={locked}
              style={{
                flex: 1,
                border: "2px solid var(--line)",
                padding: "36px 12px",
                background: myChoice === choice ? "var(--btn-bg)" : "transparent",
                color: myChoice === choice ? "var(--btn-fg)" : "var(--fg)",
                cursor: locked ? "not-allowed" : "pointer",
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
          disabled={!myChoice || submitting || locked}
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
  } else {
    // resolved
    content = (
      <Stack>
        <p className="label">Result</p>
        <p style={{ fontSize: 18, textAlign: "center" }}>The match has been resolved — check your heart total above.</p>
      </Stack>
    );
  }

  return (
    <>
      {content}
      {rulesSeen && (
        <button
          className="btn-outline"
          style={{ width: "100%", marginTop: 12, fontSize: 13, padding: "10px 16px", minHeight: "auto" }}
          onClick={() => setRulesModalOpen(true)}
        >
          View Rules
        </button>
      )}
      {rulesModalOpen && <RulesModal onClose={() => setRulesModalOpen(false)} />}
    </>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg)", width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontWeight: 400, fontSize: 22 }}>Share or Steal — Rules</h2>
          <button className="btn-outline" style={{ width: 36, height: 36, border: "1.6px solid var(--line)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <p style={{ fontSize: 17, lineHeight: 1.7 }}>{SHARE_STEAL_RULES_COPY}</p>
      </div>
    </div>
  );
}

function CheckpointWait({ label, personName, direction }: { label: string; personName: string; direction: string }) {
  return (
    <Stack>
      <p className="label">{label}</p>
      <div style={{ border: "2px solid var(--line)", padding: "26px 20px", width: "100%" }}>
        <p style={{ fontSize: 19, textAlign: "center", fontWeight: 600, lineHeight: 1.5, letterSpacing: "0.01em" }}>
          {direction}
        </p>
      </div>
      <p style={{ fontSize: 15, textAlign: "center", color: "var(--muted)", lineHeight: 1.6, maxWidth: 300 }}>
        {personName} is waiting there. Only they can let you continue.
      </p>
    </Stack>
  );
}
