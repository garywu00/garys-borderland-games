-- Starting hearts drops from 7 to 5. Only affects new teams (acceptInvite
-- never sets hearts_cached explicitly, relying on this column default) —
-- existing teams keep whatever value they already have.
alter table teams alter column hearts_cached set default 5;
