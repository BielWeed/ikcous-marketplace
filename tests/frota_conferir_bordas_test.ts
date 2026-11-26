// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/**
 * scripts/frota/conferir-frota.mjs — as BORDAS da conferência da frota.
 *
 * É esta conferência que diz, depois do `vercel promote`, se a frota inteira
 * serve o SHA da release. tests/frota_conferir_test.ts prova o caminho feliz e
 * as classes principais. Uma caça por mutação (plantar um defeito de uma linha
 * e ver se algum teste cai) achou decisões que ficavam de pé sem teste; cada
 * teste abaixo cai se a guarda correspondente for tirada:
 *
 *  - o contrato do version.json e a leitura do texto (não é JSON × não é objeto);
 *  - a sonda de um endereço: HTTP diferente de 200 no version.json NÃO vira
 *    versão, tipos de erro de rede, ficha da PRIMEIRA amostra, amostra numerada;
 *  - o deployment esperado: maioria, empate (ambíguo), mesmo SHA em outro
 *    deployment, endereço antigo apontando para outro deployment, e a regra
 *    de NÃO comparar identidade quando o SHA não é o da release;
 *  - o destino canônico (publicUrl): cada defeito de formato, destino fora do
 *    inventário, destino que não responde 200 hit, destino de OUTRA loja;
 *  - a lista de aliases da Vercel: `next` fora do formato, item sem alias,
 *    teto de 60 páginas (lista incompleta), falha na 2ª página, página que
 *    repete, alias fora do contrato (só 3 nomes na mensagem), extras resolvidos
 *    um a um, produção oficial ilegível.
 *
 * Dublês com dados inventados: nenhuma rede, nenhum CLI.
 */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  agruparPorSha,
  classificar,
  conferirFrota,
  consultarVercel,
  extrairPublicUrl,
  extrairRefsSupabase,
  extrairTitulo,
  inventariar,
  main,
  maioriaEstrita,
  montarContexto,
  montarRelatorio,
  problemasDoContrato,
  refDaLojaSondada,
  resolverCliVercel,
  sondarEndereco,
  validarVersao,
  verificarCanonico,
} from "../scripts/frota/conferir-frota.mjs";

const SHA = "1".repeat(40);
const VELHO = "2".repeat(40);
const IDENT = "e".repeat(64);
const REF_A = "a".repeat(20);
const REF_B = "b".repeat(20);

function versaoDe(sha = SHA, extra = {}) {
  return {
    version: `1.5.18-sha.${sha.slice(0, 7)}-identity.${IDENT}`,
    codeVersion: "1.5.18",
    codeSha: sha,
    identityRevision: IDENT,
    source: "database",
    promotable: true,
    ...extra,
  };
}

// -------------------------------------------------------------- extratores

Deno.test("extrairRefsSupabase: entrada que não é texto devolve lista vazia (nunca lança); repetidos somem e a saída é ordenada", () => {
  for (const entrada of [undefined, null, 42, {}]) {
    assertEquals(extrairRefsSupabase(entrada), []);
  }
  const html = `https://${REF_B}.supabase.co https://${REF_A}.supabase.co https://${REF_B}.supabase.co/rest`;
  assertEquals(extrairRefsSupabase(html), [REF_A, REF_B]);
});

Deno.test("extrairPublicUrl e extrairTitulo: página sem o bloco/etiqueta devolve null (nunca lança)", () => {
  assertEquals(extrairPublicUrl("<html></html>"), null);
  assertEquals(extrairPublicUrl(undefined), null);
  assertEquals(extrairTitulo("<p>sem título</p>"), null);
  assertEquals(extrairTitulo(undefined), null);
  assertEquals(
    extrairPublicUrl(
      '<script id="ikcous-loja" type="application/json">{"identidade":{"publicUrl":"https://x.example"}}</script>',
    ),
    "https://x.example",
  );
  assertEquals(
    extrairPublicUrl(
      '<script id="ikcous-loja">{"identidade":{"publicUrl":42}}</script>',
    ),
    null,
  );
  assertEquals(
    extrairTitulo("<title> Loja &amp; Cia &#65;&#x42; &foo; \n x </title>"),
    "Loja & Cia AB &foo; x",
  );
});

// --------------------------------------------------- contrato do version.json

Deno.test("problemasDoContrato: objeto vazio lista TODOS os seis defeitos, na ordem; um version.json certo não lista nenhum", () => {
  assertEquals(problemasDoContrato({}), [
    "codeVersion ausente ou fora de semver (undefined)",
    "codeSha ausente ou fora de 40 hex (undefined)",
    "identityRevision ausente ou fora de 64 hex (undefined)",
    "version ausente",
    'source=undefined, esperado "database"',
    "promotable=undefined, esperado true (booleano)",
  ]);
  assertEquals(problemasDoContrato(versaoDe()), []);
});

Deno.test("problemasDoContrato: texto que existe mas está fora do formato também reprova (semver, 64 hex, 'version' montada)", () => {
  assertEquals(
    problemasDoContrato(versaoDe(SHA, { codeVersion: "1.5" })).length >= 1,
    true,
  );
  assertStringIncludes(
    problemasDoContrato(versaoDe(SHA, { codeVersion: "v1.5.18" }))[0],
    'codeVersion ausente ou fora de semver ("v1.5.18")',
  );
  assertStringIncludes(
    problemasDoContrato(versaoDe(SHA, { identityRevision: "abc" }))[0],
    'identityRevision ausente ou fora de 64 hex ("abc")',
  );
  assertEquals(problemasDoContrato(versaoDe(SHA, { version: "1.5.18" })), [
    "version não bate com codeVersion + codeSha + identityRevision",
  ]);
  // `version` ausente é reportada MESMO quando outro campo já está errado
  const { version: _omitida, ...semVersion } = versaoDe(SHA, {
    codeVersion: "x",
  });
  assert(problemasDoContrato(semVersion).includes("version ausente"));
});

Deno.test("validarVersao: 'não é JSON' e 'não é um objeto' são erros diferentes; só os 6 campos do contrato passam", () => {
  assertEquals(validarVersao("{texto"), { erro: "version.json não é JSON" });
  for (const texto of ["null", "[]", "3", '"x"']) {
    assertEquals(validarVersao(texto), {
      erro: "version.json não é um objeto",
    });
  }
  const lida = validarVersao(JSON.stringify({ ...versaoDe(), segredo: "x" }));
  assertEquals(lida.versao, versaoDe());
  assertEquals(lida.erro, undefined);
});

// ------------------------------------------------------------ sondarEndereco

const NOW = Date.parse("2026-10-06T20:00:00Z");

function paginaHtml({ titulo = "Loja", ref = REF_A } = {}) {
  return `<html><head><title>${titulo}</title></head><body>https://${ref}.supabase.co</body></html>`;
}

/** A pausa da nova tentativa da sonda, sem dormir (os testes não esperam 7 s). */
const semEspera = async () => {};

function resposta({ status = 200, corpo = "", cabecalhos = {} } = {}) {
  return new Response(corpo, { status, headers: cabecalhos });
}

/** fetch falso: roteia por caminho; as amostras de "/" chegam como `?t=<agora>-<i>`. */
function fetchFalso({ versao, pagina, redirect }) {
  return async (url) => {
    const u = new URL(url);
    if (u.pathname === "/version.json") return versao();
    if (u.pathname === "/") {
      const i = Number(u.searchParams.get("t").split("-")[1]);
      return pagina(i);
    }
    return redirect();
  };
}

const paginaOk = (_i, extra = {}) =>
  resposta({
    cabecalhos: { "x-ikcous-caderneta": "hit", "x-ikcous-porteiro": "ok" },
    corpo: paginaHtml(extra),
  });

Deno.test("sonda: version.json com HTTP diferente de 200 NUNCA vira versão, mesmo se o corpo for um JSON válido", async () => {
  const sonda = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl: fetchFalso({
      versao: () =>
        resposta({ status: 404, corpo: JSON.stringify(versaoDe()) }),
      pagina: (i) => paginaOk(i),
    }),
  });
  assertEquals(sonda.versao, null);
  assertEquals(sonda.erroVersao, "version.json respondeu HTTP 404");
});

Deno.test("sonda: o tipo do erro de rede aparece na mensagem (timeout, causa, sem causa)", async () => {
  const casos = [
    [new DOMException("x", "TimeoutError"), "version.json: timeout"],
    [new DOMException("x", "AbortError"), "version.json: timeout"],
    [
      Object.assign(new Error("falhou"), { cause: { code: "ECONNRESET" } }),
      "version.json: erro de rede (ECONNRESET)",
    ],
    [
      Object.assign(new Error("falhou"), { cause: { message: "dns" } }),
      "version.json: erro de rede (dns)",
    ],
    [new Error("falhou"), "version.json: erro de rede"],
  ];
  for (const [erro, esperado] of casos) {
    const sonda = await sondarEndereco("a.example.app", {
      agora: NOW,
      esperar: semEspera,
      fetchImpl: fetchFalso({
        versao: () => {
          throw erro;
        },
        pagina: (i) => paginaOk(i),
      }),
    });
    assertEquals(sonda.erroVersao, esperado);
    assertEquals(sonda.versao, null);
  }
});

