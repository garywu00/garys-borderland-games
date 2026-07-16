"use server";

import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveShareSteal, type ShareStealChoice, type CardCode } from "@/lib/game/rules";
import { requireAuthId, requireActiveController } from "@/lib/actions/session";

async function activeEventId(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data, error } = await admin
    .from("events")
    .select("id")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No active event");
  return data.id;
}

export async function claimPlayer(playerId: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();

  const { data: player, error: playerErr } = await admin
    .from("players")
    .select("id, claim_status, claimed_by_auth_id")
    .eq("id", playerId)
    .single();
  if (playerErr) throw playerErr;
  if (player.claim_status === "claimed") {
    return { ok: false as const, reason: "already_claimed" as const };
  }

  const pin = generatePin();
  const { error: insertErr } = await admin
    .from("player_claims")
    .insert({ player_id: playerId, auth_id: authId, pin });
  if (insertErr) return { ok: false as const, reason: "already_claimed" as const };

  await admin
    .from("players")
    .update({ claim_status: "claimed", claimed_by_auth_id: authId })
    .eq("id", playerId);

  return { ok: true as const, recoveryPin: pin };
}

export async function recoverWithPin(teamId: string, pin: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();

  const { data: team, error } = await admin
    .from("teams")
    .select("id, recovery_pin_hash")
    .eq("id", teamId)
    .single();
  if (error || !team) return { ok: false as const, reason: "not_found" as const };

  const matches = await bcrypt.compare(pin, team.recovery_pin_hash);
  if (!matches) return { ok: false as const, reason: "incorrect_pin" as const };

  const { data: session, error: sessionErr } = await admin
    .from("device_sessions")
    .insert({ team_id: teamId, auth_id: authId, is_active_controller: true })
    .select("id")
    .single();
  if (sessionErr) throw sessionErr;

  await admin
    .from("device_sessions")
    .update({ is_active_controller: false })
    .eq("team_id", teamId)
    .neq("id", session.id);

  await admin
    .from("teams")
    .update({ active_controller_auth_id: authId, active_controller_device_id: session.id })
    .eq("id", teamId);

  return { ok: true as const };
}

export async function sendInvite(fromPlayerId: string, toPlayerId: string) {
  const admin = createAdminClient();
  const eventId = await activeEventId(admin);
  const { error } = await admin
    .from("pair_invites")
    .insert({ event_id: eventId, from_player_id: fromPlayerId, to_player_id: toPlayerId });
  if (error) return { ok: false as const, reason: "invite_conflict" as const };
  return { ok: true as const };
}

export async function cancelInvite(inviteId: string) {
  const admin = createAdminClient();
  await admin
    .from("pair_invites")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("status", "pending");
  return { ok: true as const };
}

export async function declineInvite(inviteId: string) {
  const admin = createAdminClient();
  await admin
    .from("pair_invites")
    .update({ status: "declined", resolved_at: new Date().toISOString() })
    .eq("id", inviteId)
    .eq("status", "pending");
  return { ok: true as const };
}

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * First-come-first-served Round 1 matchmaking: when a new pair forms, match
 * them against whichever existing pair has been waiting longest. If nobody's
 * waiting, this pair becomes the next one in line. A DB trigger rejects the
 * insert if the "waiting" team got matched by a concurrent request in the
 * meantime — that's fine, this pair just stays waiting for the next one.
 */
async function tryAutoMatchRound1(admin: ReturnType<typeof createAdminClient>, eventId: string, teamId: string) {
  const { data: openMatchups } = await admin.from("matchups").select("team_a_id, team_b_id").neq("status", "resolved");
  const busyTeamIds = new Set<string>();
  openMatchups?.forEach((m) => {
    busyTeamIds.add(m.team_a_id);
    busyTeamIds.add(m.team_b_id);
  });

  const { data: waiting } = await admin
    .from("teams")
    .select("id")
    .eq("event_id", eventId)
    .eq("status", "round1")
    .neq("id", teamId)
    .order("created_at", { ascending: true });

  const opponent = (waiting ?? []).find((t) => !busyTeamIds.has(t.id));
  if (!opponent) return;

  await admin.from("matchups").insert({ event_id: eventId, team_a_id: opponent.id, team_b_id: teamId });
}

