-- Same gap the original team_deletion_cascades migration fixed for
-- matchups/finalists/winner_results, but for the two tables added later
-- this event (clubs_pairings, clubs_fail_votes) — their team_id FKs never
-- got the matching ON DELETE CASCADE, so deleting a team that was ever
-- paired at Ajan's checkpoint silently failed (Supabase client swallows
-- the FK-violation error rather than throwing), leaving that team behind
-- through both "Remove team" and "Reset game".

alter table clubs_pairings drop constraint clubs_pairings_team_a_id_fkey;
alter table clubs_pairings
  add constraint clubs_pairings_team_a_id_fkey
  foreign key (team_a_id) references teams(id) on delete cascade;

alter table clubs_pairings drop constraint clubs_pairings_team_b_id_fkey;
alter table clubs_pairings
  add constraint clubs_pairings_team_b_id_fkey
  foreign key (team_b_id) references teams(id) on delete cascade;

alter table clubs_fail_votes drop constraint clubs_fail_votes_team_id_fkey;
alter table clubs_fail_votes
  add constraint clubs_fail_votes_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
