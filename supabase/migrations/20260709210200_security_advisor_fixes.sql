-- Resolves warnings from `supabase advisors security` after the initial schema:
--  - pin search_path on trigger functions (mutable search_path warning)
--  - move RLS-helper functions off the `public` schema so they aren't reachable
--    as public RPC endpoints (PostgREST only exposes `public`/`graphql_public`),
--    while remaining callable from policies via a schema-qualified name.

create schema if not exists internal;

create or replace function internal.my_team_ids() returns setof uuid as $$
  select tm.team_id
  from team_members tm
  join player_claims pc on pc.player_id = tm.player_id and pc.released_at is null
  where pc.auth_id = auth.uid()
  union
  select ds.team_id from device_sessions ds where ds.auth_id = auth.uid();
$$ language sql stable security definer set search_path = public;

create or replace function internal.is_manager() returns boolean as $$
  select exists (select 1 from manager_profiles where id = auth.uid());
$$ language sql stable security definer set search_path = public;

drop policy player_claims_select on player_claims;
create policy player_claims_select on player_claims for select using (auth_id = auth.uid() or internal.is_manager());

drop policy device_sessions_select on device_sessions;
create policy device_sessions_select on device_sessions for select using (auth_id = auth.uid() or internal.is_manager());

drop policy manager_profiles_select on manager_profiles;
create policy manager_profiles_select on manager_profiles for select using (id = auth.uid() or internal.is_manager());

drop policy matchups_select on matchups;
create policy matchups_select on matchups for select using (
  status = 'resolved' or team_a_id in (select internal.my_team_ids()) or team_b_id in (select internal.my_team_ids()) or internal.is_manager()
);

drop policy share_steal_submissions_select on share_steal_submissions;
create policy share_steal_submissions_select on share_steal_submissions for select using (
  team_id in (select internal.my_team_ids())
  or internal.is_manager()
  or exists (
    select 1 from matchups m
    where m.id = share_steal_submissions.matchup_id and m.status = 'resolved'
  )
);

drop policy heart_transactions_select on heart_transactions;
create policy heart_transactions_select on heart_transactions for select using (
  team_id in (select internal.my_team_ids()) or internal.is_manager()
);

drop policy manager_actions_select on manager_actions;
create policy manager_actions_select on manager_actions for select using (internal.is_manager());

drop function if exists public.my_team_ids();
drop function if exists public.is_manager();

create or replace function public.enforce_team_size() returns trigger as $$
begin
  if (select count(*) from team_members where team_id = new.team_id) >= 3 then
    raise exception 'A team may have at most 3 members';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

create or replace function public.enforce_single_open_matchup() returns trigger as $$
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
$$ language plpgsql set search_path = public;
