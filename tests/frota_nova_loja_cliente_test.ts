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
 *  - prazo estourado (ou rede que cai no meio) vira ESTADO_DESCONHECIDO;
 *  - modelos da loja nova: funcoes (GET), implantarFuncao (POST multipart) e
 *    configAuth (GET/PATCH só com a lista branca), sem DELETE.
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
  CHAVES_DO_CONFIG_AUTH,
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

// ====================================================================
// Modelos do plano nova-loja (A4, 26/11/2026): functions, deploy e config/auth.
// Formato conferido na spec oficial (https://api.supabase.com/api/v1-json) e
// em https://supabase.com/docs/reference/api/v1-deploy-a-function.

const SEGREDO_DO_HOOK = "v1,whsec_SEGREDO-DO-HOOK-NAO-PODE-VAZAR";

/** Roda `fn` com console.* espionado; devolve tudo o que foi escrito. */
async function capturarConsole(fn) {
  const escrito = [];
  const { log, info, warn, error, debug } = console;
  const espiao = (...a) => escrito.push(a.map(String).join(" "));
  Object.assign(console, {
    log: espiao,
    info: espiao,
    warn: espiao,
    error: espiao,
    debug: espiao,
  });
  try {
    await fn();
  } finally {
    Object.assign(console, { log, info, warn, error, debug });
  }
  return escrito.join("\n");
}

Deno.test("os modelos novos têm caminho FIXO e os métodos certos (nenhum DELETE)", () => {
  assertEquals(MODELOS.funcoes.caminho, "/v1/projects/{ref}/functions");
  assertEquals([...MODELOS.funcoes.metodos], ["GET"]);
  assertEquals(
    MODELOS.implantarFuncao.caminho,
    "/v1/projects/{ref}/functions/deploy",
  );
  assertEquals([...MODELOS.implantarFuncao.metodos], ["POST"]);
  assertEquals(MODELOS.configAuth.caminho, "/v1/projects/{ref}/config/auth");
  assertEquals([...MODELOS.configAuth.metodos], ["GET", "PATCH"]);
  for (const m of [
    MODELOS.funcoes,
    MODELOS.implantarFuncao,
    MODELOS.configAuth,
  ]) {
    assert(Object.isFrozen(m), `${m.caminho} não está congelado`);
    assert(Object.isFrozen(m.metodos));
  }
});

Deno.test("lista branca do PATCH de config/auth: exatamente as chaves do plano", () => {
  assertEquals(Object.keys(CHAVES_DO_CONFIG_AUTH).sort(), [
    "hook_send_email_enabled",
    "hook_send_email_secrets",
    "hook_send_email_uri",
    "rate_limit_email_sent",
    "site_url",
    "uri_allow_list",
  ]);
  assert(Object.isFrozen(CHAVES_DO_CONFIG_AUTH));
});

Deno.test("DELETE (e qualquer método fora do modelo) nos modelos novos: recusa antes do fetch", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const casos = [
    ["funcoes", "DELETE"],
    ["funcoes", "POST"],
    ["funcoes", "PUT"],
    ["funcoes", "PATCH"],
    ["implantarFuncao", "DELETE"],
    ["implantarFuncao", "GET"],
    ["configAuth", "DELETE"],
    ["configAuth", "PUT"],
    ["configAuth", "POST"],
  ];
  for (const [modelo, metodo] of casos) {
    const e = await pegarErro(() =>
      cliente.pedir(modelo, {
        ref: REF,
        metodo,
        ...(metodo === "GET" || metodo === "DELETE"
          ? {}
          : { corpo: { site_url: "https://a.example" } }),
      }),
    );
    assert(e instanceof ErroDaGestao, `${modelo} ${metodo} passou`);
  }
  assertEquals(f.chamadas.length, 0);
});

Deno.test("funcoes: GET em /v1/projects/{ref}/functions devolve a lista", async () => {
  const lista = [{ slug: "criar-pagamento", verify_jwt: true }];
  const f = fetchFalso(resposta(200, lista));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  assertEquals(await cliente.pedir("funcoes", { ref: REF }), lista);
  assertEquals(f.chamadas[0].url, `${API_GESTAO}/v1/projects/${REF}/functions`);
  assertEquals(f.chamadas[0].init.method, "GET");
  assertEquals(f.chamadas[0].init.body, undefined);
});

