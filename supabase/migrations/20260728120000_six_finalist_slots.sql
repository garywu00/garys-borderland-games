-- Widen the finalist slot cap from 3 to 6 pairs, per the updated game
-- format. The app-side logic (lib/game/rules.ts FINALIST_SLOTS) already
-- treats this as configurable; this constraint just needs to stop
-- rejecting inserts for slot > 3, which would otherwise silently fail the
-- same way the reset-game bug did earlier this event.
alter table finalists drop constraint finalists_slot_check;
alter table finalists add constraint finalists_slot_check check (slot in (1, 2, 3, 4, 5, 6));
