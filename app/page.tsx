import { createAdminClient } from "@/lib/supabase/server";
import { PlayerApp } from "./PlayerApp";

export const dynamic = "force-dynamic";

export default async function PlayerPage() {
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("events")
    .select("id, name")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!event) {
    return (
      <main style={{ display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <p style={{ textAlign: "center", color: "var(--muted)" }}>
          No active game right now. Check back once Gary starts one.
        </p>
      </main>
    );
  }

  return <PlayerApp eventId={event.id} />;
}
