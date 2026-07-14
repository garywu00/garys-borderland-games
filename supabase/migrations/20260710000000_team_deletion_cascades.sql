-- Supports the new "remove team" admin tool: deleting a team should clean up
-- everything that pointed at it, rather than failing on a foreign key or
-- leaving orphaned rows. manager_actions keeps its audit entries but drops
-- the now-meaningless team reference instead of blocking the delete.

alter table matchups drop constraint matchups_team_a_id_fkey;
alter table matchups
  add constraint matchups_team_a_id_fkey
  foreign key (team_a_id) references teams(id) on delete cascade;

alter table matchups drop constraint matchups_team_b_id_fkey;
alter table matchups
  add constraint matchups_team_b_id_fkey
  foreign key (team_b_id) references teams(id) on delete cascade;

alter table finalists drop constraint finalists_team_id_fkey;
alter table finalists
  add constraint finalists_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;

alter table winner_results drop constraint winner_results_team_id_fkey;
alter table winner_results
  add constraint winner_results_team_id_fkey
  foreign key (team_id) references teams(id) on delete cascade;

alter table manager_actions drop constraint manager_actions_target_team_id_fkey;
alter table manager_actions
  add constraint manager_actions_target_team_id_fkey
  foreign key (target_team_id) references teams(id) on delete set null;
