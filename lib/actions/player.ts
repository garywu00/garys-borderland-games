"use server";

import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveShareSteal, type ShareStealChoice, type CardCode } from "@/lib/game/rules";
import { requireAuthId, requireTeamMember } from "@/lib/actions/session";
import { applyHeartDelta } from "@/lib/actions/hearts";
import { uploadTeamPhoto } from "@/lib/actions/photos";

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

export type TeamMemberInput = { name: string; playerId?: string | null };

/**
 * Forms a whole team in one step: 2-3 people physically together, one
 * device, one group photo. Replaces the old claim-a-name-then-invite-a-
 * partner flow — there's no per-player identity to establish separately
 * anymore, just "these people are on this team, and this device plays for
 * them." The forming device becomes the team's sole controller; a teammate
 * can take over on a different device later via the recovery PIN returned
 * here (see recoverTeamWithPin) if this device is lost.
 *
 * There's no pre-seeded roster to maintain anymore — each member is either
 * an existing unclaimed player (picked from the autocomplete list, carries
 * playerId) or a brand-new name typed on the spot (playerId omitted, a
 * players row is created here). Matching by name (case-insensitively)
 * against unclaimed players avoids creating duplicate rows if two people
 * happen to type the same name independently.
 */
export async function formTeam(members: TeamMemberInput[], photoDataUrl: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();

  if (members.length < 2 || members.length > 3) {
    return { ok: false as const, reason: "invalid_size" as const };
  }

  const trimmedNames = members.map((m) => m.name.trim());
  if (trimmedNames.some((n) => n.length === 0)) {
    return { ok: false as const, reason: "invalid_name" as const };
  }
  if (new Set(trimmedNames.map((n) => n.toLowerCase())).size !== trimmedNames.length) {
    return { ok: false as const, reason: "duplicate_name" as const };
  }

  const eventId = await activeEventId(admin);

  const { data: teamedRows } = await admin.from("team_members").select("player_id");
  const teamedIds = new Set((teamedRows ?? []).map((r) => r.player_id));

  const playerIds: string[] = [];
  const orderedNames: string[] = [];
  for (let i = 0; i < members.length; i++) {
    const name = trimmedNames[i]!;
    const claimedId = members[i]!.playerId;
    if (claimedId) {
      if (teamedIds.has(claimedId)) return { ok: false as const, reason: "already_on_team" as const };
      const { data: existing } = await admin.from("players").select("id, display_name").eq("id", claimedId).eq("event_id", eventId).maybeSingle();
      if (!existing) return { ok: false as const, reason: "not_found" as const };
      playerIds.push(existing.id);
      orderedNames.push(existing.display_name);
      continue;
    }

    const { data: match } = await admin
      .from("players")
      .select("id, display_name")
      .eq("event_id", eventId)
      .ilike("display_name", name)
      .maybeSingle();
    if (match && !teamedIds.has(match.id)) {
      playerIds.push(match.id);
      orderedNames.push(match.display_name);
      continue;
    }

    const { data: inserted, error } = await admin
      .from("players")
      .insert({ event_id: eventId, display_name: name })
      .select("id, display_name")
      .single();
    if (error || !inserted) return { ok: false as const, reason: "not_found" as const };
    playerIds.push(inserted.id);
    orderedNames.push(inserted.display_name);
  }

  const { data: existingMembers } = await admin.from("team_members").select("player_id").in("player_id", playerIds);
  if (existingMembers && existingMembers.length > 0) {
    return { ok: false as const, reason: "already_on_team" as const };
  }

  // Starts the global game timer on the very first team to ever form for
  // this event. The .is(...null) guard makes this idempotent.
  await admin.from("events").update({ starts_at: new Date().toISOString() }).eq("id", eventId).is("starts_at", null);

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);

  const { data: team, error: teamErr } = await admin
    .from("teams")
    .insert({
      event_id: eventId,
      name: orderedNames.join(" + "),
      active_controller_auth_id: authId,
      recovery_pin_hash: pinHash,
    })
    .select("id")
    .single();
  if (teamErr) throw teamErr;

  const { error: membersErr } = await admin
    .from("team_members")
    .insert(playerIds.map((playerId) => ({ team_id: team.id, player_id: playerId })));
  if (membersErr) throw membersErr;

  await uploadTeamPhoto(team.id, photoDataUrl);
  await tryAutoMatchRound1(admin, eventId, team.id);

  return { ok: true as const, teamId: team.id, recoveryPin: pin };
}