export async function acceptInvite(inviteId: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();

  const { data: invite, error } = await admin
    .from("pair_invites")
    .select("id, status, from_player_id, to_player_id, event_id")
    .eq("id", inviteId)
    .single();
  if (error || !invite) return { ok: false as const, reason: "not_found" as const };
  if (invite.status !== "pending") return { ok: false as const, reason: "invite_expired" as const };

  // Starts the global game timer on the very first pair to ever form for
  // this event. The .is(...null) guard makes this idempotent — every
  // subsequent acceptInvite call is a no-op UPDATE matching zero rows.
  await admin
    .from("events")
    .update({ starts_at: new Date().toISOString() })
    .eq("id", invite.event_id)
    .is("starts_at", null);

  const { data: fromPlayer } = await admin
    .from("players")
    .select("display_name")
    .eq("id", invite.from_player_id)
    .single();
  const { data: toPlayer } = await admin
    .from("players")
    .select("display_name")
    .eq("id", invite.to_player_id)
    .single();

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);

  const { data: team, error: teamErr } = await admin
    .from("teams")
    .insert({
      event_id: invite.event_id,
      name: `${fromPlayer?.display_name ?? "Player"} + ${toPlayer?.display_name ?? "Player"}`,
      recovery_pin_hash: pinHash,
      active_controller_auth_id: authId,
    })
    .select("id")
    .single();
  if (teamErr) throw teamErr;

  await admin.from("team_members").insert([
    { team_id: team.id, player_id: invite.from_player_id },
    { team_id: team.id, player_id: invite.to_player_id },
  ]);

  const { data: deviceSession } = await admin
    .from("device_sessions")
    .insert({ team_id: team.id, auth_id: authId, is_active_controller: true })
    .select("id")
    .single();
  if (deviceSession) {
    await admin
      .from("teams")
      .update({ active_controller_device_id: deviceSession.id })
      .eq("id", team.id);
  }

  await admin
    .from("pair_invites")
    .update({ status: "accepted", resolved_at: new Date().toISOString() })
    .eq("id", inviteId);

  // any other pending invites either of these two players sent/received are now moot
  await admin
    .from("pair_invites")
    .update({ status: "cancelled", resolved_at: new Date().toISOString() })
    .eq("status", "pending")
    .in("from_player_id", [invite.from_player_id, invite.to_player_id]);

  await tryAutoMatchRound1(admin, invite.event_id, team.id);

  return { ok: true as const, teamId: team.id, pin };
}

export async function inviteThirdPlayer(teamId: string, playerId: string) {
  const admin = createAdminClient();
  const { count } = await admin
    .from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId);
  if ((count ?? 0) >= 3) return { ok: false as const, reason: "team_full" as const };
  const { error } = await admin.from("team_members").insert({ team_id: teamId, player_id: playerId });
  if (error) return { ok: false as const, reason: "conflict" as const };

  const { data: memberRows } = await admin.from("team_members").select("player_id").eq("team_id", teamId);
  const memberIds = (memberRows ?? []).map((m) => m.player_id);
  const { data: playersData } = await admin.from("players").select("display_name").in("id", memberIds);
  const names = (playersData ?? []).map((p) => p.display_name);
  if (names.length) {
    await admin.from("teams").update({ name: names.join(" + ") }).eq("id", teamId);
  }

  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Round 1 — Share or Steal
// ---------------------------------------------------------------------------

export async function setReady(matchupId: string, teamId: string) {
  const admin = createAdminClient();
  const { data: matchup, error } = await admin
    .from("matchups")
    .select("id, team_a_id, team_b_id, team_a_ready, team_b_ready")
    .eq("id", matchupId)
    .single();
  if (error || !matchup) throw new Error("Matchup not found");

  const isTeamA = matchup.team_a_id === teamId;
  const update = isTeamA ? { team_a_ready: true } : { team_b_ready: true };
  const { data: updated } = await admin
    .from("matchups")
    .update(update)
    .eq("id", matchupId)
    .select("team_a_ready, team_b_ready")
    .single();

  if (updated?.team_a_ready && updated?.team_b_ready) {
    const startsAt = new Date();
    const deadline = new Date(startsAt.getTime() + 60_000);
    await admin
      .from("matchups")
      .update({ status: "active", starts_at: startsAt.toISOString(), deadline_at: deadline.toISOString() })
      .eq("id", matchupId);
  }
  return { ok: true as const };
}

