-- The team recovery PIN had nowhere to actually be used once both
-- partners can act on a team from their own device (see requireTeamMember
-- replacing requireActiveController) — there's no single "controller"
-- device to hand off to anymore. Stop requiring a value here; acceptInvite
-- no longer generates or shows one.
alter table teams alter column recovery_pin_hash drop not null;
