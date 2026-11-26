// @ts-nocheck
/**
 * Cliente mínimo da Management API do Supabase (scripts/frota/supabase-gestao.mjs),
 * peça T2 do L4b (ligar loja nova com um comando). O que este arquivo trava:
 *
 *  - só caminhos de MODELOS fixos, só o método que o modelo permite, e o host é
 *    sempre https://api.supabase.com — nada disso vem de quem chama;
 *  - `ref` validado por ^[a-z]{20}$ ANTES de qualquer fetch;
 *  - 401/403 viram SemAcesso;
 *  - database/query: só 200/201 é sucesso, e corpo com "error" lança;
 *  - nenhuma mensagem de erro carrega o token nem o corpo cru da resposta;
 *  - prazo estourado (ou rede que cai no meio) vira ESTADO_DESCONHECIDO.
 *
 * Nenhuma chamada de rede real: todo fetch aqui é falso.
 */
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  API_GESTAO,
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  MODELOS,
  SemAcesso,
  criarClienteGestao,
} from "../scripts/frota/supabase-gestao.mjs";

const TOKEN = "sbp_oauth_TOKEN_FALSO_inventado_0123456789";
const REF = "abcdefghijklmnopqrst";
const SEGREDO_NO_CORPO = "SEGREDO-QUE-NAO-PODE-VAZAR-42";

function resposta(status, corpo, cabecalhos = {}) {
  const texto =
    corpo === undefined
      ? null
      : typeof corpo === "string"
        ? corpo
        : JSON.stringify(corpo);
  return new Response(texto, {
    status,
    headers: { "content-type": "application/json", ...cabecalhos },
  });
}

/** fetch falso: devolve as respostas na ordem e anota cada chamada. */
function fetchFalso(...respostas) {
  const chamadas = [];
  const f = (url, init = {}) => {
    chamadas.push({ url: String(url), init });
    const r = respostas.shift();
    if (typeof r === "function") return r(url, init);
    if (r === undefined) throw new Error("fetch falso sem resposta");
    return Promise.resolve(r);
  };
  f.chamadas = chamadas;
  return f;
}

/** Nada do que passa por aqui pode aparecer em nenhuma parte do erro. */
function assertSemVazamento(erro, proibidos) {
  const partes = [
    String(erro),
    String(erro?.message),
    String(erro?.stack),
    JSON.stringify(erro),
    JSON.stringify(Object.entries(erro ?? {})),
  ].join("\n");
  for (const p of proibidos) {
    assert(!partes.includes(p), `o erro vazou um trecho proibido: ${p}`);
  }
}

async function pegarErro(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("era para lançar e não lançou");
}

Deno.test("GET de modelo fixo: host fixo, Bearer e corpo lido", async () => {
  const f = fetchFalso(resposta(200, [{ slug: "org-a" }]));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const corpo = await cliente.pedir("organizacoes");
  assertEquals(corpo, [{ slug: "org-a" }]);
  assertEquals(f.chamadas.length, 1);
  assertEquals(f.chamadas[0].url, `${API_GESTAO}/v1/organizations`);
  assertEquals(f.chamadas[0].init.method, "GET");
  assertEquals(
    new Headers(f.chamadas[0].init.headers).get("authorization"),
    `Bearer ${TOKEN}`,
  );
  // redirecionamento nunca é seguido com o token junto
  assertEquals(f.chamadas[0].init.redirect, "manual");
});

Deno.test("o host é sempre api.supabase.com e todo modelo é /v1/", () => {
  assertEquals(API_GESTAO, "https://api.supabase.com");
  assert(Object.keys(MODELOS).length > 0);
  for (const [nome, m] of Object.entries(MODELOS)) {
    assert(m.caminho.startsWith("/v1/"), `${nome} fora de /v1/`);
    assert(!m.metodos.includes("DELETE"), `${nome} permite DELETE`);
  }
  assert(Object.isFrozen(MODELOS));
});

Deno.test("ref entra no caminho só depois de validado", async () => {
  const f = fetchFalso(resposta(200, { id: REF, status: "ACTIVE_HEALTHY" }));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  await cliente.pedir("projeto", { ref: REF });
  assertEquals(f.chamadas[0].url, `${API_GESTAO}/v1/projects/${REF}`);
});

Deno.test("ref inválido é recusado ANTES de qualquer fetch", async () => {
  const ruins = [
    undefined,
    "",
    "abcdefghijklmnopqrs", // 19
    "abcdefghijklmnopqrstu", // 21
    "ABCDEFGHIJKLMNOPQRST",
    "abcdefghijklmnopqrs1",
    "../../v1/organizations",
    "abcdefghijklmnopqrs/",
    "abcdefghijklmnopqrst\n",
    "abcdefghij%2fklmnopq",
    ["abcdefghijklmnopqrst"],
  ];
  for (const ref of ruins) {
    const f = fetchFalso(resposta(200, []));
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e1 = await pegarErro(() => cliente.pedir("projeto", { ref }));
    assert(e1 instanceof ErroDaGestao, `ref ${String(ref)} passou`);
    const e2 = await pegarErro(() => cliente.consultarBanco(ref, "select 1"));
    assert(e2 instanceof ErroDaGestao);
    assertEquals(f.chamadas.length, 0, `fetch chamado com ref ${ref}`);
  }
});

