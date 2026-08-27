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

// URL e chave anon são sempre ASCII imprimível ("!" a "~"). Descartar o resto elimina
// de uma vez BOM, zero-width, nbsp e espaços que entram ao colar valores no .env.
export const cleanEnvVar = (val: string) => val.replace(/[^!-~]/g, "");

export function lerSupabaseUrl(): string {
  return cleanEnvVar(import.meta.env.VITE_SUPABASE_URL || "");
}

export type OrigemChaveSupabase =
  | "VITE_SUPABASE_PUBLISHABLE_KEY"
  | "VITE_SUPABASE_ANON_KEY";

interface ChaveSupabaseResolvida {
  valor: string;
  origem: OrigemChaveSupabase;
}

// INFRA-260 (#126): o Supabase está trocando as chaves de API — a legada
// `anon` (JWT) dá lugar à `publishable` (`sb_publishable_...`). As legadas
// funcionam até o dono desligá-las num clique no Dashboard, sem data
// marcada. As 8 edge functions no ar já leem a nova com fallback para a
// legada (`readKey` em supabase/functions/_shared/webpush.ts); aqui é a
// mesma precedência, para o front sobreviver ao mesmo desligamento.
//
// A precedência mora NESTA função só. `env.ts` (para nomear a origem no
// `console.info` do portão) e `useOnlineStatus.ts` (para o header da sonda)
// chamam as duas funções exportadas abaixo, que delegam para cá — nenhum dos
// dois reimplementa o `||`, que é como duas cópias da mesma conta divergiam
// antes.
function resolverChaveSupabase(): ChaveSupabaseResolvida {
  const nova = cleanEnvVar(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "");
  if (nova) {
    return { valor: nova, origem: "VITE_SUPABASE_PUBLISHABLE_KEY" };
  }
  return {
    valor: cleanEnvVar(import.meta.env.VITE_SUPABASE_ANON_KEY || ""),
    origem: "VITE_SUPABASE_ANON_KEY",
  };
}

export function lerChaveSupabase(): string {
  return resolverChaveSupabase().valor;
}

export function lerOrigemChaveSupabase(): OrigemChaveSupabase {
  return resolverChaveSupabase().origem;
}
