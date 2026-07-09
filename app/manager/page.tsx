import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { ManagerLogin } from "./ManagerLogin";
import { ManagerDashboard } from "./ManagerDashboard";

export default async function ManagerPage() {
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
    return (
      <main style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <p style={{ textAlign: "center", color: "var(--muted)", maxWidth: 320 }}>
          You&apos;re signed in, but this email isn&apos;t set up as a manager. Ask Gary to add you to
          manager_profiles.
        </p>
      </main>
    );
  }

  return <ManagerDashboard role={profile.role as "ajan" | "michelle" | "gary"} displayName={profile.display_name} />;
}
