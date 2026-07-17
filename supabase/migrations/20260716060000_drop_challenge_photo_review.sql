-- The chicken-photo challenge is now shown in person to Michelle rather
-- than uploaded for remote review — the whole point is making the team
-- physically bring the photo back to her, which an async upload/review
-- queue undermined. Drops the now-unused review pipeline.
drop table if exists challenge_submissions;

-- The challenge_photos bucket is left in place (empty, unused) — Supabase
-- blocks direct SQL deletion of storage tables; removing it, if desired,
-- needs the Storage Management API/dashboard instead.
