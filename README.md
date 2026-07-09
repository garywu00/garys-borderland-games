# Gary's 26th Borderland Games

A live, location-based birthday game for ~30-40 people, played in pairs through
a mobile browser. Player view at `/`, manager view at `/manager`, both backed
by the same Supabase project in real time.

## Stack

Next.js 15 (App Router, TypeScript), Supabase (Postgres, Auth, Realtime,
Storage), deployed on Vercel. No Tailwind — plain CSS matching the Figma
design system (stark black/white, Inter-style body font, red accent).

## Card art attribution

The 4 of Hearts, 8 of Clubs, and 2 of Diamonds SVGs in `public/cards/` are
from Chris Aguilar's [Vector Playing Card Library](https://totalnonsense.com/open-source-vector-playing-cards/)
(v3.2), licensed under LGPL-3.0. This attribution is the license's required
public notice.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project's values
npm run dev
```

Open `http://localhost:3000` for the player view, `http://localhost:3000/manager`
for the manager view.

Run tests: `npm test`
Type-check: `npx tsc --noEmit`
Production build: `npm run build`

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | Public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel + `.env.local` | Public (anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + `.env.local` | **Secret** — server-only, bypasses RLS. Never in client code or git. |
| `NEXT_PUBLIC_DEMO_MODE` | Vercel + `.env.local` | `true` locally/preview, `false` in real production |

## Database migrations

All schema changes are version-controlled SQL files in `supabase/migrations/`,
applied in filename order. They were applied to the live project via the
Supabase Management API in this environment (raw `psql` couldn't reach the
direct-connection host, which is IPv6-only). If you have working `psql`/
Supabase CLI access elsewhere:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

After any schema change, re-run the security advisors and resolve warnings:

```bash
curl -s "https://api.supabase.com/v1/projects/<ref>/advisors/security" \
  -H "Authorization: Bearer <personal-access-token>"
```

## Seeding demo data

```bash
npx tsx scripts/seed.ts
```

Creates one active event, a 12-person roster, a few teams already parked at
the Clubs/Diamonds/final checkpoints, and manager accounts for Ajan, Michelle,
and Gary. **Edit the `MANAGERS` array in `scripts/seed.ts` first** — Ajan's
and Michelle's emails are placeholders; only Gary's is set to a real address.
Manager sign-in is by magic link, so whoever's email is there needs to be a
real inbox they can check.

## Supabase Auth redirect URL

Once deployed, add your production domain's callback URL in Supabase
dashboard → Authentication → URL Configuration → Redirect URLs:

```
https://<your-vercel-domain>/auth/callback
```

Without this, manager magic links will fail to complete sign-in on production.

## Manual manager setup required after deploy

1. Update `scripts/seed.ts` with Ajan and Michelle's real email addresses (or
   create their `manager_profiles` rows directly via SQL) before they can sign
   in.
2. Add the Supabase Auth redirect URL above.
3. Confirm `NEXT_PUBLIC_DEMO_MODE=false` in the real production environment.

## What's implemented vs. simplified right now

Implemented against the real Supabase backend: anonymous player sessions,
selfie capture with camera-denial fallback, roster claiming, recovery-PIN
takeover, pairing invites, Round 1 Share/Steal (all 4 outcomes, idempotent
resolution, timeout-to-Share), card awards, Ajan/Michelle/Gary manager actions,
finalist ranking, winner verification, RLS on every table, a manager audit
log, and Realtime updates throughout.

Known simplifications to revisit: trio (3-player team) invites are supported
in the schema/actions but not yet exposed in the pairing UI; the Round 1
selection timer isn't yet enforced server-side (a client-driven timeout call
is needed); manager "undo" actions exist as compensating heart transactions
but don't yet have dedicated UI buttons; error-state coverage (offline/
reconnect banners, invite-expired, etc.) is partial; automated test coverage
currently covers the Share/Steal rules and finalist ranking only, not the
full server-action layer.
