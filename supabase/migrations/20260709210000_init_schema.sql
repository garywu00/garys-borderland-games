-- Gary's 26th Borderland Games — initial schema
-- All privileged mutations happen server-side via the Next.js service-role client.
-- RLS below grants browsers SELECT-only access to non-sensitive data; there are
-- intentionally no client-writable INSERT/UPDATE/DELETE policies anywhere —
-- every write goes through server route handlers so business rules (atomic heart
-- resolution, one-time card awards, controller-only submissions, etc.) can be
-- enforced in one place instead of duplicated into RLS.

-- ============================================================================
-- events
-- ============================================================================
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  starts_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- players (seeded roster)
-- ============================================================================
create table players (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  display_name text not null,
  selfie_path text,
  claim_status text not null default 'available' check (claim_status in ('available', 'claimed', 'inactive')),
  claimed_by_auth_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (event_id, display_name)
);

-- append-only history of who has claimed which roster slot, supports reclaim-with-PIN
create table player_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  auth_id uuid not null references auth.users(id),
  claimed_at timestamptz not null default now(),
  released_at timestamptz
);
create unique index player_claims_one_active_per_player
  on player_claims (player_id) where released_at is null;

-- ============================================================================
-- teams (pair or trio)
-- ============================================================================
create table teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  hearts_cached int not null default 7,
  status text not null default 'round1' check (
    status in ('round1', 'round2', 'round3', 'final_waiting', 'finalist', 'non_finalist')
  ),
  recovery_pin_hash text not null,
  active_controller_auth_id uuid references auth.users(id),
  active_controller_device_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (team_id, player_id),
  unique (player_id)
);

-- enforce max 3 members per team (pair, or one trio exception)
create or replace function enforce_team_size() returns trigger as $$
begin
  if (select count(*) from team_members where team_id = new.team_id) >= 3 then
    raise exception 'A team may have at most 3 members';
  end if;
  return new;
end;
$$ language plpgsql;
create trigger team_members_size_check
  before insert on team_members
  for each row execute function enforce_team_size();

create table device_sessions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  auth_id uuid not null references auth.users(id),
  is_active_controller boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table teams
  add constraint teams_active_controller_device_fk
  foreign key (active_controller_device_id) references device_sessions(id);

-- ============================================================================
-- manager_profiles
-- ============================================================================
create table manager_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('ajan', 'michelle', 'gary')),
  display_name text not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- matchups (Round 1 — Share or Steal)
-- ============================================================================
create table matchups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_a_id uuid not null references teams(id),
  team_b_id uuid not null references teams(id),
  status text not null default 'pending_ready' check (status in ('pending_ready', 'active', 'resolved')),
  team_a_ready boolean not null default false,
  team_b_ready boolean not null default false,
  starts_at timestamptz,
  deadline_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (team_a_id <> team_b_id)
);

-- a team cannot be in two unresolved matchups at once
create or replace function enforce_single_open_matchup() returns trigger as $$
begin
  if new.status <> 'resolved' then
    if exists (
      select 1 from matchups
      where status <> 'resolved'
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (team_a_id in (new.team_a_id, new.team_b_id) or team_b_id in (new.team_a_id, new.team_b_id))
    ) then
      raise exception 'A team already has an open matchup';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;
create trigger matchups_single_open
  before insert or update on matchups
  for each row execute function enforce_single_open_matchup();

create table share_steal_submissions (
  id uuid primary key default gen_random_uuid(),
  matchup_id uuid not null references matchups(id) on delete cascade,
  team_id uuid not null references teams(id),
  choice text not null check (choice in ('share', 'steal')),
  is_timeout_default boolean not null default false,
  locked_at timestamptz not null default now(),
  unique (matchup_id, team_id)
);

-- ============================================================================
-- heart_transactions (append-only ledger — the source of truth for hearts)
-- ============================================================================
create table heart_transactions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  delta int not null,
  reason text not null,
  source_round text not null check (source_round in ('round1', 'round2', 'round3', 'final', 'manual')),
  related_id uuid,
  created_by text not null,
  created_at timestamptz not null default now(),
  reversal_of uuid references heart_transactions(id)
);

-- prevents the same matchup/action from crediting the same team's heart total twice
create unique index heart_transactions_one_per_related_action
  on heart_transactions (related_id, team_id)
  where related_id is not null and reversal_of is null;

-- ============================================================================
-- collected_cards
-- ============================================================================
create table collected_cards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  card_code text not null check (card_code in ('heart4', 'club8', 'diamond2')),
  awarded_at timestamptz not null default now(),
  awarded_by text not null,
  unique (team_id, card_code)
);