Deno.test("modelo com {ref} sem ref, ou modelo sem {ref} com ref: recusa", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  await assertRejects(() => cliente.pedir("projeto"), ErroDaGestao);
  await assertRejects(
    () => cliente.pedir("organizacoes", { ref: REF }),
    ErroDaGestao,
  );
  assertEquals(f.chamadas.length, 0);
});

Deno.test("modelo desconhecido ou caminho cru: recusa antes do fetch", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  for (const modelo of [
    "/v1/projects",
    "https://evil.example/v1/projects",
    "nao-existe",
    "__proto__",
    "constructor",
    "toString",
  ]) {
    await assertRejects(() => cliente.pedir(modelo), ErroDaGestao);
  }
  assertEquals(f.chamadas.length, 0);
});

Deno.test("método fora do que o modelo permite: recusa (DELETE nunca)", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  await assertRejects(
    () => cliente.pedir("projeto", { ref: REF, metodo: "DELETE" }),
    ErroDaGestao,
  );
  await assertRejects(
    () => cliente.pedir("organizacoes", { metodo: "POST", corpo: {} }),
    ErroDaGestao,
  );
  assertEquals(f.chamadas.length, 0);
});

Deno.test("POST manda corpo JSON com content-type", async () => {
  const f = fetchFalso(resposta(201, { id: REF }));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const corpo = { name: "loja-x", region_selection: { type: "specific" } };
  await cliente.pedir("projetos", { metodo: "POST", corpo });
  const init = f.chamadas[0].init;
  assertEquals(init.method, "POST");
  assertEquals(JSON.parse(init.body), corpo);
  assertEquals(
    new Headers(init.headers).get("content-type"),
    "application/json",
  );
});

for (const status of [401, 403]) {
  Deno.test(`HTTP ${status} vira SemAcesso, sem token nem corpo na mensagem`, async () => {
    const f = fetchFalso(
      resposta(status, { message: `token ${TOKEN} ${SEGREDO_NO_CORPO}` }),
    );
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e = await pegarErro(() => cliente.pedir("organizacoes"));
    assert(e instanceof SemAcesso, "não virou SemAcesso");
    assert(e instanceof ErroDaGestao);
    assertEquals(e.status, status);
    assertSemVazamento(e, [TOKEN, SEGREDO_NO_CORPO]);
  });
}

Deno.test("HTTP 500 com corpo que ecoa segredo: erro sem corpo cru", async () => {
  const f = fetchFalso(
    resposta(500, `<html>${TOKEN} ${SEGREDO_NO_CORPO}</html>`),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() => cliente.pedir("projeto", { ref: REF }));
  assert(e instanceof ErroDaGestao);
  assert(!(e instanceof SemAcesso));
  assertEquals(e.status, 500);
  assertSemVazamento(e, [TOKEN, SEGREDO_NO_CORPO, "<html>"]);
});

Deno.test("3xx não é seguido nem tratado como sucesso", async () => {
  const f = fetchFalso(
    resposta(302, undefined, { location: "https://evil.example/" }),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() => cliente.pedir("organizacoes"));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.status, 302);
});

Deno.test("2xx com corpo que não é JSON: ESTADO_DESCONHECIDO, sem o corpo", async () => {
  const f = fetchFalso(resposta(200, `quebrado ${SEGREDO_NO_CORPO}`));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() => cliente.pedir("organizacoes"));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, ESTADO_DESCONHECIDO);
  assertSemVazamento(e, [SEGREDO_NO_CORPO]);
});

Deno.test("database/query: 200 com linhas devolve as linhas; manda query e read_only", async () => {
  const f = fetchFalso(resposta(200, [{ n: 1 }]));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const linhas = await cliente.consultarBanco(REF, "select 1 as n", {
    somenteLeitura: true,
  });
  assertEquals(linhas, [{ n: 1 }]);
  assertEquals(
    f.chamadas[0].url,
    `${API_GESTAO}/v1/projects/${REF}/database/query`,
  );
  assertEquals(f.chamadas[0].init.method, "POST");
  assertEquals(JSON.parse(f.chamadas[0].init.body), {
    query: "select 1 as n",
    read_only: true,
  });
});

Deno.test("database/query: 201 também é sucesso; sem somenteLeitura manda read_only false", async () => {
  const f = fetchFalso(resposta(201, []));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  assertEquals(await cliente.consultarBanco(REF, "create table t()"), []);
  assertEquals(JSON.parse(f.chamadas[0].init.body).read_only, false);
});

