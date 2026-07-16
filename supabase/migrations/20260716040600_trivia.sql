-- One Gary trivia attempt per team per round. question_id references the
-- fixed 6-question pool in lib/game/trivia.ts (kept in code, not a DB
-- table, since the pool is small and fixed and answer-normalization logic
-- has to live in code regardless). started_at is set server-side the
-- moment a team taps "I'm ready" — the 30s timer is authoritative from
-- this timestamp so a refresh resumes rather than restarts, and a client
-- can't dodge the deadline by fiddling with its own clock.
create table team_trivia_attempts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  round_number int not null check (round_number in (1, 2, 3)),
  question_id text not null,
  submitted_answer text,
  is_correct boolean,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  timed_out boolean not null default false,
  heart_transaction_id uuid references heart_transactions(id),
  created_at timestamptz not null default now(),
  unique (team_id, round_number)
);

create index team_trivia_attempts_team_idx on team_trivia_attempts(team_id);

alter table team_trivia_attempts enable row level security;

create policy team_trivia_attempts_select on team_trivia_attempts for select using (
  team_id in (select internal.my_team_ids()) or internal.is_manager()
);

alter publication supabase_realtime add table team_trivia_attempts;
