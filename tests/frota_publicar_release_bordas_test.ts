// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/publicar-release.mjs — as BORDAS do portão de publicação.
 *
 * tests/frota_publicar_release_test.ts prova o caminho feliz e as falhas
 * "grandes". Uma caça por mutação (plantar um defeito de uma linha no script e
 * ver se algum teste cai) achou decisões do portão que ficavam de pé sem que
 * nenhum teste as pisasse. Este arquivo fecha essas, e cada teste abaixo cai
 * se a guarda correspondente for tirada:
 *
 *  - canais-de-backend.json mal formado (ref, lote sem consulta, soNosRefs);
 *  - o endereço do candidato é validado ANTES de qualquer pedido de rede;
 *  - ledger: JSON que começa na coluna 0, formato desconhecido;
 *  - evidência de banco: limite exato da validade, apply que termina no mesmo
 *    instante, `updatedAt` ilegível (vence), UMA linha com ok não booleano;
 *  - pacote de function: grafo de imports (losango, ciclo, arquivo não-código);
 *  - function não publicada na loja: deriva antiga × release (cada ramo do
 *    `mudou`), base indefinida, download vazio, rótulos falta/sobra/difere;
 *  - ledger não lido NÃO dispara prova de banco; diagnóstico só com prova
 *    NEGATIVA; base indefinida não consulta a lista de migrations da base;
 *  - falha ao listar/baixar function vira bloqueio (nunca exceção);
 *  - topo do ramo ilegível ou mal formado bloqueia e não gera comando;
 *  - texto do relatório de sucesso NÃO traz "FALHOU" nem rollback.
 *
 * Todas as dependências são dublês com dados inventados (lojas "loja-a" e
 * "loja-b", SHAs fictícios): nenhuma rede, nenhum CLI, nenhum banco.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  arquivosEsperados,
  classificarFuncao,
  comandosDeConserto,
  conferirCandidato,
  dependenciasReais,
  evidenciaDaProva,
  lerArgumentos,
  lerCanais,
  lojasDoInventario,
  main,
  publicarRelease,
  versoesAplicadas,
} from "../scripts/frota/publicar-release.mjs";

const SHA = "1".repeat(40);
const BASE = "2".repeat(40);
const OUTRO = "3".repeat(40);
const TOPO = "4".repeat(40);
const IDENT = "e".repeat(64);
const LOJA_A = "a".repeat(20);
const LOJA_B = "b".repeat(20);
const DPL = "dpl_Novo123";
const DPL_ANTERIOR = "dpl_Anterior456";
const AGORA = Date.parse("2026-10-06T20:00:00Z");
const PROVA = "8e-conferir-92-a-202-aplicado";
const A8 = "8a-antes-92-a-202-objetos-e-corpos";
const B8 = "8b-papeis-contraditorios";
const K8 = "8k-subtotal-divergente-ou-vazia-provada";
const ARQUIVO_NOTAS = "src/novidades/notas-das-versoes.json";
const NOTA_VALIDA = {
  titulo: "Atualização do app",
  novidades: [],
  correcoes: ["Correções de estabilidade."],
  melhorias: [],
};

// ---------------------------------------------------------------- lerCanais

function canaisEmArquivo(objeto) {
  const arquivo = Deno.makeTempFileSync({ suffix: ".json" });
  Deno.writeTextFileSync(arquivo, JSON.stringify(objeto));
  try {
    return lerCanais(arquivo);
  } finally {
    Deno.removeSync(arquivo);
  }
}

Deno.test("lerCanais: um arquivo bem formado passa (controle dos casos abaixo)", () => {
  const c = canaisEmArquivo({
    canais: { [LOJA_A]: { nome: "A" } },
    provasDeObjetos: [
      { consulta: PROVA, versoes: ["20261192000000"], soNosRefs: [LOJA_A] },
    ],
  });
  assertEquals(Object.keys(c.canais), [LOJA_A]);
});

Deno.test("lerCanais: ref de canal que não tem 20 letras minúsculas é recusado, pelo nome", () => {
  assertThrows(
    () => canaisEmArquivo({ canais: { "loja-a": {} } }),
    Error,
    "ref inválido loja-a",
  );
});

Deno.test("lerCanais: lote de prova SEM consulta é recusado (não vira lote mudo)", () => {
  assertThrows(
    () =>
      canaisEmArquivo({
        canais: { [LOJA_A]: {} },
        provasDeObjetos: [{ versoes: ["20261192000000"] }],
      }),
    Error,
    "lote sem consulta de prova",
  );
});

Deno.test("lerCanais: soNosRefs vazio ou que não é lista é recusado COM a mensagem da lista (lista vazia não pode virar 'nenhuma loja' calada)", () => {
  for (const soNosRefs of [[], "aaaaaaaaaaaaaaaaaaaa"]) {
    assertThrows(
      () =>
        canaisEmArquivo({
          canais: { [LOJA_A]: {} },
          provasDeObjetos: [{ consulta: PROVA, soNosRefs }],
        }),
      Error,
      "precisa ser uma lista não vazia",
    );
  }
});

// -------------------------------------------------------- conferirCandidato

const POLITICA_VERCEL = { projetoVercel: { id: "prj_X", time: "team_Y" } };

async function candidatoComUrl(url) {
  const pedidos = [];
  const resultado = await conferirCandidato({
    sha: SHA,
    deploymentId: DPL,
    politica: POLITICA_VERCEL,
    vercelApi: async () => ({
      id: DPL,
      url,
      target: "production",
      readyState: "READY",
      projectId: "prj_X",
    }),
    fetchImpl: async (u) => {
      pedidos.push(String(u));
      if (new URL(u).pathname === "/")
        return new Response("<html></html>", {
          status: 503,
          headers: { "x-ikcous-porteiro": "sem-loja" },
        });
      return new Response(versao(SHA), { status: 200 });
    },
  });
  return { resultado, pedidos };
}

Deno.test("candidato com URL que não é *.vercel.app próprio: BLOQUEIA e nenhum pedido de rede sai para esse endereço", async () => {
  for (const url of [
    null,
    42,
    "",
    "candidato.example.com",
    "candidato.vercel.app.evil.example.com",
    "https://candidato.vercel.app",
    "candidato.vercel.app/x",
    "CANDIDATO.vercel.app",
  ]) {
    const { resultado, pedidos } = await candidatoComUrl(url);
    assertEquals(resultado.ok, false, `url ${JSON.stringify(url)}`);
    assertEquals(resultado.problemas, [
      "deployment sem URL própria .vercel.app",
    ]);
    assertEquals(pedidos, [], `url ${JSON.stringify(url)}: nada de rede`);
  }
});

