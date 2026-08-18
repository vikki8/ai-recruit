import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client, service role.
 *
 * Every table has RLS enabled with zero policies, so the service role is the only way
 * in. There is no auth in this app and no browser-side Supabase client: all reads happen
 * in server components, all writes in route handlers.
 *
 * The key is never exposed to the browser. Next.js only inlines env vars prefixed with
 * NEXT_PUBLIC_, and this one deliberately is not, so it cannot reach client bundles.
 *
 * Built lazily so a missing env var surfaces as a clear runtime error on the request
 * that needed it, rather than a cryptic failure during `next build`.
 */

let cached: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("SUPABASE_URL is not set.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