Deno.test("funcoes: ref inválido recusado antes do fetch", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  await assertRejects(
    () => cliente.pedir("funcoes", { ref: "../../v1/organizations" }),
    ErroDaGestao,
  );
  assertEquals(f.chamadas.length, 0);
});

Deno.test("configAuth: GET em /v1/projects/{ref}/config/auth", async () => {
  const f = fetchFalso(resposta(200, { site_url: "http://localhost:3000" }));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const corpo = await cliente.pedir("configAuth", { ref: REF });
  assertEquals(corpo.site_url, "http://localhost:3000");
  assertEquals(
    f.chamadas[0].url,
    `${API_GESTAO}/v1/projects/${REF}/config/auth`,
  );
  assertEquals(f.chamadas[0].init.method, "GET");
});

Deno.test("configAuth: PATCH com as chaves permitidas manda SÓ elas, em JSON", async () => {
  const f = fetchFalso(resposta(200, { site_url: "https://loja.example" }));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const patch = {
    site_url: "https://loja.example",
    uri_allow_list: "https://loja.example/**",
    rate_limit_email_sent: 30,
    hook_send_email_enabled: true,
    hook_send_email_uri: `https://${REF}.supabase.co/functions/v1/auth-send-email`,
    hook_send_email_secrets: SEGREDO_DO_HOOK,
  };
  await cliente.pedir("configAuth", {
    ref: REF,
    metodo: "PATCH",
    corpo: patch,
  });
  const init = f.chamadas[0].init;
  assertEquals(init.method, "PATCH");
  assertEquals(JSON.parse(init.body), patch);
  assertEquals(
    new Headers(init.headers).get("content-type"),
    "application/json",
  );
});

Deno.test("configAuth: PATCH com QUALQUER chave fora da lista é recusado antes da rede, sem ecoar o valor", async () => {
  const fora = [
    { smtp_pass: SEGREDO_NO_CORPO },
    { site_url: "https://loja.example", smtp_pass: SEGREDO_NO_CORPO },
    { mailer_autoconfirm: true },
    { external_email_enabled: false },
    { hook_custom_access_token_uri: SEGREDO_NO_CORPO },
    { disable_signup: true },
    { SITE_URL: "https://loja.example" },
    { "site_url ": "https://loja.example" },
  ];
  for (const corpo of fora) {
    const f = fetchFalso(resposta(200, {}));
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e = await pegarErro(() =>
      cliente.pedir("configAuth", { ref: REF, metodo: "PATCH", corpo }),
    );
    assert(e instanceof ErroDaGestao, JSON.stringify(corpo));
    assertEquals(e.codigo, "PEDIDO_INVALIDO");
    assertEquals(f.chamadas.length, 0, `fetch com ${JSON.stringify(corpo)}`);
    assertSemVazamento(e, [SEGREDO_NO_CORPO, TOKEN]);
  }
});

Deno.test("configAuth: PATCH vazio, sem corpo, não-objeto ou com truque de serialização: recusa antes da rede", async () => {
  const comToJSON = { site_url: "https://loja.example" };
  Object.defineProperty(comToJSON, "toJSON", {
    value: () => ({ smtp_pass: SEGREDO_NO_CORPO }),
    enumerable: false,
  });
  const comSimbolo = { site_url: "https://loja.example", [Symbol("x")]: 1 };
  // chave permitida, mas como getter (valor pode mudar entre conferir e
  // mandar) ou escondida (não enumerável): recusa também
  const comGetter = {};
  Object.defineProperty(comGetter, "site_url", {
    get: () => "https://loja.example",
    enumerable: true,
  });
  const escondida = {};
  Object.defineProperty(escondida, "site_url", {
    value: "https://loja.example",
    enumerable: false,
  });
  const herdado = Object.create({ smtp_pass: SEGREDO_NO_CORPO });
  herdado.site_url = "https://loja.example";
  const ruins = [
    undefined,
    {},
    null,
    [],
    "site_url=x",
    [["site_url", "x"]],
    comToJSON,
    comSimbolo,
    comGetter,
    escondida,
    herdado,
    new Map([["site_url", "x"]]),
  ];
  for (const corpo of ruins) {
    const f = fetchFalso(resposta(200, {}));
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e = await pegarErro(() =>
      cliente.pedir("configAuth", { ref: REF, metodo: "PATCH", corpo }),
    );
    assert(e instanceof ErroDaGestao, `passou: ${String(corpo)}`);
    assertEquals(f.chamadas.length, 0);
    assertSemVazamento(e, [SEGREDO_NO_CORPO]);
  }
});

