"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Portrait } from "@/components/Portrait";
import { GameTimer } from "@/components/GameTimer";
import { PhotoCapture } from "@/components/PhotoCapture";
import { TriviaFlow } from "@/components/TriviaFlow";
import { ClubsPairingFlow } from "@/components/ClubsPairingFlow";
import { ChickenPhotoFlow } from "@/components/ChickenPhotoFlow";
import { CongratsScreen } from "@/components/CongratsScreen";
import { GameStartCountdown, GameNotStartedScreen } from "@/components/GameStartCountdown";
import { CardDisplay, ProgressTrack } from "@/components/CardDisplay";
import {
  CARD_META,
  FINALIST_SLOTS,
  GAME_COUNTDOWN_DURATION_MS,
  NON_FINALIST_MESSAGE,
  resolveShareSteal,
  type CardCode,
  type ShareStealChoice,
} from "@/lib/game/rules";
import {
  formTeam,
  recoverTeamWithPin,
  setReady,
  submitShareSteal,
  expireShareSteal,
} from "@/lib/actions/player";
import { getTeamPhotoUrl } from "@/lib/actions/photos";

type Player = { id: string; display_name: string };
export type Team = { id: string; name: string; hearts_cached: number; status: string; active_controller_auth_id?: string | null };
export type Matchup = {
  id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  team_a_ready: boolean;
  team_b_ready: boolean;
  deadline_at: string | null;
  resolved_at: string | null;
};
export type ShareStealSubmission = { team_id: string; choice: ShareStealChoice };

const SHARE_STEAL_RULES_COPY =
  "You'll be paired up against a random pair. Find them and get ready to share, or steal. If you both choose " +
  "share, each pair gains 1 heart. If just one of you steals, that pair gains 2 hearts and the other gets 0. " +
  "However, if both of you steal you both lose 1 heart. Once you're ready you'll be assigned your pair to find.";

const LOCAL_KEY = "gbb_player_local";

function loadLocal(): { teamId: string | null } {
  if (typeof window === "undefined") return { teamId: null };
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : { teamId: null };
  } catch {
    return { teamId: null };
  }
}
function saveLocal(v: { teamId: string | null }) {
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

// Same durability problem as postPairingSeenTeamId, for the Share/Steal
// reveal: tracking "have I seen this" with a live-transition ref instead of
// a persisted value meant a page load that landed on an *already*-resolved
// matchup (e.g. reloading right as your partner's submission resolved it)
// never got flagged as "new" — the reveal, and its countdown, just silently
// never appeared. Keying off matchup id (not team id) since a team only
// ever has one Round 1 matchup.
const REVEAL_SEEN_KEY = "gbb_reveal_seen_matchup_id";

function loadRevealSeenMatchupId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(REVEAL_SEEN_KEY);
  } catch {
    return null;
  }
}
function saveRevealSeenMatchupId(matchupId: string) {
  try {
    localStorage.setItem(REVEAL_SEEN_KEY, matchupId);
  } catch {
    // ignore
  }
}

