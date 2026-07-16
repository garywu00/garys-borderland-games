-- Players need to see events.starts_at populate live once the global game
-- timer begins (see acceptInvite), which requires the table to be on the
-- realtime publication — tables are not realtime by default (see the
-- manager_actions_realtime migration for precedent).
alter publication supabase_realtime add table events;