Deno.test("configAuth: PATCH com valor de tipo errado é recusado antes da rede (nem null)", async () => {
  const ruins = [
    { site_url: null },
    { site_url: 42 },
    { site_url: { toString: () => "x" } },
    { uri_allow_list: ["a", "b"] },
    { rate_limit_email_sent: "30" },
    { rate_limit_email_sent: 1.5 },
    { rate_limit_email_sent: 0 },
    { rate_limit_email_sent: null },
    { hook_send_email_enabled: "true" },
    { hook_send_email_enabled: null },
    { hook_send_email_secrets: null },
    { hook_send_email_uri: 1 },
  ];
  for (const corpo of ruins) {
    const f = fetchFalso(resposta(200, {}));
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e = await pegarErro(() =>
      cliente.pedir("configAuth", { ref: REF, metodo: "PATCH", corpo }),
    );
    assert(e instanceof ErroDaGestao, `passou: ${JSON.stringify(corpo)}`);
    assertEquals(f.chamadas.length, 0);
  }
});

Deno.test("configAuth: PATCH que falha no servidor não ecoa o segredo do hook nem o token", async () => {
  const f = fetchFalso(
    resposta(500, { message: `bad ${SEGREDO_DO_HOOK} ${TOKEN}` }),
  );
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() =>
    cliente.pedir("configAuth", {
      ref: REF,
      metodo: "PATCH",
      corpo: { hook_send_email_secrets: SEGREDO_DO_HOOK },
    }),
  );
  assert(e instanceof ErroDaGestao);
  assertEquals(e.status, 500);
  assertSemVazamento(e, [SEGREDO_DO_HOOK, TOKEN]);
});

Deno.test("corpo em GET continua recusado; a lista branca não abre PATCH em outro modelo", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  await assertRejects(
    () =>
      cliente.pedir("configAuth", {
        ref: REF,
        corpo: { site_url: "https://a.example" },
      }),
    ErroDaGestao,
  );
  await assertRejects(
    () =>
      cliente.pedir("projeto", {
        ref: REF,
        metodo: "PATCH",
        corpo: { site_url: "https://a.example" },
      }),
    ErroDaGestao,
  );
  assertEquals(f.chamadas.length, 0);
});

// ---------------------------------------------------------- implantarFuncao

const ARQ_ENTRADA = "supabase/functions/criar-pagamento/index.ts";
const ARQ_SHARED = "supabase/functions/_shared/mp.ts";
const pedidoDeDeploy = (extra = {}) => ({
  slug: "criar-pagamento",
  metadata: {
    entrypoint_path: ARQ_ENTRADA,
    verify_jwt: true,
    name: "criar-pagamento",
  },
  arquivos: [
    { caminho: ARQ_ENTRADA, conteudo: 'import "../_shared/mp.ts";' },
    { caminho: ARQ_SHARED, conteudo: new TextEncoder().encode("export {};") },
  ],
  ...extra,
});
const respostaDeDeploy = (slug = "criar-pagamento") =>
  resposta(201, { id: "f-1", slug, name: slug, status: "ACTIVE", version: 3 });

Deno.test("implantarFuncao: POST multipart em /functions/deploy?slug=, metadata JSON + um 'file' por arquivo", async () => {
  const f = fetchFalso(respostaDeDeploy());
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const r = await cliente.implantarFuncao(REF, pedidoDeDeploy());
  assertEquals(r.slug, "criar-pagamento");
  assertEquals(f.chamadas.length, 1);
  const { url, init } = f.chamadas[0];
  assertEquals(
    url,
    `${API_GESTAO}/v1/projects/${REF}/functions/deploy?slug=criar-pagamento`,
  );
  assertEquals(init.method, "POST");
  assertEquals(init.redirect, "manual");
  const cab = new Headers(init.headers);
  assertEquals(cab.get("authorization"), `Bearer ${TOKEN}`);
  // o content-type com o boundary é do fetch; o cliente não o fixa
  assertEquals(cab.get("content-type"), null);
  assert(init.body instanceof FormData, "corpo não é multipart");
  assertEquals(JSON.parse(init.body.get("metadata")), {
    entrypoint_path: ARQ_ENTRADA,
    verify_jwt: true,
    name: "criar-pagamento",
  });
  const arquivos = init.body.getAll("file");
  assertEquals(
    arquivos.map((a) => a.name),
    [ARQ_ENTRADA, ARQ_SHARED],
  );
  assertEquals(await arquivos[0].text(), 'import "../_shared/mp.ts";');
  assertEquals(await arquivos[1].text(), "export {};");
});

