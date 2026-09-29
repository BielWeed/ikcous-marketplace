/**
 * Conferência FAIL-CLOSED da classificação cliente/painel (decisão do dono,
 * 26/09/2026 — "dividir o portão"). Pura: não toca disco nem rede — quem lê o
 * JSON e o diretório de assets é `.size-limit.cjs`, que passa os dois lados
 * prontos aqui.
 *
 * Falha fechada quer dizer: qualquer divergência entre a classificação e o
 * que REALMENTE está em `${output}/assets/*.js` (sem o `leitor-zxing-*`, que
 * tem orçamento próprio) reprova o `npm run size` em vez de deixar passar um
 * chunk sem contar em teto nenhum. Como o nome de cada chunk carrega o hash
 * do conteúdo (`vite.config.ts`), um JSON de uma rodada de build ANTERIOR
 * nunca bate com o disco da rodada atual — é isso que cobre "desatualizada"
 * sem precisar de timestamp: o próprio hash do arquivo já denuncia.
 */

/**
 * @param {unknown} classificacao JSON já parseado de `.portao-tamanho/<saída>.json`.
 * @param {readonly string[]} arquivosEmDisco `assets/*.js` reais da saída, sem o leitor zxing.
 * @returns {{ cliente: string[], painel: string[] }}
 */
function validarClassificacaoContraDisco(classificacao, arquivosEmDisco) {
  if (
    typeof classificacao !== "object" ||
    classificacao === null ||
    Array.isArray(classificacao) ||
    classificacao.versao !== 1 ||
    !Array.isArray(classificacao.cliente) ||
    !Array.isArray(classificacao.painel) ||
    !classificacao.cliente.every((item) => typeof item === "string") ||
    !classificacao.painel.every((item) => typeof item === "string")
  )
    throw new Error(
      "PORTAO_TAMANHO: classificação ausente, ou com formato diferente de {versao:1, cliente:[], painel:[]}",
    );

  const cliente = new Set(classificacao.cliente);
  const painel = new Set(classificacao.painel);
  if (
    cliente.size !== classificacao.cliente.length ||
    painel.size !== classificacao.painel.length
  )
    throw new Error(
      "PORTAO_TAMANHO: classificação tem arquivo repetido dentro do mesmo grupo",
    );

  const emComum = [...cliente].filter((arquivo) => painel.has(arquivo));
  if (emComum.length > 0)
    throw new Error(
      `PORTAO_TAMANHO: cliente e painel não são disjuntos — em comum: ${JSON.stringify(emComum)}`,
    );

  const disco = new Set(arquivosEmDisco);
  if (disco.size !== arquivosEmDisco.length)
    throw new Error("PORTAO_TAMANHO: lista de arquivos em disco tem duplicata");

  const uniao = new Set([...cliente, ...painel]);
  const faltandoNaClassificacao = arquivosEmDisco.filter(
    (arquivo) => !uniao.has(arquivo),
  );
  const inexistentesNoDisco = [...uniao].filter(
    (arquivo) => !disco.has(arquivo),
  );
  if (faltandoNaClassificacao.length > 0 || inexistentesNoDisco.length > 0)
    throw new Error(
      `PORTAO_TAMANHO: classificação desatualizada frente ao disco — só no disco: ${JSON.stringify(faltandoNaClassificacao)}; só na classificação: ${JSON.stringify(inexistentesNoDisco)}`,
    );

  return { cliente: classificacao.cliente, painel: classificacao.painel };
}

module.exports = { validarClassificacaoContraDisco };
