"use server";

import { createAdminClient } from "@/lib/supabase/server";
import { requireActiveController, requireManager } from "@/lib/actions/session";

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
 * Signed URLs for a team's members' selfies — used to show an opponent
 * (not just your own) pair's photos, matching the app's existing
 * fully-public team name/hearts visibility model.
 */
export async function getTeamPortraits(teamId: string): Promise<{ playerId: string; url: string | null }[]> {
  const admin = createAdminClient();
  const { data: members } = await admin.from("team_members").select("player_id").eq("team_id", teamId);
  const playerIds = (members ?? []).map((m) => m.player_id);
  if (!playerIds.length) return [];

  const { data: players } = await admin.from("players").select("id, selfie_path").in("id", playerIds);
  const results = await Promise.all(
    (players ?? []).map(async (p) => {
      if (!p.selfie_path) return { playerId: p.id, url: null };
      const { data } = await admin.storage.from("selfies").createSignedUrl(p.selfie_path, 300);
      return { playerId: p.id, url: data?.signedUrl ?? null };
    }),
  );
  return results;
}

export async function submitChallengePhoto(teamId: string, challengeCode: "round3_chicken_photo", dataUrl: string) {
  const controller = await requireActiveController(teamId);
  if (!controller.ok) return controller;

  const admin = createAdminClient();
  const path = `${teamId}/${challengeCode}/${Date.now()}.jpg`;
  const { error: uploadErr } = await admin.storage
    .from("challenge_photos")
    .upload(path, dataUrlToBuffer(dataUrl), { contentType: "image/jpeg" });
  if (uploadErr) return { ok: false as const, reason: "upload_failed" as const };

  const { error } = await admin
    .from("challenge_submissions")
    .insert({ team_id: teamId, challenge_code: challengeCode, storage_path: path });
  if (error) return { ok: false as const, reason: "insert_failed" as const };

  return { ok: true as const };
}

export async function getChallengePhotoUrl(storagePath: string) {
  await requireManager();
  const admin = createAdminClient();
  const { data } = await admin.storage.from("challenge_photos").createSignedUrl(storagePath, 300);
  return data?.signedUrl ?? null;
}