Deno.test("database/query: linha com coluna chamada error é dado, não falha", async () => {
  const f = fetchFalso(resposta(200, [{ error: "texto da coluna" }]));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  assertEquals(await cliente.consultarBanco(REF, "select 1"), [
    { error: "texto da coluna" },
  ]);
});

for (const status of [202, 204, 206]) {
  Deno.test(`database/query: HTTP ${status} NÃO é sucesso`, async () => {
    const f = fetchFalso(resposta(status, status === 204 ? undefined : []));
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e = await pegarErro(() => cliente.consultarBanco(REF, "select 1"));
    assert(e instanceof ErroDaGestao, `HTTP ${status} passou como sucesso`);
    assertEquals(e.status, status);
  });
}

Deno.test("database/query: 200 com corpo {error} lança, sem ecoar o SQL", async () => {
  const f = fetchFalso(
    resposta(200, {
      error: `falhou em insert into vault values ('${SEGREDO_NO_CORPO}')`,
    }),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() =>
    cliente.consultarBanco(REF, `select '${SEGREDO_NO_CORPO}'`),
  );
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, "CORPO_COM_ERRO");
  assertSemVazamento(e, [SEGREDO_NO_CORPO, TOKEN]);
});

Deno.test("database/query: 200 com objeto sem linhas é ESTADO_DESCONHECIDO", async () => {
  const f = fetchFalso(resposta(200, { message: "algo" }));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() => cliente.consultarBanco(REF, "select 1"));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, ESTADO_DESCONHECIDO);
});

Deno.test("database/query: erro do Postgres expõe só o SQLSTATE", async () => {
  const f = fetchFalso(
    resposta(400, {
      message: `Failed to run sql query: ERROR:  42P07: relation "x" already exists ${SEGREDO_NO_CORPO}`,
    }),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() => cliente.consultarBanco(REF, "create t"));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.status, 400);
  assertEquals(e.sqlstate, "42P07");
  assertSemVazamento(e, [SEGREDO_NO_CORPO, "already exists"]);
});

Deno.test("database/query: SQL vazio ou não-texto é recusado antes do fetch", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  for (const sql of ["", "   ", undefined, 42]) {
    await assertRejects(() => cliente.consultarBanco(REF, sql), ErroDaGestao);
  }
  assertEquals(f.chamadas.length, 0);
});

Deno.test("prazo estourado com o fetch pendurado: ESTADO_DESCONHECIDO", async () => {
  let sinal;
  const f = fetchFalso(
    (_url, init) =>
      new Promise((_ok, falha) => {
        sinal = init.signal;
        init.signal.addEventListener("abort", () =>
          falha(new DOMException(`abortado ${TOKEN}`, "AbortError")),
        );
      }),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f, prazoMs: 20 });
  const e = await pegarErro(() => cliente.consultarBanco(REF, "select 1"));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, ESTADO_DESCONHECIDO);
  assert(sinal?.aborted, "o pedido não foi abortado");
  assertSemVazamento(e, [TOKEN]);
});

Deno.test("prazo estourado lendo o corpo (fetch que ignora o sinal): ESTADO_DESCONHECIDO", async () => {
  const corpoPendurado = new ReadableStream({ start() {} });
  const f = fetchFalso(() =>
    Promise.resolve(new Response(corpoPendurado, { status: 200 })),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f, prazoMs: 20 });
  const e = await pegarErro(() => cliente.pedir("organizacoes"));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, ESTADO_DESCONHECIDO);
  await corpoPendurado.cancel().catch(() => {});
});

Deno.test("rede cai (fetch lança com o token na mensagem): ESTADO_DESCONHECIDO sem token", async () => {
  const f = fetchFalso(() =>
    Promise.reject(new TypeError(`falha ao conectar Bearer ${TOKEN}`)),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() => cliente.pedir("organizacoes"));
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, ESTADO_DESCONHECIDO);
  assertSemVazamento(e, [TOKEN]);
  assertEquals(e.cause, undefined);
});

Deno.test("token ausente ou com quebra de linha: recusa antes do fetch e sem ecoar", async () => {
  for (const token of [undefined, "", `${TOKEN}\r\nx-a: b`, 123]) {
    const f = fetchFalso();
    const cliente = criarClienteGestao({ token, fetch: f });
    const e = await pegarErro(() => cliente.pedir("organizacoes"));
    assert(e instanceof ErroDaGestao);
    assertSemVazamento(e, [TOKEN]);
    assertEquals(f.chamadas.length, 0);
  }
});

Deno.test("token pode ser função (renovado): é pedido a cada chamada", async () => {
  let n = 0;
  const f = fetchFalso(resposta(200, []), resposta(200, []));
  const cliente = criarClienteGestao({
    token: async () => `${TOKEN}-${++n}`,
    fetch: f,
  });
  await cliente.pedir("organizacoes");
  await cliente.pedir("projetos");
  assertEquals(
    new Headers(f.chamadas[1].init.headers).get("authorization"),
    `Bearer ${TOKEN}-2`,
  );
});
