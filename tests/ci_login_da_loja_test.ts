// @ts-nocheck
/* eslint-disable security/detect-non-literal-require -- importa só o script local constante sob teste. */
/**
 * scripts/publicacao/login-da-loja.cjs (26/11/2026): as ações `conferir` (só
 * leitura) e `acertar` (PATCH só de site_url, uri_allow_list e
 * rate_limit_email_sent) do login de UMA loja assinante, pela Management API.
 * Nenhuma rede de verdade: o fetch é um dublê com estado.
 *
 * O que estes testes medem:
 *  - conferir: só GET /config/auth, GET /functions, GET /secrets e POST
 *    /database/query read_only com a consulta fixa; NENHUM PATCH; sai 0 só com SIM.
 *  - expected_sha diferente para antes da rede; loja fora de ALVOS para antes de
 *    ler segredo; 401/403 param na 1ª chamada sem tentar outro segredo.
 *  - token, smtp_pass e segredo do hook só em ::add-mask::; corpo cru e mensagem
 *    de exceção nunca no log.
 *  - acertar: PATCH só com chaves de CAMPOS_URLS; relê e confirma; outro campo
 *    mudou → "estado DESCONHECIDO"; 2ª execução = zero PATCH; site_url de outro
 *    domínio ou dominio_publico nulo → para sem gravar; imprime os valores de
 *    antes; termina rodando conferir.
 */
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const SCRIPT = join(RAIZ, "scripts/publicacao/login-da-loja.cjs");
const mod = require(SCRIPT);
const regras = require(
  join(RAIZ, "scripts/publicacao/login-da-loja-regras.cjs"),
);

const SHA = "b".repeat(40);
const REF = "gnjsrucsmjkajijrakzr"; // savy, do cadastro
const TOKEN = "token-ficticio-da-savy-7c1d";
const TOKEN_CAF = "token-ficticio-da-caf-2e9a";
const SMTP_PASS = "senha-smtp-ficticia-55aa";
const HOOK_TEXTO = "v1,whsec_ZmljdGljaW8tZG8tdGVzdGU=";
const HOOK_HASH = createHmac("sha256", REF).update(HOOK_TEXTO).digest("hex");
const DOMINIO = "loja.exemplo.com.br";
const URI_HOOK = `https://${REF}.supabase.co/functions/v1/auth-send-email`;
const MARCADOR = "CORPO-CRU-NAO-PODE-SAIR-91x";
const clone = (v) => JSON.parse(JSON.stringify(v));

const configRecemNascida = () => ({
  site_url: "http://localhost:3000",
  uri_allow_list: "",
  rate_limit_email_sent: 2,
  mailer_autoconfirm: false,
  external_email_enabled: true,
  hook_send_email_enabled: false,
  hook_send_email_uri: null,
  hook_send_email_secrets: null,
  smtp_host: null,
  smtp_port: null,
  smtp_user: null,
  smtp_pass: null,
  smtp_admin_email: null,
  campo_novo_qualquer: MARCADOR,
});
const configPronta = () => ({
  ...configRecemNascida(),
  site_url: `https://${DOMINIO}`,
  uri_allow_list: `https://${DOMINIO}/**`,
  rate_limit_email_sent: 30,
  hook_send_email_enabled: true,
  hook_send_email_uri: URI_HOOK,
  hook_send_email_secrets: HOOK_HASH,
  smtp_pass: SMTP_PASS,
});

