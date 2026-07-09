/**
 * Seeds a demo-ready state in the connected Supabase project: one active
 * event, a roster, a couple of completed teams parked at different
 * checkpoints, and manager accounts for Ajan/Michelle/Gary.
 *
 * Run with: npx tsx scripts/seed.ts
 * Reads Supabase credentials from .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (match) process.env[match[1]!] = match[2];
    }
  } catch {
    // rely on already-exported env vars instead
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const ROSTER = [
  "Natalie Po", "Dylan Marsh", "Ashley Kim", "Katherine Lu", "Owen Frost", "Bella Cruz",
  "Marcus Webb", "Priya Anand", "Srijan Patel", "Trisha Nguyen", "Noah Reyes", "Ivy Chen",
];

// Update these to your managers' real email addresses so their magic links
// actually reach them. Gary's is set to the account owner's real address.
const MANAGERS: { email: string; role: "ajan" | "michelle" | "gary"; name: string }[] = [
  { email: "ajan@example.com", role: "ajan", name: "Ajan Lorenzo" },
  { email: "michelle@example.com", role: "michelle", name: "Michelle Tran" },
  { email: "garywu00@gmail.com", role: "gary", name: "Gary Wu" },
];

async function main() {
  console.log("Seeding event...");
  const { data: event, error: eventErr } = await admin
    .from("events")
    .insert({ name: "Gary's 26th Borderland Games", status: "active" })
    .select("id")
    .single();
  if (eventErr) throw eventErr;
  const eventId = event.id;

  console.log("Seeding roster...");
  const { data: players, error: playersErr } = await admin
    .from("players")
    .insert(ROSTER.map((name) => ({ event_id: eventId, display_name: name })))
    .select("id, display_name");
  if (playersErr) throw playersErr;
  const byName = (name: string) => players.find((p) => p.display_name === name)!.id;

  console.log("Seeding manager accounts...");
  for (const m of MANAGERS) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: m.email,
      email_confirm: true,
    });
    if (createErr && !createErr.message.includes("already been registered")) throw createErr;
    const userId =
      created?.user?.id ??
      (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === m.email)?.id;
    if (!userId) continue;
    await admin.from("manager_profiles").upsert({ id: userId, role: m.role, display_name: m.name });
  }

  async function makeTeam(nameA: string, nameB: string, hearts: number, status: string) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const pinHash = await bcrypt.hash(pin, 10);
    const { data: team, error } = await admin
      .from("teams")
      .insert({ event_id: eventId, name: `${nameA} + ${nameB}`, hearts_cached: hearts, status, recovery_pin_hash: pinHash })
      .select("id")
      .single();
    if (error) throw error;
    await admin.from("team_members").insert([
      { team_id: team.id, player_id: byName(nameA) },
      { team_id: team.id, player_id: byName(nameB) },
    ]);
    await admin
      .from("players")
      .update({ claim_status: "claimed" })
      .in("id", [byName(nameA), byName(nameB)]);
    console.log(`  team ${nameA} + ${nameB} — ${hearts} hearts, status=${status}, PIN=${pin}`);
    return team.id;
  }

  console.log("Seeding teams at various checkpoints...");
  await makeTeam("Ashley Kim", "Katherine Lu", 8, "round2"); // at Clubs (Ajan)
  await makeTeam("Owen Frost", "Bella Cruz", 8, "round2"); // at Clubs (Ajan), pairs with above
  await makeTeam("Marcus Webb", "Priya Anand", 6, "round3"); // at Diamonds (Michelle)
  const finalistTeamId = await makeTeam("Srijan Patel", "Trisha Nguyen", 9, "final_waiting"); // awaiting Gary's confirmation

  console.log(`Done. Active event: ${eventId}`);
  console.log(`Team awaiting arrival confirmation: ${finalistTeamId}`);
  console.log("Remaining unclaimed roster: Natalie Po, Dylan Marsh, Noah Reyes, Ivy Chen — free to register/pair live.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
