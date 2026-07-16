"use server";

import { createAdminClient } from "@/lib/supabase/server";

const TERMINAL_STATUSES = ["finalist", "non_finalist", "eliminated"];

/**
 * Single source of truth for mutating a team's heart total — every round's
 * scoring, manual manager adjustments, and trivia penalties all flow
 * through here. Idempotent per (relatedId, teamId) via the partial unique
 * index on heart_transactions when relatedId is provided. Automatically
 * eliminates a team whose hearts drop to 0 or below, stashing the prior
 * status so a later reversal (see reverseHeartDelta) can restore it.
 */
export async function applyHeartDelta(
  teamId: string,
  delta: number,
  sourceRound: string,
  relatedId: string | null,
  createdBy: string,
): Promise<{ applied: boolean; eliminated: boolean; hearts: number; transactionId: string | null }> {
  const admin = createAdminClient();
  const { data: inserted, error } = await admin
    .from("heart_transactions")
    .insert({
      team_id: teamId,
      delta,
      reason: `${sourceRound} adjustment`,
      source_round: sourceRound,
      related_id: relatedId,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) {
    const { data: team } = await admin.from("teams").select("hearts_cached").eq("id", teamId).maybeSingle();
    return { applied: false, eliminated: false, hearts: team?.hearts_cached ?? 0, transactionId: null };
  }

  const { data: team } = await admin.from("teams").select("hearts_cached, status").eq("id", teamId).single();
  if (!team) return { applied: true, eliminated: false, hearts: 0, transactionId: inserted.id };

  const newHearts = team.hearts_cached + delta;
  const becomesEliminated = newHearts <= 0 && !TERMINAL_STATUSES.includes(team.status);

  await admin
    .from("teams")
    .update({
      hearts_cached: newHearts,
      updated_at: new Date().toISOString(),
      ...(becomesEliminated ? { status: "eliminated", pre_elimination_status: team.status } : {}),
    })
    .eq("id", teamId);

  return { applied: true, eliminated: becomesEliminated, hearts: newHearts, transactionId: inserted.id };
}

/**
 * Reverses a specific heart_transactions row by inserting a compensating
 * entry (append-only ledger — never deletes/edits the original). If the
 * team is currently eliminated and this reversal brings it back above 0
 * hearts, restores whatever status it held right before elimination.
 */
export async function reverseHeartDelta(
  originalTransactionId: string,
  createdBy: string,
): Promise<{ applied: boolean }> {
  const admin = createAdminClient();
  const { data: original } = await admin
    .from("heart_transactions")
    .select("id, team_id, delta, source_round, related_id, reversal_of")
    .eq("id", originalTransactionId)
    .maybeSingle();
  if (!original || original.reversal_of) return { applied: false };

  const { error } = await admin.from("heart_transactions").insert({
    team_id: original.team_id,
    delta: -original.delta,
    reason: `Reversal of ${original.id}`,
    source_round: original.source_round,
    related_id: original.related_id,
    created_by: createdBy,
    reversal_of: original.id,
  });
  if (error) return { applied: false };

  const { data: team } = await admin
    .from("teams")
    .select("hearts_cached, status, pre_elimination_status")
    .eq("id", original.team_id)
    .single();
  if (!team) return { applied: true };

  const newHearts = team.hearts_cached - original.delta;
  const restoredStatus =
    team.status === "eliminated" && newHearts > 0 && team.pre_elimination_status ? team.pre_elimination_status : null;

  await admin
    .from("teams")
    .update({
      hearts_cached: newHearts,
      updated_at: new Date().toISOString(),
      ...(restoredStatus ? { status: restoredStatus, pre_elimination_status: null } : {}),
    })
    .eq("id", original.team_id);

  return { applied: true };
}