Deno.test("sonda: cada amostra de '/' que falha é numerada a partir de 1 e a ficha não existe sem nenhuma amostra", async () => {
  const sonda = await sondarEndereco("a.example.app", {
    agora: NOW,
    esperar: semEspera,
    fetchImpl: fetchFalso({
      versao: () => resposta({ corpo: JSON.stringify(versaoDe()) }),
      pagina: () => {
        throw new Error("rede");
      },
    }),
  });
  assertEquals(sonda.errosPagina, [
    "amostra 1 da página: erro de rede",
    "amostra 2 da página: erro de rede",
    "amostra 3 da página: erro de rede",
  ]);
  assertEquals(sonda.ficha, null);
  assertEquals(sonda.amostras, []);
  assertEquals(sonda.versao, versaoDe());
});

Deno.test("sonda: a ficha vem da PRIMEIRA amostra e fica instável se qualquer outra divergir", async () => {
  const divergente = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl: fetchFalso({
      versao: () => resposta({ corpo: JSON.stringify(versaoDe()) }),
      pagina: (i) => paginaOk(i, { titulo: i === 0 ? "Primeira" : "Outra" }),
    }),
  });
  assertEquals(divergente.ficha.titulo, "Primeira");
  assertEquals(divergente.ficha.estavel, false);
  const igual = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl: fetchFalso({
      versao: () => resposta({ corpo: JSON.stringify(versaoDe()) }),
      pagina: (i) => paginaOk(i),
    }),
  });
  assertEquals(igual.ficha.estavel, true);
  assertEquals(igual.ficha.refs, [REF_A]);
  assertEquals(igual.ficha.porteiro, "ok");
});

Deno.test("sonda de redirecionamento: guarda status, Location e o pedido feito; falha de rede vira erro de página", async () => {
  const ok = await sondarEndereco("velho.example.app", {
    agora: NOW,
    redirecionamento: true,
    fetchImpl: fetchFalso({
      versao: () => resposta({ corpo: JSON.stringify(versaoDe()) }),
      pagina: (i) => paginaOk(i),
      redirect: () =>
        resposta({
          status: 308,
          cabecalhos: { location: "https://novo.example.app/x" },
        }),
    }),
  });
  assertEquals(ok.redirecionamento.status, 308);
  assertEquals(ok.redirecionamento.location, "https://novo.example.app/x");
  assertEquals(
    ok.redirecionamento.pedido,
    `/produto/frota-conferencia?y=1&t=${NOW}`,
  );
  const falha = await sondarEndereco("velho.example.app", {
    agora: NOW,
    redirecionamento: true,
    esperar: semEspera,
    fetchImpl: fetchFalso({
      versao: () => resposta({ corpo: JSON.stringify(versaoDe()) }),
      pagina: (i) => paginaOk(i),
      redirect: () => {
        throw new DOMException("x", "TimeoutError");
      },
    }),
  });
  assertEquals(falha.redirecionamento, null);
  assertEquals(falha.errosPagina, ["sonda de redirecionamento: timeout"]);
});

// ---------------------------------------------- nova tentativa da sonda
// Com 300-600 endereços x 4 pedidos, um tropeço de rede à toa NÃO pode virar
// INALCANCAVEL (antes do promote bloqueia o ensaio; depois assusta o dono com
// um "FALHOU"). Só tropeço (rede, tempo esgotado, 5xx no version.json) se
// repete; resposta que contradiz (404, não-JSON, versão velha) fica como veio.

/**
 * fetch com roteiro POR PEDIDO: a n-ésima chamada a "/version.json" usa
 * roteiro["/version.json"][n] (o último se repete). A amostra i de "/" tem a
 * chave "/#i" (cai em roteiro["/"] se não houver), e o resto vai em "*".
 * `contagem[chave]` = quantas vezes aquele pedido foi feito.
 */
function fetchComRoteiro(roteiro) {
  const pedidos = [];
  const contagem = {};
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const chave =
      u.pathname === "/"
        ? `/#${u.searchParams.get("t").split("-")[1]}`
        : u.pathname;
    pedidos.push(`${chave}?t=${u.searchParams.get("t")}`);
    const lista = roteiro[chave] ?? roteiro[u.pathname] ?? roteiro["*"];
    const n = contagem[chave] ?? 0;
    contagem[chave] = n + 1;
    const passo = lista[Math.min(n, lista.length - 1)];
    const r = passo();
    if (r instanceof Error || r instanceof DOMException) throw r;
    return r;
  };
  return { fetchImpl, pedidos, contagem };
}

const rede = () => new TypeError("fetch failed");
const tempo = () => new DOMException("x", "TimeoutError");
const versaoOk =
  (sha = SHA) =>
  () =>
    resposta({ corpo: JSON.stringify(versaoDe(sha)) });
const paginaBoa = () => paginaOk(0);

const CTX_DA_SONDA = {
  shaEsperado: SHA,
  identidadeRef: IDENT,
  codeVersionRef: "1.5.18",
  cruzado: {},
  canonicos: new Set(),
};

function relogio() {
  const esperas = [];
  return { esperas, esperar: async (ms) => void esperas.push(ms) };
}

Deno.test("nova tentativa: tropeço ÚNICO no version.json, numa amostra e no redirecionamento se recupera, com carimbo novo e pausa de 2 s injetada", async () => {
  const { fetchImpl, pedidos, contagem } = fetchComRoteiro({
    "/version.json": [() => rede(), versaoOk()],
    "/#1": [() => tempo(), paginaBoa],
    "/": [paginaBoa],
    "*": [
      () => rede(),
      () =>
        resposta({
          status: 308,
          cabecalhos: { location: "https://novo.example.app/x" },
        }),
    ],
  });
  const { esperas, esperar } = relogio();
  const sonda = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl,
    esperar,
    redirecionamento: true,
  });
  assertEquals(sonda.erroVersao, null);
  assertEquals(sonda.versao, versaoDe());
  assertEquals(sonda.errosPagina, []);
  assertEquals(sonda.amostras.length, 3);
  assertEquals(sonda.ficha.estavel, true);
  assertEquals(sonda.redirecionamento.status, 308);
  // o Location é conferido contra o pedido QUE RESPONDEU (o da nova tentativa)
  assertEquals(
    sonda.redirecionamento.pedido,
    `/produto/frota-conferencia?y=1&t=${NOW}-n1`,
  );
  assertEquals(esperas, [2000, 2000, 2000]);
  assertEquals(contagem["/version.json"], 2);
  assertEquals(contagem["/#0"], 1);
  assertEquals(contagem["/#1"], 2);
  assertEquals(contagem["/#2"], 1);
  // a nova tentativa pede com carimbo NOVO (não cai no mesmo cache)
  assert(pedidos.includes(`/version.json?t=${NOW}-n1`), pedidos.join(" "));
  assert(pedidos.includes(`/#1?t=${NOW}-1-n1`), pedidos.join(" "));
  // e quem classifica não vê mais nada de alcance
  const { achados } = classificar(
    { dominio: "a.example.app", esperado: null },
    sonda,
    CTX_DA_SONDA,
  );
  assertEquals(
    achados.filter((a) => a.classe === "INALCANCAVEL"),
    [],
  );
});

Deno.test("nova tentativa: 3 falhas seguidas (rede ou 5xx no version.json) = INALCANCAVEL, depois de pausas de 2 s e 5 s, e só 3 pedidos", async () => {
  for (const [falha, motivo] of [
    [() => rede(), "version.json: erro de rede"],
    [() => tempo(), "version.json: timeout"],
    [() => resposta({ status: 503 }), "version.json respondeu HTTP 503"],
    [() => resposta({ status: 500 }), "version.json respondeu HTTP 500"],
  ]) {
    const { fetchImpl, contagem } = fetchComRoteiro({
      "/version.json": [falha],
      "/": [paginaBoa],
    });
    const { esperas, esperar } = relogio();
    const sonda = await sondarEndereco("a.example.app", {
      agora: NOW,
      fetchImpl,
      esperar,
    });
    assertEquals(sonda.erroVersao, motivo);
    assertEquals(sonda.versao, null);
    assertEquals(contagem["/version.json"], 3, motivo);
    assertEquals(esperas, [2000, 5000], motivo);
    const { classe } = classificar(
      { dominio: "a.example.app", esperado: null },
      sonda,
      CTX_DA_SONDA,
    );
    assertEquals(classe, "INALCANCAVEL", motivo);
  }
  // as 3 amostras de "/" caídas nas 3 tentativas: ficha nenhuma, erro numerado
  const { fetchImpl, contagem } = fetchComRoteiro({
    "/version.json": [versaoOk()],
    "/": [() => rede()],
  });
  const { esperas, esperar } = relogio();
  const sonda = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl,
    esperar,
  });
  assertEquals(sonda.ficha, null);
  assertEquals(sonda.errosPagina, [
    "amostra 1 da página: erro de rede",
    "amostra 2 da página: erro de rede",
    "amostra 3 da página: erro de rede",
  ]);
  assertEquals([contagem["/#0"], contagem["/#1"], contagem["/#2"]], [3, 3, 3]);
  assertEquals(esperas, [2000, 2000, 2000, 5000, 5000, 5000]);
});

Deno.test("nova tentativa: o 5xx que tropeçou uma vez e depois respondeu certo se recupera", async () => {
  const { fetchImpl } = fetchComRoteiro({
    "/version.json": [() => resposta({ status: 502 }), versaoOk()],
    "/": [paginaBoa],
  });
  const { esperar } = relogio();
  const sonda = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl,
    esperar,
  });
  assertEquals(sonda.erroVersao, null);
  assertEquals(sonda.versao, versaoDe());
});

