-- Private storage bucket for player selfies. Uploads/reads of another team's
-- selfie are not needed client-side beyond displaying portraits already
-- referenced by players.selfie_path, so we keep the bucket private and only
-- serve images via signed URLs generated server-side.

insert into storage.buckets (id, name, public)
values ('selfies', 'selfies', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by default with no policies for this
-- bucket, so browsers get zero direct access — reads/writes happen exclusively
-- through server route handlers using the service-role key (signed URLs for
-- display, direct upload for capture).
