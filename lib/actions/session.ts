"use server";

import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

export type ManagerRole = "ajan" | "michelle" | "gary";

/**
 * All three managers have equal controls — Ajan/Michelle/Gary can each
 * operate any checkpoint, confirm arrivals, verify the winner, and reset the
 * game, so any one of them can cover for another on the day of. `role` is
 * still returned so the audit log records who actually did what.
 */
export async function requireManager(): Promise<{ id: string; role: ManagerRole }> {
  const session = await createSessionClient();
  const { data } = await session.auth.getUser();
  if (!data.user) throw new Error("Not authenticated");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("manager_profiles")
    .select("id, role")
    .eq("id", data.user.id)
    .single();
  if (!profile) {
    throw new Error("Unauthorized manager action");
  }
  return { id: profile.id, role: profile.role as ManagerRole };
}

export async function requireAuthId(): Promise<string> {
  const session = await createSessionClient();
  const { data } = await session.auth.getUser();
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

/**
 * Gates an action to someone actually on the team — either partner's
 * device, not just whichever one happened to accept the pairing invite.
 * Both partners play from their own phones, so there's no single
 * "controller" device to restrict actions to.
 */
export async function requireTeamMember(teamId: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();
  const { data } = await admin
    .from("team_members")
    .select("player_id, players!inner(claimed_by_auth_id)")
    .eq("team_id", teamId)
    .eq("players.claimed_by_auth_id", authId)
    .maybeSingle();
  if (!data) return { ok: false as const, reason: "not_team_member" as const };
  return { ok: true as const, authId };
}
