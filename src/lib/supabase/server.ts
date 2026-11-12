import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env, features } from "@/lib/env";

/** Server-side Supabase client bound to the request cookies (anon key + user JWT — RLS applies). */
export async function createSupabaseServerClient() {
  if (!features.supabaseAuth()) return null;
  const cookieStore = await cookies();
  return createServerClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — the proxy refreshes cookies instead.
        }
      },
    },
  });
}