/**
 * Lets a teammate take over as the team's controlling device from a fresh
 * device — the only recourse if the original forming device is lost, since
 * exactly one device controls a team at a time.
 */
export async function recoverTeamWithPin(teamId: string, pin: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();

  const { data: team } = await admin.from("teams").select("id, recovery_pin_hash").eq("id", teamId).maybeSingle();
  if (!team || !team.recovery_pin_hash) return { ok: false as const, reason: "not_found" as const };

  const valid = await bcrypt.compare(pin, team.recovery_pin_hash);
  if (!valid) return { ok: false as const, reason: "wrong_pin" as const };

  await admin.from("teams").update({ active_controller_auth_id: authId }).eq("id", teamId);
  return { ok: true as const, teamId: team.id };
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
  const member = await requireTeamMember(teamId);
  if (!member.ok) return member;

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

/**
 * Fallback for a matchup that's past its 60-second deadline but still
 * missing a submission from one or both teams. The original design had
 * each team's own client auto-submit its own default the instant its
 * device's clock hit zero — which silently resolved nothing if that team's
 * one open tab happened to be backgrounded/asleep at exactly the wrong
 * moment, since nothing else was watching. This is callable by *any* member
 * of *either* team in the matchup, or a manager, specifically so any of the
 * up-to-four connected devices — or an admin, as a last resort — can be the
 * one that notices the clock ran out and pushes it forward, rather than
 * requiring the one specific missing team's own device to do it.
 *
 * Server-authoritative: only actually does anything once deadline_at has
 * genuinely passed per the server clock, regardless of what the caller's
 * local clock claims.
 */
export async function expireShareSteal(matchupId: string) {
  const admin = createAdminClient();

  const { data: matchup } = await admin
    .from("matchups")
    .select("id, team_a_id, team_b_id, status, deadline_at")
    .eq("id", matchupId)
    .maybeSingle();
  if (!matchup) return { ok: false as const, reason: "not_found" as const };
  if (matchup.status === "resolved") return { ok: true as const };
  if (!matchup.deadline_at || new Date(matchup.deadline_at).getTime() > Date.now()) {
    return { ok: false as const, reason: "not_expired" as const };
  }

  const authId = await requireAuthId();
  const [memberA, memberB] = await Promise.all([requireTeamMember(matchup.team_a_id), requireTeamMember(matchup.team_b_id)]);
  const { data: manager } = await admin.from("manager_profiles").select("id").eq("id", authId).maybeSingle();
  if (!memberA.ok && !memberB.ok && !manager) return { ok: false as const, reason: "not_authorized" as const };

  const { data: submissions } = await admin.from("share_steal_submissions").select("team_id").eq("matchup_id", matchupId);
  const submittedTeamIds = new Set((submissions ?? []).map((s) => s.team_id));

  for (const teamId of [matchup.team_a_id, matchup.team_b_id]) {
    if (!submittedTeamIds.has(teamId)) {
      await admin.from("share_steal_submissions").insert({ matchup_id: matchupId, team_id: teamId, choice: "share", is_timeout_default: true });
    }
  }

  await resolveMatchup(matchupId);
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

  const resultA = await applyHeartDelta(claimed.team_a_id, outcome.deltaA, "round1", matchupId, "system");
  const resultB = await applyHeartDelta(claimed.team_b_id, outcome.deltaB, "round1", matchupId, "system");

  // A team eliminated by this delta stays eliminated — don't let awardCard's
  // unconditional status update clobber it back into round2.
  if (!resultA.eliminated) await awardCard(claimed.team_a_id, "heart4", "system");
  if (!resultB.eliminated) await awardCard(claimed.team_b_id, "heart4", "system");
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
