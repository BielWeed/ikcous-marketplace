import type { Database } from "@/types/database.types";
import { createClient } from "@supabase/supabase-js";
// Importar `env` primeiro \u00E9 intencional: ele valida as vari\u00E1veis e, se faltarem,
// pinta a tela de erro antes de interromper o boot. Sem isso o app morria em sil\u00EAncio
// aqui mesmo, deixando o usu\u00E1rio preso no loader.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
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
  },
);

// Diagnostic check for development only
if (import.meta.env.DEV) {
  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[Supabase Auth] Event:", event, { hasSession: !!session });
  });
}
