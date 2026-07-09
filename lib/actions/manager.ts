"use server";

import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { CARD_META } from "@/lib/game/rules";

type ManagerRole = "ajan" | "michelle" | "gary";

async function requireManager(allowed: ManagerRole[]): Promise<{ id: string; role: ManagerRole }> {
  const session = await createSessionClient();
  const { data } = await session.auth.getUser();
  if (!data.user) throw new Error("Not authenticated");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("manager_profiles")
    .select("id, role")
    .eq("id", data.user.id)
    .single();
  if (!profile || !allowed.includes(profile.role as ManagerRole)) {
    throw new Error("Unauthorized manager action");
  }
  return { id: profile.id, role: profile.role as ManagerRole };
}

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

async function applyHeartDelta(teamId: string, delta: number, sourceRound: string, relatedId: string | null, createdBy: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("heart_transactions").insert({
    team_id: teamId,
    delta,
    reason: `${sourceRound} adjustment`,
    source_round: sourceRound,
    related_id: relatedId,
    created_by: createdBy,
  });
  if (error) return false;
  const { data: team } = await admin.from("teams").select("hearts_cached").eq("id", teamId).single();
  if (team) {
    await admin.from("teams").update({ hearts_cached: team.hearts_cached + delta }).eq("id", teamId);
  }
  return true;
}

export async function recordClubsOutcome(teamAId: string, teamBId: string, outcome: "pass" | "fail") {
  const manager = await requireManager(["ajan", "gary"]);
  const admin = createAdminClient();
  const delta = outcome === "pass" ? 1 : -2;
  const relatedId = crypto.randomUUID();

  for (const teamId of [teamAId, teamBId]) {
    await applyHeartDelta(teamId, delta, "round2", relatedId, manager.id);
    await admin.from("collected_cards").insert({ team_id: teamId, card_code: "club8", awarded_by: manager.id }).select();
    await admin.from("teams").update({ status: "round3" }).eq("id", teamId);
  }

  await logAction(manager.id, manager.role, `Clubs outcome: ${outcome}`, teamAId, null, { teamAId, teamBId, delta });
  return { ok: true as const };
}

export async function recordDiamondsPass(teamId: string) {
  const manager = await requireManager(["michelle", "gary"]);
  const admin = createAdminClient();

  await admin.from("collected_cards").insert({ team_id: teamId, card_code: "diamond2", awarded_by: manager.id }).select();
  await admin.from("teams").update({ status: "final_waiting" }).eq("id", teamId);

  await logAction(manager.id, manager.role, "Diamonds Pass", teamId, null, { card: "diamond2" });
  return { ok: true as const };
}

export async function adjustHeartsManual(teamId: string, delta: number) {
  const manager = await requireManager(["ajan", "michelle", "gary"]);
  await applyHeartDelta(teamId, delta, "manual", null, manager.id);
  await logAction(manager.id, manager.role, "Manual heart adjustment", teamId, null, { delta });
  return { ok: true as const };
}

export async function confirmArrival(teamId: string) {
  const manager = await requireManager(["gary"]);
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

export async function verifyWinner(teamId: string) {
  const manager = await requireManager(["gary"]);
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
  const manager = await requireManager(["gary"]);
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
  const manager = await requireManager(["gary"]);
  const admin = createAdminClient();
  await admin.from("events").update({ status: "closed" }).eq("id", eventId);
  await logAction(manager.id, manager.role, "Closed game", null, null, null);
  return { ok: true as const };
}

export async function createRandomMatchups() {
  const manager = await requireManager(["gary"]);
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

  const { data: teams } = await admin.from("teams").select("id, event_id").eq("status", "round1");
  const available = (teams ?? []).filter((t) => !busyTeamIds.has(t.id));
  const shuffled = [...available].sort(() => Math.random() - 0.5);

  const created: string[] = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const teamA = shuffled[i]!;
    const teamB = shuffled[i + 1]!;
    const { data: matchup, error } = await admin
      .from("matchups")
      .insert({ event_id: teamA.event_id, team_a_id: teamA.id, team_b_id: teamB.id })
      .select("id")
      .single();
    if (!error && matchup) created.push(matchup.id);
  }

  await logAction(manager.id, manager.role, "Created random Round 1 matchups", null, null, { count: created.length });
  return { ok: true as const, created: created.length, leftoverTeam: shuffled.length % 2 === 1 };
}

export { CARD_META };
