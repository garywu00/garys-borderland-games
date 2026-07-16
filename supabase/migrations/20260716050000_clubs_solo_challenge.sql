-- Ajan can give a single team a smaller, solo version of the spinach
-- challenge instead of always requiring two teams to pair up. Modeled as a
-- clubs_pairings row with team_b_id left null — every existing pairing,
-- fail-vote, and pass-resolution code path already treats team_a_id/
-- team_b_id generically, so this is the only schema change needed.
-- (team_a_id <> team_b_id still holds: the comparison is NULL, not FALSE,
-- when team_b_id is null, so the check constraint is unaffected.)
alter table clubs_pairings alter column team_b_id drop not null;
