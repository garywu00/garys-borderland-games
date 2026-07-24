-- Same class of gap as the clubs_pairings migration just before this one:
-- team_trivia_attempts.heart_transaction_id referenced heart_transactions
-- without ON DELETE CASCADE, so wiping heart_transactions during a reset
-- failed as soon as any trivia penalty had ever been recorded.
alter table team_trivia_attempts drop constraint team_trivia_attempts_heart_transaction_id_fkey;
alter table team_trivia_attempts
  add constraint team_trivia_attempts_heart_transaction_id_fkey
  foreign key (heart_transaction_id) references heart_transactions(id) on delete cascade;