-- ============================================================================
-- checkpoint_arrivals
-- ============================================================================
create table checkpoint_arrivals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  checkpoint text not null check (checkpoint in ('clubs', 'diamonds', 'final')),
  arrived_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id),
  unique (team_id, checkpoint)
);

-- ============================================================================
-- finalists (first 3 confirmed arrivals at the final checkpoint)
-- ============================================================================
create table finalists (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null references teams(id),
  slot int not null check (slot in (1, 2, 3)),
  hearts_at_qualification int not null,
  arrival_order int not null,
  qualified_at timestamptz not null default now(),
  unique (team_id),
  unique (event_id, slot)
);

-- ============================================================================
-- winner_results
-- ============================================================================
create table winner_results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null references teams(id),
  verified_by uuid references auth.users(id),
  verified_at timestamptz not null default now(),
  reversed boolean not null default false,
  reversed_at timestamptz
);
create unique index winner_results_one_active_per_event
  on winner_results (event_id) where reversed = false;

-- ============================================================================
-- manager_actions (append-only audit log)
-- ============================================================================
create table manager_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  actor_role text not null,
  action text not null,
  target_team_id uuid references teams(id),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- helper: team ids the current auth session belongs to
-- ============================================================================
create or replace function my_team_ids() returns setof uuid as $$
  select tm.team_id
  from team_members tm
  join player_claims pc on pc.player_id = tm.player_id and pc.released_at is null
  where pc.auth_id = auth.uid()
  union
  select ds.team_id from device_sessions ds where ds.auth_id = auth.uid();
$$ language sql stable security definer set search_path = public;

create or replace function is_manager() returns boolean as $$
  select exists (select 1 from manager_profiles where id = auth.uid());
$$ language sql stable security definer set search_path = public;

-- ============================================================================
-- Row Level Security — every browser-accessible table, SELECT-only.
-- Writes happen exclusively through server route handlers using the
-- service-role key, which bypasses RLS by design and is never sent to browsers.
-- ============================================================================
alter table events enable row level security;
alter table players enable row level security;
alter table player_claims enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table device_sessions enable row level security;
alter table manager_profiles enable row level security;
alter table matchups enable row level security;
alter table share_steal_submissions enable row level security;
alter table heart_transactions enable row level security;
alter table collected_cards enable row level security;
alter table checkpoint_arrivals enable row level security;
alter table finalists enable row level security;
alter table winner_results enable row level security;
alter table manager_actions enable row level security;

create policy events_select on events for select using (true);

create policy players_select on players for select using (true);
revoke select on players from anon, authenticated;
grant select (id, event_id, display_name, selfie_path, claim_status, created_at) on players to anon, authenticated;

create policy player_claims_select on player_claims for select using (auth_id = auth.uid() or is_manager());

create policy teams_select on teams for select using (true);
revoke select on teams from anon, authenticated;
grant select (id, event_id, name, hearts_cached, status, created_at, updated_at) on teams to anon, authenticated;

create policy team_members_select on team_members for select using (true);

create policy device_sessions_select on device_sessions for select using (auth_id = auth.uid() or is_manager());

create policy manager_profiles_select on manager_profiles for select using (id = auth.uid() or is_manager());

create policy matchups_select on matchups for select using (
  status = 'resolved' or team_a_id in (select my_team_ids()) or team_b_id in (select my_team_ids()) or is_manager()
);

create policy share_steal_submissions_select on share_steal_submissions for select using (
  team_id in (select my_team_ids())
  or is_manager()
  or exists (
    select 1 from matchups m
    where m.id = share_steal_submissions.matchup_id and m.status = 'resolved'
  )
);

create policy heart_transactions_select on heart_transactions for select using (
  team_id in (select my_team_ids()) or is_manager()
);

create policy collected_cards_select on collected_cards for select using (true);

create policy checkpoint_arrivals_select on checkpoint_arrivals for select using (true);

create policy finalists_select on finalists for select using (true);

create policy winner_results_select on winner_results for select using (true);

create policy manager_actions_select on manager_actions for select using (is_manager());

-- ============================================================================
-- indexes
-- ============================================================================
create index players_event_idx on players(event_id);
create index teams_event_idx on teams(event_id);
create index team_members_team_idx on team_members(team_id);
create index device_sessions_team_idx on device_sessions(team_id);
create index matchups_event_idx on matchups(event_id);
create index heart_transactions_team_idx on heart_transactions(team_id);
create index collected_cards_team_idx on collected_cards(team_id);
create index checkpoint_arrivals_team_idx on checkpoint_arrivals(team_id);
create index manager_actions_target_idx on manager_actions(target_team_id);
