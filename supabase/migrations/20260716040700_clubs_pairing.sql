-- Round 2 (Ajan/Clubs) rework: Ajan pairs two arrived teams together up
-- front (rather than picking a pair only when recording an outcome), both
-- teams then see each other's photo and instructions on their own screens.
-- Passing still requires Ajan's button press (physical proof of a finished
-- spinach bag); failing is self-serve but requires BOTH paired teams to
-- independently agree, mirroring the existing Round 1 Share/Steal
-- pairing + "wait for both sides" shape.
create table clubs_pairings (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_a_id uuid not null references teams(id),
  team_b_id uuid not null references teams(id),
  status text not null default 'active' check (status in ('active', 'resolved')),
  paired_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (team_a_id <> team_b_id)
);

-- mirrors matchups' enforce_single_open_matchup trigger: a team can't be in
-- two open Clubs pairings at once
create or replace function enforce_single_open_clubs_pairing() returns trigger as $$
begin
  if new.status <> 'resolved' then
    if exists (
      select 1 from clubs_pairings
      where status <> 'resolved'
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (team_a_id in (new.team_a_id, new.team_b_id) or team_b_id in (new.team_a_id, new.team_b_id))
    ) then
      raise exception 'A team already has an open Clubs pairing';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger clubs_pairings_single_open
  before insert or update on clubs_pairings
  for each row execute function enforce_single_open_clubs_pairing();

create table clubs_fail_votes (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references clubs_pairings(id) on delete cascade,
  team_id uuid not null references teams(id),
  voted_at timestamptz not null default now(),
  unique (pairing_id, team_id)
);

alter table clubs_pairings enable row level security;
alter table clubs_fail_votes enable row level security;

create policy clubs_pairings_select on clubs_pairings for select using (
  team_a_id in (select internal.my_team_ids()) or team_b_id in (select internal.my_team_ids()) or internal.is_manager()
);
create policy clubs_fail_votes_select on clubs_fail_votes for select using (
  team_id in (select internal.my_team_ids()) or internal.is_manager()
);

alter publication supabase_realtime add table clubs_pairings;
alter publication supabase_realtime add table clubs_fail_votes;