export async function submitShareSteal(
  matchupId: string,
  teamId: string,
  choice: ShareStealChoice,
  isTimeoutDefault = false,
) {
  const controller = await requireActiveController(teamId);
  if (!controller.ok) return controller;

  const admin = createAdminClient();

  const { error: insertErr } = await admin
    .from("share_steal_submissions")
    .insert({ matchup_id: matchupId, team_id: teamId, choice, is_timeout_default: isTimeoutDefault });
  if (insertErr) return { ok: false as const, reason: "already_submitted" as const };

  const { data: matchup } = await admin
    .from("matchups")
    .select("id, team_a_id, team_b_id, status")
    .eq("id", matchupId)
    .single();
  if (!matchup) throw new Error("Matchup not found");

  const { data: submissions } = await admin
    .from("share_steal_submissions")
    .select("team_id, choice")
    .eq("matchup_id", matchupId);

  const subA = submissions?.find((s) => s.team_id === matchup.team_a_id);
  const subB = submissions?.find((s) => s.team_id === matchup.team_b_id);

  if (subA && subB && matchup.status !== "resolved") {
    await resolveMatchup(matchupId);
  }
  return { ok: true as const };
}

async function resolveMatchup(matchupId: string) {
  const admin = createAdminClient();

  // Atomically claim resolution — a matchup can only move to 'resolved' once,
  // so a concurrent/retried call that loses this race simply no-ops below.
  const { data: claimed } = await admin
    .from("matchups")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", matchupId)
    .neq("status", "resolved")
    .select("id, team_a_id, team_b_id")
    .maybeSingle();
  if (!claimed) return;

  const { data: submissions } = await admin
    .from("share_steal_submissions")
    .select("team_id, choice")
    .eq("matchup_id", matchupId);

  const subA = submissions?.find((s) => s.team_id === claimed.team_a_id);
  const subB = submissions?.find((s) => s.team_id === claimed.team_b_id);
  if (!subA || !subB) return;

  const outcome = resolveShareSteal(subA.choice as ShareStealChoice, subB.choice as ShareStealChoice);

  await applyHeartDelta(claimed.team_a_id, outcome.deltaA, "round1", matchupId, "system");
  await applyHeartDelta(claimed.team_b_id, outcome.deltaB, "round1", matchupId, "system");

  await awardCard(claimed.team_a_id, "heart4", "system");
  await awardCard(claimed.team_b_id, "heart4", "system");
}

async function applyHeartDelta(
  teamId: string,
  delta: number,
  sourceRound: string,
  relatedId: string | null,
  createdBy: string,
) {
  const admin = createAdminClient();
  const { error } = await admin.from("heart_transactions").insert({
    team_id: teamId,
    delta,
    reason: `${sourceRound} resolution`,
    source_round: sourceRound,
    related_id: relatedId,
    created_by: createdBy,
  });
  // unique index on (related_id, team_id) makes this a no-op if already applied
  if (error) return;

  const { data: team } = await admin.from("teams").select("hearts_cached").eq("id", teamId).single();
  if (team) {
    await admin
      .from("teams")
      .update({ hearts_cached: team.hearts_cached + delta, updated_at: new Date().toISOString() })
      .eq("id", teamId);
  }
}

async function awardCard(teamId: string, cardCode: CardCode, awardedBy: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("collected_cards")
    .insert({ team_id: teamId, card_code: cardCode, awarded_by: awardedBy });
  if (error) return; // unique(team_id, card_code) guarantees idempotency

  const nextStatus = cardCode === "heart4" ? "round2" : cardCode === "club8" ? "round3" : "final_waiting";
  await admin.from("teams").update({ status: nextStatus }).eq("id", teamId);
}
