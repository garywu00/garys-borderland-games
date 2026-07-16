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
 * Gates an action to the one device a team designated as its active
 * controller (acceptInvite/recoverWithPin set this) — every other device
 * holding a valid teamId can read but must not be able to submit on the
 * team's behalf.
 */
export async function requireActiveController(teamId: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();
  const { data: team } = await admin.from("teams").select("active_controller_auth_id").eq("id", teamId).maybeSingle();
  if (!team || team.active_controller_auth_id !== authId) {
    return { ok: false as const, reason: "not_active_controller" as const };
  }
  return { ok: true as const, authId };
}
