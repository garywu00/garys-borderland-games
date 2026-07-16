-- Tracks player-submitted challenge photos awaiting manager review (the
-- Round 3 chicken photo, and any future photo challenge). Deliberately no
-- unique(team_id, challenge_code) — this is an append-log so a rejected
-- team can resubmit; readers take the latest row per (team_id, challenge_code).
create table challenge_submissions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  challenge_code text not null check (challenge_code in ('round3_chicken_photo')),
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz
);

create index challenge_submissions_team_idx on challenge_submissions(team_id);

alter table challenge_submissions enable row level security;

create policy challenge_submissions_select on challenge_submissions for select using (
  team_id in (select internal.my_team_ids()) or internal.is_manager()
);

alter publication supabase_realtime add table challenge_submissions;
