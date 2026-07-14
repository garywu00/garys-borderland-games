-- Resets all game/pairing state back to "roster exists, nobody's paired up
-- yet" while keeping the roster, the active event, and manager accounts/PINs
-- intact. Run this between test runs (or before the real event) via the
-- Supabase SQL Editor or Management API — it is NOT a schema migration, so
-- it does not live in supabase/migrations/.

update teams set active_controller_device_id = null;

delete from manager_actions;
delete from winner_results;
delete from finalists;
delete from share_steal_submissions;
delete from matchups;
delete from checkpoint_arrivals;
delete from collected_cards;
delete from heart_transactions;
delete from device_sessions;
delete from team_members;
delete from teams;
delete from pair_invites;
delete from player_claims;

update players set claim_status = 'available', claimed_by_auth_id = null;
