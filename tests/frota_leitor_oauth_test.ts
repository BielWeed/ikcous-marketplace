// @ts-nocheck
/**
 * scripts/frota/leitor-oauth.mjs — o leitor da loja OAuth (T5 do plano
 * PORTAO-OAUTH-PONTE-A, 26/11/2026). Ele troca as três leituras que o portão
 * faz pelo CLI (`migrationList`, `listarFuncoes`, `baixarFuncao`) por leituras
 * pela Management API com o token da lojista, devolvendo AS MESMAS FORMAS: o
 * portão (`versoesAplicadas`, `prontidaoDaLoja`) não muda uma linha.
 *
 * O que este arquivo trava (cada teste cai se a guarda correspondente sair):
 *  1. o ledger da API vira um texto que `versoesAplicadas` aceita, com as
 *     mesmas versões, lido do modelo `migracoes` (GET);
 *  2. ledger vazio, versão fora de ^\d{13,14}$, versão repetida ou corpo que não
 *     é lista LANÇAM: no portão isso vira "ledger não lido", nunca "nada falta";
 *  3. functions: `[{ slug, verify_jwt }]`, com verify_jwt booleano obrigatório;
 *  4. o código da function vem do `baixar` INJETADO (a API da T3 ou o CLI com o
 *     token só no env da chamada, decidido depois da prova P8) e tem de estar
 *     no formato `[{ caminho: "supabase/functions/…", conteudo }]` — as mesmas
 *     chaves do caminho pelo CLI, inclusive o `_shared`. Caminho fora de
 *     `supabase/functions/` (ou com `..`, `\`, absoluto) é recusado;
 *  5. SemAcesso (e qualquer erro da gestão ou do `baixar`) sobe SEM alteração.
 *
 * Nenhuma rede: o cliente da gestão é um dublê, ou o cliente real com um fetch
 * falso. O "token" é um canário montado em tempo de execução.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { criarLeitorOAuth } from "../scripts/frota/leitor-oauth.mjs";
import {
  arquivosEsperados,
  classificarFuncao,
  versoesAplicadas,
} from "../scripts/frota/publicar-release.mjs";
import {
  API_GESTAO,
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  SemAcesso,
  criarClienteGestao,
} from "../scripts/frota/supabase-gestao.mjs";

const REF = "abcdefghijklmnopqrst";
// canário montado em tempo de execução (literal no fonte dispara o secretlint)
const CANARIO = `sbp_oauth_${"ab".repeat(20)}`;

/** Dublê do cliente da gestão: responde por modelo e anota cada pedido. */
function gestaoFalsa(respostas) {
  const chamadas = [];
  const porModelo = new Map(Object.entries(respostas));
  return {
    chamadas,
    pedir(modelo, opcoes) {
      chamadas.push([modelo, opcoes]);
      const r = porModelo.get(modelo);
      if (r instanceof Error) return Promise.reject(r);
      if (typeof r === "function") return Promise.resolve(r());
      return Promise.resolve(structuredClone(r));
    },
  };
}

/** Dublê do `baixar`: devolve o pacote e anota (ref, nome). */
function baixarFalso(pacote) {
  const chamadas = [];
  const f = (ref, nome) => {
    chamadas.push([ref, nome]);
    if (pacote instanceof Error) return Promise.reject(pacote);
    return Promise.resolve(structuredClone(pacote));
  };
  f.chamadas = chamadas;
  return f;
}

const naoChama = () => {
  throw new Error("não devia ter sido chamado");
};

function leitorCom({ migracoes, funcoes, pacote } = {}) {
  const gestao = gestaoFalsa({ migracoes, funcoes });
  const baixar = baixarFalso(pacote ?? []);
  return { gestao, baixar, leitor: criarLeitorOAuth({ gestao, baixar }) };
}

// ------------------------------------------------------------ construção

Deno.test("criar sem gestão com pedir(), ou sem baixar, recusa na hora", () => {
  const baixar = baixarFalso([]);
  assertThrows(() => criarLeitorOAuth({ baixar }));
  assertThrows(() => criarLeitorOAuth({ gestao: {}, baixar }));
  assertThrows(() => criarLeitorOAuth({ gestao: gestaoFalsa({}) }));
  assertThrows(() =>
    criarLeitorOAuth({ gestao: gestaoFalsa({}), baixar: "x" }),
  );
  assertThrows(() => criarLeitorOAuth());
});

