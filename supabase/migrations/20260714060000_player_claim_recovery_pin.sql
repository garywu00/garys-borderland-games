-- Per-claim recovery PIN, so a player can prove which roster slot is really
-- theirs if they (or someone else) picked the wrong name by mistake.
-- player_claims already existed for exactly this ("supports reclaim-with-PIN")
-- but never had a PIN column. RLS already restricts player_claims rows to
-- the owning auth_id or a manager, so no policy changes are needed — a
-- player can see their own pin, and any manager can see everyone's.
alter table player_claims add column pin text;
