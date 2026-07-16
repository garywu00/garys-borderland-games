-- Private storage bucket for player-submitted challenge photos (e.g. the
-- Round 3 chicken photo). Kept separate from the `selfies` bucket since
-- these are moderated/team-owned content, not private/player-owned photos.
-- Same access pattern as selfies: no client-side storage.objects policies,
-- all reads/writes go through server actions using the service-role key.

insert into storage.buckets (id, name, public)
values ('challenge_photos', 'challenge_photos', false)
on conflict (id) do nothing;
