import type { Database } from "@/types/database.types";
import { createClient } from "@supabase/supabase-js";

// Production fallback values (anon keys are safe to expose)
const cleanEnvVar = (val: string) =>
  val.replace(/[\uFEFF\u200B-\u200D\u00A0]/g, "").trim();

const supabaseUrl = cleanEnvVar(import.meta.env.VITE_SUPABASE_URL || "");
const supabaseAnonKey = cleanEnvVar(
  import.meta.env.VITE_SUPABASE_ANON_KEY || "",
);

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "CRITICAL: Supabase Environment Variables Missing. Check your .env file and ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: globalThis.localStorage,
  },
  realtime: {
    params: {
      events_per_second: 10,
    },
    worker: true,
  },
});

// Diagnostic check for development only
if (import.meta.env.DEV) {
  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[Supabase Auth] Event:", event, { hasSession: !!session });
  });
}