Deno.test("nova tentativa: resposta que CONTRADIZ não é re-sondada para virar ok (404, não-JSON, versão velha); tropeço seguido de versão velha fica com a velha", async () => {
  for (const [primeira, esperado] of [
    [
      () => resposta({ status: 404 }),
      { erroVersao: "version.json respondeu HTTP 404" },
    ],
    [
      () => resposta({ corpo: "{quebrado" }),
      { erroVersao: "version.json não é JSON" },
    ],
    [versaoOk(VELHO), { versao: versaoDe(VELHO) }],
  ]) {
    const { fetchImpl, contagem } = fetchComRoteiro({
      // a 2ª resposta seria a "boa": se alguém repetir, o teste vê
      "/version.json": [primeira, versaoOk()],
      "/": [paginaBoa],
    });
    const { esperas, esperar } = relogio();
    const sonda = await sondarEndereco("a.example.app", {
      agora: NOW,
      fetchImpl,
      esperar,
    });
    assertEquals(contagem["/version.json"], 1, JSON.stringify(esperado));
    assertEquals(esperas, []);
    assertEquals(sonda.erroVersao, esperado.erroVersao ?? null);
    assertEquals(sonda.versao, esperado.versao ?? null);
  }
  // tropeço e depois versão velha: vale a velha (o pior), sem 3ª tentativa
  const { fetchImpl, contagem } = fetchComRoteiro({
    "/version.json": [() => tempo(), versaoOk(VELHO), versaoOk()],
    "/": [paginaBoa],
  });
  const { esperas, esperar } = relogio();
  const sonda = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl,
    esperar,
  });
  assertEquals(sonda.versao, versaoDe(VELHO));
  assertEquals(contagem["/version.json"], 2);
  assertEquals(esperas, [2000]);
  const { classe } = classificar(
    { dominio: "a.example.app", esperado: null },
    sonda,
    CTX_DA_SONDA,
  );
  assertEquals(classe, "ENDERECO_ANTIGO");
});

Deno.test("tropeço marcado: a sonda diz QUAL pedido tropeçou (rede, tempo, 5xx) e o achado leva tropecouEm; resposta que contradiz (404, não-JSON) não leva", async () => {
  const sondar = async (roteiro, redirecionamento = false) => {
    const { fetchImpl } = fetchComRoteiro(roteiro);
    const { esperar } = relogio();
    const sonda = await sondarEndereco("a.example.app", {
      agora: NOW,
      fetchImpl,
      esperar,
      redirecionamento,
    });
    const { achados } = classificar(
      { dominio: "a.example.app", esperado: null },
      sonda,
      CTX_DA_SONDA,
    );
    return {
      sonda,
      alcance: achados.filter((a) => a.classe === "INALCANCAVEL"),
    };
  };
  for (const falha of [
    () => rede(),
    () => tempo(),
    () => resposta({ status: 503 }),
  ]) {
    const { sonda, alcance } = await sondar({
      "/version.json": [falha],
      "/": [paginaBoa],
    });
    assertEquals(sonda.versaoTropecou, true);
    assertEquals(alcance.length, 1);
    assertEquals(alcance[0].tropecouEm, "version.json");
  }
  for (const contradiz of [
    () => resposta({ status: 404 }),
    () => resposta({ corpo: "<!doctype html><title>x</title>" }),
  ]) {
    const { sonda, alcance } = await sondar({
      "/version.json": [contradiz],
      "/": [paginaBoa],
    });
    assertEquals(sonda.versaoTropecou, false);
    assertEquals(alcance.length, 1);
    assert(!("tropecouEm" in alcance[0]), JSON.stringify(alcance[0]));
  }
  // as amostras de "/" e a sonda de redirecionamento: cada erro com o seu pedido
  const { sonda, alcance } = await sondar(
    {
      "/version.json": [versaoOk()],
      "/#1": [() => tempo()],
      "/": [paginaBoa],
      "*": [() => rede()],
    },
    true,
  );
  assertEquals(sonda.versaoTropecou, false);
  assertEquals(sonda.errosPagina, [
    "sonda de redirecionamento: erro de rede",
    "amostra 2 da página: timeout",
  ]);
  assertEquals(sonda.errosPaginaTropecouEm, ["redirecionamento", "/"]);
  assertEquals(
    alcance.map((a) => a.tropecouEm),
    ["redirecionamento", "/"],
  );
  // sonda montada à mão, sem a marca: nenhum achado vira tropeço (lado seguro)
  const { achados } = classificar(
    { dominio: "a.example.app", esperado: null },
    {
      ...sonda,
      versaoTropecou: undefined,
      erroVersao: "version.json: timeout",
      errosPaginaTropecouEm: undefined,
    },
    CTX_DA_SONDA,
  );
  assert(
    achados.every((a) => !("tropecouEm" in a)),
    JSON.stringify(achados),
  );
});

Deno.test("nova tentativa: página que RESPONDE com 5xx (503 de loja adormecida/manutenção) é estado, não tropeço: não se repete", async () => {
  const { fetchImpl, contagem } = fetchComRoteiro({
    "/version.json": [versaoOk()],
    "/": [() => resposta({ status: 503 }), paginaBoa],
  });
  const { esperas, esperar } = relogio();
  const sonda = await sondarEndereco("a.example.app", {
    agora: NOW,
    fetchImpl,
    esperar,
  });
  assertEquals([contagem["/#0"], contagem["/#1"], contagem["/#2"]], [1, 1, 1]);
  assertEquals(esperas, []);
  assertEquals(sonda.ficha.status, 503);
});

Deno.test("nova tentativa: inventariar e conferirFrota repassam a espera injetada (nenhum teste dorme de verdade)", async () => {
  const { fetchImpl, contagem } = fetchComRoteiro({
    "/version.json": [() => rede(), versaoOk()],
    "/": [paginaBoa],
  });
  const { esperas, esperar } = relogio();
  const inv = await inventariar(
    { enderecosEsperados: [], enderecosDeReserva: ["a.example.app"] },
    { fetchImpl, esperar, agora: NOW },
  );
  assertEquals(inv.sondas[0].versao, versaoDe());
  assertEquals(inv.sondas[0].erroVersao, null);
  assertEquals(contagem["/version.json"], 2);
  assertEquals(esperas, [2000]);
});

// ------------------------------------------------- maioria e agrupamento

Deno.test("maioriaEstrita: só mais da metade vale; empate e metade exata são null", () => {
  assertEquals(maioriaEstrita([]), null);
  assertEquals(maioriaEstrita(["a", "a", "b"]), "a");
  assertEquals(maioriaEstrita(["a", "b"]), null);
  assertEquals(maioriaEstrita(["a", "a", "b", "b"]), null);
  assertEquals(maioriaEstrita(["a"]), "a");
});

Deno.test("agruparPorSha: o grupo com mais endereços vem primeiro; empate desempata pelo SHA em ordem crescente", () => {
  const s = (dominio, sha) => ({ dominio, versao: versaoDe(sha) });
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const C = "c".repeat(40);
  // mesma quantidade: B antes de A na entrada, A tem de vir primeiro na saída
  assertEquals(
    agruparPorSha([s("1", B), s("2", A)]).map((g) => g.sha),
    [A, B],
  );
  // C tem 2 endereços: vence quem tem menos SHA "menor"
  assertEquals(
    agruparPorSha([s("1", A), s("2", C), s("3", C)]).map((g) => g.sha),
    [C, A],
  );
  // sem versão ou com SHA inválido não entra em grupo nenhum
  assertEquals(
    agruparPorSha([{ dominio: "x", versao: null }, s("y", "nope")]),
    [],
  );
});

// --------------------------------------------------------- verificarCanonico

function lojaSondada(
  dominio,
  { refs = [REF_A], publicUrl, status = 200, caderneta = "hit" } = {},
) {
  return {
    dominio,
    ficha: {
      status,
      caderneta,
      titulo: "Loja",
      refs,
      publicUrl,
      estavel: true,
    },
  };
}

const motivosDo = (achados, dominio) =>
  (achados[dominio] ?? []).map((a) => a.motivo);

Deno.test("canônico: ficha sem publicUrl e publicUrl que nem é URL geram UM achado cada, com o motivo exato", () => {
  const { achados } = verificarCanonico([
    lojaSondada("sem.example.app", { publicUrl: null }),
    lojaSondada("lixo.example.app", { publicUrl: "isto nao e url" }),
  ]);
  assertEquals(motivosDo(achados, "sem.example.app"), [
    "ficha sem publicUrl (cadastro sem dominio_publico)",
  ]);
  assertEquals(motivosDo(achados, "lixo.example.app"), [
    "publicUrl inválido na ficha (isto nao e url)",
  ]);
});

Deno.test("canônico: cada defeito de formato (http, credencial, query, hash, caminho) reprova SOZINHO e com um achado só", () => {
  const ruins = [
    "http://x.example.app",
    "https://usuario@x.example.app/",
    "https://:senha@x.example.app/",
    "https://x.example.app/?a=1",
    "https://x.example.app/#h",
    "https://x.example.app/caminho",
  ];
  for (const publicUrl of ruins) {
    const { achados, canonicos } = verificarCanonico([
      lojaSondada("a.example.app", { publicUrl }),
      // o destino NÃO responde 200: se a checagem de formato não parasse a
      // análise, o endereço ganharia um SEGUNDO achado (destino ruim)
      lojaSondada("x.example.app", {
        publicUrl: "https://x.example.app/",
        status: 503,
      }),
    ]);
    assertEquals(
      motivosDo(achados, "a.example.app"),
      [`publicUrl fora do formato https://host (${publicUrl})`],
      publicUrl,
    );
    assertEquals([...canonicos], [], publicUrl);
  }
});