Deno.test("candidato com URL própria: confere version.json E o porteiro (controle)", async () => {
  const { resultado, pedidos } = await candidatoComUrl("candidato.vercel.app");
  assertEquals(resultado.problemas, []);
  assertEquals(resultado.ok, true);
  assertEquals(pedidos.length, 2);
  assertStringIncludes(pedidos[0], "https://candidato.vercel.app/version.json");
});

// ------------------------------------------------------- versoesAplicadas

Deno.test("versoesAplicadas: JSON que começa na coluna 0 é lido (a saída inteira é o JSON)", () => {
  const lidas = versoesAplicadas(
    '{"migrations":[{"remote":"20261190000000"},{"remote":""},{"local":"x"}]}',
  );
  assertEquals([...lidas], ["20261190000000"]);
});

Deno.test("versoesAplicadas: chaves fora de ordem e chave solta não viram JSON: formato desconhecido", () => {
  for (const texto of ["} depois {", "lixo { sem fechar", "nada de tabela"]) {
    assertThrows(() => versoesAplicadas(texto), Error, "formato desconhecido");
  }
});

Deno.test("versoesAplicadas: JSON sem a lista migrations falha com a mensagem do campo", () => {
  assertThrows(
    () => versoesAplicadas('{"migrations": 3}'),
    Error,
    "sem o campo migrations",
  );
});

// ------------------------------------------------------- evidenciaDaProva

const TITULO_PROVA = `conferir ${PROVA} em loja-b`;

function runDaProva(createdAt = "2026-10-06T19:00:00Z") {
  return {
    databaseId: 11,
    displayTitle: TITULO_PROVA,
    headSha: OUTRO,
    createdAt,
    conclusion: "success",
    status: "completed",
  };
}

function veredito({ okFalse = 0, naoBooleano = 0, linhas = 5 } = {}) {
  return `algo\nVEREDITO-CONSULTA consulta=${PROVA} ref=${LOJA_B} sha=${OUTRO} linhas=${linhas} ok_false=${okFalse} ok_nao_booleano=${naoBooleano} rol=ok\n`;
}

function prova({
  runs = [runDaProva()],
  applies = [],
  log = veredito(),
  arvoreIgual = true,
} = {}) {
  return evidenciaDaProva({
    consulta: PROVA,
    projeto: "loja-b",
    projetosNoMesmoBanco: [],
    ref: LOJA_B,
    sha: SHA,
    topo: TOPO,
    validadeHoras: 6,
    agora: AGORA,
    deps: {
      listarRuns: async (wf) =>
        wf === "conferir-banco-da-loja.yml" ? runs : applies,
      arvoreIgual: async () => arvoreIgual,
      logDoRun: async () => log,
    },
  });
}

Deno.test("prova: controle — run fresco, verde, sem apply depois e todas as linhas ok: POSITIVA", async () => {
  const r = await prova();
  assertEquals(r.estado, "POSITIVA");
  assertEquals(r.ok, true);
});

Deno.test("prova: o run com EXATAMENTE a idade da validade ainda vale; 1 ms mais velho não vale", async () => {
  // limite = agora - 6 h = 14:00:00.000Z
  const noLimite = await prova({
    runs: [runDaProva("2026-10-06T14:00:00.000Z")],
  });
  assertEquals(noLimite.estado, "POSITIVA");
  const vencido = await prova({
    runs: [runDaProva("2026-10-06T13:59:59.999Z")],
  });
  assertEquals(vencido.estado, "SEM_EVIDENCIA");
  assertStringIncludes(vencido.motivo, "nas últimas 6 h");
});

Deno.test("prova: apply que terminou NO MESMO instante do início da prova não vence; 1 ms depois vence", async () => {
  const inicio = "2026-10-06T19:00:00.000Z";
  const apply = (updatedAt) => ({
    databaseId: 9,
    displayTitle: "aplicar em loja-b: 20261192000000_b.sql",
    createdAt: inicio,
    updatedAt,
    conclusion: "success",
    status: "completed",
  });
  const mesmoInstante = await prova({
    runs: [runDaProva(inicio)],
    applies: [apply(inicio)],
  });
  assertEquals(mesmoInstante.estado, "POSITIVA");
  const depois = await prova({
    runs: [runDaProva(inicio)],
    applies: [apply("2026-10-06T19:00:00.001Z")],
  });
  assertEquals(depois.estado, "SEM_EVIDENCIA");
  assertStringIncludes(depois.motivo, "evidência vencida");
});

Deno.test("prova: apply com updatedAt ILEGÍVEL vence a evidência (data que não se lê não é 'antes')", async () => {
  const r = await prova({
    applies: [
      {
        databaseId: 9,
        displayTitle: "aplicar em loja-b: 20261192000000_b.sql",
        createdAt: "2026-10-06T18:00:00Z",
        updatedAt: "",
        conclusion: "success",
        status: "completed",
      },
    ],
  });
  assertEquals(r.estado, "SEM_EVIDENCIA");
  assertStringIncludes(r.motivo, "evidência vencida");
});

Deno.test("prova: UMA linha com ok não booleano já tira a evidência (nem POSITIVA nem NEGATIVA), com ou sem ok=false junto", async () => {
  for (const okFalse of [0, 2]) {
    const r = await prova({ log: veredito({ okFalse, naoBooleano: 1 }) });
    assertEquals(r.estado, "SEM_EVIDENCIA", `ok_false=${okFalse}`);
    assertEquals(r.ok, false);
    assertStringIncludes(r.motivo, "1 sem ok booleano");
  }
});

Deno.test("prova: commit do run com árvore diferente da do SHA: SEM_EVIDENCIA e a mensagem cita os 8 primeiros caracteres do commit", async () => {
  const r = await prova({ arvoreIgual: false });
  assertEquals(r.estado, "SEM_EVIDENCIA");
  assertStringIncludes(r.motivo, `(${OUTRO.slice(0, 8)})`);
});

// ----------------------------------------------- arquivosEsperados / classificar