function cenario(op = {}) {
  let config = op.config ?? configPronta();
  const functions = op.functions ?? [
    { slug: "auth-send-email", status: "ACTIVE", verify_jwt: false },
    { slug: "criar-pagamento", status: "ACTIVE", verify_jwt: true },
  ];
  const secrets = op.secrets ?? [
    { name: "SEND_EMAIL_HOOK_SECRET", value: "digest-ficticio" },
  ];
  const linha = op.linha ?? {
    dominio_publico: op.dominio === undefined ? DOMINIO : op.dominio,
    gmail_cadastrado: op.gmail ?? true,
  };
  const chamadas = [];
  const logs = [];
  const erros = [];
  const resumos = [];
  const mascaras = [];
  let patches = 0;
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ url, path: u.pathname, method: init.method, body, init });
    assertEquals(u.origin, "https://api.supabase.com");
    assert(u.pathname.startsWith(`/v1/projects/${REF}/`), "nunca outro alvo");
    assertEquals(init.redirect, "error");
    assert(init.signal instanceof AbortSignal, "prazo em todo fetch");
    assertEquals(init.headers.Authorization, `Bearer ${TOKEN}`);
    if (op.rede) throw new Error(`falhou com ${TOKEN} e ${MARCADOR}`);
    let status = 200;
    let data;
    const p = u.pathname.slice(`/v1/projects/${REF}`.length);
    const forcado = op.statusEm ? op.statusEm(init.method, p) : 0;
    if (forcado)
      return {
        status: forcado,
        text: async () => JSON.stringify({ message: MARCADOR }),
      };
    if (p === "/config/auth" && init.method === "GET") data = clone(config);
    else if (p === "/config/auth" && init.method === "PATCH") {
      patches++;
      if (!op.patchIgnorado) config = { ...config, ...body };
      if (op.outroCampoMuda)
        config.mailer_autoconfirm = !config.mailer_autoconfirm;
      data = clone(config);
    } else if (p === "/functions" && init.method === "GET")
      data = clone(functions);
    else if (p === "/secrets" && init.method === "GET") data = clone(secrets);
    else if (p === "/database/query" && init.method === "POST") {
      status = 201;
      data = op.rows ?? [clone(linha)];
    } else throw new Error(`endpoint inesperado ${init.method} ${p}`);
    return { status, text: async () => JSON.stringify(data) };
  };
  const saida = {
    log: (v) => logs.push(v),
    erro: (v) => erros.push(v),
    resumo: (v) => resumos.push(v),
    mascarar: (v) => mascaras.push(v),
  };
  return {
    fetchImpl,
    saida,
    chamadas,
    logs,
    erros,
    resumos,
    mascaras,
    get patches() {
      return patches;
    },
    get config() {
      return config;
    },
    tudo: () => [...logs, ...erros, ...resumos].join("\n"),
  };
}

const envSavy = (extra = {}) => ({
  EXPECTED_SHA: SHA,
  GITHUB_SHA: SHA,
  SUPABASE_ACCESS_TOKEN_SAVY: TOKEN,
  SUPABASE_ACCESS_TOKEN_IKCOUS: TOKEN_CAF,
  SUPABASE_ACCESS_TOKEN: "token-legado-ficticio",
  ...extra,
});
const rodar = (c, acao, env = envSavy(), projeto = "savy") =>
  mod.executar({ projeto, acao, env, fetchImpl: c.fetchImpl, saida: c.saida });

function semVazamento(c) {
  const t = c.tudo();
  for (const s of [
    TOKEN,
    TOKEN_CAF,
    SMTP_PASS,
    HOOK_HASH,
    HOOK_TEXTO,
    MARCADOR,
  ])
    assert(!t.includes(s), `vazou na saída: ${s}\n${t}`);
}

// ---------------------------------------------------------------------------
// conferir
// ---------------------------------------------------------------------------
Deno.test("conferir em loja pronta: só as quatro leituras, nenhum PATCH, veredito SIM e saída 0", async () => {
  const c = cenario();
  assertEquals(await rodar(c, "conferir"), 0, c.tudo());
  const pares = c.chamadas.map((x) => `${x.method} ${x.path.split(REF)[1]}`);
  assertEquals(pares.sort(), [
    "GET /config/auth",
    "GET /functions",
    "GET /secrets",
    "POST /database/query",
  ]);
  assertEquals(c.patches, 0);
  const q = c.chamadas.find((x) => x.method === "POST");
  assertEquals(q.body, { query: regras.CONSULTA_GMAIL, read_only: true });
  assertStringIncludes(c.tudo(), "veredito: SIM");
  semVazamento(c);
});

Deno.test("conferir em loja recém-nascida: NÃO, saída 1, e ainda assim nenhum PATCH", async () => {
  const c = cenario({ config: configRecemNascida(), gmail: false });
  assertEquals(await rodar(c, "conferir"), 1);
  assertEquals(c.patches, 0);
  assert(c.chamadas.every((x) => x.method !== "PATCH"));
  assertStringIncludes(c.tudo(), "veredito: NÃO");
  assertStringIncludes(c.tudo(), "localhost");
  semVazamento(c);
});

