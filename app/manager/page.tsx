import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { ManagerLogin } from "./ManagerLogin";
import { ManagerDashboard } from "./ManagerDashboard";
import { NotAManager } from "./NotAManager";

export default async function ManagerPage() {
  try {
    const session = await createSessionClient();
    const { data } = await session.auth.getUser();

    if (!data.user) {
      return <ManagerLogin />;
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("manager_profiles")
      .select("id, role, display_name")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile) {
      return <NotAManager />;
    }

    return <ManagerDashboard role={profile.role as "ajan" | "michelle" | "gary"} displayName={profile.display_name} />;
  } catch (err) {
    console.error("ManagerPage: unexpected error", err);
    return <ManagerLogin />;
  }
}
