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
 * Gates an action to the team's one controlling device — the device that
 * formed the team, or a teammate's device that took over via the recovery
 * PIN after it did. One device plays for the whole team, so there's
 * exactly one valid auth id at any given time, not "any claimed member."
 */
export async function requireTeamMember(teamId: string) {
  const authId = await requireAuthId();
  const admin = createAdminClient();
  const { data } = await admin.from("teams").select("active_controller_auth_id").eq("id", teamId).maybeSingle();
  if (!data || data.active_controller_auth_id !== authId) return { ok: false as const, reason: "not_team_member" as const };
  return { ok: true as const, authId };
}
