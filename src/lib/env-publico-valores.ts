export interface AmbientePublicoSupabase {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

export type OrigemChaveSupabase =
  | "VITE_SUPABASE_PUBLISHABLE_KEY"
  | "VITE_SUPABASE_ANON_KEY"
  // Etapa 2 da escala (11/09/2026): a conexão veio da FICHA DA LOJA que o
  // porteiro gravou no HTML (`src/config/fichaDaLoja.ts`), não do ambiente
  // de build — só acontece num build compartilhado por N lojas.
  | "ficha";

// URL e chave são ASCII imprimível ("!" a "~"). Remove também BOM,
// zero-width, nbsp e espaços que entram ao colar valores no ambiente.
export const cleanEnvVar = (val: string) => val.replace(/[^!-~]/g, "");

// INFRA-260 (#126): o Supabase está trocando as chaves de API — a legada
// `anon` (JWT) dá lugar à `publishable` (`sb_publishable_...`). As legadas
// funcionam até o dono desligá-las num clique no Dashboard, sem data
// marcada. As 8 edge functions no ar já leem a nova com fallback para a
// legada (`readKey` em supabase/functions/_shared/webpush.ts); aqui é a
// mesma precedência, para o front sobreviver ao mesmo desligamento.
//
// A limpeza e a precedência moram NESTA função só. O app (`env-valores.ts`,
// lendo `import.meta.env` a cada chamada) e o preparo da marca
// (`scripts/identityBuildConfig.ts`, com o `env` do build) chamam esta
// função — nenhum dos dois reimplementa o `||`, que é como duas cópias da
// mesma conta divergiam antes (A7b1: publishable só de espaços e anon válida
// davam escolhas diferentes no app e no build). Quem precisar da chave
// pública em outro runtime chama aqui; não copia a regra.
//
// Só converte valores de ambiente. A validação da API pública fica no leitor.
export function resolverValoresPublicosSupabase(env: AmbientePublicoSupabase): {
  supabaseUrl: string;
  chave: { valor: string; origem: OrigemChaveSupabase };
} {
  const nova = cleanEnvVar(env.VITE_SUPABASE_PUBLISHABLE_KEY || "");
  return {
    supabaseUrl: cleanEnvVar(env.VITE_SUPABASE_URL || ""),
    chave: nova
      ? { valor: nova, origem: "VITE_SUPABASE_PUBLISHABLE_KEY" }
      : {
          valor: cleanEnvVar(env.VITE_SUPABASE_ANON_KEY || ""),
          origem: "VITE_SUPABASE_ANON_KEY",
        },
  };
}