Deno.test("conferir: token, smtp_pass e segredo do hook só em ::add-mask::; campo desconhecido nunca impresso", async () => {
  const c = cenario();
  await rodar(c, "conferir");
  for (const s of [TOKEN, SMTP_PASS, HOOK_HASH])
    assert(c.mascaras.includes(s), `não mascarou ${s}`);
  // o token é mascarado ANTES da primeira chamada
  semVazamento(c);
});

Deno.test("conferir: a função sem verify_jwt=false e o Gmail ausente aparecem como FALTA", async () => {
  const c = cenario({
    functions: [
      { slug: "auth-send-email", status: "ACTIVE", verify_jwt: true },
    ],
    gmail: false,
  });
  assertEquals(await rodar(c, "conferir"), 1);
  assertStringIncludes(c.tudo(), "FALTA");
  assertStringIncludes(c.tudo(), "verify_jwt");
  assertStringIncludes(c.tudo(), "Gmail");
});

Deno.test("conferir: resposta da consulta fora do formato PARA sem imprimir o corpo", async () => {
  for (const rows of [
    [],
    [{ dominio_publico: DOMINIO }],
    [{ dominio_publico: DOMINIO, gmail_cadastrado: "sim" }],
    [{ dominio_publico: 3, gmail_cadastrado: true }],
    [
      { dominio_publico: DOMINIO, gmail_cadastrado: true },
      { dominio_publico: DOMINIO, gmail_cadastrado: true },
    ],
    [{ dominio_publico: DOMINIO, gmail_cadastrado: true, extra: MARCADOR }],
    { error: MARCADOR },
  ]) {
    const c = cenario({ rows });
    assertEquals(await rodar(c, "conferir"), 1, JSON.stringify(rows));
    semVazamento(c);
  }
});

// ---------------------------------------------------------------------------
// travas antes da rede e do segredo
// ---------------------------------------------------------------------------
const fetchProibido = () => {
  throw new Error("rede não podia ser tocada");
};

Deno.test("expected_sha diferente, ausente ou curto PARA antes de qualquer rede", async () => {
  for (const env of [
    envSavy({ EXPECTED_SHA: "c".repeat(40) }),
    envSavy({ EXPECTED_SHA: "" }),
    envSavy({ EXPECTED_SHA: SHA.slice(0, 7) }),
    envSavy({ GITHUB_SHA: undefined }),
  ]) {
    const c = cenario();
    const r = await mod.executar({
      projeto: "savy",
      acao: "acertar",
      env,
      fetchImpl: fetchProibido,
      saida: c.saida,
    });
    assertEquals(r, 1);
    assertStringIncludes(c.tudo(), "expected_sha");
    assertEquals(c.mascaras, [], "nem o token foi lido");
  }
});

Deno.test("loja fora de ALVOS PARA antes de ler QUALQUER segredo", async () => {
  for (const projeto of [
    "loja",
    "sandbox",
    "__proto__",
    "constructor",
    "x",
    "",
    undefined,
  ]) {
    const lidas = [];
    const env = new Proxy(envSavy(), {
      get(alvo, chave) {
        lidas.push(String(chave));
        return Reflect.get(alvo, chave);
      },
    });
    const c = cenario();
    const r = await mod.executar({
      projeto,
      acao: "conferir",
      env,
      fetchImpl: fetchProibido,
      saida: c.saida,
    });
    assertEquals(r, 1, String(projeto));
    assertStringIncludes(c.tudo(), "projeto desconhecido");
    assert(!lidas.some((k) => /TOKEN/.test(k)), `leu segredo: ${lidas}`);
  }
});

Deno.test("ação desconhecida PARA antes da rede", async () => {
  for (const acao of ["medir", "ativar", "", undefined, "ACERTAR"]) {
    const c = cenario();
    const r = await mod.executar({
      projeto: "savy",
      acao,
      env: envSavy(),
      fetchImpl: fetchProibido,
      saida: c.saida,
    });
    assertEquals(r, 1);
    assertStringIncludes(c.tudo(), "ação desconhecida");
  }
});

