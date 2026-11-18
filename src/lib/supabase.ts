// Importar `env` primeiro \u00E9 intencional: ele valida as vari\u00E1veis e, se faltarem,
// pinta a tela de erro antes de interromper o boot. Sem isso o app morria em sil\u00EAncio
// aqui mesmo, deixando o usu\u00E1rio preso no loader.
import { localStorageSeguro } from "@/lib/armazenamento-seguro";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";
import type { Database } from "@/types/database.types";
import { createClient } from "@supabase/supabase-js";

// Chrome/Safari com "bloquear dados de sites" fazem o próprio ACESSO a
// `localStorage` lançar SecurityError (tela em branco antes do React se isso
// acontecesse na avaliação do módulo), e aparelho com a cota cheia faz o
// `setItem` lançar — o que derrubava o login ao guardar a sessão. O supabase-js
// usa o `storage` recebido DIRETO, sem alternativa; por isso recebe o
// armazenamento seguro: sem o de verdade, a sessão vive na memória (a cliente
// entra e compra; só não fica logada ao recarregar).
export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: localStorageSeguro(),
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