// ------------------------------------------------------------ 1. ledger

Deno.test("1. migrationList: o ledger da API vira texto que versoesAplicadas lê, com as mesmas versões", async () => {
  const { gestao, leitor } = leitorCom({
    migracoes: [
      { version: "20250101000000", name: "inicio" },
      { version: "20261126120000", name: "loja_nova" },
      { version: "1700000000000" }, // 13 dígitos também é versão válida
    ],
  });
  const saida = await leitor.migrationList(REF);
  assertEquals(typeof saida, "string");
  assertEquals(
    versoesAplicadas(saida),
    new Set(["20250101000000", "20261126120000", "1700000000000"]),
  );
  assertEquals(gestao.chamadas, [["migracoes", { ref: REF }]]);
});

Deno.test("1. migrationList pelo cliente REAL: GET em /database/migrations do ref", async () => {
  const chamadas = [];
  const fetchFalso = (url, init) => {
    chamadas.push({ url: String(url), metodo: init.method });
    return Promise.resolve(
      new Response(JSON.stringify([{ version: "20250101000000" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  const gestao = criarClienteGestao({ token: CANARIO, fetch: fetchFalso });
  const leitor = criarLeitorOAuth({ gestao, baixar: naoChama });
  assertEquals(
    versoesAplicadas(await leitor.migrationList(REF)),
    new Set(["20250101000000"]),
  );
  assertEquals(chamadas, [
    {
      url: `${API_GESTAO}/v1/projects/${REF}/database/migrations`,
      metodo: "GET",
    },
  ]);
});

// ------------------------------------------------------------ 2. ledger ilegível

Deno.test("2. ledger vazio LANÇA (vira 'ledger não lido', nunca 'nada falta')", async () => {
  const { leitor } = leitorCom({ migracoes: [] });
  await assertRejects(() => leitor.migrationList(REF), Error, "vazio");
});

Deno.test("2. versão fora de ^\\d{13,14}$ LANÇA, e a mensagem não ecoa o valor", async () => {
  const ruins = [
    "2025",
    "202501010000001", // 15 dígitos
    "20250101000000x",
    " 20250101000000",
    CANARIO,
    "",
    20250101000000, // número, não texto
    null,
    undefined,
  ];
  for (const version of ruins) {
    const { leitor } = leitorCom({
      migracoes: [{ version: "20250101000000" }, { version }],
    });
    const e = await assertRejects(() => leitor.migrationList(REF), Error);
    assert(!e.message.includes(CANARIO), "mensagem ecoou o valor da resposta");
  }
});

Deno.test("2. item do ledger que não é objeto LANÇA", async () => {
  for (const item of [null, "20250101000000", ["20250101000000"], 7]) {
    const { leitor } = leitorCom({
      migracoes: [{ version: "20250101000000" }, item],
    });
    await assertRejects(() => leitor.migrationList(REF), Error);
  }
});

Deno.test("2. versão REPETIDA no ledger LANÇA (a chave do ledger é única: resposta suspeita)", async () => {
  const { leitor } = leitorCom({
    migracoes: [
      { version: "20250101000000" },
      { version: "20261126120000" },
      { version: "20250101000000" },
    ],
  });
  await assertRejects(() => leitor.migrationList(REF), Error, "repetida");
});

Deno.test("2. corpo que não é lista (null, objeto, texto) LANÇA", async () => {
  for (const corpo of [null, {}, { migrations: [] }, "20250101000000"]) {
    const { leitor } = leitorCom({ migracoes: () => corpo });
    await assertRejects(() => leitor.migrationList(REF), Error);
  }
});

// ------------------------------------------------------------ 3. functions

Deno.test("3. listarFuncoes devolve só { slug, verify_jwt } de cada function", async () => {
  const { gestao, leitor } = leitorCom({
    funcoes: [
      {
        id: "1",
        slug: "criar-pedido",
        name: "criar-pedido",
        status: "ACTIVE",
        version: 4,
        verify_jwt: true,
      },
      { id: "2", slug: "webhook-pagamento", verify_jwt: false },
    ],
  });
  assertEquals(await leitor.listarFuncoes(REF), [
    { slug: "criar-pedido", verify_jwt: true },
    { slug: "webhook-pagamento", verify_jwt: false },
  ]);
  assertEquals(gestao.chamadas, [["funcoes", { ref: REF }]]);
});

Deno.test("3. loja sem nenhuma function: lista vazia (igual ao CLI), sem lançar", async () => {
  const { leitor } = leitorCom({ funcoes: [] });
  assertEquals(await leitor.listarFuncoes(REF), []);
});

Deno.test("3. verify_jwt que não é booleano LANÇA (ausente, texto, número, null)", async () => {
  for (const vj of [undefined, "true", 1, 0, null]) {
    const f = { slug: "criar-pedido" };
    if (vj !== undefined) f.verify_jwt = vj;
    const { leitor } = leitorCom({
      funcoes: [{ slug: "outra", verify_jwt: true }, f],
    });
    await assertRejects(() => leitor.listarFuncoes(REF), Error, "verify_jwt");
  }
});

Deno.test("3. (T6, revisão Opus) a mensagem do verify_jwt torto diz QUAL function e QUAL loja", async () => {
  const { leitor } = leitorCom({
    funcoes: [{ slug: "webhook-pagamento", status: "ACTIVE" }],
  });
  const e = await assertRejects(() => leitor.listarFuncoes(REF), Error);
  assert(e.message.includes("webhook-pagamento"), e.message);
  assert(e.message.includes(REF), e.message);
  assert(e.message.includes("verify_jwt"), e.message);
});

Deno.test("3. (T6) slug fora do padrão do portão NÃO é impresso na mensagem do verify_jwt", async () => {
  const { leitor } = leitorCom({
    funcoes: [{ slug: "Webhook\nforjado", verify_jwt: "sim" }],
  });
  const e = await assertRejects(() => leitor.listarFuncoes(REF), Error);
  assert(!e.message.includes("forjado"), e.message);
  assert(e.message.includes(REF), e.message);
});

Deno.test("3. (T6, revisão Opus) function REMOVED ou THROTTLED conta como AUSENTE (gera o comando de publicar, não esconde nada)", async () => {
  for (const status of ["REMOVED", "THROTTLED"]) {
    const { leitor } = leitorCom({
      funcoes: [
        { slug: "criar-pedido", status: "ACTIVE", verify_jwt: true },
        // fora da lista mesmo sem verify_jwt: o que não está ativo não se compara
        { slug: "webhook-pagamento", status },
      ],
    });
    assertEquals(
      await leitor.listarFuncoes(REF),
      [{ slug: "criar-pedido", verify_jwt: true }],
      status,
    );
  }
});

Deno.test("3. (T6) status desconhecido LANÇA (lista não lida, nunca 'em dia' no escuro); status ausente vale como ativa (a forma do CLI)", async () => {
  for (const status of ["DEPLOYING", "active", "", 1, null]) {
    const { leitor } = leitorCom({
      funcoes: [{ slug: "criar-pedido", status, verify_jwt: true }],
    });
    const e = await assertRejects(
      () => leitor.listarFuncoes(REF),
      Error,
      "status",
    );
    assert(e.message.includes("criar-pedido"), e.message);
  }
  const { leitor } = leitorCom({
    funcoes: [{ slug: "criar-pedido", verify_jwt: false }],
  });
  assertEquals(await leitor.listarFuncoes(REF), [
    { slug: "criar-pedido", verify_jwt: false },
  ]);
});

Deno.test("3. slug ausente/não-texto, slug repetido, item não-objeto ou corpo não-lista LANÇAM", async () => {
  const casos = [
    [{ verify_jwt: true }],
    [{ slug: 7, verify_jwt: true }],
    [{ slug: "", verify_jwt: true }],
    [
      { slug: "a", verify_jwt: true },
      { slug: "a", verify_jwt: false },
    ],
    [null],
    ["a"],
  ];
  for (const funcoes of casos) {
    const { leitor } = leitorCom({ funcoes });
    await assertRejects(() => leitor.listarFuncoes(REF), Error);
  }
  for (const corpo of [null, {}, "[]"]) {
    const { leitor } = leitorCom({ funcoes: () => corpo });
    await assertRejects(() => leitor.listarFuncoes(REF), Error);
  }
});

Deno.test("3. listarFuncoes pelo cliente REAL: GET em /functions do ref", async () => {
  const chamadas = [];
  const fetchFalso = (url, init) => {
    chamadas.push({ url: String(url), metodo: init.method });
    return Promise.resolve(
      new Response(JSON.stringify([{ slug: "x", verify_jwt: true }]), {
        status: 200,
      }),
    );
  };
  const gestao = criarClienteGestao({ token: CANARIO, fetch: fetchFalso });
  const leitor = criarLeitorOAuth({ gestao, baixar: naoChama });
  assertEquals(await leitor.listarFuncoes(REF), [
    { slug: "x", verify_jwt: true },
  ]);
  assertEquals(chamadas, [
    { url: `${API_GESTAO}/v1/projects/${REF}/functions`, metodo: "GET" },
  ]);
});

// ------------------------------------------------------------ 4. código da function

/** Uma function com `_shared`, como o repositório tem no SHA. */
const NO_SHA = new Map([
  [
    "supabase/functions/criar-pedido/index.ts",
    'import { cors } from "../_shared/cors.ts";\nimport { total } from "./total.ts";\nexport default () => cors(total());\n',
  ],
  [
    "supabase/functions/criar-pedido/total.ts",
    "export const total = () => 42;\n",
  ],
  [
    "supabase/functions/_shared/cors.ts",
    "export const cors = (x: number) => x;\n",
  ],
]);

Deno.test("4. baixarFuncao devolve [{ caminho: 'supabase/functions/…', conteudo }] com as MESMAS chaves do caminho pelo CLI (com _shared)", async () => {
  const pacote = [...NO_SHA].map(([caminho, conteudo]) => ({
    caminho,
    conteudo,
  }));
  const { gestao, baixar, leitor } = leitorCom({ pacote });
  const baixados = await leitor.baixarFuncao(REF, "criar-pedido");
  assertEquals(baixados, pacote);
  assertEquals(baixar.chamadas, [[REF, "criar-pedido"]]);
  assertEquals(gestao.chamadas, []);
  // As chaves batem com o que o portão espera do SHA: a function sai EM_DIA.
  const esperados = arquivosEsperados(
    "criar-pedido",
    (c) => NO_SHA.get(c) ?? null,
  );
  assertEquals(
    new Set(baixados.map((a) => a.caminho)),
    new Set(esperados.keys()),
  );
  const mapa = new Map(baixados.map((a) => [a.caminho, a.conteudo]));
  assertEquals(classificarFuncao(mapa, esperados, esperados).estado, "EM_DIA");
});

Deno.test("4. baixarFuncao devolve só { caminho, conteudo } (campo extra do baixar não passa)", async () => {
  const { leitor } = leitorCom({
    pacote: [
      {
        caminho: "supabase/functions/x/index.ts",
        conteudo: "a",
        tamanho: 1,
      },
    ],
  });
  assertEquals(await leitor.baixarFuncao(REF, "x"), [
    { caminho: "supabase/functions/x/index.ts", conteudo: "a" },
  ]);
});

Deno.test("4. pacote vazio passa como lista vazia (o portão já o trata: 'download vazio')", async () => {
  const { leitor } = leitorCom({ pacote: [] });
  assertEquals(await leitor.baixarFuncao(REF, "x"), []);
});

Deno.test("4. caminho fora de supabase/functions/ é RECUSADO", async () => {
  const ruins = [
    "outra/pasta/index.ts",
    "functions/x/index.ts",
    "x/index.ts",
    "supabase/functionsX/x/index.ts",
    "supabase/functions/",
    "supabase/functions/../../.env",
    "supabase/functions/x/../../../segredo.ts",
    "supabase/functions/./x/index.ts",
    "supabase/functions/x//index.ts",
    "/supabase/functions/x/index.ts",
    "C:/supabase/functions/x/index.ts",
    "supabase\\functions\\x\\index.ts",
    "supabase/functions/x\\..\\..\\a.ts",
    "supabase/functions/x/index.ts\n",
    "",
    7,
    null,
  ];
  for (const caminho of ruins) {
    const { leitor } = leitorCom({
      pacote: [
        { caminho: "supabase/functions/x/index.ts", conteudo: "ok" },
        { caminho, conteudo: CANARIO },
      ],
    });
    const e = await assertRejects(
      () => leitor.baixarFuncao(REF, "x"),
      Error,
      undefined,
      `caminho aceito: ${JSON.stringify(caminho)}`,
    );
    assert(!e.message.includes(CANARIO), "mensagem ecoou o conteúdo");
  }
});

Deno.test("4. conteúdo que não é texto, caminho repetido, item não-objeto ou resposta não-lista são RECUSADOS", async () => {
  const casos = [
    [{ caminho: "supabase/functions/x/index.ts", conteudo: new Uint8Array(1) }],
    [{ caminho: "supabase/functions/x/index.ts", conteudo: null }],
    [{ caminho: "supabase/functions/x/index.ts" }],
    [
      { caminho: "supabase/functions/x/index.ts", conteudo: "a" },
      { caminho: "supabase/functions/x/index.ts", conteudo: "b" },
    ],
    [null],
    ["supabase/functions/x/index.ts"],
  ];
  for (const pacote of casos) {
    const { leitor } = leitorCom({ pacote });
    await assertRejects(() => leitor.baixarFuncao(REF, "x"), Error);
  }
  for (const resposta of [null, undefined, {}, "supabase/functions/x"]) {
    const baixar = () => Promise.resolve(resposta);
    const leitor = criarLeitorOAuth({ gestao: gestaoFalsa({}), baixar });
    await assertRejects(() => leitor.baixarFuncao(REF, "x"), Error);
  }
});

Deno.test("4. ref ou nome inválido é recusado ANTES de chamar o baixar", async () => {
  for (const [ref, nome] of [
    ["curto", "x"],
    ["ABCDEFGHIJKLMNOPQRST", "x"],
    [REF, "../x"],
    [REF, "x y"],
    [REF, ""],
    [REF, "-x"],
    [REF, undefined],
  ]) {
    const { baixar, leitor } = leitorCom({ pacote: [] });
    await assertRejects(() => leitor.baixarFuncao(ref, nome), Error);
    assertEquals(baixar.chamadas, []);
  }
});

Deno.test("ref inválido no ledger e nas functions é recusado ANTES da gestão", async () => {
  const { gestao, leitor } = leitorCom({ migracoes: [], funcoes: [] });
  await assertRejects(() => leitor.migrationList("../v1/organizations"), Error);
  await assertRejects(() => leitor.listarFuncoes("curto"), Error);
  assertEquals(gestao.chamadas, []);
});

// ------------------------------------------------------------ 5. erros sobem intactos

Deno.test("5. SemAcesso (e ESTADO_DESCONHECIDO) sobe SEM alteração, nas três leituras", async () => {
  const semAcesso = new SemAcesso("Gestão Supabase: HTTP 401", { status: 401 });
  const desconhecido = new ErroDaGestao("prazo", {
    codigo: ESTADO_DESCONHECIDO,
  });
  for (const erro of [semAcesso, desconhecido]) {
    const { leitor } = leitorCom({
      migracoes: erro,
      funcoes: erro,
      pacote: erro,
    });
    for (const ler of [
      () => leitor.migrationList(REF),
      () => leitor.listarFuncoes(REF),
      () => leitor.baixarFuncao(REF, "x"),
    ]) {
      let pego;
      try {
        await ler();
      } catch (e) {
        pego = e;
      }
      assertStrictEquals(pego, erro);
    }
  }
});

Deno.test("5. 401 do cliente REAL chega ao portão como SemAcesso, sem o token na mensagem", async () => {
  const fetchFalso = () => Promise.resolve(new Response("", { status: 401 }));
  const gestao = criarClienteGestao({ token: CANARIO, fetch: fetchFalso });
  const leitor = criarLeitorOAuth({ gestao, baixar: naoChama });
  for (const ler of [
    () => leitor.migrationList(REF),
    () => leitor.listarFuncoes(REF),
  ]) {
    const e = await assertRejects(ler, SemAcesso);
    assert(!e.message.includes(CANARIO));
  }
});

Deno.test("as leituras funcionam desligadas do objeto (o portão as chama com apply em outro this)", async () => {
  const { leitor } = leitorCom({
    migracoes: [{ version: "20250101000000" }],
    funcoes: [{ slug: "x", verify_jwt: true }],
    pacote: [{ caminho: "supabase/functions/x/index.ts", conteudo: "a" }],
  });
  const { migrationList, listarFuncoes, baixarFuncao } = leitor;
  const outro = {};
  assertEquals(
    versoesAplicadas(await migrationList.apply(outro, [REF])),
    new Set(["20250101000000"]),
  );
  assertEquals((await listarFuncoes.apply(outro, [REF])).length, 1);
  assertEquals((await baixarFuncao.apply(outro, [REF, "x"])).length, 1);
});