Deno.test("implantarFuncao: verify_jwt false segue como false (não é apagado nem trocado)", async () => {
  const f = fetchFalso(respostaDeDeploy("webhook-mercadopago"));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const entrada = "supabase/functions/webhook-mercadopago/index.ts";
  await cliente.implantarFuncao(REF, {
    slug: "webhook-mercadopago",
    metadata: { entrypoint_path: entrada, verify_jwt: false },
    arquivos: [{ caminho: entrada, conteudo: "x" }],
  });
  const meta = JSON.parse(f.chamadas[0].init.body.get("metadata"));
  assertEquals(meta.verify_jwt, false);
});

Deno.test("implantarFuncao: pedido inválido é recusado ANTES da rede", async () => {
  const base = pedidoDeDeploy();
  const comArquivo = (caminho) => ({
    ...base,
    arquivos: [...base.arquivos, { caminho, conteudo: "x" }],
  });
  const comMeta = (extra) => ({
    ...base,
    metadata: { ...base.metadata, ...extra },
  });
  const ruins = [
    ["ref ruim", "x/../y", base],
    ["slug com barra", REF, { ...base, slug: "a/b" }],
    ["slug com ?", REF, { ...base, slug: "a?x=1" }],
    ["slug começa com número", REF, { ...base, slug: "1abc" }],
    ["slug vazio", REF, { ...base, slug: "" }],
    ["slug não-texto", REF, { ...base, slug: 7 }],
    [
      "sem verify_jwt",
      REF,
      { ...base, metadata: { entrypoint_path: ARQ_ENTRADA } },
    ],
    ["verify_jwt texto", REF, comMeta({ verify_jwt: "false" })],
    ["sem entrypoint", REF, { ...base, metadata: { verify_jwt: true } }],
    [
      "entrypoint fora dos arquivos",
      REF,
      comMeta({ entrypoint_path: "outro/index.ts" }),
    ],
    [
      "import_map fora dos arquivos",
      REF,
      comMeta({ import_map_path: "deno.json" }),
    ],
    ["chave de metadata desconhecida", REF, comMeta({ ezbr_sha256: "x" })],
    ["static_patterns não-lista", REF, comMeta({ static_patterns: "*.html" })],
    ["metadata não-objeto", REF, { ...base, metadata: "x" }],
    ["sem arquivos", REF, { ...base, arquivos: [] }],
    ["arquivos não-lista", REF, { ...base, arquivos: "x" }],
    ["caminho com ..", REF, comArquivo("supabase/../../etc/passwd")],
    ["caminho absoluto", REF, comArquivo("/etc/x")],
    ["caminho com barra invertida", REF, comArquivo("a\\b.ts")],
    ["caminho com unidade do Windows", REF, comArquivo("C:/x.ts")],
    ["caminho com segmento vazio", REF, comArquivo("a//b.ts")],
    ["caminho com quebra de linha", REF, comArquivo("a\nb.ts")],
    ["caminho duplicado", REF, comArquivo(ARQ_ENTRADA)],
    [
      "conteúdo que não é texto nem bytes",
      REF,
      { ...base, arquivos: [{ caminho: ARQ_ENTRADA, conteudo: { a: 1 } }] },
    ],
  ];
  for (const [nome, ref, pedido] of ruins) {
    const f = fetchFalso(respostaDeDeploy());
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e = await pegarErro(() => cliente.implantarFuncao(ref, pedido));
    assert(e instanceof ErroDaGestao, `passou: ${nome}`);
    assertEquals(e.codigo, "PEDIDO_INVALIDO", nome);
    assertEquals(f.chamadas.length, 0, `fetch chamado: ${nome}`);
  }
});

Deno.test("implantarFuncao: pedir() genérico não manda multipart nem deploy cru; query solta é recusada", async () => {
  const f = fetchFalso();
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const form = new FormData();
  form.append("metadata", "{}");
  for (const corpo of [form, { metadata: {} }, undefined]) {
    await assertRejects(
      () =>
        cliente.pedir("implantarFuncao", { ref: REF, metodo: "POST", corpo }),
      ErroDaGestao,
    );
  }
  await assertRejects(
    () => cliente.pedir("funcoes", { ref: REF, consulta: { slug: "x" } }),
    ErroDaGestao,
  );
  assertEquals(f.chamadas.length, 0);
});

