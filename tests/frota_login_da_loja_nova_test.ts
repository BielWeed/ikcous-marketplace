// @ts-nocheck
/**
 * Login (Auth) da loja NOVA pela Management API (scripts/frota/login-da-loja-nova.mjs,
 * plano nova-loja B4, 26/11/2026). Nenhuma rede real: o fetch é um dublê que
 * imita a API (o GET /config/auth devolve o segredo do hook como HMAC-SHA256
 * em hex com chave = ref, como a API real; o GET /secrets devolve só nome e
 * um digest).
 *
 * O que estes testes travam:
 *  - tudo novo: segredo PRIMEIRO (POST /secrets), depois UM PATCH do Auth,
 *    depois a conferência; veredito SIM;
 *  - já configurado: 0 escritas, SIM;
 *  - meia configuração (só uma ponta do gancho, gancho de outro lugar ou
 *    ligado sem segredo): NÃO e 0 escritas — nunca substitui;
 *  - uri_allow_list preserva as URLs que já estão lá e não duplica o padrão;
 *  - o MESMO segredo vai para o secret da função e para o hook (o dublê
 *    compara sem imprimir);
 *  - PATCH só com as chaves da lista branca (nunca Google, SMTP, mailer);
 *  - sem --aplicar, 0 escritas;
 *  - segredo, HMAC e token nunca aparecem na saída;
 *  - domínio inválido ou com vírgula é recusado antes de qualquer rede.
 */
import { createHash, createHmac } from "node:crypto";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CHAVES_DO_PATCH,
  NOME_SEGREDO,
  configurarLoginNovo,
  lerArgumentos,
  main,
} from "../scripts/frota/login-da-loja-nova.mjs";
import { criarClienteGestao } from "../scripts/frota/supabase-gestao.mjs";

const REF = "abcdefghijklmnopqrst";
const DOMINIO = "loja-nova.exemplo.com.br";
const SITE = `https://${DOMINIO}`;
const PADRAO = `https://${DOMINIO}/**`;
const URI_HOOK = `https://${REF}.supabase.co/functions/v1/auth-send-email`;
const TOKEN = "sbp_oauth_TOKEN_FALSO_de_teste_nao_e_real";
const SEGREDO_ANTIGO = "texto-ficticio-de-teste-que-nao-e-segredo";
const RE_SEGREDO = /^v1,whsec_[A-Za-z0-9+/]{43}=$/;

const hmac = (texto) => createHmac("sha256", REF).update(texto).digest("hex");

const configNova = (extra = {}) => ({
  site_url: "http://localhost:3000",
  uri_allow_list: "",
  rate_limit_email_sent: 2,
  mailer_autoconfirm: false,
  external_google_enabled: false,
  hook_send_email_enabled: false,
  hook_send_email_uri: null,
  hook_send_email_secrets: null,
  smtp_host: null,
  smtp_port: null,
  smtp_user: null,
  smtp_pass: null,
  smtp_admin_email: null,
  ...extra,
});

const configPronta = (extra = {}) =>
  configNova({
    site_url: SITE,
    uri_allow_list: PADRAO,
    hook_send_email_uri: URI_HOOK,
    hook_send_email_secrets: hmac(SEGREDO_ANTIGO),
    ...extra,
  });

const secretDaFuncao = (nome = NOME_SEGREDO) => ({
  name: nome,
  value: createHash("sha256").update(SEGREDO_ANTIGO).digest("hex"),
});