Deno.test("sem o segredo da PRÓPRIA loja PARA, mesmo com o da vizinha e o legado", async () => {
  const c = cenario();
  const r = await mod.executar({
    projeto: "savy",
    acao: "conferir",
    env: envSavy({ SUPABASE_ACCESS_TOKEN_SAVY: "" }),
    fetchImpl: fetchProibido,
    saida: c.saida,
  });
  assertEquals(r, 1);
  assertStringIncludes(c.tudo(), "SUPABASE_ACCESS_TOKEN_SAVY");
});

Deno.test("401/403 PARAM na primeira chamada, sem tentar outro segredo, e sem imprimir o corpo", async () => {
  for (const status of [401, 403]) {
    for (const acao of ["conferir", "acertar"]) {
      const c = cenario({ statusEm: () => status });
      assertEquals(await rodar(c, acao), 1);
      assertEquals(c.chamadas.length, 1, `${acao} ${status}`);
      assertStringIncludes(c.tudo(), "sem acesso legítimo");
      semVazamento(c);
    }
  }
});

Deno.test("HTTP inesperado e falha de rede: mensagem fechada (status numérico no máximo), nunca corpo nem exceção", async () => {
  const c1 = cenario({ statusEm: () => 500 });
  assertEquals(await rodar(c1, "conferir"), 1);
  assertStringIncludes(c1.tudo(), "HTTP 500");
  semVazamento(c1);
  const c2 = cenario({ rede: true });
  assertEquals(await rodar(c2, "conferir"), 1);
  semVazamento(c2);
});

