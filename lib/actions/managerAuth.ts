"use server";

import bcrypt from "bcryptjs";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";

type ManagerRole = "ajan" | "michelle" | "gary";

export async function managerPinLogin(role: ManagerRole, pin: string) {
  try {
    const admin = createAdminClient();

    const { data: profile, error } = await admin
      .from("manager_profiles")
      .select("id, pin_hash")
      .eq("role", role)
      .maybeSingle();
    if (error || !profile || !profile.pin_hash) {
      return { ok: false as const, reason: "not_found" as const };
    }

    const matches = await bcrypt.compare(pin, profile.pin_hash);
    if (!matches) {
      return { ok: false as const, reason: "incorrect_pin" as const };
    }

    const { data: authUser, error: userErr } = await admin.auth.admin.getUserById(profile.id);
    if (userErr || !authUser.user?.email) {
      console.error("managerPinLogin: getUserById failed", userErr);
      return { ok: false as const, reason: "error" as const };
    }

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: authUser.user.email,
    });
    if (linkErr || !link) {
      console.error("managerPinLogin: generateLink failed", linkErr);
      return { ok: false as const, reason: "error" as const };
    }

    const session = await createSessionClient();
    const { error: verifyErr } = await session.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyErr) {
      console.error("managerPinLogin: verifyOtp failed", verifyErr);
      return { ok: false as const, reason: "error" as const };
    }

    return { ok: true as const };
  } catch (err) {
    console.error("managerPinLogin: unexpected error", err);
    return { ok: false as const, reason: "error" as const };
  }
}
