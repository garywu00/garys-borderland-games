import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * Session-aware server client — respects the caller's own anonymous/manager
 * auth session (and therefore RLS) via cookies. Use for reads in server
 * components that should see only what that caller is allowed to see.
 */
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — a middleware refresh
            // will keep the session in sync instead.
          }
        },
      },
    },
  );
}

/**
 * Privileged admin client — bypasses RLS with the service-role key. Never
 * import this from a Client Component; it must only run in Server Actions
 * and Route Handlers. This is the only client allowed to write to game data.
 */
export function createAdminClient() {
  return createRawClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
