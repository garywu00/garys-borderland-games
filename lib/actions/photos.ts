"use server";

import { createAdminClient } from "@/lib/supabase/server";

function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",")[1] ?? dataUrl;
  return Buffer.from(base64, "base64");
}

export async function uploadSelfie(playerId: string, dataUrl: string) {
  const admin = createAdminClient();
  const path = `${playerId}/${Date.now()}.jpg`;
  const { error: uploadErr } = await admin.storage
    .from("selfies")
    .upload(path, dataUrlToBuffer(dataUrl), { contentType: "image/jpeg", upsert: true });
  if (uploadErr) return { ok: false as const };

  const { error } = await admin.from("players").update({ selfie_path: path }).eq("id", playerId);
  if (error) return { ok: false as const };
  return { ok: true as const };
}

/**
 * Signed URLs for an arbitrary list of players' selfies — used to show
 * opponent/inviter photos, matching the app's existing fully-public team
 * name/hearts visibility model.
 */
export async function getPlayerPhotoUrls(playerIds: string[]): Promise<{ playerId: string; url: string | null }[]> {
  if (!playerIds.length) return [];
  const admin = createAdminClient();
  const { data: players } = await admin.from("players").select("id, selfie_path").in("id", playerIds);
  return Promise.all(
    (players ?? []).map(async (p) => {
      if (!p.selfie_path) return { playerId: p.id, url: null };
      const { data } = await admin.storage.from("selfies").createSignedUrl(p.selfie_path, 300);
      return { playerId: p.id, url: data?.signedUrl ?? null };
    }),
  );
}

export async function getTeamPortraits(teamId: string): Promise<{ playerId: string; url: string | null }[]> {
  const admin = createAdminClient();
  const { data: members } = await admin.from("team_members").select("player_id").eq("team_id", teamId);
  return getPlayerPhotoUrls((members ?? []).map((m) => m.player_id));
}
