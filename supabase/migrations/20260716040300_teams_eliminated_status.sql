-- A team that hits 0 hearts is eliminated and redirected to the final
-- meetup spot rather than continuing the round they were on.
-- pre_elimination_status records what to restore if a manager later
-- reverses the heart transaction that caused the elimination.
alter table teams drop constraint teams_status_check;
alter table teams add constraint teams_status_check
  check (status in ('round1','round2','round3','final_waiting','finalist','non_finalist','eliminated'));
alter table teams add column pre_elimination_status text;
