-- Manager sign-in switches from email magic link to a simple PIN, since the
-- 3 managers are known/trusted people at a single live event and email
-- delivery (plus Supabase's default 2/hour auth-email rate limit) is an
-- unnecessary point of failure on the day of. The underlying Supabase Auth
-- session is still established server-side (via admin.generateLink +
-- verifyOtp) so RLS and auth.uid() keep working exactly as before — only the
-- credential a manager types in changes.

alter table manager_profiles add column if not exists pin_hash text;

with pins as (
  select 'ajan' as role, (1000 + floor(random() * 9000))::int as pin
  union all
  select 'michelle', (1000 + floor(random() * 9000))::int
  union all
  select 'gary', (1000 + floor(random() * 9000))::int
)
update manager_profiles mp
set pin_hash = crypt(pins.pin::text, gen_salt('bf'))
from pins
where mp.role = pins.role
returning mp.role, pins.pin;
