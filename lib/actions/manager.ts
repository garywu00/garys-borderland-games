"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { applyHeartDelta } from "@/lib/actions/hearts";
import { requireManager } from "@/lib/actions/session";

async function logAction(
  actorId: string,
  actorRole: string,
  action: string,
  targetTeamId: string | null,
  before: unknown,
  after: unknown,
) {
  const admin = createAdminClient();
  await admin.from("manager_actions").insert({
    actor_id: actorId,
    actor_role: actorRole,
    action,
    target_team_id: targetTeamId,
    before_state: before as never,
    after_state: after as never,
  });
}

export async function recordClubsOutcome(teamAId: string, teamBId: string, outcome: "pass" | "fail") {
  const manager = await requireManager();
  const admin = createAdminClient();
  const delta = outcome === "pass" ? 1 : -2;
  const relatedId = crypto.randomUUID();

  for (const teamId of [teamAId, teamBId]) {
    const result = await applyHeartDelta(teamId, delta, "round2", relatedId, manager.id);
    // A team eliminated by this delta stays eliminated — don't advance it.
    if (!result.eliminated) {
      await admin.from("collected_cards").insert({ team_id: teamId, card_code: "club8", awarded_by: manager.id }).select();
      await admin.from("teams").update({ status: "round3" }).eq("id", teamId);
    }
  }

  await logAction(manager.id, manager.role, `Clubs outcome: ${outcome}`, teamAId, null, { teamAId, teamBId, delta });
  return { ok: true as const };
}

/**
 * For the last team to arrive at the Clubs checkpoint when no other pair is
 * left to complete the challenge with. Awards the same outcome as a Pass
 * (+1 heart, 8♣ card) and advances them, rather than making them wait for a
 * pair that may never show.
 */
export async function giveByeRound2(teamId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { data: team } = await admin.from("teams").select("status").eq("id", teamId).maybeSingle();
  if (!team || team.status !== "round2") return { ok: false as const, reason: "not_found" as const };

  await applyHeartDelta(teamId, 1, "round2", null, manager.id);
  await admin.from("collected_cards").insert({ team_id: teamId, card_code: "club8", awarded_by: manager.id }).select();
  await admin.from("teams").update({ status: "round3" }).eq("id", teamId);

  await logAction(manager.id, manager.role, "Gave Round 2 bye (no pair to complete with)", teamId, null, { delta: 1 });
  return { ok: true as const };
}

export async function recordDiamondsPass(teamId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  await admin.from("collected_cards").insert({ team_id: teamId, card_code: "diamond2", awarded_by: manager.id }).select();
  await admin.from("teams").update({ status: "final_waiting" }).eq("id", teamId);

  await logAction(manager.id, manager.role, "Diamonds Pass", teamId, null, { card: "diamond2" });
  return { ok: true as const };
}

/**
 * For the leftover team when Round 1 has an odd number of pairs and one has
 * no opponent to matchup against. Awards the same outcome as a mutual
 * Share (+1 heart, 4♥ card) and advances them, rather than leaving them
 * stuck waiting indefinitely.
 */
export async function giveByeRound1(teamId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { data: team } = await admin.from("teams").select("status").eq("id", teamId).maybeSingle();
  if (!team || team.status !== "round1") return { ok: false as const, reason: "not_found" as const };

  const { data: activeMatchup } = await admin
    .from("matchups")
    .select("id")
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .neq("status", "resolved")
    .maybeSingle();
  if (activeMatchup) return { ok: false as const, reason: "has_opponent" as const };

  await applyHeartDelta(teamId, 1, "round1", null, manager.id);
  await admin.from("collected_cards").insert({ team_id: teamId, card_code: "heart4", awarded_by: manager.id }).select();
  await admin.from("teams").update({ status: "round2" }).eq("id", teamId);

  await logAction(manager.id, manager.role, "Gave Round 1 bye (no opponent)", teamId, null, { delta: 1 });
  return { ok: true as const };
}

export async function adjustHeartsManual(teamId: string, delta: number) {
  const manager = await requireManager();
  await applyHeartDelta(teamId, delta, "manual", null, manager.id);
  await logAction(manager.id, manager.role, "Manual heart adjustment", teamId, null, { delta });
  return { ok: true as const };
}

export async function confirmArrival(teamId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { count } = await admin.from("finalists").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= 3) return { ok: false as const, reason: "slots_full" as const };

  const slot = (count ?? 0) + 1;
  const { data: team } = await admin.from("teams").select("hearts_cached, event_id").eq("id", teamId).single();
  if (!team) return { ok: false as const, reason: "not_found" as const };

  await admin.from("checkpoint_arrivals").insert({
    team_id: teamId,
    checkpoint: "final",
    confirmed_by: manager.id,
  });

  const { error } = await admin.from("finalists").insert({
    event_id: team.event_id,
    team_id: teamId,
    slot,
    hearts_at_qualification: team.hearts_cached,
    arrival_order: slot,
  });
  if (error) return { ok: false as const, reason: "slots_full" as const };

  await admin.from("teams").update({ status: "finalist" }).eq("id", teamId);

  if (slot === 3) {
    const { data: waiting } = await admin.from("teams").select("id").eq("status", "final_waiting");
    if (waiting?.length) {
      await admin
        .from("teams")
        .update({ status: "non_finalist" })
        .in("id", waiting.map((t) => t.id));
    }
  }

  await logAction(manager.id, manager.role, `Confirmed arrival — Finalist #${slot}`, teamId, null, { slot });
  return { ok: true as const, slot };
}