Deno.test("canônico: destino fora do inventário, que não responde 200 hit ou que serve OUTRA loja — um achado e o motivo certo para cada", () => {
  const origem = (publicUrl, refs = [REF_A]) =>
    lojaSondada("a.example.app", { publicUrl, refs });
  const sozinho = (sondas) =>
    verificarCanonico(sondas).achados["a.example.app"];

  assertEquals(
    sozinho([origem("https://fora.example.app/")]).map((a) => a.motivo),
    [
      "publicUrl aponta para fora.example.app, que não é endereço do inventário",
    ],
  );

  for (const [destino, texto] of [
    [{ status: 503 }, "HTTP 503, caderneta hit"],
    [{ caderneta: "miss" }, "HTTP 200, caderneta miss"],
  ]) {
    assertEquals(
      sozinho([
        origem("https://d.example.app/"),
        lojaSondada("d.example.app", {
          publicUrl: "https://d.example.app/",
          ...destino,
        }),
      ]).map((a) => a.motivo),
      [
        `publicUrl aponta para d.example.app, que não responde 200 hit (${texto})`,
      ],
    );
  }
  // destino sem ficha nenhuma
  assertEquals(
    sozinho([
      origem("https://d.example.app/"),
      { dominio: "d.example.app", ficha: null },
    ]).map((a) => a.motivo),
    [
      "publicUrl aponta para d.example.app, que não responde 200 hit (HTTP -, caderneta -)",
    ],
  );

  // outra loja: cada variação sozinha reprova
  const variacoes = [
    [
      origem("https://d.example.app/"),
      lojaSondada("d.example.app", { refs: [REF_B] }),
      `ref ${REF_B}, esperado ${REF_A}`,
    ],
    [
      origem("https://d.example.app/"),
      lojaSondada("d.example.app", { refs: [REF_A, REF_B] }),
      `ref ${REF_A}+${REF_B}, esperado ${REF_A}`,
    ],
    [
      origem("https://d.example.app/", [REF_A, REF_B]),
      lojaSondada("d.example.app", { refs: [REF_A] }),
      `ref ${REF_A}, esperado ${REF_A}+${REF_B}`,
    ],
    [
      origem("https://d.example.app/"),
      lojaSondada("d.example.app", { refs: [] }),
      `ref -, esperado ${REF_A}`,
    ],
  ];
  for (const [o, d, trecho] of variacoes) {
    d.ficha.publicUrl = "https://d.example.app/";
    const motivos = (
      verificarCanonico([o, d]).achados["a.example.app"] ?? []
    ).map((a) => a.motivo);
    assertEquals(motivos.length, 1, trecho);
    assertStringIncludes(
      motivos[0],
      `o canônico d.example.app serve outra loja (${trecho})`,
    );
  }
});

Deno.test("canônico: destino certo (200, hit, mesmo ref) entra em canonicos e não gera achado", () => {
  const { achados, canonicos } = verificarCanonico([
    lojaSondada("a.example.app", { publicUrl: "https://d.example.app/" }),
    lojaSondada("d.example.app", { publicUrl: "https://d.example.app/" }),
  ]);
  assertEquals(achados, {});
  assertEquals([...canonicos], ["d.example.app"]);
});

// ------------------------------------------------------ montarContexto

function sondaComDeploy(dominio) {
  return { dominio, versao: versaoDe(), ficha: null };
}

Deno.test("deployment esperado: maioria vence, empate é ambíguo, um só é esperado sem ambiguidade, nenhum é 'desconhecido'", () => {
  const vercel = (mapa) => ({
    ok: true,
    porDominio: Object.fromEntries(
      Object.entries(mapa).map(([d, id]) => [d, { deploymentId: id }]),
    ),
  });
  const ctxDe = (mapa) =>
    montarContexto(Object.keys(mapa).map(sondaComDeploy), {
      sha: SHA,
      vercel: vercel(mapa),
    }).ctx.vercel;

  const maioria = ctxDe({ a: "dpl_A", b: "dpl_A", c: "dpl_B" });
  assertEquals(maioria.deploymentEsperado, "dpl_A");
  assertEquals(maioria.ambiguo, false);

  const empate = ctxDe({ a: "dpl_A", b: "dpl_B" });
  assertEquals(empate.deploymentEsperado, null);
  assertEquals(empate.ambiguo, true);

  const unico = ctxDe({ a: "dpl_A" });
  assertEquals(unico.deploymentEsperado, "dpl_A");
  assertEquals(unico.ambiguo, false);

  const nenhum = ctxDe({ a: null });
  assertEquals(nenhum.deploymentEsperado, undefined);
  assertEquals(nenhum.ambiguo, false);
});

// --------------------------------------------------------- classificar

const CTX = {
  shaEsperado: SHA,
  identidadeRef: IDENT,
  codeVersionRef: "1.5.18",
  cruzado: {},
  canonicos: new Set(),
};

function sondaDeLoja(versao, ficha = {}) {
  const f = {
    status: 200,
    caderneta: "hit",
    porteiro: "ok",
    titulo: "Loja",
    refs: [REF_A],
    publicUrl: null,
    estavel: true,
    ...ficha,
  };
  return {
    dominio: "a.example.app",
    versao,
    erroVersao: null,
    errosPagina: [],
    amostras: [f, f, f],
    redirecionamento: null,
    ficha: f,
  };
}

const ALVO_LOJA = { dominio: "a.example.app", esperado: null };
const comDeploy = (
  deploymentEsperado,
  ambiguo,
  deploymentDoEndereco = "dpl_X",
) => ({
  ...CTX,
  vercel: {
    porDominio: { "a.example.app": { deploymentId: deploymentDoEndereco } },
    deploymentEsperado,
    ambiguo,
  },
});
const resumo = (r) => r.achados.map((a) => `${a.classe}: ${a.motivo}`);

Deno.test("classificar: loja que serve o SHA certo, em dia, sem informação de deployment: OK sem achado nenhum", () => {
  const r = classificar(ALVO_LOJA, sondaDeLoja(versaoDe()), CTX);
  assertEquals(r, { classe: "OK", achados: [] });
});

Deno.test("classificar: mesmo SHA em OUTRO deployment é BUILD_DIVERGENTE; no deployment certo, nada", () => {
  const outro = classificar(
    ALVO_LOJA,
    sondaDeLoja(versaoDe()),
    comDeploy("dpl_E", false),
  );
  assertEquals(resumo(outro), [
    "BUILD_DIVERGENTE: mesmo SHA servido por outro deployment (dpl_X, esperado dpl_E)",
  ]);
  assertEquals(outro.classe, "BUILD_DIVERGENTE");
  const certo = classificar(
    ALVO_LOJA,
    sondaDeLoja(versaoDe()),
    comDeploy("dpl_X", false),
  );
  assertEquals(certo.achados, []);
});

Deno.test("classificar: sem maioria de deployments (ambíguo) o mesmo SHA vira BUILD_DIVERGENTE; sem ambiguidade, não", () => {
  const ambiguo = classificar(
    ALVO_LOJA,
    sondaDeLoja(versaoDe()),
    comDeploy(null, true),
  );
  assertEquals(resumo(ambiguo), [
    "BUILD_DIVERGENTE: mesmo SHA servido por deployments diferentes, sem maioria (dpl_X)",
  ]);
  assertEquals(
    classificar(ALVO_LOJA, sondaDeLoja(versaoDe()), comDeploy(null, false))
      .achados,
    [],
  );
});

Deno.test("classificar: deployment esperado 'desconhecido' (undefined) pula toda a conferência de deployment, mesmo com ambiguidade", () => {
  const r = classificar(
    ALVO_LOJA,
    sondaDeLoja(versaoDe()),
    comDeploy(undefined, true),
  );
  assertEquals(r.achados, []);
  // endereço sem deployment mapeado também não é comparado
  const semMapa = classificar(ALVO_LOJA, sondaDeLoja(versaoDe()), {
    ...comDeploy("dpl_E", false),
    vercel: { porDominio: {}, deploymentEsperado: "dpl_E", ambiguo: false },
  });
  assertEquals(semMapa.achados, []);
});

Deno.test("classificar: endereço com SHA ANTIGO é ENDERECO_ANTIGO (mensagem com os 7 primeiros) e, apontando para outro deployment, ganha o 2º achado", () => {
  const velho = sondaDeLoja(versaoDe(VELHO));
  const so = classificar(ALVO_LOJA, velho, comDeploy("dpl_X", false));
  assertEquals(resumo(so), [
    "ENDERECO_ANTIGO: serve 2222222 (1.5.18), esperado 1111111",
  ]);
  const duplo = classificar(ALVO_LOJA, velho, comDeploy("dpl_E", false));
  assertEquals(resumo(duplo), [
    "ENDERECO_ANTIGO: serve 2222222 (1.5.18), esperado 1111111",
    "ENDERECO_ANTIGO: aponta para dpl_X, não para o deployment esperado dpl_E",
  ]);
  // sem deployment esperado (ambíguo/null) não há "aponta para"
  assertEquals(
    classificar(ALVO_LOJA, velho, comDeploy(null, true)).achados.length,
    1,
  );
});