Deno.test("arquivosEsperados: pacote em losango lê o arquivo comum UMA vez; ciclo termina", () => {
  const fonte = {
    "supabase/functions/f/index.ts": 'import "./a.ts";\nimport "./b.ts";',
    "supabase/functions/f/a.ts": 'import "./comum.ts";',
    "supabase/functions/f/b.ts": 'import "./comum.ts";\nimport "./index.ts";',
    "supabase/functions/f/comum.ts": "export {};",
  };
  const leituras = [];
  const mapa = arquivosEsperados("f", (c) => {
    leituras.push(c);
    assert(
      leituras.length < 50,
      "ciclo sem fim: o arquivo visto não pode voltar à fila",
    );
    return fonte[c] ?? null;
  });
  assertEquals([...mapa.keys()].sort(), Object.keys(fonte).sort());
  assertEquals(leituras.filter((c) => c.endsWith("comum.ts")).length, 1);
  assertEquals(leituras.length, 4);
});

Deno.test("arquivosEsperados: arquivo que não é código (json) entra no pacote mas NÃO é lido atrás de imports", () => {
  const fonte = {
    "supabase/functions/f/index.ts": 'import dados from "./dados.json";',
    "supabase/functions/f/dados.json": 'import "./fantasma.ts";',
    "supabase/functions/f/fantasma.ts": "export {};",
  };
  const leituras = [];
  const mapa = arquivosEsperados("f", (c) => {
    leituras.push(c);
    return fonte[c] ?? null;
  });
  assertEquals([...mapa.keys()].sort(), [
    "supabase/functions/f/dados.json",
    "supabase/functions/f/index.ts",
  ]);
  assert(!leituras.some((c) => c.endsWith("fantasma.ts")));
});

Deno.test("arquivosEsperados: import de arquivo ausente entra com valor null (o pacote diz o que falta)", () => {
  const mapa = arquivosEsperados("f", (c) =>
    c.endsWith("index.ts") ? 'import "./sumiu.ts";' : null,
  );
  assertEquals(mapa.get("supabase/functions/f/sumiu.ts"), null);
});

Deno.test("classificarFuncao: download VAZIO é NAO_PRONTA mesmo quando a função não mudou na release", () => {
  const igual = new Map([["supabase/functions/f/index.ts", "x"]]);
  assertEquals(classificarFuncao(new Map(), igual, igual), {
    estado: "NAO_PRONTA",
    divergentes: ["(download vazio)"],
  });
});

Deno.test("classificarFuncao: os três rótulos — falta no ar, difere, sobra no ar", () => {
  const baixados = new Map([
    ["p/a.ts", "1"],
    ["p/c.ts", "velho"],
    ["p/d.ts", "extra"],
  ]);
  const sha = new Map([
    ["p/a.ts", "1"],
    ["p/b.ts", "2"],
    ["p/c.ts", "novo"],
  ]);
  const r = classificarFuncao(baixados, sha, null);
  assertEquals(r.divergentes, [
    "p/b.ts (falta no ar)",
    "p/c.ts (difere)",
    "p/d.ts (sobra no ar)",
  ]);
  assertEquals(r.estado, "NAO_PRONTA");
});

Deno.test("classificarFuncao: arquivo esperado-ausente (null no SHA) que existe no ar com o texto 'null' é SOBRA, não igual (ausente ≠ a palavra null)", () => {
  const r = classificarFuncao(
    new Map([["p/x.ts", "null"]]),
    new Map([["p/x.ts", null]]),
    null,
  );
  assertEquals(r.divergentes, ["p/x.ts (sobra no ar)"]);
  assertEquals(r.estado, "NAO_PRONTA");
});

// ------------------------------------------------------- lojasDoInventario