/**
 * Undoes a mistaken arrival confirmation — frees the finalist slot and puts
 * the team back to awaiting confirmation. If this was the 3rd/final slot,
 * also reopens the game for anyone who got auto-closed-out when it filled.
 */
export async function undoFinalistConfirmation(teamId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { data: finalist } = await admin.from("finalists").select("id, slot").eq("team_id", teamId).maybeSingle();
  if (!finalist) return { ok: false as const, reason: "not_found" as const };

  const { data: winner } = await admin
    .from("winner_results")
    .select("id")
    .eq("team_id", teamId)
    .eq("reversed", false)
    .maybeSingle();
  if (winner) return { ok: false as const, reason: "already_won" as const };

  await admin.from("finalists").delete().eq("id", finalist.id);
  await admin.from("checkpoint_arrivals").delete().eq("team_id", teamId).eq("checkpoint", "final");
  await admin.from("teams").update({ status: "final_waiting" }).eq("id", teamId);

  if (finalist.slot === 3) {
    await admin.from("teams").update({ status: "final_waiting" }).eq("status", "non_finalist");
  }

  await logAction(manager.id, manager.role, "Undid finalist confirmation", teamId, { slot: finalist.slot }, null);
  return { ok: true as const };
}

export async function verifyWinner(teamId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();
  const { data: team } = await admin.from("teams").select("event_id").eq("id", teamId).single();
  if (!team) return { ok: false as const, reason: "not_found" as const };

  const { error } = await admin
    .from("winner_results")
    .insert({ event_id: team.event_id, team_id: teamId, verified_by: manager.id });
  if (error) return { ok: false as const, reason: "already_verified" as const };

  await logAction(manager.id, manager.role, "Verified winner", teamId, null, null);
  return { ok: true as const };
}