Deno.test("classificar: identidade e codeVersion só se comparam quando o SHA é o da release E o contrato está em dia", () => {
  const outraIdentidade = "f".repeat(64);
  // SHA certo, contrato certo, identidade diferente: diverge (8 primeiros na mensagem)
  const diverge = classificar(
    ALVO_LOJA,
    sondaDeLoja(
      versaoDe(SHA, {
        identityRevision: outraIdentidade,
        version: `1.5.18-sha.${SHA.slice(0, 7)}-identity.${outraIdentidade}`,
      }),
    ),
    CTX,
  );
  assertEquals(resumo(diverge), [
    "BUILD_DIVERGENTE: identityRevision ffffffff difere dos demais do mesmo SHA",
  ]);
  // SHA certo mas contrato quebrado: só o problema do contrato, sem comparar identidade
  const quebrado = classificar(
    ALVO_LOJA,
    sondaDeLoja(
      versaoDe(SHA, {
        promotable: false,
        identityRevision: outraIdentidade,
        version: `1.5.18-sha.${SHA.slice(0, 7)}-identity.${outraIdentidade}`,
        codeVersion: "1.5.18",
      }),
    ),
    CTX,
  );
  assertEquals(resumo(quebrado), [
    "BUILD_DIVERGENTE: version.json fora do contrato: promotable=false, esperado true (booleano)",
  ]);
  // SHA antigo com identidade diferente: só ENDERECO_ANTIGO
  const antigo = classificar(
    ALVO_LOJA,
    sondaDeLoja(
      versaoDe(VELHO, {
        identityRevision: outraIdentidade,
        version: `1.5.18-sha.${VELHO.slice(0, 7)}-identity.${outraIdentidade}`,
      }),
    ),
    CTX,
  );
  assertEquals(
    antigo.achados.map((a) => a.classe),
    ["ENDERECO_ANTIGO"],
  );
  // codeVersion diferente da referência
  const outraVersao = classificar(
    ALVO_LOJA,
    sondaDeLoja(
      versaoDe(SHA, {
        codeVersion: "1.5.19",
        version: `1.5.19-sha.${SHA.slice(0, 7)}-identity.${IDENT}`,
      }),
    ),
    CTX,
  );
  assertEquals(resumo(outraVersao), [
    "BUILD_DIVERGENTE: codeVersion 1.5.19 difere dos demais do mesmo SHA",
  ]);
});

Deno.test("classificar: estado esperado desconhecido na política é ESTADO_INESPERADO com o nome dele", () => {
  const r = classificar(
    { dominio: "a.example.app", esperado: "xyz" },
    sondaDeLoja(versaoDe()),
    CTX,
  );
  assertEquals(resumo(r), [
    "ESTADO_INESPERADO: estado esperado desconhecido na política: xyz",
  ]);
});

const ALVO_REDIR = {
  dominio: "velho.example.app",
  esperado: "redirecionamento",
  para: "novo.example.app",
};
const sondaRedir = (extra = {}) => ({
  dominio: "velho.example.app",
  versao: versaoDe(),
  erroVersao: null,
  errosPagina: [],
  amostras: [],
  ficha: { status: 308, caderneta: null, estavel: true, refs: [] },
  redirecionamento: null,
  ...extra,
});

Deno.test("redirecionamento: sem sonda de redirecionamento e sem erro de sondagem é CANONICO_INVALIDO; com erro de sondagem (mesmo misturado a outros) só o erro", () => {
  const sem = classificar(ALVO_REDIR, sondaRedir(), CTX);
  assertEquals(resumo(sem), [
    "CANONICO_INVALIDO: redirecionamento não foi sondado",
  ]);
  const falhou = classificar(
    ALVO_REDIR,
    sondaRedir({
      errosPagina: [
        "sonda de redirecionamento: timeout",
        "amostra 1 da página: timeout",
      ],
    }),
    CTX,
  );
  assertEquals(
    falhou.achados.map((a) => a.classe),
    ["INALCANCAVEL", "INALCANCAVEL"],
  );
});

Deno.test("redirecionamento: 308 SEM Location é 'sem cabeçalho Location' (não 'Location inválido')", () => {
  const r = classificar(
    ALVO_REDIR,
    sondaRedir({
      redirecionamento: { status: 308, location: null, pedido: "/p?y=1" },
    }),
    CTX,
  );
  assertEquals(resumo(r), ["CANONICO_INVALIDO: 308 sem cabeçalho Location"]);
});

// ----------------------------------------------------- consultarVercel

const POLITICA = { projetoVercel: { id: "prj_X", time: "team_Y" } };
const aliasOk = (alias, extra = {}) => ({
  alias,
  deploymentId: "dpl_A",
  projectId: "prj_X",
  ...extra,
});

/** executor falso: `paginas` é a fila de respostas de /v4/aliases?; o resto por rota. */
function executorFalso({ paginas, projeto, porAlias = {} }) {
  const chamadas = { paginas: [], alias: [], projeto: 0 };
  const executor = async (caminho) => {
    if (caminho.startsWith("/v4/aliases?")) {
      chamadas.paginas.push(caminho);
      const p = paginas[chamadas.paginas.length - 1];
      if (p instanceof Error) throw p;
      return typeof p === "function" ? p(chamadas.paginas.length - 1) : p;
    }
    if (caminho.startsWith("/v4/aliases/")) {
      const dominio = decodeURIComponent(
        caminho.slice("/v4/aliases/".length).split("?")[0],
      );
      chamadas.alias.push(dominio);
      const r = porAlias[dominio];
      if (r instanceof Error) throw r;
      return r;
    }
    chamadas.projeto++;
    if (projeto instanceof Error) throw projeto;
    return projeto ?? { targets: { production: { id: "dpl_A" } } };
  };
  return { executor, chamadas };
}

Deno.test("aliases: `pagination.next` só pode ser texto, número, null ou ausente", async () => {
  for (const next of [true, {}, [], false]) {
    const { executor } = executorFalso({
      paginas: [{ aliases: [aliasOk("a.example.app")], pagination: { next } }],
    });
    const r = await consultarVercel(POLITICA, [], executor);
    assertEquals(r.ok, false, JSON.stringify(next));
    assertEquals(
      r.erro,
      "página 1 da lista de aliases fora do contrato: pagination.next fora do formato",
    );
  }
  for (const next of [undefined, null, 5, "7"]) {
    const { executor } = executorFalso({
      paginas: [
        { aliases: [aliasOk("a.example.app")], pagination: { next } },
        { aliases: [aliasOk("b.example.app")], pagination: {} },
      ],
    });
    const r = await consultarVercel(POLITICA, [], executor);
    assertEquals(r.ok, true, JSON.stringify(next));
  }
});

Deno.test("aliases: um item ruim no meio da página (sem alias, vazio, não-objeto, número) reprova a página inteira", async () => {
  for (const ruim of [{}, { alias: "" }, { alias: 5 }, null, "texto", [1]]) {
    const { executor } = executorFalso({
      paginas: [
        {
          aliases: [aliasOk("a.example.app"), ruim],
          pagination: { next: null },
        },
      ],
    });
    const r = await consultarVercel(POLITICA, [], executor);
    assertEquals(r.ok, false, JSON.stringify(ruim));
    assertEquals(
      r.erro,
      "página 1 da lista de aliases fora do contrato: item de `aliases` sem `alias` em texto",
    );
  }
});

Deno.test("aliases: o teto é de 60 páginas — no 60º pedido a lista sai INCOMPLETA (nunca completa) e o 61º não acontece", async () => {
  const { executor, chamadas } = executorFalso({
    paginas: Array.from({ length: 100 }, (_, i) => ({
      aliases: [aliasOk(`a${i}.example.app`)],
      pagination: { next: 1000 - i },
    })),
  });
  const r = await consultarVercel(POLITICA, [], executor);
  assertEquals(r.ok, true);
  assertEquals(chamadas.paginas.length, 60);
  assertEquals(r.aliasesProjeto.length, 60);
  assertEquals(r.listaCompleta, false);
  assert(
    r.avisos.some((a) => a.includes("lista de aliases do projeto INCOMPLETA")),
  );
});

Deno.test("aliases: acabar exatamente na página 60 (sem next) ainda é lista COMPLETA", async () => {
  const { executor, chamadas } = executorFalso({
    paginas: Array.from({ length: 60 }, (_, i) => ({
      aliases: [aliasOk(`a${i}.example.app`)],
      pagination: { next: i === 59 ? null : 1000 - i },
    })),
  });
  const r = await consultarVercel(POLITICA, [], executor);
  assertEquals(chamadas.paginas.length, 60);
  assertEquals(r.listaCompleta, true);
});

Deno.test("aliases: o 'until' da página seguinte é next+1 (o alias que empata com o último não se perde)", async () => {
  const { executor, chamadas } = executorFalso({
    paginas: [
      { aliases: [aliasOk("a.example.app")], pagination: { next: 1000 } },
      { aliases: [aliasOk("b.example.app")], pagination: { next: "2000" } },
      {
        aliases: [aliasOk("c.example.app")],
        pagination: { next: "token-opaco" },
      },
      { aliases: [aliasOk("d.example.app")], pagination: {} },
    ],
  });
  await consultarVercel(POLITICA, [], executor);
  assertEquals(chamadas.paginas.length, 4);
  assertStringIncludes(chamadas.paginas[1], "&until=1001");
  assertStringIncludes(chamadas.paginas[2], "&until=2001");
  assertStringIncludes(chamadas.paginas[3], "&until=token-opaco");
  assert(!chamadas.paginas[0].includes("until"));
});

