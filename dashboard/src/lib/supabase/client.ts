import { createBrowserClient } from "@supabase/ssr";

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Only require Supabase config when auth is enabled
if (!SKIP_AUTH && (!supabaseUrl || !supabaseKey)) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

// Mock Supabase client for dev mode (no real Supabase instance needed)
function createMockClient() {
  const noop = async () => ({ data: null, error: null });
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signOut: noop,
      signInWithPassword: async () => ({
        data: { session: null, user: null },
        error: null,
      }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      refreshSession: async () => ({ data: { session: null }, error: null }),
    },
  } as unknown as ReturnType<typeof createBrowserClient>;
}

export function createClient() {
  if (SKIP_AUTH) {
    return createMockClient();
  }
  return createBrowserClient(supabaseUrl!, supabaseKey!);
}
