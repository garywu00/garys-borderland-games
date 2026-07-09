-- Pending pair invitations, prior to a team existing. A player may have at
-- most one outstanding *outgoing* invite at a time, but may receive many
-- incoming invites until they accept one.

create table pair_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  from_player_id uuid not null references players(id) on delete cascade,
  to_player_id uuid not null references players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (from_player_id <> to_player_id)
);

create unique index pair_invites_one_outgoing_per_player
  on pair_invites (from_player_id) where status = 'pending';

alter table pair_invites enable row level security;

create policy pair_invites_select on pair_invites for select using (true);

create index pair_invites_to_idx on pair_invites(to_player_id);
create index pair_invites_from_idx on pair_invites(from_player_id);
