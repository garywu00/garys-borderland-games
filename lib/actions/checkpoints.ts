"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireActiveController } from "@/lib/actions/session";
import { applyHeartDelta } from "@/lib/actions/hearts";

/**
 * Self-serve mutual give-up at Ajan's checkpoint: each paired team
 * independently votes to fail. Once BOTH sides of the pairing have voted,
 * it auto-resolves — no manager interaction needed, mirroring how a
 * Round 1 Share/Steal matchup resolves once both submissions land.
 */
export async function voteClubsFail(teamId: string) {
  const controller = await requireActiveController(teamId);
  if (!controller.ok) return controller;

  const admin = createAdminClient();
  const { data: pairing } = await admin
    .from("clubs_pairings")
    .select("id, team_a_id, team_b_id, status")
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .eq("status", "active")
    .maybeSingle();
  if (!pairing) return { ok: false as const, reason: "not_paired" as const };

  const { error: voteErr } = await admin.from("clubs_fail_votes").insert({ pairing_id: pairing.id, team_id: teamId });
  // unique(pairing_id, team_id) makes a repeat vote a harmless no-op
  if (voteErr) return { ok: true as const, resolved: false };

  // A solo challenge (team_b_id null) has nobody to wait on — resolves on
  // this single vote.
  const requiredTeamIds = [pairing.team_a_id, pairing.team_b_id].filter((id): id is string => id !== null);
  const { data: votes } = await admin.from("clubs_fail_votes").select("team_id").eq("pairing_id", pairing.id);
  const votedTeamIds = new Set((votes ?? []).map((v) => v.team_id));
  const allVoted = requiredTeamIds.every((id) => votedTeamIds.has(id));
  if (!allVoted) return { ok: true as const, resolved: false };

  for (const otherTeamId of requiredTeamIds) {
    const result = await applyHeartDelta(otherTeamId, -2, "round2", pairing.id, "system");
    if (!result.eliminated) {
      await admin.from("collected_cards").insert({ team_id: otherTeamId, card_code: "club8", awarded_by: "system" }).select();
      await admin.from("teams").update({ status: "round3" }).eq("id", otherTeamId);
    }
  }

  await admin.from("clubs_pairings").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", pairing.id);

  return { ok: true as const, resolved: true };
}
