"use server";

import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

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