function json(status, corpo) {
  return new Response(corpo === undefined ? "" : JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Dublê da Management API. Guarda o estado, aplica PATCH e POST /secrets como
 * a API real (o hook vira HMAC na leitura), anota a ordem das chamadas e
 * GUARDA EM PARTICULAR o texto puro que chegou em cada ponta — o teste só
 * compara, nunca imprime.
 *
 * `falhar`: { postSecret?: status | "rede", patch?: status | "rede",
 *            patchAplicaEPerde?: true } (aplica o PATCH e "perde" a resposta).
 */
function apiFalsa({ config, secrets = [], falhar = {} } = {}) {
  const estado = {
    config: structuredClone(config),
    secrets: structuredClone(secrets),
  };
  const privado = { noSecret: undefined, noHook: undefined };
  const chamadas = [];
  const corposDoPatch = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    const caminho = u.pathname;
    chamadas.push({
      metodo,
      caminho,
      autorizacao: new Headers(init.headers).get("authorization"),
    });
    if (caminho === `/v1/projects/${REF}/config/auth`) {
      if (metodo === "GET") return json(200, estado.config);
      if (metodo === "PATCH") {
        const corpo = JSON.parse(init.body);
        corposDoPatch.push(Object.keys(corpo));
        if (falhar.patch === "rede") throw new TypeError("rede caiu");
        if (typeof falhar.patch === "number") return json(falhar.patch, {});
        for (const [k, v] of Object.entries(corpo)) {
          if (k === "hook_send_email_secrets") {
            privado.noHook = v;
            Reflect.set(estado.config, k, hmac(v));
          } else Reflect.set(estado.config, k, v);
        }
        if (falhar.patchAplicaEPerde) throw new TypeError("resposta perdida");
        return json(200, estado.config);
      }
    }
    if (caminho === `/v1/projects/${REF}/secrets`) {
      if (metodo === "GET") return json(200, estado.secrets);
      if (metodo === "POST") {
        if (falhar.postSecret === "rede") throw new TypeError("rede caiu");
        if (typeof falhar.postSecret === "number")
          return json(falhar.postSecret, {});
        for (const s of JSON.parse(init.body)) {
          privado.noSecret = s.value;
          estado.secrets = estado.secrets.filter((x) => x.name !== s.name);
          estado.secrets.push({
            name: s.name,
            value: createHash("sha256").update(s.value).digest("hex"),
          });
        }
        return json(201);
      }
    }
    return json(404, { message: "rota que o dublê não conhece" });
  };
  const escritas = () => chamadas.filter((c) => c.metodo !== "GET");
  return { fetch, estado, privado, chamadas, escritas, corposDoPatch };
}

const cliente = (api) =>
  criarClienteGestao({ token: TOKEN, fetch: api.fetch, prazoMs: 2000 });

async function rodar(api, { aplicar = true, dominio = DOMINIO } = {}) {
  return await configurarLoginNovo({
    cliente: cliente(api),
    ref: REF,
    dominio,
    aplicar,
  });
}

/** Nada destes textos pode aparecer em nenhuma linha nem no objeto devolvido. */
function assertSemSegredo(r, api) {
  const tudo = `${r.linhas.join("\n")}\n${JSON.stringify(r)}`;
  const proibidos = [TOKEN, SEGREDO_ANTIGO, hmac(SEGREDO_ANTIGO)];
  for (const p of [api.privado.noSecret, api.privado.noHook]) {
    if (typeof p === "string") {
      proibidos.push(p, p.replace(/^v1,whsec_/, ""), hmac(p));
    }
  }
  for (const p of proibidos) {
    assert(!tudo.includes(p), "a saída vazou um trecho secreto (não impresso)");
  }
}

// ---------------------------------------------------------------------------
// tudo novo
// ---------------------------------------------------------------------------

Deno.test("tudo novo: segredo primeiro, depois UM PATCH, confere e dá SIM", async () => {
  const api = apiFalsa({ config: configNova() });
  const r = await rodar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  const escritas = api.escritas().map((c) => `${c.metodo} ${c.caminho}`);
  assertEquals(escritas, [
    `POST /v1/projects/${REF}/secrets`,
    `PATCH /v1/projects/${REF}/config/auth`,
  ]);
  // depois das escritas, a conferência relê as duas pontas
  const depois = api.chamadas
    .slice(api.chamadas.findIndex((c) => c.metodo === "PATCH") + 1)
    .map((c) => `${c.metodo} ${c.caminho}`);
  assert(depois.includes(`GET /v1/projects/${REF}/config/auth`));
  assert(depois.includes(`GET /v1/projects/${REF}/secrets`));

  const c = api.estado.config;
  assertEquals(c.site_url, SITE);
  assertEquals(c.uri_allow_list, PADRAO);
  assertEquals(c.hook_send_email_uri, URI_HOOK);
  // preparado DESLIGADO, como o "preparar" das lojas reais: liga só depois do Gmail
  assertEquals(c.hook_send_email_enabled, false);
  assertEquals(c.external_google_enabled, false);
  assert(api.estado.secrets.some((s) => s.name === NOME_SEGREDO));
  assertSemSegredo(r, api);
});

Deno.test("tudo novo: o MESMO segredo forte vai para o secret da função e para o hook (comparado sem imprimir)", async () => {
  const api = apiFalsa({ config: configNova() });
  const r = await rodar(api);
  assertEquals(r.veredito, "SIM");
  assert(typeof api.privado.noSecret === "string", "o secret não foi gravado");
  assert(typeof api.privado.noHook === "string", "o hook não foi gravado");
  assert(
    api.privado.noSecret === api.privado.noHook,
    "o secret da função e o hook receberam valores DIFERENTES (não impressos)",
  );
  assert(RE_SEGREDO.test(api.privado.noSecret), "segredo fora do formato");
  assertSemSegredo(r, api);
});

Deno.test("tudo novo: duas lojas recebem segredos diferentes (gerado na hora, não fixo)", async () => {
  const a = apiFalsa({ config: configNova() });
  const b = apiFalsa({ config: configNova() });
  await rodar(a);
  await rodar(b);
  assert(a.privado.noSecret !== b.privado.noSecret, "segredo repetido");
});

// ---------------------------------------------------------------------------
// sem --aplicar
// ---------------------------------------------------------------------------

Deno.test("sem --aplicar: 0 escritas, mostra o plano e dá NÃO (falta aplicar)", async () => {
  const api = apiFalsa({ config: configNova() });
  const r = await rodar(api, { aplicar: false });
  assertEquals(api.escritas().length, 0);
  assertEquals(r.veredito, "NÃO");
  const texto = r.linhas.join("\n");
  assertStringIncludes(texto, "ENSAIO");
  assertStringIncludes(texto, PADRAO);
  assertStringIncludes(texto, "--aplicar");
  assertSemSegredo(r, api);
});

Deno.test("sem --aplicar e já configurado: 0 escritas e SIM", async () => {
  const api = apiFalsa({ config: configPronta(), secrets: [secretDaFuncao()] });
  const r = await rodar(api, { aplicar: false });
  assertEquals(api.escritas().length, 0);
  assertEquals(r.veredito, "SIM");
});

// ---------------------------------------------------------------------------
// já configurado / meia configuração
// ---------------------------------------------------------------------------

Deno.test("já configurado (as duas pontas presentes): 0 escritas, SIM, não troca o segredo", async () => {
  for (const ligado of [false, true]) {
    // ligado = remetente próprio: a loja pronta já tem o limite de 30/h
    const api = apiFalsa({
      config: configPronta({
        hook_send_email_enabled: ligado,
        rate_limit_email_sent: ligado ? 30 : 2,
      }),
      secrets: [secretDaFuncao("OUTRO_SECRET"), secretDaFuncao()],
    });
    const r = await rodar(api);
    assertEquals(api.escritas().length, 0, `ligado=${ligado}`);
    assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
    assertEquals(
      api.estado.config.hook_send_email_secrets,
      hmac(SEGREDO_ANTIGO),
    );
    assertEquals(api.estado.config.hook_send_email_enabled, ligado);
    assertSemSegredo(r, api);
  }
});

Deno.test("gancho pronto e só os endereços faltando: PATCH só dos endereços, sem tocar no gancho", async () => {
  const api = apiFalsa({
    config: configPronta({
      site_url: "http://localhost:3000",
      uri_allow_list: "",
    }),
    secrets: [secretDaFuncao()],
  });
  const r = await rodar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  assertEquals(
    api.escritas().map((c) => c.metodo),
    ["PATCH"],
  );
  assertEquals(api.corposDoPatch, [["site_url", "uri_allow_list"]]);
  assertEquals(api.estado.config.hook_send_email_secrets, hmac(SEGREDO_ANTIGO));
});

Deno.test("gancho pronto e LIGADO com limite baixo: só o PATCH do limite (regra das lojas reais), gancho intocado", async () => {
  const api = apiFalsa({
    config: configPronta({ hook_send_email_enabled: true }),
    secrets: [secretDaFuncao()],
  });
  const r = await rodar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  assertEquals(api.corposDoPatch, [["rate_limit_email_sent"]]);
  assertEquals(api.estado.config.rate_limit_email_sent, 30);
  assertEquals(api.estado.config.hook_send_email_secrets, hmac(SEGREDO_ANTIGO));
  assertEquals(api.estado.config.hook_send_email_enabled, true);
});

const MEIAS = [
  ["só o secret da função, sem hook no Auth", configNova(), [secretDaFuncao()]],
  [
    "hook no Auth (endereço e hash), sem o secret da função",
    configPronta(),
    [],
  ],
  [
    "hook LIGADO sem endereço nem segredo",
    configNova({ hook_send_email_enabled: true }),
    [],
  ],
  [
    "hook ligado de OUTRO projeto, mesmo com o secret",
    configPronta({
      hook_send_email_enabled: true,
      hook_send_email_uri:
        "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/auth-send-email",
    }),
    [secretDaFuncao()],
  ],
  [
    "hash do hook presente sem endereço",
    configNova({ hook_send_email_secrets: hmac(SEGREDO_ANTIGO) }),
    [],
  ],
  [
    "endereço do hook presente sem hash",
    configNova({ hook_send_email_uri: URI_HOOK }),
    [],
  ],
];

for (const [nome, config, secrets] of MEIAS) {
  Deno.test(`meia configuração (${nome}): NÃO e 0 escritas, nem dos endereços`, async () => {
    const api = apiFalsa({ config, secrets });
    const antes = structuredClone(api.estado);
    const r = await rodar(api);
    assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
    assertEquals(api.escritas().length, 0);
    assertEquals(api.estado, antes);
    assertStringIncludes(r.linhas.join("\n"), "não substituo");
    assertSemSegredo(r, api);
  });
}

Deno.test("site_url de outro endereço: NÃO e 0 escritas (regra das lojas reais)", async () => {
  const api = apiFalsa({
    config: configNova({ site_url: "https://outra-loja.exemplo.com" }),
  });
  const r = await rodar(api);
  assertEquals(r.veredito, "NÃO");
  assertEquals(api.escritas().length, 0);
  assertStringIncludes(r.linhas.join("\n"), "outra-loja.exemplo.com");
});

// ---------------------------------------------------------------------------
// uri_allow_list
// ---------------------------------------------------------------------------

Deno.test("uri_allow_list: preserva as URLs que já existem, na ordem, e acrescenta o padrão uma vez", async () => {
  const existente = "https://antiga.exemplo.com/**,http://localhost:3000/**";
  const api = apiFalsa({ config: configNova({ uri_allow_list: existente }) });
  const r = await rodar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  assertEquals(api.estado.config.uri_allow_list, `${existente},${PADRAO}`);
});

Deno.test("uri_allow_list: com o padrão já lá, não duplica nem manda a lista no PATCH", async () => {
  const existente = `https://antiga.exemplo.com/**,${PADRAO}`;
  const api = apiFalsa({ config: configNova({ uri_allow_list: existente }) });
  const r = await rodar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  assertEquals(api.estado.config.uri_allow_list, existente);
  for (const chaves of api.corposDoPatch) {
    assert(!chaves.includes("uri_allow_list"));
  }
});

// ---------------------------------------------------------------------------
// lista branca do PATCH
// ---------------------------------------------------------------------------

Deno.test("PATCH só com as chaves da lista branca (nunca Google, SMTP nem mailer)", async () => {
  const smtp = {
    smtp_host: "smtp.exemplo.com",
    smtp_port: "587",
    smtp_user: "loja@exemplo.com",
    smtp_pass: SEGREDO_ANTIGO,
    smtp_admin_email: "loja@exemplo.com",
  };
  for (const config of [configNova(), configNova(smtp)]) {
    const api = apiFalsa({ config });
    const r = await rodar(api);
    assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
    assert(api.corposDoPatch.length >= 1);
    for (const chaves of api.corposDoPatch) {
      for (const k of chaves) {
        assert(CHAVES_DO_PATCH.includes(k), `chave fora da lista: ${k}`);
      }
    }
    assertSemSegredo(r, api);
  }
  assertEquals([...CHAVES_DO_PATCH].sort(), [
    "hook_send_email_enabled",
    "hook_send_email_secrets",
    "hook_send_email_uri",
    "rate_limit_email_sent",
    "site_url",
    "uri_allow_list",
  ]);
});

Deno.test("SMTP completo: o limite de e-mails vai num PATCH SEPARADO, depois dos endereços e do gancho", async () => {
  const api = apiFalsa({
    config: configNova({
      smtp_host: "smtp.exemplo.com",
      smtp_port: "587",
      smtp_user: "loja@exemplo.com",
      smtp_pass: SEGREDO_ANTIGO,
      smtp_admin_email: "loja@exemplo.com",
    }),
  });
  const r = await rodar(api);
  assertEquals(r.veredito, "SIM");
  assertEquals(api.corposDoPatch.length, 2);
  assert(!api.corposDoPatch[0].includes("rate_limit_email_sent"));
  assertEquals(api.corposDoPatch[1], ["rate_limit_email_sent"]);
  assertEquals(api.estado.config.rate_limit_email_sent, 30);
});

// ---------------------------------------------------------------------------
// falhas no meio
// ---------------------------------------------------------------------------

Deno.test("POST do secret recusado: nenhum PATCH, NÃO, e diz que nada do gancho ficou gravado", async () => {
  const api = apiFalsa({ config: configNova(), falhar: { postSecret: 400 } });
  const r = await rodar(api);
  assertEquals(r.veredito, "NÃO");
  assertEquals(
    api.escritas().map((c) => c.metodo),
    ["POST"],
  );
  assertStringIncludes(r.linhas.join("\n"), "pode rodar de novo com --aplicar");
  assertSemSegredo(r, api);
});

Deno.test("PATCH falha DEPOIS do secret: NÃO, relata o estado (segredo só na função) e o que fazer", async () => {
  for (const falha of [500, "rede"]) {
    const api = apiFalsa({ config: configNova(), falhar: { patch: falha } });
    const r = await rodar(api);
    assert(r.veredito !== "SIM", `falha=${falha}`);
    const texto = r.linhas.join("\n");
    assertStringIncludes(texto, NOME_SEGREDO);
    assertStringIncludes(texto, "só na função");
    assertStringIncludes(texto, "apague");
    assertSemSegredo(r, api);
  }
});

Deno.test("PATCH aplicado mas resposta perdida: a releitura bate, mesmo assim INCERTO (nunca SIM)", async () => {
  const api = apiFalsa({
    config: configNova(),
    falhar: { patchAplicaEPerde: true },
  });
  const r = await rodar(api);
  assertEquals(r.veredito, "INCERTO", r.linhas.join("\n"));
  assertStringIncludes(r.linhas.join("\n"), "sem --aplicar");
  assertSemSegredo(r, api);
});

Deno.test("leitura inicial falha: INCERTO e 0 escritas", async () => {
  const api = apiFalsa({ config: configNova() });
  const quebrado = async (url, init) => {
    if (String(url).endsWith("/secrets")) return json(500, {});
    return api.fetch(url, init);
  };
  const r = await configurarLoginNovo({
    cliente: criarClienteGestao({ token: TOKEN, fetch: quebrado }),
    ref: REF,
    dominio: DOMINIO,
    aplicar: true,
  });
  assertEquals(r.veredito, "INCERTO");
  assertEquals(api.escritas().length, 0);
});

Deno.test("configuração com formato inesperado no hook: INCERTO e 0 escritas", async () => {
  const api = apiFalsa({
    config: configNova({ hook_send_email_enabled: "sim" }),
  });
  const r = await rodar(api);
  assertEquals(r.veredito, "INCERTO");
  assertEquals(api.escritas().length, 0);
});

// ---------------------------------------------------------------------------
// argumentos
// ---------------------------------------------------------------------------

const BASE = ["--projeto", REF, "--loja", "loja-nova", "--dominio", SITE];

Deno.test("argumentos: os três obrigatórios, --aplicar opcional, domínio vira host", () => {
  assertEquals(lerArgumentos(BASE), {
    projeto: REF,
    loja: "loja-nova",
    dominio: DOMINIO,
    aplicar: false,
  });
  assertEquals(lerArgumentos([...BASE, "--aplicar"]).aplicar, true);
  assertEquals(
    lerArgumentos([
      "--projeto",
      REF,
      "--loja",
      "loja-nova",
      "--dominio",
      `${SITE}/`,
    ]).dominio,
    DOMINIO,
  );
});

Deno.test("argumentos: domínio inválido ou com vírgula é recusado", () => {
  const ruins = [
    `${SITE},https://intrusa.exemplo.com`,
    "https://a.exemplo.com,b.exemplo.com",
    `http://${DOMINIO}`,
    DOMINIO,
    `https://${DOMINIO}/caminho`,
    `https://${DOMINIO}/**`,
    `https://${DOMINIO}:8443`,
    `https://${DOMINIO}?x=1`,
    `https://${DOMINIO}#x`,
    "https://LOJA.exemplo.com",
    "https://usuario@loja.exemplo.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://",
    "",
    ` ${SITE}`,
  ];
  for (const d of ruins) {
    assertThrows(
      () =>
        lerArgumentos([
          "--projeto",
          REF,
          "--loja",
          "loja-nova",
          "--dominio",
          d,
        ]),
      Error,
      undefined,
      `aceitou: ${d}`,
    );
  }
});

Deno.test("argumentos: falta, repetição, desconhecido, ref e loja fora do formato são recusados", () => {
  const ruins = [
    [],
    ["--projeto", REF, "--loja", "loja-nova"],
    ["--projeto", REF, "--dominio", SITE],
    ["--loja", "loja-nova", "--dominio", SITE],
    [...BASE, "--projeto", REF],
    [...BASE, "--aplicar", "--aplicar"],
    [...BASE, "--forcar"],
    [
      "--projeto",
      "ABCDEFGHIJKLMNOPQRST",
      "--loja",
      "loja-nova",
      "--dominio",
      SITE,
    ],
    ["--projeto", "curto", "--loja", "loja-nova", "--dominio", SITE],
    ["--projeto", REF, "--loja", "../cofre", "--dominio", SITE],
    ["--projeto", REF, "--loja", "--dominio", SITE],
  ];
  for (const a of ruins) {
    assertThrows(() => lerArgumentos(a), Error, undefined, a.join(" "));
  }
});

// ---------------------------------------------------------------------------
// main: token e saída
// ---------------------------------------------------------------------------

function saidaFalsa() {
  const linhas = [];
  return {
    linhas,
    log: (l) => linhas.push(String(l)),
    erro: (l) => linhas.push(String(l)),
  };
}

Deno.test("main: argumento ruim sai 2 sem pedir token nem chamar a rede", async () => {
  const api = apiFalsa({ config: configNova() });
  let pediuToken = false;
  const saida = saidaFalsa();
  const codigo = await main(
    [
      "--projeto",
      REF,
      "--loja",
      "loja-nova",
      "--dominio",
      "https://a.com,b.com",
    ],
    {
      obterToken: async () => {
        pediuToken = true;
        return TOKEN;
      },
      fetch: api.fetch,
      saida,
    },
  );
  assertEquals(codigo, 2);
  assertEquals(pediuToken, false);
  assertEquals(api.chamadas.length, 0);
});

Deno.test("main: usa o token da loja (--loja) no cabeçalho e nunca o imprime; SIM sai 0", async () => {
  const api = apiFalsa({ config: configNova() });
  const saida = saidaFalsa();
  let lojaPedida;
  const codigo = await main([...BASE, "--aplicar"], {
    obterToken: async (loja) => {
      lojaPedida = loja;
      return TOKEN;
    },
    fetch: api.fetch,
    saida,
  });
  assertEquals(codigo, 0, saida.linhas.join("\n"));
  assertEquals(lojaPedida, "loja-nova");
  assert(api.chamadas.every((c) => c.autorizacao === `Bearer ${TOKEN}`));
  assertSemSegredo({ linhas: saida.linhas }, api);
});

Deno.test("main: falha da API e do token não vazam token nem segredo; não-SIM sai diferente de 0", async () => {
  const api = apiFalsa({ config: configNova(), falhar: { patch: 500 } });
  const saida = saidaFalsa();
  const codigo = await main([...BASE, "--aplicar"], {
    obterToken: async () => TOKEN,
    fetch: api.fetch,
    saida,
  });
  assert(codigo !== 0);
  assertSemSegredo({ linhas: saida.linhas }, api);

  const saida2 = saidaFalsa();
  const codigo2 = await main(BASE, {
    obterToken: async () => {
      throw new Error(`cofre quebrou com ${TOKEN}`);
    },
    fetch: api.fetch,
    saida: saida2,
  });
  assert(codigo2 !== 0);
  assert(!saida2.linhas.join("\n").includes(TOKEN), "vazou o token");
});

Deno.test("main: 401 vira mensagem de acesso, sem token", async () => {
  const saida = saidaFalsa();
  const codigo = await main(BASE, {
    obterToken: async () => TOKEN,
    fetch: async () => json(401, { message: TOKEN }),
    saida,
  });
  assert(codigo !== 0);
  const texto = saida.linhas.join("\n");
  assert(!texto.includes(TOKEN));
  assertMatch(texto, /INCERTO/);
});
