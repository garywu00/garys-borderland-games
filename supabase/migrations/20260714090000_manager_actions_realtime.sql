-- manager_actions was never added to the realtime publication (same class
-- of bug as the original "realtime completely non-functional" fix) — the
-- new Overview "Recent activity" log subscribes to it, so without this the
-- subscription silently never fires.
alter publication supabase_realtime add table manager_actions;