Deno.test("aliases: falha de rede na 2ª página deixa a lista INCOMPLETA e diz qual página; falha na 1ª é ok:false", async () => {
  const { executor } = executorFalso({
    paginas: [
      { aliases: [aliasOk("a.example.app")], pagination: { next: 5 } },
      new Error("boom"),
    ],
  });
  const r = await consultarVercel(POLITICA, [], executor);
  assertEquals(r.ok, true);
  assertEquals(r.listaCompleta, false);
  assert(
    r.avisos.includes("página 2 dos aliases falhou: boom"),
    r.avisos.join("|"),
  );

  const primeira = await consultarVercel(
    POLITICA,
    [],
    executorFalso({ paginas: [new Error("sem rede")] }).executor,
  );
  assertEquals(primeira, {
    ok: false,
    erro: "aliases do projeto não listados: sem rede",
  });
});

Deno.test("aliases: página malformada na 2ª posição é ok:false citando 'página 2'", async () => {
  const { executor } = executorFalso({
    paginas: [
      { aliases: [aliasOk("a.example.app")], pagination: { next: 5 } },
      { aliases: "não é lista", pagination: {} },
    ],
  });
  const r = await consultarVercel(POLITICA, [], executor);
  assertEquals(r, {
    ok: false,
    erro: "página 2 da lista de aliases fora do contrato: resposta sem `aliases` em array",
  });
});

Deno.test("aliases: página que só repete o que já veio NÃO avança — lista incompleta, com o número da página", async () => {
  const repetida = {
    aliases: [aliasOk("a.example.app")],
    pagination: { next: 5 },
  };
  const { executor, chamadas } = executorFalso({
    paginas: [repetida, repetida, repetida],
  });
  const r = await consultarVercel(POLITICA, [], executor);
  assertEquals(chamadas.paginas.length, 2);
  assertEquals(r.listaCompleta, false);
  assert(
    r.avisos.includes("página 2 dos aliases não trouxe nada novo"),
    r.avisos.join("|"),
  );
});

Deno.test("aliases: alias fora do contrato reprova nomeando só os 3 primeiros e contando os outros", async () => {
  const ruins = ["r1", "r2", "r3", "r4"].map((n) =>
    aliasOk(`${n}.example.app`, { projectId: "prj_OUTRO" }),
  );
  const quatro = await consultarVercel(
    POLITICA,
    [],
    executorFalso({ paginas: [{ aliases: ruins, pagination: {} }] }).executor,
  );
  assertEquals(quatro.ok, false);
  assertEquals(
    quatro.erro,
    "alias fora do contrato (sem deploymentId ou de outro projeto): r1.example.app (projectId prj_OUTRO), r2.example.app (projectId prj_OUTRO), r3.example.app (projectId prj_OUTRO) e mais 1",
  );
  const tres = await consultarVercel(
    POLITICA,
    [],
    executorFalso({ paginas: [{ aliases: ruins.slice(0, 3), pagination: {} }] })
      .executor,
  );
  assert(!tres.erro.includes("e mais"), tres.erro);
});

Deno.test("aliases: o motivo distingue 'sem deploymentId dpl_*' de 'projectId ausente'", async () => {
  const r = await consultarVercel(
    POLITICA,
    [],
    executorFalso({
      paginas: [
        {
          aliases: [
            aliasOk("a.example.app", { deploymentId: "lixo" }),
            { alias: "b.example.app", deploymentId: "dpl_A" },
          ],
          pagination: {},
        },
      ],
    }).executor,
  );
  assertStringIncludes(r.erro, "a.example.app (sem deploymentId dpl_*)");
  assertStringIncludes(r.erro, "b.example.app (projectId ausente)");
});

Deno.test("aliases: preview (qualquer dos padrões da política) fica fora da conferência de contrato", async () => {
  const politica = {
    ...POLITICA,
    aliasesDePreview: ["^um-.+\\.app$", "^dois-.+\\.app$"],
  };
  const r = await consultarVercel(
    politica,
    [],
    executorFalso({
      paginas: [
        {
          aliases: [
            aliasOk("real.example.app"),
            { alias: "um-x.app", deploymentId: "lixo" },
            { alias: "dois-y.app", projectId: "outro" },
          ],
          pagination: {},
        },
      ],
    }).executor,
  );
  assertEquals(r.ok, true, r.erro);
});

Deno.test("aliases: extras são resolvidos um a um — só os que faltam, só os de formato válido, e só valem os do projeto com deployment dpl_*", async () => {
  const { executor, chamadas } = executorFalso({
    paginas: [{ aliases: [aliasOk("ja.example.app")], pagination: {} }],
    porAlias: {
      "novo.example.app": { projectId: "prj_X", deploymentId: "dpl_N" },
      "outro.example.app": { projectId: "prj_OUTRO", deploymentId: "dpl_N" },
      "semdpl.example.app": { projectId: "prj_X", deploymentId: "lixo" },
      "falha.example.app": new Error("404"),
    },
  });
  const r = await consultarVercel(
    POLITICA,
    [
      "ja.example.app",
      "novo.example.app",
      "novo.example.app",
      "outro.example.app",
      "semdpl.example.app",
      "falha.example.app",
      "isto nao e dominio",
    ],
    executor,
  );
  assertEquals(r.ok, true);
  assertEquals([...chamadas.alias].sort(), [
    "falha.example.app",
    "novo.example.app",
    "outro.example.app",
    "semdpl.example.app",
  ]);
  assertEquals(r.porDominio["ja.example.app"], { deploymentId: "dpl_A" });
  assertEquals(r.porDominio["novo.example.app"], { deploymentId: "dpl_N" });
  for (const d of [
    "outro.example.app",
    "semdpl.example.app",
    "falha.example.app",
  ])
    assertEquals(r.porDominio[d], { deploymentId: null }, d);
  assert(!("isto nao e dominio" in r.porDominio));
  assertEquals(r.avisos.length, 3);
});

Deno.test("aliases: produção oficial ilegível ou sem dpl_* é ok:false (nunca 'sem produção' calado)", async () => {
  const falha = await consultarVercel(
    POLITICA,
    [],
    executorFalso({
      paginas: [{ aliases: [aliasOk("a.example.app")], pagination: {} }],
      projeto: new Error("boom"),
    }).executor,
  );
  assertEquals(falha, { ok: false, erro: "produção oficial não lida: boom" });
  const semId = await consultarVercel(
    POLITICA,
    [],
    executorFalso({
      paginas: [{ aliases: [aliasOk("a.example.app")], pagination: {} }],
      projeto: { targets: { production: { id: "lixo" } } },
    }).executor,
  );
  assertEquals(semId.ok, false);
  assertStringIncludes(semId.erro, "produção oficial desconhecida");
});

// ------------------------------------------------ ficha instável, ref, política

Deno.test("classificar: amostras que divergem viram LOJA_TROCADA e o resumo mostra '-' onde falta ref ou título", () => {
  const sonda = sondaDeLoja(versaoDe(), { estavel: false });
  sonda.amostras = [
    { caderneta: "hit", titulo: "A", refs: [] },
    { caderneta: null, titulo: null, refs: [REF_A] },
  ];
  const r = classificar(ALVO_LOJA, sonda, CTX);
  assertEquals(r.classe, "LOJA_TROCADA");
  assertEquals(
    resumo(r)[0],
    `LOJA_TROCADA: as 2 amostras de "/" divergem (caderneta/título/ref): hit/A/- | -/-/${REF_A}`,
  );
});

Deno.test("refDaLojaSondada: cada campo fora do esperado, SOZINHO, tira a loja (sem status 200, caderneta hit, UM ref e amostras estáveis não há loja)", () => {
  const boa = { status: 200, caderneta: "hit", refs: [REF_A], estavel: true };
  assertEquals(refDaLojaSondada(boa), REF_A);
  assertEquals(refDaLojaSondada({ ...boa, estavel: undefined }), REF_A);
  for (const ruim of [
    { status: 503 },
    { caderneta: "miss" },
    { caderneta: null },
    { refs: "x" },
    { refs: [] },
    { refs: [REF_A, REF_B] },
    { estavel: false },
  ]) {
    assertEquals(
      refDaLojaSondada({ ...boa, ...ruim }),
      null,
      JSON.stringify(ruim),
    );
  }
  assertEquals(refDaLojaSondada(null), null);
  assertEquals(refDaLojaSondada(undefined), null);
});

// ------------------------------------------------------ resolverCliVercel

Deno.test("resolverCliVercel: fora do Windows é o comando 'vercel'; no Windows só vale diretório do PATH com vercel.cmd E vc.js, e entrada vazia é ignorada", () => {
  assertEquals(resolverCliVercel({ plataforma: "linux" }), {
    comando: "vercel",
    prefixo: [],
  });
  const win = (env, existe) =>
    resolverCliVercel({ env, plataforma: "win32", existe, node: "node.exe" });
  assertEquals(
    win({ PATH: "C:\\bin;" }, () => true),
    {
      comando: "node.exe",
      prefixo: ["C:\\bin\\node_modules\\vercel\\dist\\vc.js"],
    },
  );
  assertEquals(win({ Path: "C:\\bin" }, () => true).comando, "node.exe");
  // entrada vazia do PATH não vira caminho relativo ao diretório de trabalho
  assertThrows(
    () => win({ PATH: ";" }, () => true),
    Error,
    "CLI vercel não encontrado",
  );
  // só o shim, sem o vc.js ao lado: não serve
  assertThrows(
    () => win({ PATH: "C:\\bin" }, (p) => p.endsWith("vercel.cmd")),
    Error,
    "CLI vercel não encontrado",
  );
});