export async function undoWinnerVerification(eventId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();
  await admin
    .from("winner_results")
    .update({ reversed: true, reversed_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("reversed", false);
  await logAction(manager.id, manager.role, "Undo winner verification", null, null, null);
  return { ok: true as const };
}

export async function closeGame(eventId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();
  await admin.from("events").update({ status: "closed" }).eq("id", eventId);
  await logAction(manager.id, manager.role, "Closed game", null, null, null);
  return { ok: true as const };
}

/**
 * Round 1 pairs are matched automatically, first-come-first-served, the
 * moment a second pair forms (see tryAutoMatchRound1 in player actions).
 * This is the manual backup for whatever that misses — e.g. pairs that
 * formed before this went live, or a race where two pairs landed in the
 * queue at the exact same instant. Kept first-come-first-served too, by
 * team creation time, rather than random, to match the live behavior.
 */
export async function matchUpWaitingTeams() {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { data: openMatchups } = await admin
    .from("matchups")
    .select("team_a_id, team_b_id")
    .neq("status", "resolved");
  const busyTeamIds = new Set<string>();
  openMatchups?.forEach((m) => {
    busyTeamIds.add(m.team_a_id);
    busyTeamIds.add(m.team_b_id);
  });

  const { data: teams } = await admin
    .from("teams")
    .select("id, event_id")
    .eq("status", "round1")
    .order("created_at", { ascending: true });
  const waiting = (teams ?? []).filter((t) => !busyTeamIds.has(t.id));

  const created: string[] = [];
  for (let i = 0; i + 1 < waiting.length; i += 2) {
    const teamA = waiting[i]!;
    const teamB = waiting[i + 1]!;
    const { data: matchup, error } = await admin
      .from("matchups")
      .insert({ event_id: teamA.event_id, team_a_id: teamA.id, team_b_id: teamB.id })
      .select("id")
      .single();
    if (!error && matchup) created.push(matchup.id);
  }

  await logAction(manager.id, manager.role, "Matched up waiting Round 1 pairs", null, null, { count: created.length });
  return { ok: true as const, created: created.length, leftoverTeam: waiting.length % 2 === 1 };
}

/**
 * Clears all pairing/game state (teams, matchups, hearts, cards, checkpoints,
 * finalists, winner results, audit log) back to "roster exists, nobody's
 * paired up yet" — while keeping the roster, the active event, and manager
 * accounts/PINs intact. Mirrors scripts/reset_test_run.sql.
 */
export async function resetGameState() {
  const manager = await requireManager();
  const admin = createAdminClient();

  const all = () => admin.from("teams").update({ active_controller_device_id: null }).not("id", "is", null);
  await all();

  await admin.from("events").update({ starts_at: null }).not("id", "is", null);

  await admin.from("manager_actions").delete().not("id", "is", null);
  await admin.from("winner_results").delete().not("id", "is", null);
  await admin.from("finalists").delete().not("id", "is", null);
  await admin.from("share_steal_submissions").delete().not("id", "is", null);
  await admin.from("matchups").delete().not("id", "is", null);
  await admin.from("checkpoint_arrivals").delete().not("id", "is", null);
  await admin.from("collected_cards").delete().not("id", "is", null);
  await admin.from("heart_transactions").delete().not("id", "is", null);
  await admin.from("device_sessions").delete().not("id", "is", null);
  await admin.from("team_members").delete().not("id", "is", null);
  await admin.from("teams").delete().not("id", "is", null);
  await admin.from("pair_invites").delete().not("id", "is", null);
  await admin.from("player_claims").delete().not("id", "is", null);
  await admin.from("players").update({ claim_status: "available", claimed_by_auth_id: null }).not("id", "is", null);

  await logAction(manager.id, manager.role, "Reset game state", null, null, null);
  return { ok: true as const };
}

/** Fixes a typo'd roster name. Keeps any team's cached display name in sync. */
export async function updatePlayerName(playerId: string, newName: string) {
  const manager = await requireManager();
  const admin = createAdminClient();
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false as const, reason: "invalid_name" as const };

  const { data: before } = await admin.from("players").select("display_name").eq("id", playerId).single();
  const { error } = await admin.from("players").update({ display_name: trimmed }).eq("id", playerId);
  if (error) return { ok: false as const, reason: "conflict" as const };

  const { data: membership } = await admin
    .from("team_members")
    .select("team_id")
    .eq("player_id", playerId)
    .maybeSingle();
  if (membership) {
    const { data: memberRows } = await admin
      .from("team_members")
      .select("player_id")
      .eq("team_id", membership.team_id);
    const memberIds = (memberRows ?? []).map((m) => m.player_id);
    const { data: playersData } = await admin.from("players").select("display_name").in("id", memberIds);
    const names = (playersData ?? []).map((p) => p.display_name);
    if (names.length) {
      await admin.from("teams").update({ name: names.join(" + ") }).eq("id", membership.team_id);
    }
  }

  await logAction(manager.id, manager.role, "Renamed player", null, { name: before?.display_name }, { name: trimmed });
  return { ok: true as const };
}

/**
 * Removes a team entirely (mispairing, duplicate, etc.) and frees its
 * members back to the available roster so they can be re-paired. All the
 * team's matchups/cards/hearts/checkpoints/finalist-or-winner records go
 * with it (cascading FKs) rather than being left orphaned.
 */
export async function deleteTeam(teamId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { data: team } = await admin.from("teams").select("name").eq("id", teamId).maybeSingle();
  if (!team) return { ok: false as const, reason: "not_found" as const };

  const { data: memberRows } = await admin.from("team_members").select("player_id").eq("team_id", teamId);
  const playerIds = (memberRows ?? []).map((m) => m.player_id);

  await admin.from("teams").update({ active_controller_device_id: null }).eq("id", teamId);
  const { error } = await admin.from("teams").delete().eq("id", teamId);
  if (error) return { ok: false as const, reason: "delete_failed" as const };

  if (playerIds.length) {
    await admin.from("player_claims").delete().in("player_id", playerIds);
    await admin.from("players").update({ claim_status: "available", claimed_by_auth_id: null }).in("id", playerIds);
  }

  await logAction(manager.id, manager.role, "Removed team", null, { teamId, name: team.name }, null);
  return { ok: true as const };
}

/**
 * Releases a mistakenly-claimed name back to "available" so the right
 * person can claim it — for the case where someone picked the wrong roster
 * name before pairing up. Once a player has paired, use deleteTeam instead.
 */
export async function resetPlayerClaim(playerId: string) {
  const manager = await requireManager();
  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("team_members")
    .select("team_id")
    .eq("player_id", playerId)
    .maybeSingle();
  if (membership) return { ok: false as const, reason: "already_paired" as const };

  const { data: before } = await admin.from("players").select("display_name").eq("id", playerId).single();

  await admin
    .from("player_claims")
    .update({ released_at: new Date().toISOString() })
    .eq("player_id", playerId)
    .is("released_at", null);

  await admin
    .from("players")
    .update({ claim_status: "available", claimed_by_auth_id: null })
    .eq("id", playerId);

  await logAction(manager.id, manager.role, "Reset player claim", null, { name: before?.display_name }, null);
  return { ok: true as const };
}

/** Adds a new roster entry mid-event, so late signups don't need a database change. */
export async function addPlayer(name: string) {
  const manager = await requireManager();
  const admin = createAdminClient();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, reason: "invalid_name" as const };

  const { data: event } = await admin.from("events").select("id").eq("status", "active").limit(1).maybeSingle();
  if (!event) return { ok: false as const, reason: "no_active_event" as const };

  const { error } = await admin.from("players").insert({ event_id: event.id, display_name: trimmed });
  if (error) return { ok: false as const, reason: "duplicate_name" as const };

  await logAction(manager.id, manager.role, "Added player", null, null, { name: trimmed });
  return { ok: true as const };
}
