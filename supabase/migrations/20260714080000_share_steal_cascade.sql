-- The team-deletion cascade migration (20260710000000) covered matchups,
-- finalists, winner_results, and manager_actions, but missed
-- share_steal_submissions — so "Remove team" failed on a foreign key
-- violation for any team that had already played Round 1 (i.e. almost
-- every team by the time an admin wants to remove one).
alter table share_steal_submissions drop constraint share_steal_submissions_team_id_fkey;
alter table share_steal_submissions
  add constraint share_steal_submissions_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;