// ------------------------------------------------------------ conferirFrota

const POLITICA_FROTA = {
  enderecosEsperados: [],
  enderecosDeReserva: [],
};

function sondaDaLoja(dominio, ref = REF_A) {
  return {
    ...sondaDeLoja(versaoDe(), {
      refs: [ref],
      publicUrl: `https://${dominio}/`,
    }),
    dominio,
  };
}

function inventarioDe({
  sondas = [sondaDaLoja("a.example.app")],
  completo = true,
  vercel = {
    ok: true,
    porDominio: { "a.example.app": { deploymentId: "dpl_A" } },
    producaoOficial: "dpl_A",
    listaCompleta: true,
    avisos: [],
  },
} = {}) {
  return {
    origem: vercel?.ok ? "vercel" : "reserva",
    completo,
    motivoParcial: completo ? null : "motivo de teste",
    dominios: sondas.map((s) => s.dominio),
    vercel,
    sondas,
  };
}

const frota = (inventarioPronto, extra = {}) =>
  conferirFrota(POLITICA_FROTA, {
    sha: SHA,
    pedirVercel: true,
    inventarioPronto,
    ...extra,
  });

Deno.test("conferirFrota: controle — com --vercel, inventário completo e todos os endereços OK, a frota passa", async () => {
  const r = await frota(inventarioDe());
  assertEquals(
    r.resultados.map((x) => x.classe),
    ["OK"],
  );
  assertEquals(r.ok, true);
  assert(!r.relatorio.includes("Cobertura da frota"));
});

Deno.test("conferirFrota: com --vercel, lista de aliases INCOMPLETA reprova mesmo com todos os endereços OK; --vercel que falhou também", async () => {
  const incompleta = await frota(inventarioDe({ completo: false }));
  assertEquals(incompleta.resultados[0].classe, "OK");
  assertEquals(incompleta.ok, false);
  assertStringIncludes(
    incompleta.relatorio,
    "inventário: PARCIAL (motivo de teste)",
  );

  const vercelFalhou = await frota(
    inventarioDe({ vercel: { ok: false, erro: "boom" }, completo: true }),
  );
  assertEquals(vercelFalhou.ok, false);
  assertStringIncludes(
    vercelFalhou.relatorio,
    "endereço→deployment: NÃO CONFERIDO (--vercel falhou: boom)",
  );
});

Deno.test("conferirFrota: SEM --vercel (modo CI) um inventário parcial não reprova por ser parcial", async () => {
  const r = await frota(inventarioDe({ completo: false, vercel: null }), {
    pedirVercel: false,
  });
  assertEquals(r.ok, true);
  assertStringIncludes(
    r.relatorio,
    "endereço→deployment: NÃO CONFERIDO (sem --vercel)",
  );
});

Deno.test("conferirFrota: loja obrigatória que não foi sondada, ou endereço sondado antes do promote e sumido depois, reprova com o motivo", async () => {
  const semB = await frota(inventarioDe(), {
    lojasObrigatorias: [{ ref: REF_B, nome: "Loja B" }],
  });
  assertEquals(semB.ok, false);
  assertStringIncludes(semB.relatorio, "## Cobertura da frota — FALHOU");
  assertStringIncludes(
    semB.relatorio,
    "a loja Loja B está cadastrada mas não foi sondada",
  );

  const comA = await frota(inventarioDe(), {
    lojasObrigatorias: [{ ref: REF_A, nome: "Loja A" }],
  });
  assertEquals(comA.ok, true);

  const sumiu = await frota(inventarioDe(), {
    dominiosDeLojasAntes: ["a.example.app", "sumiu.example.app"],
  });
  assertEquals(sumiu.ok, false);
  assertStringIncludes(
    sumiu.relatorio,
    "sumiu.example.app: endereço de loja sondado antes do promote, mas não depois",
  );
});

Deno.test("conferirFrota: --sha inválido falha ANTES de qualquer pedido de rede", async () => {
  let pedidos = 0;
  const politica = {
    enderecosEsperados: [
      { dominio: "manut.example.app", estado: "manutencao" },
    ],
  };
  await assertRejects(
    () =>
      conferirFrota(politica, {
        sha: "xyz",
        fetchImpl: async () => {
          pedidos++;
          return new Response("", { status: 503 });
        },
      }),
    Error,
    "--sha precisa ter 40 caracteres hexadecimais",
  );
  assertEquals(pedidos, 0);
});

// ------------------------------------------------------------ montarRelatorio

const RES_OK = {
  dominio: "a.example.app",
  esperado: null,
  classe: "OK",
  achados: [],
  versao: versaoDe(),
  ficha: { status: 200, caderneta: "hit", refs: [REF_A] },
};
const RES_VELHO = {
  dominio: "b.example.app",
  esperado: null,
  classe: "ENDERECO_ANTIGO",
  achados: [
    { classe: "ENDERECO_ANTIGO", motivo: "serve o velho" },
    { classe: "BUILD_DIVERGENTE", motivo: "identidade" },
  ],
  versao: versaoDe(VELHO),
  ficha: { status: 200, caderneta: "hit", refs: [REF_B] },
};
const RES_MUDO = {
  dominio: "c.example.app",
  esperado: null,
  classe: "INALCANCAVEL",
  achados: [{ classe: "INALCANCAVEL", motivo: "timeout" }],
  versao: null,
  ficha: null,
};

function relatorio(extra = {}) {
  return montarRelatorio({
    resultados: [RES_OK],
    sha: SHA,
    grupos: [{ sha: SHA, codeVersion: "1.5.18", dominios: ["a.example.app"] }],
    inventario: { completo: true, motivoParcial: null },
    vercel: null,
    vercelPedido: false,
    politica: {},
    ...extra,
  });
}

Deno.test("relatório: o grupo servido aparece com os 7 primeiros do SHA e a marca da release; sem grupo diz que ninguém respondeu", () => {
  const um = relatorio();
  assertStringIncludes(
    um,
    "- `1111111` (1.5.18): 1 endereço(s) <- release esperada: a.example.app",
  );
  assert(!um.includes("nenhum endereço respondeu"));
  const dois = relatorio({
    grupos: [
      { sha: SHA, codeVersion: "1.5.18", dominios: ["a.example.app"] },
      { sha: VELHO, codeVersion: "1.5.17", dominios: ["b.example.app"] },
    ],
  });
  assertStringIncludes(
    dois,
    "- `2222222` (1.5.17): 1 endereço(s): b.example.app",
  );
  assert(!dois.includes("2222222` (1.5.17): 1 endereço(s) <- release"));
  assertStringIncludes(
    relatorio({ grupos: [] }),
    "- (nenhum endereço respondeu version.json)",
  );
});

Deno.test("relatório: a linha do endereço mostra só os achados da classe principal e lista as outras em '(também: ...)'", () => {
  const r = relatorio({ resultados: [RES_OK, RES_VELHO] });
  assertStringIncludes(
    r,
    `| b.example.app | ${REF_B} | ENDERECO_ANTIGO | 1.5.18 (2222222) | 200 / hit | - | serve o velho; (também: BUILD_DIVERGENTE) |`,
  );
  const linhaOk = r.split("\n").find((l) => l.startsWith("| a.example.app"));
  assert(!linhaOk.includes("também"), linhaOk);
});

Deno.test("relatório: 'Como recuperar' só existe quando há classe ruim, e cada classe lista só os SEUS endereços", () => {
  const limpo = relatorio();
  assert(!limpo.includes("## Como recuperar"));
  const sujo = relatorio({ resultados: [RES_OK, RES_VELHO, RES_MUDO] });
  assertStringIncludes(sujo, "## Como recuperar");
  assertStringIncludes(
    sujo,
    "- **ENDERECO_ANTIGO** (b.example.app): promover o deployment",
  );
  assertStringIncludes(
    sujo,
    "- **INALCANCAVEL** (c.example.app): repetir a conferência",
  );
  assert(!sujo.includes("**OK**"));
});

Deno.test("relatório: o deployment da release — é/não é a produção oficial, indefinido, ou nenhum endereço serve o SHA", () => {
  const com = (vercel) => relatorio({ vercelPedido: true, vercel });
  const base = { ok: true, porDominio: {}, avisos: [] };
  assertStringIncludes(
    com({ ...base, deploymentEsperado: "dpl_A", producaoOficial: "dpl_A" }),
    "- Deployment da release: `dpl_A` — É a produção oficial do projeto (`dpl_A`).",
  );
  assertStringIncludes(
    com({ ...base, deploymentEsperado: "dpl_A", producaoOficial: "dpl_B" }),
    "- Deployment da release: `dpl_A` — NÃO É a produção oficial do projeto (`dpl_B`).",
  );
  assertStringIncludes(
    com({ ...base, deploymentEsperado: null, producaoOficial: "dpl_B" }),
    "- Deployment da release: INDEFINIDO (endereços do SHA esperado estão em deployments diferentes, sem maioria).",
  );
  const nenhum = com({
    ...base,
    deploymentEsperado: undefined,
    producaoOficial: "dpl_B",
  });
  assertStringIncludes(
    nenhum,
    "- Deployment da release: nenhum endereço serve o SHA esperado. Produção oficial do projeto: `dpl_B`.",
  );
  assert(!nenhum.includes("`undefined`"));
  assertStringIncludes(
    com({
      ...base,
      deploymentEsperado: "dpl_A",
      producaoOficial: "dpl_A",
      avisos: ["aviso x"],
    }),
    "- AVISO: aviso x",
  );
});

