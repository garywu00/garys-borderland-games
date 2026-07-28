-- Rebuild registration around one-device-per-team: a single person forms
-- the whole team in one step (multi-select roster + one group photo)
-- instead of individually claiming a name and pairing via invites. That
-- device becomes the team's sole controller (teams.active_controller_auth_id,
-- already present but unused since the invite-based "either partner acts"
-- model replaced the single-controller design it was built for) — a
-- teammate can take over on a new device via the recovery PIN
-- (teams.recovery_pin_hash, also already present and unused for the same
-- reason) if that device is lost.

alter table teams add column photo_path text;

-- Was: player_claims (per-player claim) union device_sessions (unused).
-- Now: the team's own controlling device, directly.
create or replace function internal.my_team_ids() returns setof uuid
language sql stable security definer set search_path = 'public' as $$
  select id from teams where active_controller_auth_id = auth.uid();
$$;