// Surfaces the actual failure instead of a generic "try again" — critical
// while diagnosing live, so the message a player reads out loud is enough
// to tell us what's actually wrong (auth, network, stale deploy, etc.)
// rather than another round of guessing blind.
function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export function PlayerApp({ eventId }: { eventId: string }) {
  const supabase = createClient();
  const [ready, setReadyState] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [teamedPlayerIds, setTeamedPlayerIds] = useState<Set<string>>(new Set());
  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [shareStealSubmissions, setShareStealSubmissions] = useState<ShareStealSubmission[]>([]);
  const [revealSeenMatchupId, setRevealSeenMatchupId] = useState<string | null>(null);
  const [congrats, setCongrats] = useState<"round2pass" | "round3approved" | null>(null);
  const prevTeamStatusRef = useRef<string | null>(null);
  const prevHeartsRef = useRef<number | null>(null);
  const [opponentTeam, setOpponentTeam] = useState<Team | null>(null);
  const [myTeamPhoto, setMyTeamPhoto] = useState<string | null>(null);
  const [collectedCards, setCollectedCards] = useState<CardCode[]>([]);
  const [finalistSlot, setFinalistSlot] = useState<number | null>(null);
  const [isWinner, setIsWinner] = useState(false);
  const [formStep, setFormStep] = useState<"landing" | "select-teammates" | "photo" | "recover">("landing");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [forming, setForming] = useState(false);
  const [recoveryPinShown, setRecoveryPinShown] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<"share" | "steal" | null>(null);
  const [toast, setToastMsg] = useState<string | null>(null);
  const [eventStartsAt, setEventStartsAt] = useState<string | null>(null);
  const [countdownStartedAt, setCountdownStartedAt] = useState<string | null>(null);
  const [countdownDone, setCountdownDone] = useState(false);
  const [connected, setConnected] = useState(true);
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
      setTeamId(local.teamId);
      setPostPairingSeenTeamId(loadPostPairingSeenTeamId());
      setRevealSeenMatchupId(loadRevealSeenMatchupId());
      setReadyState(true);
    })();
  }, [supabase]);

  const refreshRoster = useCallback(async () => {
    const { data } = await supabase.from("players").select("id, display_name").eq("event_id", eventId).order("display_name");
    setPlayers(data ?? []);
  }, [supabase, eventId]);

  const refreshEventStartsAt = useCallback(async () => {
    const { data } = await supabase.from("events").select("starts_at, countdown_started_at").eq("id", eventId).maybeSingle();
    setEventStartsAt(data?.starts_at ?? null);
    setCountdownStartedAt(data?.countdown_started_at ?? null);
  }, [supabase, eventId]);

  const refreshTeamedPlayerIds = useCallback(async () => {
    const { data } = await supabase.from("team_members").select("player_id");
    setTeamedPlayerIds(new Set((data ?? []).map((m) => m.player_id)));
  }, [supabase]);

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
    getTeamPhotoUrl(teamId).then(setMyTeamPhoto);
  }, [teamId]);

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
    refreshTeamedPlayerIds();
    refreshTeam();
    refreshCards();
    refreshFinalist();
    refreshWinner();
    refreshEventStartsAt();
  }, [ready, refreshRoster, refreshTeamedPlayerIds, refreshTeam, refreshCards, refreshFinalist, refreshWinner, refreshEventStartsAt]);

  useEffect(() => {
    refreshMatchup();
  }, [refreshMatchup]);

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

  // Recompute from real elapsed time whenever the timestamp changes, rather
  // than always resetting to false. A manager can trigger the countdown more
  // than once (e.g. a second game night), so it still needs to re-show for a
  // genuinely fresh timestamp — but the very first fetch on page load can
  // just as easily land on a timestamp from minutes or days ago, and
  // unconditionally resetting to false used to spuriously block, then
  // self-correct a moment later, yanking players out of whatever step of
  // team-formation step they were already on the instant the fetch resolved.
  useEffect(() => {
    if (!countdownStartedAt) {
      setCountdownDone(false);
      return;
    }
    const elapsed = Date.now() - new Date(countdownStartedAt).getTime() >= GAME_COUNTDOWN_DURATION_MS;
    setCountdownDone(elapsed);
  }, [countdownStartedAt]);

  // Not gated on matchup.status — RLS already restricts a pre-resolution
  // read to just this team's own row (never the opponent's), so fetching
  // at any stage is safe and is what lets a partner's device reflect "we
  // already submitted" the instant the other partner does, rather than
  // only finding out after trying to submit and getting rejected.
  const refreshShareStealSubmissions = useCallback(async () => {
    if (!matchup) return;
    const { data } = await supabase.from("share_steal_submissions").select("team_id, choice").eq("matchup_id", matchup.id);
    setShareStealSubmissions((data as ShareStealSubmission[] | null) ?? []);
    // Depends on matchup?.id (a stable primitive), not the whole matchup
    // object — every refetch produces a new object reference even when
    // nothing meaningful changed, which was churning this callback's
    // identity and, with it, restarting the poll effect below on every
    // single cycle instead of letting it run on a steady 3s cadence.
  }, [supabase, matchup?.id]);

  useEffect(() => {
    refreshShareStealSubmissions();
  }, [refreshShareStealSubmissions]);

  // Belt-and-suspenders alongside the realtime subscription below: this is
  // a short (max 60s), high-stakes window where a dropped/laggy websocket
  // (real risk on event wifi with dozens of devices) would otherwise leave
  // a player staring at a stale "select your action" screen after their
  // partner already locked in a choice, or after the match actually
  // resolved. A cheap poll while the window is open catches what a missed
  // realtime event would otherwise silently drop. It also sweeps expired
  // matchups: if the deadline has passed and either side never submitted,
  // any of the (up to) four connected devices — not just the specific team
  // that's missing a submission — pushes it to resolution, since the
  // original design (each team only auto-submitting its own default) went
  // silently nowhere whenever that one team's device was backgrounded or
  // closed right at the deadline.
  //
  // Also keeps polling for a while *after* resolution (until this device has
  // actually shown the reveal, per revealSeenMatchupId) — a team that
  // reported needing to manually refresh to see the reveal is exactly the
  // symptom of a missed realtime event landing right at resolution, so this
  // makes sure the resolved matchup + opponent data gets re-fetched
  // regardless of whether that one realtime message ever arrives.
  const awaitingReveal = matchup?.status === "resolved" && matchup.id !== revealSeenMatchupId;
  useEffect(() => {
    if (matchup?.status !== "active" && !awaitingReveal) return;
    const interval = setInterval(() => {
      refreshMatchup();
      refreshShareStealSubmissions();
      if (matchup?.status === "active" && matchup.deadline_at && new Date(matchup.deadline_at).getTime() <= Date.now()) {
        expireShareSteal(matchup.id).catch(() => {});
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [matchup?.status, awaitingReveal, refreshMatchup, refreshShareStealSubmissions]);

  // Realtime: keep everything live
  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel("player-app")
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, refreshRoster)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, refreshTeamedPlayerIds)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, refreshTeam)
      .on("postgres_changes", { event: "*", schema: "public", table: "matchups" }, refreshMatchup)
      .on("postgres_changes", { event: "*", schema: "public", table: "share_steal_submissions" }, refreshShareStealSubmissions)
      .on("postgres_changes", { event: "*", schema: "public", table: "collected_cards" }, refreshCards)
      .on("postgres_changes", { event: "*", schema: "public", table: "finalists" }, refreshFinalist)
      .on("postgres_changes", { event: "*", schema: "public", table: "winner_results" }, refreshWinner)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, refreshEventStartsAt)
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    ready,
    supabase,
    refreshRoster,
    refreshTeamedPlayerIds,
    refreshTeam,
    refreshMatchup,
    refreshShareStealSubmissions,
    refreshCards,
    refreshFinalist,
    refreshWinner,
    refreshEventStartsAt,
  ]);

  if (!ready) return null;

  // ---------- Pre-game gate: nobody can form a team until an admin starts
  // the game and the 3-minute countdown clears. Keyed
  // on !teamId rather than the countdown fields alone, so a team that's
  // already formed and playing can never get bounced back here — e.g. if a
  // manager cancels/restarts the countdown well after the event is underway.
  if (!teamId && !countdownDone) {
    if (!countdownStartedAt) {
      return (
        <Screen connected={connected}>
          <GameNotStartedScreen />
        </Screen>
      );
    }
    return (
      <Screen connected={connected}>
        <GameStartCountdown countdownStartedAt={countdownStartedAt} onComplete={() => setCountdownDone(true)} />
      </Screen>
    );
  }

  // ---------- Team formation / recovery ----------
  if (!teamId || !team) {
    if (recoveryPinShown) {
      return (
        <Screen startsAt={eventStartsAt} connected={connected}>
          <Stack>
            <h2 style={{ fontWeight: 400, fontSize: "var(--fs-h4)" }}>Save this — just in case</h2>
            <p style={{ fontSize: "var(--fs-body)", textAlign: "center", maxWidth: 320 }}>
              If this phone dies, a teammate can use this PIN to pick up your team from their own phone.
            </p>
            <div className="label">Your team&apos;s recovery PIN</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 40, letterSpacing: "0.3em" }}>{recoveryPinShown}</div>
            <button
              className="btn btn-outline"
              style={{ width: "100%" }}
              onClick={() => {
                navigator.clipboard?.writeText(recoveryPinShown);
                notify("PIN copied.");
              }}
            >
              Copy PIN
            </button>
            <button className="btn" style={{ width: "100%" }} onClick={() => setRecoveryPinShown(null)}>
              Got it, continue
            </button>
          </Stack>
        </Screen>
      );
    }
    return (
      <Screen startsAt={eventStartsAt} connected={connected}>
        {formStep === "landing" && (
          <Stack>
            <div style={{ textAlign: "center" }}>
              <img
                src="/Gary_logo.svg"
                alt="Gary's 26th Borderland Games"
                style={{ width: "100%", maxWidth: 340, height: "auto" }}
              />
            </div>
            <button className="btn" style={{ width: "100%" }} onClick={() => setFormStep("select-teammates")}>
              Enter Borderland
            </button>
            <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => setFormStep("recover")}>
              My team already exists — recover with PIN
            </button>
          </Stack>
        )}
        {formStep === "select-teammates" && (
          <SelectTeammatesStep
            players={players}
            teamedPlayerIds={teamedPlayerIds}
            onContinue={(ids) => {
              setSelectedPlayerIds(ids);
              setFormStep("photo");
            }}
          />
        )}
        {formStep === "photo" && (
          <TeamPhotoStep
            forming={forming}
            onBack={() => setFormStep("select-teammates")}
            onDone={async (photoDataUrl) => {
              setForming(true);
              try {
                const result = await formTeam(selectedPlayerIds, photoDataUrl);
                if (result.ok) {
                  setTeamId(result.teamId);
                  saveLocal({ teamId: result.teamId });
                  setRecoveryPinShown(result.recoveryPin);
                } else {
                  notify(
                    result.reason === "already_on_team"
                      ? "One of these players is already on a team."
                      : "Couldn't form your team — try again.",
                  );
                  setFormStep("select-teammates");
                }
              } catch {
                notify("Couldn't submit — check your connection and try again.");
              } finally {
                setForming(false);
              }
            }}
          />
        )}
        {formStep === "recover" && (
          <RecoverTeamStep
            onBack={() => setFormStep("landing")}
            onRecovered={(recoveredTeamId) => {
              setTeamId(recoveredTeamId);
              saveLocal({ teamId: recoveredTeamId });
              notify("Welcome back.");
            }}
            notify={notify}
          />
        )}
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Post-pairing rules (shown once per team, identical on every device) ----------
  if (postPairingSeenTeamId !== teamId) {
    return (
      <Screen startsAt={eventStartsAt} connected={connected}>
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
  // instant resolution happens). Uses a persisted "seen" id rather than a
  // live-transition ref so a page load that lands directly on an
  // already-resolved matchup (e.g. reloading right as the other partner's
  // submission resolves it) still shows the reveal instead of skipping
  // straight to the static "resolved" text with no countdown or outcome. ----------
  if (matchup && matchup.status === "resolved" && matchup.id !== revealSeenMatchupId && opponentTeam) {
    return (
      <Screen startsAt={eventStartsAt} connected={connected}>
        <ShareStealReveal
          team={team}
          opponentTeam={opponentTeam}
          matchup={matchup}
          submissions={shareStealSubmissions}
          onDismiss={() => {
            saveRevealSeenMatchupId(matchup.id);
            setRevealSeenMatchupId(matchup.id);
          }}
        />
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- Congratulations (Round 2 pass / Round 3 approval) ----------
  if (congrats) {
    return (
      <Screen startsAt={eventStartsAt} connected={connected}>
        <CongratsScreen
          teamId={team.id}
          teamName={team.name}
          eyebrow={congrats === "round2pass" ? "The bag is empty" : "The chicken approves"}
          title={congrats === "round2pass" ? "You survived the Clubs." : "Michelle lets you through."}
          onDismiss={() => setCongrats(null)}
        />
        <Toast msg={toast} />
      </Screen>
    );
  }

  // ---------- In-game ----------
  return (
    <Screen startsAt={eventStartsAt} connected={connected}>
      <PlayerHeader team={team} photo={myTeamPhoto} />
      {team.status === "round1" && (
        <Round1Flow
          teamId={teamId}
          team={team}
          matchup={matchup}
          opponentTeam={opponentTeam}
          myChoice={myChoice}
          setMyChoice={setMyChoice}
          mySubmittedChoice={shareStealSubmissions.find((s) => s.team_id === teamId)?.choice ?? null}
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
          <CheckpointWait label="The last checkpoint" direction="FIND GARY AT FOCAL POINT BREWERY." />
        </TriviaFlow>
      )}
      {team.status === "eliminated" && (
        <>
          <div className="dramatic-panel">
            <p className="label flicker-in">Your hearts are gone</p>
            <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h1)", textAlign: "center" }}>
              You&apos;re out of hearts — you&apos;re eliminated.
            </h2>
            <p className="fade-up" style={{ fontSize: "var(--fs-body-lg)", textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
              Head to Focal Point Brewery — the others will find you there.
            </p>
            {collectedCards.length > 0 && (
              <div className="fade-up" style={{ display: "flex", gap: 12, marginTop: 4 }}>
                {collectedCards.map((c) => (
                  <CardDisplay key={c} code={c} width={90} />
                ))}
              </div>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <p className="label">Standings</p>
            <TeamLeaderboardList myTeamId={team.id} />
          </div>
        </>
      )}
      {team.status === "non_finalist" && (
        <>
          <div className="dramatic-panel">
            <p className="label flicker-in">Game over</p>
            <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h1)", textAlign: "center" }}>
              {FINALIST_SLOTS} pairs made it through. You weren&apos;t one of them.
            </h2>
            <p className="fade-up" style={{ fontSize: "var(--fs-body-lg)", textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
              {NON_FINALIST_MESSAGE}
            </p>
            {collectedCards.length > 0 && (
              <div className="fade-up" style={{ display: "flex", gap: 12, marginTop: 4 }}>
                {collectedCards.map((c) => (
                  <CardDisplay key={c} code={c} width={90} />
                ))}
              </div>
            )}
          </div>
          <div style={{ marginTop: 24 }}>
            <p className="label">Standings</p>
            <TeamLeaderboardList myTeamId={team.id} />
          </div>
        </>
      )}
      {team.status === "finalist" && isWinner && (
        <div className="dramatic-panel">
          <p className="label flicker-in">The Borderland has a winner</p>
          <div className="pop-in">
            <Portrait name={team.name} photoUrl={myTeamPhoto} size={92} />
          </div>
          <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-display)", fontWeight: 700, textAlign: "center" }}>
            You won.
          </h2>
          <p className="fade-up" style={{ fontSize: "var(--fs-body-lg)", textAlign: "center", maxWidth: 320, lineHeight: 1.6, color: "var(--muted)" }}>
            {team.name} claims Gary&apos;s 26th Borderland Games — right here, at Focal Point Brewery.
          </p>
          <div style={{ fontSize: "var(--fs-h4)" }}>♥ {team.hearts_cached} remaining</div>
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
            <Portrait name={team.name} photoUrl={myTeamPhoto} size={92} />
          </div>
          <h2 className="fade-up" style={{ fontFamily: "var(--font-display)", fontSize: "var(--fs-h1)", textAlign: "center" }}>
            Finalist #{finalistSlot ?? "—"}
          </h2>
          <div style={{ fontSize: "var(--fs-h4)" }}>♥ {team.hearts_cached} remaining</div>
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

function Screen({
  children,
  startsAt,
  connected = true,
}: {
  children: React.ReactNode;
  startsAt?: string | null;
  connected?: boolean;
}) {
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
      {!connected && (
        <div
          role="status"
          style={{
            textAlign: "center",
            fontSize: "var(--fs-xs)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--accent)",
            border: "1.6px solid var(--accent)",
            padding: "6px 10px",
            marginBottom: 10,
          }}
        >
          Reconnecting…
        </div>
      )}
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
        fontSize: "var(--fs-md)",
        textAlign: "center",
      }}
    >
      {msg}
    </div>
  );
}

function PlayerHeader({ team, photo }: { team: Team; photo: string | null }) {
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16, borderBottom: "1px solid rgba(10,10,10,0.15)", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Portrait name={team.name} photoUrl={photo} size={32} />
        <div>
          <div style={{ fontSize: "var(--fs-body)" }}>{team.name}</div>
          <div style={{ fontSize: "var(--fs-md)" }}>♥ {team.hearts_cached}</div>
        </div>
      </div>
      <button
        className="btn-outline"
        style={{ width: 44, height: 44, minHeight: 44, padding: 0, border: "1.6px solid var(--line)" }}
        aria-label="Leaderboard"
        onClick={() => setShowLeaderboard(true)}
      >
        🏆
      </button>
      {showLeaderboard && <LeaderboardModal myTeamId={team.id} onClose={() => setShowLeaderboard(false)} />}
    </header>
  );
}

// Kept live (not a one-time fetch) since this now also renders embedded on
// the eliminated/non-finalist screens, where a team can sit for the rest of
// the event watching other teams' progress rather than just a static "you
// lost" message.
function useAllTeamsLeaderboard(): Team[] {
  const [teams, setTeams] = useState<Team[]>([]);
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const fetchTeams = () => {
      supabase
        .from("teams")
        .select("id, name, hearts_cached, status")
        .then(({ data }) => {
          if (active) setTeams(data ?? []);
        });
    };
    fetchTeams();
    const channel = supabase
      .channel("leaderboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, fetchTeams)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);
  return teams;
}

function TeamLeaderboardList({ myTeamId }: { myTeamId: string }) {
  const teams = useAllTeamsLeaderboard();
  const sorted = [...teams].sort((a, b) => b.hearts_cached - a.hearts_cached);
  return (
    <>
      {sorted.map((t, i) => (
        <LeaderboardRow key={t.id} rank={i + 1} team={t} highlight={t.id === myTeamId} />
      ))}
    </>
  );
}

function LeaderboardModal({ myTeamId, onClose }: { myTeamId: string; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,10,10,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 }}>
      <div style={{ background: "var(--bg)", width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontWeight: 400, fontSize: "var(--fs-h4)" }}>Leaderboard</h2>
          <button className="btn-outline" style={{ width: 44, height: 44, border: "1.6px solid var(--line)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <TeamLeaderboardList myTeamId={myTeamId} />
      </div>
    </div>
  );
}

export function LeaderboardRow({ team, highlight, rank }: { team: Team; highlight: boolean; rank: number }) {
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
      <div style={{ width: 22, textAlign: "center", fontSize: "var(--fs-sm)", color: "var(--muted)" }}>{rank}</div>
      <Portrait name={team.name} size={32} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "var(--fs-body)", fontWeight: highlight ? 700 : 400 }}>
          {team.name}
          {highlight && <span style={{ marginLeft: 8, fontSize: "var(--fs-2xs)", color: "var(--accent)" }}>YOU</span>}
        </div>
        <div style={{ fontSize: "var(--fs-sm)" }}>♥ {team.hearts_cached}</div>
      </div>
    </div>
  );
}

function SelectTeammatesStep({
  players,
  teamedPlayerIds,
  onContinue,
}: {
  players: Player[];
  teamedPlayerIds: Set<string>;
  onContinue: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const available = players.filter(
    (p) => !teamedPlayerIds.has(p.id) && p.display_name.toLowerCase().includes(query.toLowerCase()),
  );

  function toggle(id: string) {
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= 3) return cur;
      return [...cur, id];
    });
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <h2 style={{ fontWeight: 400, fontSize: "var(--fs-h4)", marginBottom: 8, textAlign: "center" }}>Who&apos;s on your team?</h2>
      <p style={{ fontSize: "var(--fs-body)", textAlign: "center", color: "var(--muted)", marginBottom: 16 }}>
        Pick the 2 or 3 people standing here with you right now.
      </p>
      <input type="text" placeholder="Search roster…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ marginTop: 8, flex: 1, overflowY: "auto" }}>
        {available.length === 0 && <p style={{ color: "var(--muted)", padding: "16px 0", textAlign: "center" }}>Everyone&apos;s already on a team.</p>}
        {available.map((p) => {
          const isSelected = selected.includes(p.id);
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => toggle(p.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 10px",
                marginBottom: 6,
                border: isSelected ? "2px solid var(--accent)" : "1.6px solid transparent",
                background: isSelected ? "rgba(198,40,40,0.06)" : "transparent",
                cursor: "pointer",
              }}
            >
              <Portrait name={p.display_name} size={36} />
              <div style={{ flex: 1 }}>{p.display_name}</div>
              {isSelected && <span style={{ color: "var(--accent)", fontSize: "var(--fs-h4)" }}>✓</span>}
            </div>
          );
        })}
      </div>
      <button className="btn" style={{ width: "100%", marginTop: 12 }} disabled={selected.length < 2} onClick={() => onContinue(selected)}>
        {selected.length < 2 ? "Select at least 2" : `Continue with ${selected.length}`}
      </button>
    </div>
  );
}

