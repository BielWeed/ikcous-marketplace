/**
 * Valores de ambiente do Supabase — leitura VIVA, sem efeito colateral.
 *
 * Extraído de `src/lib/env.ts` (que continua sendo o PORTÃO de boot: valida
 * as chaves e derruba o app, com `throw`, se alguma faltar — na própria
 * avaliação do módulo). Aquele portão fazia qualquer import transitivo de
 * `@/lib/env` herdar o `throw`, mesmo quando o chamador só queria o VALOR
 * (caso de `useOnlineStatus.ts`, que roda em teste sem `.env`).
 *
 * A garantia deste arquivo é a inversa: importá-lo nunca lança, nunca toca
 * `document`, nunca escreve em `console` — com ou sem as variáveis de
 * ambiente presentes. Quem precisa do portão continua importando de
 * `@/lib/env`, que reexporta estes mesmos valores.
 *
 * POR QUE FUNÇÕES, E NÃO `const` DE MÓDULO (como era antes): uma `const` de
 * módulo ES congela o valor na avaliação do `import` — que roda ANTES de
 * qualquer `beforeEach`. Um caller que faz `vi.stubEnv(...)` dentro de um
 * `beforeEach` nunca alcançava mais o valor quando o módulo já tinha sido
 * importado estaticamente no topo de um arquivo de teste (era exatamente o
 * caso de `useOnlineStatus.ts` em
 * `tests/front/use-online-status-502-isolado-nao-marca-offline.test.tsx`, que
 * não usa `vi.resetModules()` para esse hook). As funções abaixo leem
 * `import.meta.env` a cada chamada — o valor é resolvido quando alguém
 * pergunta, não quando o módulo é avaliado.
 */

import { resolverValoresPublicosSupabase } from "./env-publico-valores";
import type { OrigemChaveSupabase } from "./env-publico-valores";

export { cleanEnvVar } from "./env-publico-valores";
export type { OrigemChaveSupabase } from "./env-publico-valores";

// A mesma limpeza e precedência usada no preparo, com ambiente lido a cada chamada.
function resolverAmbientePublicoSupabase() {
  return resolverValoresPublicosSupabase({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env
      .VITE_SUPABASE_PUBLISHABLE_KEY,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  });
}

export function lerSupabaseUrl(): string {
  return resolverAmbientePublicoSupabase().supabaseUrl;
}

export function lerChaveSupabase(): string {
  return resolverAmbientePublicoSupabase().chave.valor;
}

export function lerOrigemChaveSupabase(): OrigemChaveSupabase {
  return resolverAmbientePublicoSupabase().chave.origem;
}
