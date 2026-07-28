"use server";

import { createAdminClient } from "@/lib/supabase/server";

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return Buffer.from(base64, "base64");
}

/**
 * One photo per team (taken together at formation), not one per player —
 * stored in the challenge_photos bucket (team-owned content) rather than
 * selfies (which was per-player, private/player-owned).
 */
export async function uploadTeamPhoto(teamId: string, dataUrl: string) {
  const admin = createAdminClient();
  const path = `${teamId}/${Date.now()}.jpg`;
  const { error: uploadErr } = await admin.storage
    .from("challenge_photos")
    .upload(path, dataUrlToBuffer(dataUrl), { contentType: "image/jpeg", upsert: true });
  if (uploadErr) return { ok: false as const };

  const { error } = await admin.from("teams").update({ photo_path: path }).eq("id", teamId);
  if (error) return { ok: false as const };
  return { ok: true as const };
}

/**
 * Signed URL for a team's group photo — used for both a team's own header
 * and to show the opponent/other team's photo, matching the app's existing
 * fully-public team name/hearts visibility model.
 */
export async function getTeamPhotoUrl(teamId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: team } = await admin.from("teams").select("photo_path").eq("id", teamId).maybeSingle();
  if (!team?.photo_path) return null;
  const { data } = await admin.storage.from("challenge_photos").createSignedUrl(team.photo_path, 300);
  return data?.signedUrl ?? null;
}