function TeamPhotoStep({
  forming,
  onBack,
  onDone,
}: {
  forming: boolean;
  onBack: () => void;
  onDone: (photo: string) => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);

  if (photo) {
    return (
      <Stack>
        <p className="label">Everyone in frame?</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- local capture preview, no benefit from next/image here */}
        <img
          src={photo}
          alt="Your team"
          style={{ width: 240, height: 240, objectFit: "cover", border: "2px solid var(--line)", filter: "grayscale(1) contrast(1.05)" }}
        />
        <button className="btn" style={{ width: "100%" }} disabled={forming} onClick={() => onDone(photo)}>
          {forming ? "Just a sec…" : "Use this photo"}
        </button>
        <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => setPhoto(null)}>
          Retake
        </button>
      </Stack>
    );
  }

  return (
    <Stack>
      <PhotoCapture label="Get the whole team in frame" buttonLabel="Take Photo" onCapture={(dataUrl) => setPhoto(dataUrl)} />
      <button className="btn btn-outline" style={{ width: "100%" }} onClick={onBack}>
        Back
      </button>
    </Stack>
  );
}

function RecoverTeamStep({
  onBack,
  onRecovered,
  notify,
}: {
  onBack: () => void;
  onRecovered: (teamId: string) => void;
  notify: (msg: string) => void;
}) {
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("teams")
      .select("id, name")
      .order("name")
      .then(({ data }) => setTeams(data ?? []));
  }, []);

  if (!selectedTeamId) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <h2 style={{ fontWeight: 400, fontSize: "var(--fs-h4)", marginBottom: 16, textAlign: "center" }}>Which team is yours?</h2>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {teams.map((t) => (
            <button
              key={t.id}
              className="btn-outline"
              style={{ width: "100%", padding: 14, marginBottom: 8, border: "1.6px solid var(--line)", textAlign: "left" }}
              onClick={() => setSelectedTeamId(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <button className="btn btn-outline" style={{ width: "100%", marginTop: 12 }} onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <Stack>
      <p className="label">Enter your team&apos;s PIN</p>
      <input
        type="text"
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        placeholder="4-digit PIN"
        style={{ fontFamily: "var(--font-mono)", fontSize: 32, letterSpacing: "0.3em", textAlign: "center" }}
      />
      <button
        className="btn"
        style={{ width: "100%" }}
        disabled={pin.length !== 4 || recovering}
        onClick={async () => {
          setRecovering(true);
          try {
            const result = await recoverTeamWithPin(selectedTeamId, pin);
            if (result.ok) onRecovered(result.teamId);
            else notify(result.reason === "wrong_pin" ? "Wrong PIN — try again." : "Could not recover that team.");
          } catch {
            notify("Couldn't submit — check your connection and try again.");
          } finally {
            setRecovering(false);
          }
        }}
      >
        {recovering ? "Checking…" : "Recover team"}
      </button>
      <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => setSelectedTeamId(null)}>
        Back
      </button>
    </Stack>
  );
}

export function PostPairingScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <Stack>
      <p className="bracket-title">【 GAME START 】</p>
      <p style={{ fontSize: "var(--fs-body-lg)", lineHeight: 1.6, textAlign: "center", maxWidth: 320 }}>
        Your team starts with <strong style={{ color: "var(--accent)" }}>5 hearts</strong>. Lose them all and
        you&apos;re out.
      </p>
      <p style={{ fontSize: "var(--fs-md)", lineHeight: 1.6, textAlign: "center", color: "var(--muted)", maxWidth: 320 }}>
        Whoever's holding this phone plays for the whole team — if it dies, use your recovery PIN on another phone.
      </p>
      <button className="btn" style={{ width: "100%" }} onClick={onContinue}>
        Continue
      </button>
    </Stack>
  );
}