Deno.test("o script não tem DELETE, PUT nem POST fora da consulta (lista fechada de chamadas)", () => {
  const fonte = Deno.readTextFileSync(SCRIPT);
  assert(!/"DELETE"|"PUT"/.test(fonte));
  assert(!/\/secrets"\s*,\s*"POST"/.test(fonte));
  assertEquals([...mod.CHAMADAS_PERMITIDAS].sort(), [
    "GET /config/auth",
    "GET /functions",
    "GET /secrets",
    "PATCH /config/auth",
    "POST /database/query",
  ]);
});

// ---------------------------------------------------------------------------
// acertar
// ---------------------------------------------------------------------------
Deno.test("acertar loja recém-nascida: UM PATCH com site_url e lista, relido e confirmado; imprime o antes; termina conferindo; 2ª execução = zero PATCH", async () => {
  const c = cenario({ config: configRecemNascida(), gmail: false });
  assertEquals(await rodar(c, "acertar"), 0, c.tudo());
  const patches = c.chamadas.filter((x) => x.method === "PATCH");
  assertEquals(patches.length, 1);
  assertEquals(patches[0].body, {
    site_url: `https://${DOMINIO}`,
    uri_allow_list: `https://${DOMINIO}/**`,
  });
  for (const p of patches)
    assert(Object.keys(p.body).every((k) => regras.CAMPOS_URLS.includes(k)));
  // relê depois do PATCH
  const i = c.chamadas.indexOf(patches[0]);
  assert(
    c.chamadas
      .slice(i + 1)
      .some((x) => x.method === "GET" && x.path.endsWith("/config/auth")),
  );
  assertEquals(c.config.site_url, `https://${DOMINIO}`);
  const t = c.tudo();
  assertStringIncludes(t, "http://localhost:3000"); // valor de antes
  assertStringIncludes(t, "veredito:"); // terminou conferindo
  assert(c.chamadas.some((x) => x.path.endsWith("/functions")));
  semVazamento(c);

  // 2ª execução: zero PATCH
  const antes = c.chamadas.length;
  const saida2 = cenario().saida;
  const r2 = await mod.executar({
    projeto: "savy",
    acao: "acertar",
    env: envSavy(),
    fetchImpl: c.fetchImpl,
    saida: saida2,
  });
  assertEquals(r2, 0);
  assertEquals(
    c.chamadas.slice(antes).filter((x) => x.method === "PATCH").length,
    0,
  );
});

Deno.test("acertar com hook ligado e limite 2: dois PATCHes separados (endereços, depois limite), cada um só com as suas chaves", async () => {
  const c = cenario({
    config: {
      ...configPronta(),
      site_url: "http://localhost:3000",
      rate_limit_email_sent: 2,
    },
  });
  assertEquals(await rodar(c, "acertar"), 0, c.tudo());
  const patches = c.chamadas
    .filter((x) => x.method === "PATCH")
    .map((x) => x.body);
  assertEquals(patches, [
    { site_url: `https://${DOMINIO}` },
    { rate_limit_email_sent: 30 },
  ]);
  assertStringIncludes(c.tudo(), "veredito: SIM");
});

Deno.test("acertar: limite recusado com 400 depois dos endereços gravados PARA com estado DESCONHECIDO e HTTP 400", async () => {
  // statusEm devolve 0 = segue normal; o 2º PATCH (o do limite) leva 400
  const c0 = { patchesVistos: 0 };
  const c = cenario({
    config: {
      ...configPronta(),
      site_url: "http://localhost:3000",
      rate_limit_email_sent: 2,
    },
    statusEm: (m, p) =>
      m === "PATCH" && p === "/config/auth" && c0.patchesVistos++ === 1
        ? 400
        : 0,
  });
  assertEquals(await rodar(c, "acertar"), 1);
  assertStringIncludes(c.tudo(), "HTTP 400");
  assertStringIncludes(c.tudo(), "DESCONHECIDO");
  assertEquals(c.config.site_url, `https://${DOMINIO}`, "os endereços ficaram");
  semVazamento(c);
});

Deno.test("acertar: site_url de OUTRO domínio PARA sem gravar, mostrando só o host", async () => {
  const c = cenario({
    config: {
      ...configRecemNascida(),
      site_url: "https://outra-loja.com.br/x?y=1",
    },
  });
  assertEquals(await rodar(c, "acertar"), 1);
  assertEquals(c.patches, 0);
  assertStringIncludes(c.tudo(), "outra-loja.com.br");
  assert(!c.tudo().includes("y=1"));
});

Deno.test("acertar: dominio_publico nulo ou fora do formato PARA sem gravar", async () => {
  for (const dominio of [null, "", "https://x.com", "Loja.com"]) {
    const c = cenario({ config: configRecemNascida(), dominio });
    assertEquals(await rodar(c, "acertar"), 1, String(dominio));
    assertEquals(c.patches, 0);
    assertStringIncludes(c.tudo(), "dominio_publico");
  }
});

Deno.test("acertar: outro campo do Auth mudou entre antes e depois PARA com estado DESCONHECIDO", async () => {
  const c = cenario({ config: configRecemNascida(), outroCampoMuda: true });
  assertEquals(await rodar(c, "acertar"), 1);
  assertStringIncludes(c.tudo(), "DESCONHECIDO");
  assertEquals(c.patches, 1, "não tenta de novo");
  semVazamento(c);
});

Deno.test("acertar: PATCH ignorado (releitura não confirma) PARA com estado DESCONHECIDO", async () => {
  const c = cenario({ config: configRecemNascida(), patchIgnorado: true });
  assertEquals(await rodar(c, "acertar"), 1);
  assertStringIncludes(c.tudo(), "releitura não confirmou");
  assertStringIncludes(c.tudo(), "DESCONHECIDO");
});

Deno.test("acertar: 402 (plano) no PATCH PARA com HTTP 402 e estado DESCONHECIDO", async () => {
  const c = cenario({
    config: configRecemNascida(),
    statusEm: (m) => (m === "PATCH" ? 402 : 0),
  });
  assertEquals(await rodar(c, "acertar"), 1);
  assertStringIncludes(c.tudo(), "HTTP 402");
  assertStringIncludes(c.tudo(), "DESCONHECIDO");
  semVazamento(c);
});

Deno.test("acertar mascara smtp_pass e o segredo do hook ANTES de qualquer saída, também na resposta do PATCH", async () => {
  const c = cenario({
    config: { ...configPronta(), site_url: "http://localhost:3000" },
  });
  await rodar(c, "acertar");
  for (const s of [TOKEN, SMTP_PASS, HOOK_HASH]) assert(c.mascaras.includes(s));
  semVazamento(c);
});