Deno.test("lojasDoInventario: endereço sem ficha legível vira problema com o motivo exato e NÃO vira loja", () => {
  const inv = {
    vercel: { ok: true },
    completo: true,
    sondas: [
      {
        dominio: "a.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
      {
        dominio: "b.vercel.app",
        ficha: {
          status: 200,
          caderneta: "hit",
          refs: [LOJA_A, LOJA_B],
          estavel: false,
        },
      },
      { dominio: "c.vercel.app" },
      {
        dominio: "ok.vercel.app",
        versao: { codeSha: SHA },
        ficha: {
          status: 200,
          caderneta: "hit",
          titulo: "Loja A",
          refs: [LOJA_A],
          estavel: true,
        },
      },
    ],
  };
  const r = lojasDoInventario(inv, { enderecosEsperados: [] });
  assertEquals(r.problemas, [
    "a.vercel.app: não é loja legível (status 503, caderneta miss, refs -)",
    `b.vercel.app: não é loja legível (status 200, caderneta hit, refs ${LOJA_A},${LOJA_B}, amostras divergentes)`,
    "c.vercel.app: não é loja legível (status -, caderneta -, refs -)",
  ]);
  assertEquals(
    r.lojas.map((l) => l.ref),
    [LOJA_A],
  );
  assertEquals(r.lojas[0].dominios, ["ok.vercel.app"]);
});

// ------------------------------------------------- comandosDeConserto (direto)

const LOJA = { titulo: "Loja B", ref: LOJA_B };
const CANAL = {
  migrations: "loja-b",
  functions: "loja-b",
  functionsPublicaveis: [],
};
const CTX = {
  ramo: "release",
  topo: TOPO,
  topoBancoIgual: true,
  topoFunctionsIgual: true,
  nomesPorVersao: new Map(),
};
const prontLote = (decisao, extra = {}) => ({
  lotes: [{ consulta: PROVA, decisao, faltam: [], lote: {}, ...extra }],
  funcoes: [],
  bancoPronto: false,
});

Deno.test("comandosDeConserto: sem o topo do ramo NÃO sai comando algum (nem comentário de lote, nem gh com expected_sha vazio)", () => {
  const cmds = comandosDeConserto(
    LOJA,
    prontLote({ acao: "CONFERIR", consultas: [PROVA], motivo: "x" }),
    CANAL,
    { ...CTX, topo: null },
  );
  assertEquals(cmds.length, 1);
  assertStringIncludes(cmds[0], "sem comandos");
  assertStringIncludes(cmds[0], "origin/release");
  assert(!cmds.some((l) => l.startsWith("gh ")));
});

Deno.test("comandosDeConserto: APLICAR com UM nome de arquivo faltando não emite apply (nenhum apply parcial) e nomeia só a versão sem arquivo", () => {
  const ctx = {
    ...CTX,
    nomesPorVersao: new Map([["20261192000000", "20261192000000_b.sql"]]),
  };
  const aplicar = (versoes) =>
    prontLote({ acao: "APLICAR", versoes, motivo: "ausente" });
  const parcial = comandosDeConserto(
    LOJA,
    aplicar(["20261192000000", "20261193000000"]),
    CANAL,
    ctx,
  );
  assert(!parcial.some((l) => l.startsWith("gh ")), parcial.join("\n"));
  assertEquals(parcial.length, 1);
  assertStringIncludes(parcial[0], "para 20261193000000 — nenhum apply");
  assert(!parcial[0].includes("para 20261192000000"));
  // controle: todos achados — um único apply com os nomes completos
  const completo = comandosDeConserto(
    LOJA,
    aplicar(["20261192000000"]),
    CANAL,
    ctx,
  );
  const gh = completo.filter((l) =>
    l.startsWith("gh workflow run aplicar-migrations.yml"),
  );
  assertEquals(gh.length, 1);
  assertStringIncludes(gh[0], '-f "migracoes=20261192000000_b.sql"');
});

Deno.test("comandosDeConserto: function que mudou e o canal não publica fica PARADA pelo nome; sem nenhuma declarada o texto diz isso", () => {
  const pront = {
    lotes: [],
    funcoes: [{ nome: "nova-fn", estado: "NAO_PRONTA", motivo: "x" }],
    bancoPronto: true,
  };
  const cmds = comandosDeConserto(LOJA, pront, CANAL, CTX);
  assertEquals(cmds.length, 1);
  assertStringIncludes(
    cmds[0],
    "PARADO, sem comando: functions nova-fn mudaram na release",
  );
  assertStringIncludes(cmds[0], "só publica (nenhuma declarada)");
});

Deno.test("comandosDeConserto: function publicável com banco pronto gera o comando e NENHUM aviso de 'parado'", () => {
  const pront = {
    lotes: [],
    funcoes: [{ nome: "nova-fn", estado: "NAO_PRONTA", motivo: "x" }],
    bancoPronto: true,
  };
  const cmds = comandosDeConserto(
    LOJA,
    pront,
    { ...CANAL, functionsPublicaveis: ["nova-fn"] },
    CTX,
  );
  assert(!cmds.some((l) => l.includes("PARADO")), cmds.join("\n"));
  const gh = cmds.filter((l) =>
    l.startsWith("gh workflow run publicar-functions.yml"),
  );
  assertEquals(gh.length, 1);
  assertStringIncludes(gh[0], '-f "functions=nova-fn"');
  assertStringIncludes(gh[0], `-f "expected_sha=${TOPO}"`);
});

// ------------------------------------------------------------ lerArgumentos

Deno.test("lerArgumentos: opção desconhecida e opção sem valor são recusadas", () => {
  const ok = ["--sha", SHA, "--deployment", DPL];
  assertThrows(
    () => lerArgumentos(["--foo", "x", ...ok]),
    Error,
    "argumento desconhecido: --foo",
  );
  assertThrows(() => lerArgumentos(["--sha"]), Error, "--sha exige um valor");
  assertThrows(
    () => lerArgumentos(["--sha", "--promover", "--deployment", DPL]),
    Error,
    "--sha exige um valor",
  );
  assertThrows(
    () => lerArgumentos([...ok, "--json"]),
    Error,
    "--json exige um valor",
  );
  assertEquals(lerArgumentos([...ok, "--promover"]).promover, true);
  assertEquals(lerArgumentos(ok).promover, false);
});

Deno.test("main: uso errado devolve 2 e nunca chega a montar as dependências reais", async () => {
  const antes = console.error;
  const vistos = [];
  console.error = (m) => vistos.push(String(m));
  try {
    assertEquals(await main(["--sha"]), 2);
    assertEquals(await main([]), 2);
  } finally {
    console.error = antes;
  }
  assertEquals(vistos.length, 2);
  assertStringIncludes(
    vistos[0],
    "Uso: node scripts/frota/publicar-release.mjs",
  );
});

// ====================================================================
// publicarRelease de ponta a ponta, com dublês
// ====================================================================

function versao(sha = SHA, extra = {}) {
  return JSON.stringify({
    version: `1.5.18-sha.${sha.slice(0, 7)}-identity.${IDENT}`,
    codeVersion: "1.5.18",
    codeSha: sha,
    identityRevision: IDENT,
    source: "database",
    promotable: true,
    ...extra,
  });
}

function sonda(dominio, ref, titulo, sha = SHA) {
  return {
    dominio,
    versao: { codeSha: sha },
    ficha: {
      status: 200,
      caderneta: "hit",
      titulo,
      refs: [ref],
      estavel: true,
    },
  };
}

function arvorePadrao(extraSha = {}, extraBase = {}) {
  return {
    [SHA]: {
      [ARQUIVO_NOTAS]: JSON.stringify({ "1.5.18": NOTA_VALIDA }),
      "supabase/functions/criar-pagamento/index.ts": "pagamento",
      "supabase/functions/webhook-mercadopago/index.ts": "webhook",
      "supabase/config.toml":
        '[functions."webhook-mercadopago"]\nverify_jwt = false\n',
      ...extraSha,
    },
    [BASE]: {
      "supabase/functions/criar-pagamento/index.ts": "pagamento",
      "supabase/functions/webhook-mercadopago/index.ts": "webhook",
      ...extraBase,
    },
  };
}

const POLITICA = {
  projetoVercel: { id: "prj_X", time: "team_Y" },
  lojasSemBackendGerenciado: [],
  enderecosEsperados: [{ dominio: "manut.vercel.app", estado: "manutencao" }],
  migrationsForaDaRelease: [],
};
const CANAIS = {
  ramoDaRelease: "release",
  funcoesNaoPublicadas: ["send-order-whatsapp"],
  validadeDaEvidenciaHoras: 6,
  provasDeObjetos: [
    {
      consulta: PROVA,
      versoes: ["20261192000000"],
      backfillLedger: "92-202",
      ausenciaConfirmadaPor: A8,
      conferenciasAntesDoApply: [A8, B8, K8],
    },
  ],
  canais: {
    [LOJA_A]: {
      nome: "Loja A",
      migrations: "loja-a",
      functions: "loja-a",
      projetosNoMesmoBanco: [],
      functionsPublicaveis: ["criar-pagamento"],
    },
    [LOJA_B]: {
      nome: "Loja B",
      migrations: "loja-b",
      functions: "loja-b",
      projetosNoMesmoBanco: [],
      functionsPublicaveis: ["criar-pagamento"],
    },
  },
};
const MIGRATIONS = {
  [SHA]: ["20261190000000_a.sql", "20261192000000_b.sql"],
  [BASE]: ["20261190000000_a.sql"],
};

function tabelaDoLedger(versoes) {
  return [
    "",
    "   Local | Remote           | Time (UTC)            ",
    "  -------|------------------|-----------------------",
    ...versoes.map((v) => `   \` \`   | \`${v}\` | \`${v}\`      `),
    "",
  ].join("\n");
}

/** Dublês de tudo; `ajuste` troca o estado por cenário. */
function montar(ajuste = {}) {
  const chamadas = {
    promover: [],
    baixar: [],
    runsConferir: 0,
    migrationsNoSha: [],
  };
  const arvore = ajuste.arvore ?? arvorePadrao();
  const pacote = (nome) =>
    arquivosEsperados(nome, (c) => arvore[SHA][c] ?? null);
  const estado = {
    ledger: {
      [LOJA_A]: ["20261190000000", "20261192000000"],
      [LOJA_B]: ["20261190000000", "20261192000000"],
    },
    funcoesNoSha: ["criar-pagamento", "webhook-mercadopago"],
    verifyJwt: { "webhook-mercadopago": false },
    falhaListarFuncoes: null,
    falhaBaixar: null,
    falhaMigrationsDaBase: false,
    sondas: [
      sonda("a.vercel.app", LOJA_A, "Loja A"),
      sonda("b.vercel.app", LOJA_B, "Loja B", BASE),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
    semDominios: false,
    producaoOficial: DPL_ANTERIOR,
    candidato: {
      id: DPL,
      url: "cand.vercel.app",
      target: "production",
      readyState: "READY",
      projectId: "prj_X",
    },
    versaoCandidato: versao(),
    classesAntes: [
      { dominio: "a.vercel.app", classe: "OK" },
      { dominio: "b.vercel.app", classe: "ENDERECO_ANTIGO" },
    ],
    posOk: true,
    producaoDepois: DPL,
    runsConferir: [
      {
        databaseId: 11,
        displayTitle: `conferir ${PROVA} em loja-b`,
        headSha: OUTRO,
        createdAt: "2026-10-06T19:00:00Z",
        conclusion: "success",
        status: "completed",
      },
    ],
    logs: {
      11: `VEREDITO-CONSULTA consulta=${PROVA} ref=${LOJA_B} sha=${OUTRO} linhas=61 ok_false=0 ok_nao_booleano=0 rol=ok\n`,
    },
    topo: TOPO,
    ...ajuste,
  };
  estado.noAr ??= {
    [LOJA_A]: Object.fromEntries(
      ["criar-pagamento", "webhook-mercadopago"].map((n) => [n, pacote(n)]),
    ),
    [LOJA_B]: Object.fromEntries(
      ["criar-pagamento", "webhook-mercadopago"].map((n) => [n, pacote(n)]),
    ),
  };
  const politica = ajuste.politica ?? POLITICA;
  const d = {
    politica,
    canais: CANAIS,
    agora: () => AGORA,
    fetchImpl: async (url) => {
      const u = new URL(url);
      if (u.pathname === "/")
        return new Response("<html></html>", {
          status: 503,
          headers: { "x-ikcous-porteiro": "sem-loja" },
        });
      return new Response(estado.versaoCandidato, { status: 200 });
    },
    vercelApi: async () => estado.candidato,
    inventariar: async () => ({
      origem: "vercel",
      completo: true,
      motivoParcial: null,
      ...(estado.semDominios
        ? {}
        : { dominios: estado.sondas.map((s) => s.dominio) }),
      vercel: { ok: true, producaoOficial: estado.producaoOficial },
      sondas: estado.sondas,
    }),
    conferirFrota: async (_p, _sha, inventario) =>
      inventario
        ? { ok: false, resultados: estado.classesAntes, relatorio: "(antes)" }
        : {
            ok: estado.posOk,
            resultados: [],
            relatorio: "(relatório da frota)",
            vercel: { ok: true, producaoOficial: estado.producaoDepois },
          },
    promover: async (id) => {
      chamadas.promover.push(id);
    },
    listarMigrationsNoSha: async (sha) => {
      chamadas.migrationsNoSha.push(sha);
      if (sha === BASE && estado.falhaMigrationsDaBase) throw new Error("boom");
      return MIGRATIONS[sha] ?? [];
    },
    listarFuncoesNoSha: async () => estado.funcoesNoSha,
    lerArquivoNoSha: (sha, caminho) => arvore[sha]?.[caminho] ?? null,
    arvoreIgual: async () => true,
    topoDoRamo: async () => {
      if (estado.topo instanceof Error) throw estado.topo;
      return estado.topo;
    },
    listarRuns: async (wf) => {
      if (wf === "conferir-banco-da-loja.yml") {
        chamadas.runsConferir++;
        return estado.runsConferir;
      }
      return [];
    },
    logDoRun: async (id) => estado.logs[id] ?? "",
    migrationList: async (ref) => {
      if (!estado.ledger[ref]) throw new Error("sem acesso");
      return tabelaDoLedger(estado.ledger[ref]);
    },
    listarFuncoes: async (ref) => {
      if (estado.falhaListarFuncoes === ref) throw new Error("boom");
      return Object.keys(estado.noAr[ref] ?? {}).map((slug) => ({
        slug,
        verify_jwt: estado.verifyJwt[slug] ?? true,
      }));
    },
    baixarFuncao: async (ref, nome) => {
      chamadas.baixar.push(`${ref}:${nome}`);
      if (estado.falhaBaixar === `${ref}:${nome}`) throw new Error("boom");
      return [...estado.noAr[ref][nome]].map(([caminho, conteudo]) => ({
        caminho,
        conteudo,
      }));
    },
  };
  return { d, chamadas, estado };
}

const executar = (d, promover = false) =>
  publicarRelease({ sha: SHA, deploymentId: DPL, promover }, d);

const bloqueiosDaLoja = (r, ref) =>
  r.bloqueios.filter((b) => b.alvo.includes(ref)).map((b) => b.motivo);

Deno.test("portão: controle — cenário base está PRONTO, a tabela mostra o SHA servido inteiro (8) e o ledger 'nenhuma'", async () => {
  const { d } = montar();
  const r = await executar(d);
  assertEquals(r.bloqueios, []);
  assertEquals(r.codigo, 0);
  assertStringIncludes(r.relatorio, "PRONTO");
  assertStringIncludes(r.relatorio, "| 11111111 | assinante (loja-a) |");
  assertStringIncludes(r.relatorio, "faltam no ledger: nenhuma");
  assert(!r.relatorio.includes("NÃO LIDO"));
  assertStringIncludes(r.relatorio, "3 endereços");
});

Deno.test("portão: inventário sem a lista de endereços diz '0 endereços'", async () => {
  const { d } = montar({ semDominios: true });
  const r = await executar(d);
  assertStringIncludes(r.relatorio, "0 endereços;");
});

Deno.test("nota da versão: título de UM caractere e item de UM caractere valem", async () => {
  const arvore = arvorePadrao({
    [ARQUIVO_NOTAS]: JSON.stringify({
      "1.5.18": { titulo: "A", novidades: ["b"], correcoes: [], melhorias: [] },
    }),
  });
  const { d } = montar({ arvore });
  const r = await executar(d);
  assertEquals(
    r.notasDaVersao.ok,
    true,
    JSON.stringify(r.notasDaVersao.problemas),
  );
  assertEquals(r.codigo, 0);
});

Deno.test("nota da versão: version.json do candidato sem codeVersion bloqueia dizendo que a versão não foi identificada", async () => {
  const { d } = montar({
    versaoCandidato: versao(SHA, { codeVersion: undefined }),
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assertEquals(r.notasDaVersao.ok, false);
  assertStringIncludes(
    r.notasDaVersao.problemas[0],
    "a versão não pôde ser identificada no candidato validado",
  );
});

Deno.test("ledger NÃO lido: nenhuma prova de banco é pedida e o relatório diz 'NÃO LIDO'", async () => {
  const { d, chamadas } = montar({
    ledger: { [LOJA_A]: ["20261190000000", "20261192000000"] },
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assert(
    bloqueiosDaLoja(r, LOJA_B).some((m) => m.startsWith("ledger não lido")),
    JSON.stringify(r.bloqueios),
  );
  assertEquals(
    chamadas.runsConferir,
    0,
    "sem ledger não se consulta evidência",
  );
  assertStringIncludes(r.relatorio, "faltam no ledger: NÃO LIDO");
  assert(!r.relatorio.includes("lote "), "nenhum lote decidido sem ledger");
});

Deno.test("base indefinida (a loja serve 2 SHAs): bloqueia e NÃO pergunta a lista de migrations de base nenhuma", async () => {
  const { d, chamadas } = montar({
    sondas: [
      sonda("a.vercel.app", LOJA_A, "Loja A"),
      sonda("b.vercel.app", LOJA_B, "Loja B", BASE),
      sonda("b2.vercel.app", LOJA_B, "Loja B", SHA),
      {
        dominio: "manut.vercel.app",
        ficha: { status: 503, caderneta: "miss", refs: [] },
      },
    ],
    classesAntes: [
      { dominio: "a.vercel.app", classe: "OK" },
      { dominio: "b.vercel.app", classe: "ENDERECO_ANTIGO" },
      { dominio: "b2.vercel.app", classe: "OK" },
    ],
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assert(
    bloqueiosDaLoja(r, LOJA_B).some((m) =>
      m.includes("base indefinida (a loja serve 2 SHAs)"),
    ),
    JSON.stringify(r.bloqueios),
  );
  for (const sha of chamadas.migrationsNoSha)
    assertEquals(sha === SHA || sha === BASE, true, `lista pedida para ${sha}`);
});

Deno.test("migrations da base ilegíveis: bloqueia citando os 8 primeiros caracteres da base e o erro", async () => {
  const { d } = montar({ falhaMigrationsDaBase: true });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assert(
    bloqueiosDaLoja(r, LOJA_B).includes(
      "migrations da base 22222222 não lidas: boom",
    ),
    JSON.stringify(r.bloqueios),
  );
});

Deno.test("diagnóstico de lote só é buscado com ledger incompleto E prova NEGATIVA (cada consulta a mais é uma ida ao GitHub)", async () => {
  // ledger completo + POSITIVA: só a consulta da prova
  const completo = montar();
  const r1 = await executar(completo.d);
  assertEquals(r1.codigo, 0);
  assertEquals(completo.chamadas.runsConferir, 1);

  // ledger com lacuna + POSITIVA: backfill, ainda só a consulta da prova
  const lacuna = montar({
    ledger: {
      [LOJA_A]: ["20261190000000", "20261192000000"],
      [LOJA_B]: ["20261190000000"],
    },
  });
  const r2 = await executar(lacuna.d);
  assertEquals(r2.codigo, 1);
  assertStringIncludes(r2.relatorio, "BACKFILL");
  assertEquals(lacuna.chamadas.runsConferir, 1);

  // ledger com lacuna + NEGATIVA: a prova + as 3 consultas de diagnóstico
  const negativa = montar({
    ledger: {
      [LOJA_A]: ["20261190000000", "20261192000000"],
      [LOJA_B]: ["20261190000000"],
    },
    logs: {
      11: `VEREDITO-CONSULTA consulta=${PROVA} ref=${LOJA_B} sha=${OUTRO} linhas=61 ok_false=1 ok_nao_booleano=0 rol=ok\n`,
    },
  });
  const r3 = await executar(negativa.d);
  assertEquals(r3.codigo, 1);
  assertEquals(negativa.chamadas.runsConferir, 4);
});

Deno.test("falha ao listar as functions da loja vira bloqueio com o erro, nunca exceção", async () => {
  const { d } = montar({ falhaListarFuncoes: LOJA_B });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assert(
    bloqueiosDaLoja(r, LOJA_B).includes("functions não listadas: boom"),
    JSON.stringify(r.bloqueios),
  );
});

Deno.test("falha ao baixar o pacote de uma function vira bloqueio daquela function, nunca exceção", async () => {
  const { d } = montar({ falhaBaixar: `${LOJA_B}:criar-pagamento` });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assert(
    bloqueiosDaLoja(r, LOJA_B).includes(
      "function criar-pagamento: download falhou: boom",
    ),
    JSON.stringify(r.bloqueios),
  );
});

Deno.test("verify_jwt diferente do config.toml: UMA entrada bloqueante por function e o pacote nem é baixado", async () => {
  const { d, chamadas } = montar({ verifyJwt: {} });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  for (const ref of [LOJA_A, LOJA_B]) {
    assertEquals(
      bloqueiosDaLoja(r, ref).filter((m) =>
        m.startsWith("function webhook-mercadopago"),
      ),
      [
        "function webhook-mercadopago: verify_jwt true no ar, config.toml do SHA diz false",
      ],
    );
    assert(!chamadas.baixar.includes(`${ref}:webhook-mercadopago`));
  }
});

// ---- function que ainda não está publicada na loja: o ramo do `mudou`

const CAMINHO_NOVA = "supabase/functions/nova-fn/index.ts";
const CAMINHO_AUX = "supabase/functions/nova-fn/aux.ts";

async function novaFunction({ sha, base, sondasDaB }) {
  const { d } = montar({
    arvore: arvorePadrao(sha, base),
    funcoesNoSha: ["criar-pagamento", "webhook-mercadopago", "nova-fn"],
    ...(sondasDaB
      ? {
          sondas: [
            sonda("a.vercel.app", LOJA_A, "Loja A"),
            sonda("b.vercel.app", LOJA_B, "Loja B", BASE),
            sonda("b2.vercel.app", LOJA_B, "Loja B", SHA),
            {
              dominio: "manut.vercel.app",
              ficha: { status: 503, caderneta: "miss", refs: [] },
            },
          ],
          classesAntes: [
            { dominio: "a.vercel.app", classe: "OK" },
            { dominio: "b.vercel.app", classe: "ENDERECO_ANTIGO" },
            { dominio: "b2.vercel.app", classe: "OK" },
          ],
        }
      : {}),
  });
  const r = await executar(d);
  const motivos = bloqueiosDaLoja(r, LOJA_B).filter((m) =>
    m.startsWith("function nova-fn"),
  );
  return { r, motivos };
}

Deno.test("function nova, idêntica na base e na release: deriva antiga — não bloqueia e o relatório mostra a deriva", async () => {
  const igual = { [CAMINHO_NOVA]: "igual" };
  const { r, motivos } = await novaFunction({ sha: igual, base: igual });
  assertEquals(motivos, []);
  assertEquals(r.codigo, 0);
  assertStringIncludes(
    r.relatorio,
    "- deriva antiga (não bloqueia esta release): nova-fn — não publicada nesta loja",
  );
});

Deno.test("function nova com arquivo VAZIO igual na base e na release: ainda deriva antiga (vazio não é 'ausente')", async () => {
  const vazio = { [CAMINHO_NOVA]: "" };
  const { motivos } = await novaFunction({ sha: vazio, base: vazio });
  assertEquals(motivos, []);
});

Deno.test("function nova cujo conteúdo mudou na release: NAO_PRONTA e bloqueia a loja", async () => {
  const { motivos } = await novaFunction({
    sha: { [CAMINHO_NOVA]: "novo" },
    base: { [CAMINHO_NOVA]: "velho" },
  });
  assertEquals(motivos, ["function nova-fn: não publicada nesta loja"]);
});

Deno.test("function nova com 2 arquivos, só UM mudou na release: basta um para bloquear", async () => {
  const importa = 'import "./aux.ts";';
  const { motivos } = await novaFunction({
    sha: { [CAMINHO_NOVA]: `${importa}\n// novo`, [CAMINHO_AUX]: "export {};" },
    base: {
      [CAMINHO_NOVA]: `${importa}\n// velho`,
      [CAMINHO_AUX]: "export {};",
    },
  });
  assertEquals(motivos, ["function nova-fn: não publicada nesta loja"]);
});

Deno.test("function nova na release que a base nem tinha: bloqueia", async () => {
  const { motivos } = await novaFunction({
    sha: { [CAMINHO_NOVA]: "primeira vez" },
    base: {},
  });
  assertEquals(motivos, ["function nova-fn: não publicada nesta loja"]);
});

Deno.test("function nova numa loja de base indefinida: toda diferença conta como da release (bloqueia, sem exceção)", async () => {
  const igual = { [CAMINHO_NOVA]: "igual" };
  const { motivos } = await novaFunction({
    sha: igual,
    base: igual,
    sondasDaB: true,
  });
  assertEquals(
    motivos.includes("function nova-fn: não publicada nesta loja"),
    true,
    motivos.join("\n"),
  );
});

Deno.test("lista de functions do SHA: '_shared', nome fora do padrão e as declaradas não publicadas NÃO entram; function válida entra", async () => {
  const novas = {
    "supabase/functions/send-order-whatsapp/index.ts": "x",
    "supabase/functions/Bad_Name/index.ts": "x",
    "supabase/functions/_shared/index.ts": "x",
    [CAMINHO_NOVA]: "x",
  };
  const { d } = montar({
    arvore: arvorePadrao(novas, {}),
    funcoesNoSha: [
      "criar-pagamento",
      "webhook-mercadopago",
      "_shared",
      "Bad_Name",
      "send-order-whatsapp",
      "nova-fn",
    ],
  });
  const r = await executar(d);
  const nomes = bloqueiosDaLoja(r, LOJA_B)
    .filter((m) => m.startsWith("function "))
    .map((m) => m.split(":")[0]);
  assertEquals(nomes, ["function nova-fn"]);
});

// ---- topo do ramo

Deno.test("topo do ramo com resposta mal formada: bloqueia citando só os 50 primeiros caracteres e não usa o valor", async () => {
  const lixo = "x".repeat(60);
  const { d } = montar({ topo: lixo });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  const b = r.bloqueios.find((x) => x.alvo === "ramo release");
  assert(b, JSON.stringify(r.bloqueios));
  assertStringIncludes(b.motivo, `resposta inválida "${"x".repeat(50)}"`);
  assert(!b.motivo.includes("x".repeat(51)));
  assertStringIncludes(r.relatorio, "Topo de origin/release: `não lido`");
});

// ---- texto do relatório depois do promote

Deno.test("promote que deu certo: o relatório NÃO fala em FALHOU, rollback nem produção divergente", async () => {
  const { d, chamadas } = montar();
  const r = await executar(d, true);
  assertEquals(r.codigo, 0);
  assertEquals(chamadas.promover, [DPL]);
  assert(!r.relatorio.includes("FALHOU"), r.relatorio);
  assert(!r.relatorio.includes("vercel rollback"));
  assert(!r.relatorio.includes("Produção oficial depois"));
});

Deno.test("promote com a produção oficial em OUTRO deployment: falha, diz qual produção ficou e imprime o rollback exato", async () => {
  const { d } = montar({ producaoDepois: "dpl_Outro999" });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assertStringIncludes(
    r.relatorio,
    `Produção oficial depois: \`dpl_Outro999\` (esperado \`${DPL}\`).`,
  );
  assertStringIncludes(r.relatorio, "**FALHOU.**");
  assertStringIncludes(
    r.relatorio,
    `vercel rollback ${DPL_ANTERIOR} --yes --scope <slug do time>\n\`\`\``,
  );
});

Deno.test("promote com a frota reprovada mas a produção no deployment certo: falha com rollback e SEM a linha de produção divergente; o escopo da política vai no comando", async () => {
  const { d } = montar({
    posOk: false,
    politica: {
      ...POLITICA,
      projetoVercel: { ...POLITICA.projetoVercel, escopo: "time-da-loja" },
    },
  });
  const r = await executar(d, true);
  assertEquals(r.codigo, 1);
  assertStringIncludes(r.relatorio, "**FALHOU.**");
  assertStringIncludes(
    r.relatorio,
    `vercel rollback ${DPL_ANTERIOR} --yes --scope time-da-loja`,
  );
  assert(!r.relatorio.includes("Produção oficial depois"));
});

Deno.test("bloqueio sem nenhum comando de conserto: o relatório não promete 'próximo passo seguro' e não devolve consertos", async () => {
  const { d } = montar({
    candidato: {
      id: DPL,
      url: "cand.vercel.app",
      target: "production",
      readyState: "BUILDING",
      projectId: "prj_X",
    },
  });
  const r = await executar(d);
  assertEquals(r.codigo, 1);
  assertEquals(r.consertos, []);
  assert(!r.relatorio.includes("Próximo passo seguro"));
});

// ====================================================================
// dependenciasReais: SÓ o que não toca rede, CLI de nuvem nem token
// (guardas de entrada, que recusam ANTES de qualquer comando; e o git LOCAL,
// somente leitura, sobre o commit que está em HEAD deste checkout)
// ====================================================================

/** No Windows o resolverCliVercel só confere se `vercel.cmd` e o vc.js EXISTEM
 * no PATH (nunca os executa): um par de arquivos vazios numa pasta temporária
 * basta para `dependenciasReais()` montar. Em outros sistemas não precisa. */
async function comDependenciasReais(corpo) {
  if (Deno.build.os !== "windows") return await corpo(dependenciasReais());
  const dir = Deno.makeTempDirSync();
  Deno.mkdirSync(`${dir}/node_modules/vercel/dist`, { recursive: true });
  Deno.writeTextFileSync(`${dir}/vercel.cmd`, "");
  Deno.writeTextFileSync(`${dir}/node_modules/vercel/dist/vc.js`, "");
  const antes = Deno.env.get("PATH") ?? "";
  Deno.env.set("PATH", `${dir};${antes}`);
  try {
    return await corpo(dependenciasReais());
  } finally {
    Deno.env.set("PATH", antes);
    Deno.removeSync(dir, { recursive: true });
  }
}

async function commitDeHead() {
  const saida = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "null",
  }).output();
  return new TextDecoder().decode(saida.stdout).trim();
}

Deno.test("dependenciasReais.arvoreIgual: só aceita commits de 40 hex; árvore igual a si mesma é igual; commit que não existe NÃO é igual", async () => {
  const head = await commitDeHead();
  assertEquals(head.length, 40, "o teste precisa de um checkout git com HEAD");
  await comDependenciasReais(async (reais) => {
    assertEquals(await reais.arvoreIgual(head, head, ["scripts"]), true);
    // "HEAD" o git aceitaria; o portão não: evidência só por SHA completo
    assertEquals(await reais.arvoreIgual("HEAD", head, ["scripts"]), false);
    assertEquals(await reais.arvoreIgual(head, "HEAD", ["scripts"]), false);
    assertEquals(await reais.arvoreIgual(undefined, head, ["scripts"]), false);
    // 40 hex válido, mas commit que não existe: sem prova, não é igual
    assertEquals(
      await reais.arvoreIgual(head, "0".repeat(40), ["scripts"]),
      false,
    );
  });
});

Deno.test("dependenciasReais.lerArquivoNoSha: devolve o texto do arquivo no commit e null quando o caminho não existe nele", async () => {
  const head = await commitDeHead();
  await comDependenciasReais((reais) => {
    const politica = reais.lerArquivoNoSha(head, "scripts/frota/politica.json");
    assertEquals(typeof politica, "string");
    assertStringIncludes(politica, "projetoVercel");
    assertEquals(
      reais.lerArquivoNoSha(head, "scripts/frota/nao-existe.json"),
      null,
    );
    assertEquals(
      reais.lerArquivoNoSha(head, "scripts/frota/politica.json"),
      politica,
    );
  });
});

Deno.test("dependenciasReais: ref, nome de function e ramo mal formados são recusados ANTES de qualquer comando", async () => {
  await comDependenciasReais(async (reais) => {
    for (const ref of [
      "x",
      "A".repeat(20),
      "../etc",
      "",
      `${"a".repeat(19)}1`,
    ]) {
      await assertRejects(
        () => reais.migrationList(ref),
        Error,
        `ref inválido ${ref}`,
      );
      await assertRejects(
        () => reais.listarFuncoes(ref),
        Error,
        `ref inválido ${ref}`,
      );
      await assertRejects(
        () => reais.baixarFuncao(ref, "criar-pagamento"),
        Error,
        "ref ou nome inválido",
      );
    }
    for (const nome of ["../x", "_shared", "", "Maiuscula", "com espaco"]) {
      await assertRejects(
        () => reais.baixarFuncao(LOJA_A, nome),
        Error,
        "ref ou nome inválido",
      );
    }
    await assertRejects(
      () => reais.topoDoRamo("a b"),
      Error,
      "ramo inválido a b",
    );
    await assertRejects(
      () => reais.topoDoRamo("a;b"),
      Error,
      "ramo inválido a;b",
    );
  });
});
