// Declaração de tipos do validador (.cjs) para quem o importa de um .ts —
// mesmo padrão de scripts/identidade-bootstrap.d.mts: TS não tem `allowJs`
// neste projeto, e `.d.cts` é a extensão que o TypeScript associa a um `.cjs`
// do mesmo nome (par CommonJS), sem precisar de referência explícita em
// nenhum lugar. Fica `.cjs` (não `.ts`) de propósito: `.size-limit.cjs`
// precisa de um `require()` síncrono, e um `.ts`/`.mjs` exigiria import
// assíncrono dentro de um arquivo que o size-limit carrega como CommonJS.
export interface ClassificacaoDoPortao {
  readonly versao: 1;
  readonly cliente: readonly string[];
  readonly painel: readonly string[];
}

export function validarClassificacaoContraDisco(
  classificacao: unknown,
  arquivosEmDisco: readonly string[],
): { readonly cliente: string[]; readonly painel: string[] };