export const REVEAL_COUNTDOWN_MS = 3000;

export function ShareStealReveal({
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
  const [myPhoto, setMyPhoto] = useState<string | null>(null);
  const [opponentPhoto, setOpponentPhoto] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getTeamPhotoUrl(team.id).then(setMyPhoto);
    getTeamPhotoUrl(opponentTeam.id).then(setOpponentPhoto);
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
          name={team.name}
          photo={myPhoto}
          choice={revealed ? mySub?.choice : undefined}
          delta={revealed ? outcome?.deltaA : undefined}
        />
        <RevealColumn
          label="OPPONENTS"
          name={opponentTeam.name}
          photo={opponentPhoto}
          choice={revealed ? opponentSub?.choice : undefined}
          delta={revealed ? outcome?.deltaB : undefined}
        />
      </div>
      {!revealed && (
        <div
          className="pulse-accent"
          style={{ fontFamily: "var(--font-display)", fontSize: 120, fontWeight: 700, color: "var(--accent)" }}
        >
          {countdownNumber}
        </div>
      )}
      {revealed && outcome && (
        <div className="pop-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%" }}>
          <p style={{ fontSize: "var(--fs-h4)", fontWeight: 500, lineHeight: 1.5, textAlign: "center", maxWidth: 320 }}>{outcome.copyForA}</p>
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
  name,
  photo,
  choice,
  delta,
}: {
  label: string;
  name: string;
  photo: string | null;
  choice?: ShareStealChoice;
  delta?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
      <Portrait name={name} photoUrl={photo} size={76} />
      <p className="label" style={{ marginTop: 4 }}>
        {label}
      </p>
      {choice !== undefined && delta !== undefined && (
        <div className="pop-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: "var(--fs-badge)", fontWeight: 700, color: delta > 0 ? "var(--ok)" : delta < 0 ? "var(--accent)" : "var(--fg)" }}>
            ♥ {delta > 0 ? `+${delta}` : delta}
          </div>
          <div
            style={{
              fontSize: "var(--fs-md)",
              fontWeight: 600,
              letterSpacing: "0.06em",
              border: "2px solid var(--line)",
              padding: "6px 14px",
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
  mySubmittedChoice,
  notify,
}: {
  teamId: string;
  team: Team;
  matchup: Matchup | null;
  opponentTeam: Team | null;
  myChoice: "share" | "steal" | null;
  setMyChoice: (c: "share" | "steal" | null) => void;
  mySubmittedChoice: ShareStealChoice | null;
  notify: (msg: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [readyPending, setReadyPending] = useState(false);
  // mySubmittedChoice only reflects reality once the parent's realtime
  // subscription (or its poll fallback) round-trips — which can lag by a
  // beat, or longer on flaky event wifi. Setting this the instant our own
  // submit call succeeds means the lock-in is immediate on THIS device
  // regardless of that round-trip, instead of leaving a window where
  // tapping Submit still visibly lets you change your answer.
  const [locallySubmitted, setLocallySubmitted] = useState(false);
  const [rulesSeen, setRulesSeen] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [opponentPhoto, setOpponentPhoto] = useState<string | null>(null);
  const [teammateDraftChoice, setTeammateDraftChoice] = useState<"share" | "steal" | null>(null);
  const draftChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    if (!opponentTeam) {
      setOpponentPhoto(null);
      return;
    }
    getTeamPhotoUrl(opponentTeam.id).then(setOpponentPhoto);
  }, [opponentTeam]);

  // Ephemeral, not persisted — a lightweight broadcast so a still-deciding
  // teammate's tap shows up on their partner's screen before either of them
  // hits Submit, instead of each device only ever reflecting its own local
  // tap. Scoped to the TEAM (not the matchup) so only your own teammate ever
  // joins this channel — the matchup is shared with the opposing team, and
  // broadcasting on a matchup-scoped channel would leak your live pick to
  // the pair you're facing off against before either side has submitted.
  useEffect(() => {
    if (!matchup || matchup.status !== "active") return;
    const supabase = createClient();
    const channel = supabase
      .channel(`share-steal-draft-team-${teamId}`)
      .on("broadcast", { event: "draft-choice" }, ({ payload }) => {
        if (payload?.choice === "share" || payload?.choice === "steal") setTeammateDraftChoice(payload.choice);
      })
      .subscribe();
    draftChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      draftChannelRef.current = null;
    };
  }, [matchup?.id, matchup?.status, teamId]);

  useEffect(() => {
    if (!myChoice) return;
    draftChannelRef.current?.send({ type: "broadcast", event: "draft-choice", payload: { teamId, choice: myChoice } });
  }, [myChoice, teamId]);

  // Ticks only during the 60-second selection window (matchup.deadline_at,
  // set server-side the instant both teams ready up) — was tracked all
  // along but never actually rendered anywhere. Also recomputes immediately
  // on visibilitychange: a backgrounded/locked phone throttles or fully
  // pauses setInterval, so without this, a device that was put down right
  // before the deadline would sit on a stale "time left" reading — and
  // never fire the auto-submit below — until whenever the browser next
  // happened to resume the timer, rather than the instant it's reopened.
  const [now, setNow] = useState(() => Date.now());
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!matchup || matchup.status !== "active") return;
    // Correct immediately, don't wait for the first tick — now was last set
    // whenever Round1Flow mounted (well before deadline_at exists, e.g.
    // during the pending_ready wait), so without this the very first render
    // after both teams ready up shows an inflated "time left" that then
    // visibly jumps down once the interval catches up a second later.
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [matchup?.id, matchup?.status]);

  const mySubmitted = mySubmittedChoice !== null || locallySubmitted;
  const deadlineMs = matchup?.status === "active" && matchup.deadline_at ? new Date(matchup.deadline_at).getTime() : null;
  const remainingMs = deadlineMs !== null ? Math.max(0, deadlineMs - now) : null;
  const secondsLeft = remainingMs !== null ? Math.ceil(remainingMs / 1000) : null;

  // Auto-submit at 0, mirroring TriviaFlow's timeout handling — honors
  // whatever this team was leaning toward (my own tap or my teammate's live
  // one), falling back to Share only if nobody had picked anything at all.
  // On failure, un-claim the ref so the next tick (now/matchup will keep
  // changing) retries instead of permanently giving up after one attempt.
  useEffect(() => {
    if (!matchup || mySubmitted || remainingMs === null || remainingMs > 0 || autoSubmittedRef.current) return;
    autoSubmittedRef.current = true;
    submitShareSteal(matchup.id, teamId, myChoice ?? teammateDraftChoice ?? "share", true)
      .then((result) => {
        if (result.ok || result.reason === "already_submitted") {
          setLocallySubmitted(true);
        } else {
          autoSubmittedRef.current = false;
        }
      })
      .catch(() => {
        autoSubmittedRef.current = false;
      });
    // now (not remainingMs) drives retries: remainingMs is clamped to 0 and
    // stops changing value once the deadline passes, so a retry after a
    // failed attempt needs the raw ticking clock as a dependency, or the
    // effect would never re-run once autoSubmittedRef is reset.
  }, [matchup, mySubmitted, remainingMs, now, teamId, myChoice, teammateDraftChoice]);

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
        <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--fs-h3)", textAlign: "center" }}>
          Share or Steal.
        </h2>
        <p style={{ fontSize: "var(--fs-body-lg)", lineHeight: 1.7, textAlign: "center", maxWidth: 320 }}>{SHARE_STEAL_RULES_COPY}</p>
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
              <Portrait name={opponentTeam.name} photoUrl={opponentPhoto} size={104} />
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--fs-h3)", textAlign: "center" }}>
              {opponentTeam.name}
            </h2>
          </>
        )}
        {!myReady ? (
          <button
            className="btn"
            style={{ width: "100%" }}
            disabled={readyPending}
            onClick={async () => {
              setReadyPending(true);
              try {
                await setReady(matchup.id, teamId);
              } catch {
                notify("Couldn't submit — check your connection and try again.");
              } finally {
                setReadyPending(false);
              }
            }}
          >
            {readyPending ? "Just a sec…" : "I'm ready"}
          </button>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: "var(--fs-md)" }}>Waiting for {opponentTeam?.name ?? "opponents"} to be ready…</p>
        )}
      </Stack>
    );
  } else if (matchup.status === "active") {
    // mySubmittedChoice is server-derived — the instant either partner
    // submits, both devices reflect it via realtime, instead of the other
    // partner only finding out by trying to submit and getting rejected.
    // teammateDraftChoice folds in the same way pre-submit: it only ever
    // comes from your own teammate (see the team-scoped broadcast above),
    // so there's no separate "hint" state to call out — it just reads as
    // your team's current pick, exactly like your own tap would.
    const effectiveChoice = mySubmittedChoice ?? myChoice ?? teammateDraftChoice;
    const urgent = secondsLeft !== null && secondsLeft <= 10;
    content = (
      <Stack>
        {opponentTeam && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: -4 }}>
            <Portrait name={opponentTeam.name} photoUrl={opponentPhoto} size={36} />
            <div>
              <p className="label" style={{ marginBottom: 0 }}>
                Facing
              </p>
              <div style={{ fontSize: "var(--fs-body)" }}>{opponentTeam.name}</div>
            </div>
          </div>
        )}
        {secondsLeft !== null && (
          <div style={{ textAlign: "center" }}>
            <p className="label" style={{ marginBottom: 2 }}>
              {mySubmitted ? "Waiting for the other team" : "Time left"}
            </p>
            <p
              className={urgent && !mySubmitted ? "pulse-accent" : undefined}
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: "var(--fs-h1)",
                lineHeight: 1,
                color: urgent && !mySubmitted ? "var(--accent)" : "var(--fg)",
              }}
            >
              {secondsLeft}s
            </p>
          </div>
        )}
        <p className="label">{mySubmitted ? "Choice locked in" : "Select your action"}</p>
        <div style={{ display: "flex", gap: 16, width: "100%" }}>
          {(["share", "steal"] as const).map((choice) => (
            <button
              key={choice}
              className="btn-outline"
              aria-pressed={effectiveChoice === choice}
              disabled={mySubmitted}
              style={{
                flex: 1,
                border: "2px solid var(--line)",
                padding: "36px 12px",
                background: effectiveChoice === choice ? "var(--btn-bg)" : "transparent",
                color: effectiveChoice === choice ? "var(--btn-fg)" : "var(--fg)",
                cursor: mySubmitted ? "not-allowed" : "pointer",
              }}
              onClick={() => setMyChoice(choice)}
            >
              {choice === "share" ? "Share" : "Steal"}
            </button>
          ))}
        </div>
        {!mySubmitted && (
          <button
            className="btn"
            style={{ width: "100%" }}
            disabled={!myChoice || submitting}
            onClick={async () => {
              if (!myChoice) return;
              setSubmitting(true);
              try {
                const result = await submitShareSteal(matchup.id, teamId, myChoice);
                if (result.ok || result.reason === "already_submitted") {
                  // Either way the team's choice is now locked in server-side
                  // (ours, or a partner's that beat us to it) — lock the UI
                  // immediately rather than waiting on realtime/poll to catch
                  // up, which is exactly the lag that let Submit look like it
                  // did nothing.
                  setLocallySubmitted(true);
                  if (!result.ok) notify("Your partner already submitted for your team.");
                } else {
                  notify(`Couldn't submit (${result.reason}) — try again.`);
                }
              } catch (e) {
                notify(`Couldn't submit: ${errorMessage(e)}`);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        )}
      </Stack>
    );
  } else {
    // resolved
    content = (
      <Stack>
        <p className="label">Result</p>
        <p style={{ fontSize: "var(--fs-body-lg)", textAlign: "center" }}>The match has been resolved — check your heart total above.</p>
      </Stack>
    );
  }

  return (
    <>
      {content}
      {rulesSeen && (
        <button
          className="btn-outline"
          style={{ width: "100%", marginTop: 12, fontSize: "var(--fs-sm)", padding: "10px 16px", minHeight: "auto" }}
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
          <h2 style={{ fontWeight: 400, fontSize: "var(--fs-h4)" }}>Share or Steal — Rules</h2>
          <button className="btn-outline" style={{ width: 44, height: 44, border: "1.6px solid var(--line)" }} onClick={onClose}>
            ✕
          </button>
        </div>
        <p style={{ fontSize: "var(--fs-body-lg)", lineHeight: 1.7 }}>{SHARE_STEAL_RULES_COPY}</p>
      </div>
    </div>
  );
}

function CheckpointWait({ label, direction }: { label: string; direction: string }) {
  return (
    <Stack>
      <p className="label">{label}</p>
      <div style={{ border: "2px solid var(--line)", padding: "26px 20px", width: "100%" }}>
        <p style={{ fontSize: "var(--fs-callout)", textAlign: "center", fontWeight: 600, lineHeight: 1.5, letterSpacing: "0.01em" }}>
          {direction}
        </p>
      </div>
    </Stack>
  );
}
