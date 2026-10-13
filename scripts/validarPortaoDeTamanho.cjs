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
 *
 * Esquema versão 3 (13/10/2026, decisão do dono de 12/10/2026): o quarto
 * grupo `workerDoMapa` é o worker do MapLibre (asset `.js` com teto próprio).
 * O chunk do mapa (`opcional`) e o worker só viajam juntos — um dos dois
 * vazio sem o outro também reprova.
 */

/**
 * @param {unknown} classificacao JSON já parseado de `.portao-tamanho/<saída>.json`.
 * @param {readonly string[]} arquivosEmDisco `assets/*.js` e `assets/*.mjs` reais da saída, sem o leitor zxing.
 * @returns {{ cliente: string[], painel: string[], opcional: string[], workerDoMapa: string[] }}
 */
function validarClassificacaoContraDisco(classificacao, arquivosEmDisco) {
  if (
    typeof classificacao !== "object" ||
    classificacao === null ||
    Array.isArray(classificacao) ||
    classificacao.versao !== 3 ||
    !Array.isArray(classificacao.cliente) ||
    !Array.isArray(classificacao.painel) ||
    !Array.isArray(classificacao.opcional) ||
    !Array.isArray(classificacao.workerDoMapa) ||
    !classificacao.cliente.every((item) => typeof item === "string") ||
    !classificacao.painel.every((item) => typeof item === "string") ||
    !classificacao.opcional.every((item) => typeof item === "string") ||
    !classificacao.workerDoMapa.every((item) => typeof item === "string")
  )
    throw new Error(
      "PORTAO_TAMANHO: classificação ausente, ou com formato diferente de {versao:3, cliente:[], painel:[], opcional:[], workerDoMapa:[]} — rode `npm run build` para regenerar",
    );

  const cliente = new Set(classificacao.cliente);
  const painel = new Set(classificacao.painel);
  const opcional = new Set(classificacao.opcional);
  const workerDoMapa = new Set(classificacao.workerDoMapa);
  if (
    cliente.size !== classificacao.cliente.length ||
    painel.size !== classificacao.painel.length ||
    opcional.size !== classificacao.opcional.length ||
    workerDoMapa.size !== classificacao.workerDoMapa.length
  )
    throw new Error(
      "PORTAO_TAMANHO: classificação tem arquivo repetido dentro do mesmo grupo",
    );

  const conferirDisjuncao = (nomeA, grupoA, nomeB, grupoB) => {
    const emComum = [...grupoA].filter((arquivo) => grupoB.has(arquivo));
    if (emComum.length > 0)
      throw new Error(
        `PORTAO_TAMANHO: ${nomeA} e ${nomeB} não são disjuntos — em comum: ${JSON.stringify(emComum)}`,
      );
  };
  conferirDisjuncao("cliente", cliente, "painel", painel);
  conferirDisjuncao("cliente", cliente, "opcional", opcional);
  conferirDisjuncao("painel", painel, "opcional", opcional);
  conferirDisjuncao("cliente", cliente, "workerDoMapa", workerDoMapa);
  conferirDisjuncao("painel", painel, "workerDoMapa", workerDoMapa);
  conferirDisjuncao("opcional", opcional, "workerDoMapa", workerDoMapa);

  const disco = new Set(arquivosEmDisco);
  if (disco.size !== arquivosEmDisco.length)
    throw new Error("PORTAO_TAMANHO: lista de arquivos em disco tem duplicata");

  const uniao = new Set([...cliente, ...painel, ...opcional, ...workerDoMapa]);
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

  // O `importarRenderer` do AddressCardMap importa o chunk do maplibre e a
  // URL do worker JUNTOS. Um sem o outro é renomeação de um lado só (o
  // arquivo deixou de casar com a allowlist dele e foi para `cliente`), um
  // dos dois sumiu do build, ou o chunk não passou na alcançabilidade de
  // `scripts/portaoDividido.ts` (ficou em `cliente` ou `painel`). As
  // mensagens dizem ONDE olhar sem adivinhar qual das causas foi.
  if (opcional.size > 0 && workerDoMapa.size === 0)
    throw new Error(
      `PORTAO_TAMANHO: workerDoMapa vazio com o chunk do mapa em opcional (${JSON.stringify(classificacao.opcional)}) — o worker do MapLibre sumiu do build ou foi renomeado; renomeado, ele deixa de casar com \`ARQUIVO_DO_WORKER_DO_MAPA\` (scripts/portaoDividido.ts) e é contado em \`cliente\`: procure o \`*worker*\` em cliente no JSON e ajuste a allowlist lá (ancorada, com hash)`,
    );
  if (workerDoMapa.size > 0 && opcional.size === 0)
    throw new Error(
      `PORTAO_TAMANHO: opcional vazio com o worker do mapa em workerDoMapa (${JSON.stringify(classificacao.workerDoMapa)}) — nenhum chunk passou ao mesmo tempo no nome (\`CHUNKS_OPCIONAIS\`, scripts/portaoDividido.ts) e na alcançabilidade (\`soDinamicoNoCliente\`, mesmo arquivo): renomeado, o chunk do maplibre-gl é contado em \`cliente\`; importado ESTATICAMENTE por algum chunk que a cliente alcança (inclusive em ciclo com outro pedaço do próprio mapa), também fica em \`cliente\`; alcançado só atrás do painel, fica em \`painel\`; ou sumiu do build. Procure o \`maplibre-gl-*\` em cliente/painel no JSON`,
    );

  return {
    cliente: classificacao.cliente,
    painel: classificacao.painel,
    opcional: classificacao.opcional,
    workerDoMapa: classificacao.workerDoMapa,
  };
}

module.exports = { validarClassificacaoContraDisco };