Deno.test("relatório: a seção de política só aparece quando há migration fora da release; loja sem backend ganha o nome na coluna da loja", () => {
  assert(!relatorio().includes("## Política"));
  const politica = {
    migrationsForaDaRelease: [
      {
        versao: "20260101000000",
        motivo: "só depois das edges",
        conferencia: "8f",
      },
    ],
    lojasSemBackendGerenciado: [{ ref: REF_B, nome: "Loja de Teste" }],
    motivoLojasSemBackendGerenciado: "descontinuada",
  };
  const r = relatorio({ resultados: [RES_OK, RES_VELHO], politica });
  assertStringIncludes(r, "## Política (para quem publica)");
  assertStringIncludes(
    r,
    "- Migration 20260101000000 fica FORA da release: só depois das edges (conferência: 8f).",
  );
  assertStringIncludes(
    r,
    "- Lojas sem backend gerenciado: Loja de Teste — descontinuada",
  );
  assertStringIncludes(r, `| Loja de Teste [${REF_B}] |`);
});

// -------------------------------------------------------------- inventariar

const POLITICA_INV = {
  projetoVercel: { id: "prj_X", time: "team_Y" },
  enderecosEsperados: [],
  aliasesDePreview: ["^preview-.+\\.app$"],
  enderecosDeReserva: ["reserva.example.app"],
};

function fetchQueAnota(hosts) {
  return async (url) => {
    hosts.add(new URL(url).host);
    return new Response("", { status: 404 });
  };
}

Deno.test("inventariar --vercel: sonda os aliases do projeto (sem preview, sem a reserva); lista completa não traz motivo de parcial", async () => {
  const hosts = new Set();
  const { executor } = executorFalso({
    paginas: [
      {
        aliases: [
          aliasOk("b.example.app"),
          aliasOk("preview-x.app"),
          aliasOk("a.example.app"),
        ],
        pagination: { next: null },
      },
    ],
  });
  const inv = await inventariar(POLITICA_INV, {
    pedirVercel: true,
    executorVercel: executor,
    fetchImpl: fetchQueAnota(hosts),
    agora: NOW,
  });
  assertEquals(inv.origem, "vercel");
  assertEquals(inv.completo, true);
  assertEquals(inv.motivoParcial, null);
  assertEquals(inv.dominios, ["a.example.app", "b.example.app"]);
  assertEquals([...hosts].sort(), ["a.example.app", "b.example.app"]);
});

Deno.test("inventariar --vercel: lista de aliases incompleta deixa o inventário PARCIAL e diz por quê", async () => {
  const { executor } = executorFalso({
    paginas: [
      { aliases: [aliasOk("a.example.app")], pagination: { next: 5 } },
      new Error("boom"),
    ],
  });
  const inv = await inventariar(POLITICA_INV, {
    pedirVercel: true,
    executorVercel: executor,
    fetchImpl: fetchQueAnota(new Set()),
    agora: NOW,
  });
  assertEquals(inv.origem, "vercel");
  assertEquals(inv.completo, false);
  assertEquals(
    inv.motivoParcial,
    "a lista de aliases da Vercel veio incompleta",
  );
});

Deno.test("inventariar: Vercel que falha cai na lista de reserva, PARCIAL, com o erro; sem --vercel o motivo é 'sem --vercel'", async () => {
  const hosts = new Set();
  const falha = await inventariar(POLITICA_INV, {
    pedirVercel: true,
    executorVercel: async () => {
      throw new Error("boom");
    },
    fetchImpl: fetchQueAnota(hosts),
    agora: NOW,
  });
  assertEquals(falha.origem, "reserva");
  assertEquals(falha.completo, false);
  assertEquals(
    falha.motivoParcial,
    "--vercel falhou: aliases do projeto não listados: boom",
  );
  assertEquals(falha.dominios, ["reserva.example.app"]);
  const sem = await inventariar(POLITICA_INV, {
    fetchImpl: fetchQueAnota(hosts),
    agora: NOW,
  });
  assertEquals(sem.motivoParcial, "sem --vercel");
  assertEquals(sem.completo, false);
});

// --------------------------------------------------------------- main (CLI)

async function capturando(corpo) {
  const logs = [];
  const erros = [];
  const log = console.log;
  const erro = console.error;
  console.log = (m) => logs.push(String(m));
  console.error = (m) => erros.push(String(m));
  try {
    return { codigo: await corpo(), logs, erros };
  } finally {
    console.log = log;
    console.error = erro;
  }
}

Deno.test("main: uso errado devolve 2 com a mensagem certa e NUNCA toca a rede", async () => {
  const semRede = {
    fetchImpl: async () => {
      throw new Error("a rede não podia ser tocada");
    },
  };
  const casos = [
    [[], "--sha é obrigatório"],
    [["--sha"], "--sha exige um valor"],
    [["--sha", "--vercel"], "--sha exige um valor"],
    [["--sha", SHA, "--json"], "--json exige um valor"],
    [["--sha", "xyz"], "--sha precisa ter 40 caracteres hexadecimais"],
    [["--sha", SHA, "--foo"], "argumento desconhecido: --foo"],
    [
      ["--sha", SHA, "--enderecos", "nao-existe-nesta-pasta.txt"],
      "nao-existe-nesta-pasta.txt",
    ],
  ];
  for (const [argv, trecho] of casos) {
    const r = await capturando(() => main(argv, {}, semRede));
    assertEquals(r.codigo, 2, argv.join(" "));
    assertStringIncludes(r.erros.join("\n"), trecho);
    assertStringIncludes(
      r.erros.join("\n"),
      "Uso: node scripts/frota/conferir-frota.mjs",
    );
  }
});

function fetchQueObserva() {
  const visto = { urls: [], abortadoDepois: [] };
  const fetchImpl = async (url, init) => {
    visto.urls.push(String(url));
    await new Promise((resolve) => setTimeout(resolve, 30));
    visto.abortadoDepois.push(init?.signal?.aborted === true);
    return new Response("", { status: 503 });
  };
  return { visto, fetchImpl };
}

Deno.test("main: frota que não responde sai com 1 (nunca 0), escreve o JSON pedido e o resumo do GitHub", async () => {
  const dir = Deno.makeTempDirSync();
  try {
    const json = `${dir}/saida.json`;
    const resumo = `${dir}/resumo.md`;
    const { fetchImpl } = fetchQueObserva();
    const r = await capturando(() =>
      main(
        ["--sha", SHA, "--json", json],
        { GITHUB_STEP_SUMMARY: resumo },
        { fetchImpl, esperar: semEspera },
      ),
    );
    assertEquals(r.codigo, 1);
    assertStringIncludes(r.logs.join("\n"), "# Conferência da frota");
    const gravado = JSON.parse(Deno.readTextFileSync(json));
    assertEquals(gravado.ok, false);
    assertEquals(gravado.sha, SHA);
    assert(
      !("relatorio" in gravado),
      "o relatório vai para o console, não para o JSON",
    );
    assertStringIncludes(
      Deno.readTextFileSync(resumo),
      "# Conferência da frota",
    );
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("main: FROTA_URL_MODELO troca o endereço sondado; FROTA_TIMEOUT_MS vale só se for número positivo", async () => {
  const modelo = fetchQueObserva();
  await capturando(() =>
    main(
      ["--sha", SHA],
      { FROTA_URL_MODELO: "http://127.0.0.1:9/{dominio}" },
      { fetchImpl: modelo.fetchImpl, esperar: semEspera },
    ),
  );
  assert(modelo.visto.urls.length > 0);
  assert(
    modelo.visto.urls.every((u) => u.startsWith("http://127.0.0.1:9/")),
    modelo.visto.urls[0],
  );

  // "1" ms: a resposta (30 ms depois) já encontra o prazo vencido
  const curto = fetchQueObserva();
  await capturando(() =>
    main(
      ["--sha", SHA],
      { FROTA_TIMEOUT_MS: "1" },
      { fetchImpl: curto.fetchImpl, esperar: semEspera },
    ),
  );
  assert(
    curto.visto.abortadoDepois.length > 0 &&
      curto.visto.abortadoDepois.every(Boolean),
  );

  // "0", negativo e lixo caem no padrão de 15 s: ninguém vence o prazo em 30 ms
  for (const valor of ["0", "-5", "abc"]) {
    const longo = fetchQueObserva();
    await capturando(() =>
      main(
        ["--sha", SHA],
        { FROTA_TIMEOUT_MS: valor },
        { fetchImpl: longo.fetchImpl, esperar: semEspera },
      ),
    );
    assert(longo.visto.abortadoDepois.length > 0, valor);
    assert(
      longo.visto.abortadoDepois.every((x) => !x),
      `FROTA_TIMEOUT_MS=${valor}`,
    );
  }
});