for (const status of [200, 202, 204]) {
  Deno.test(`implantarFuncao: HTTP ${status} não é o 201 da spec → ESTADO_DESCONHECIDO`, async () => {
    const f = fetchFalso(
      status === 204
        ? resposta(204, undefined)
        : resposta(status, { slug: "criar-pagamento" }),
    );
    const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
    const e = await pegarErro(() =>
      cliente.implantarFuncao(REF, pedidoDeDeploy()),
    );
    assert(e instanceof ErroDaGestao);
    assertEquals(e.codigo, ESTADO_DESCONHECIDO);
  });
}

Deno.test("implantarFuncao: 201 com slug de OUTRA function → ESTADO_DESCONHECIDO", async () => {
  const f = fetchFalso(respostaDeDeploy("outra-coisa"));
  const cliente = criarClienteGestao({ token: TOKEN, fetch: f });
  const e = await pegarErro(() =>
    cliente.implantarFuncao(REF, pedidoDeDeploy()),
  );
  assert(e instanceof ErroDaGestao);
  assertEquals(e.codigo, ESTADO_DESCONHECIDO);
});

Deno.test("implantarFuncao: 403 vira SemAcesso; 500 que ecoa o código não vaza nada", async () => {
  const codigo = `const chave = "${SEGREDO_NO_CORPO}";`;
  const pedido = {
    ...pedidoDeDeploy(),
    arquivos: [{ caminho: ARQ_ENTRADA, conteudo: codigo }],
  };
  const f403 = fetchFalso(resposta(403, { message: TOKEN }));
  const e403 = await pegarErro(() =>
    criarClienteGestao({ token: TOKEN, fetch: f403 }).implantarFuncao(
      REF,
      pedido,
    ),
  );
  assert(e403 instanceof SemAcesso);
  assertSemVazamento(e403, [TOKEN]);
  const f500 = fetchFalso(resposta(500, `erro em ${codigo} ${TOKEN}`));
  const e500 = await pegarErro(() =>
    criarClienteGestao({ token: TOKEN, fetch: f500 }).implantarFuncao(
      REF,
      pedido,
    ),
  );
  assert(e500 instanceof ErroDaGestao);
  assertEquals(e500.status, 500);
  assertSemVazamento(e500, [TOKEN, SEGREDO_NO_CORPO]);
});

Deno.test("nenhum dos modelos novos escreve o token (nem o segredo do hook) no console", async () => {
  const tentar = async (fn) => {
    try {
      await fn();
    } catch {
      // só o console interessa aqui; os erros têm os próprios testes acima
    }
  };
  const escrito = await capturarConsole(async () => {
    const f = fetchFalso(
      resposta(200, []),
      resposta(200, {}),
      resposta(200, {}),
      respostaDeDeploy(),
      resposta(500, `x ${TOKEN}`),
      resposta(401, `x ${TOKEN}`),
      () => Promise.reject(new TypeError(`rede caiu ${TOKEN}`)),
    );
    const c = criarClienteGestao({ token: TOKEN, fetch: f });
    await tentar(() => c.pedir("funcoes", { ref: REF }));
    await tentar(() => c.pedir("configAuth", { ref: REF }));
    await tentar(() =>
      c.pedir("configAuth", {
        ref: REF,
        metodo: "PATCH",
        corpo: { hook_send_email_secrets: SEGREDO_DO_HOOK },
      }),
    );
    await tentar(() => c.implantarFuncao(REF, pedidoDeDeploy()));
    await tentar(() => c.implantarFuncao(REF, pedidoDeDeploy()));
    await tentar(() => c.pedir("funcoes", { ref: REF }));
    await tentar(() => c.pedir("configAuth", { ref: REF }));
    await tentar(() =>
      c.pedir("configAuth", {
        ref: REF,
        metodo: "PATCH",
        corpo: { smtp_pass: SEGREDO_DO_HOOK },
      }),
    );
  });
  assert(!escrito.includes(TOKEN), "o token foi para o console");
  assert(!escrito.includes(SEGREDO_DO_HOOK), "o segredo foi para o console");
});
