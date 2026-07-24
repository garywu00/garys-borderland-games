-- Admin-triggered pre-game hype countdown, broadcast to every connected
-- player at once (regardless of what screen they're on) while Gary
-- explains the rules in person. Distinct from starts_at, which anchors the
-- in-game elapsed timer once the first pair actually forms.
alter table events add column countdown_started_at timestamptz;
