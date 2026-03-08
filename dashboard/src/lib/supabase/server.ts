import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Only require Supabase config when auth is enabled
if (!SKIP_AUTH && (!supabaseUrl || !supabaseKey)) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function createSupabaseMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (SKIP_AUTH) {
    // Return a mock that never has a session (middleware will skip auth check anyway)
    const mockSupabase = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
      },
    } as unknown as ReturnType<typeof createServerClient>;
    return { supabase: mockSupabase, response };
  }

  const supabase = createServerClient(
    supabaseUrl!,
    supabaseKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  return { supabase, response };
}
