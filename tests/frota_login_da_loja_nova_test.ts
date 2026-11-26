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
 *
 * E o `ativarGanchoNovo` (plano nova-loja-fechar, T6), no fim do arquivo:
 *  - pré-condições só lidas (Gmail cadastrado, auth-send-email ACTIVE com
 *    verify_jwt desligado, gancho preparado): qualquer uma faltando é NÃO e
 *    0 escritas;
 *  - os PATCHes só levam hook_send_email_enabled=true e o limite de 30/h;
 *  - releitura que não confirma é INCERTO (nunca SIM);
 *  - sem `aplicar`, 0 escritas; IKCOUS/Savy e alvo legado recusados antes de
 *    qualquer rede; nenhum segredo (senha de app, gancho, token) na saída.
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
  CHAVES_DA_ATIVACAO,
  CHAVES_DO_PATCH,
  NOME_SEGREDO,
  ativarGanchoNovo,
  configurarLoginNovo,
  lerArgumentos,
  main,
} from "../scripts/frota/login-da-loja-nova.mjs";
import {
  LOJAS_LEGADAS,
  LOJAS_PROTEGIDAS,
  REFS_PROTEGIDOS,
} from "../scripts/frota/nova-loja.mjs";
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

// ---------------------------------------------------------------------------
// ativarGanchoNovo: ligar o gancho da loja nova (plano nova-loja-fechar, T6)
// ---------------------------------------------------------------------------

/** Texto inventado no lugar da senha de app do Gmail: nunca pode sair. */
const SENHA_DE_APP = "senha-de-app-inventada-wxyz";
const CAMINHO_CONSULTA = `/v1/projects/${REF}/database/query`;
const ALVO = { hook_send_email_enabled: true, rate_limit_email_sent: 30 };

const funcaoDoGancho = (extra = {}) => ({
  id: "id-inventado",
  slug: "auth-send-email",
  name: "auth-send-email",
  status: "ACTIVE",
  version: 3,
  verify_jwt: false,
  ...extra,
});

/** O estado que o login-da-loja-nova deixa: gancho preparado DESLIGADO. */
const configPreparada = (extra = {}) =>
  configPronta({ rate_limit_email_sent: 2, ...extra });

/**
 * Dublê da Management API para a ativação: /config/auth (GET e PATCH),
 * /secrets (GET), /functions (GET) e /database/query (a consulta do Gmail).
 * `falhar`: { lerConfig?: status, patch?: status | "rede",
 *   patchSemEfeito?: true (responde 200 e não grava), consulta?: status }.
 * Os corpos de erro carregam texto secreto de propósito: não pode vazar.
 */
function apiDaAtivacao({
  config = configPreparada(),
  secrets = [secretDaFuncao()],
  funcoes = [funcaoDoGancho()],
  gmail = true,
  linhasDoGmail,
  falhar = {},
} = {}) {
  const estado = { config: structuredClone(config) };
  const chamadas = [];
  const corposDoPatch = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    const caminho = u.pathname;
    const chamada = { metodo, caminho, leitura: metodo === "GET" };
    chamadas.push(chamada);
    if (caminho === `/v1/projects/${REF}/config/auth`) {
      if (metodo === "GET") {
        if (typeof falhar.lerConfig === "number")
          return json(falhar.lerConfig, { message: TOKEN });
        return json(200, estado.config);
      }
      if (metodo === "PATCH") {
        const corpo = JSON.parse(init.body);
        corposDoPatch.push(corpo);
        if (falhar.patch === "rede") throw new TypeError(`rede caiu ${TOKEN}`);
        if (typeof falhar.patch === "number")
          return json(falhar.patch, { message: SEGREDO_ANTIGO });
        if (!falhar.patchSemEfeito)
          for (const [k, v] of Object.entries(corpo))
            Reflect.set(estado.config, k, v);
        return json(200, estado.config);
      }
    }
    if (caminho === `/v1/projects/${REF}/secrets` && metodo === "GET")
      return json(200, secrets);
    if (caminho === `/v1/projects/${REF}/functions` && metodo === "GET")
      return json(200, funcoes);
    if (caminho === CAMINHO_CONSULTA && metodo === "POST") {
      const corpo = JSON.parse(init.body);
      // só conta como leitura se pediu read_only E é a consulta do Gmail
      chamada.leitura =
        corpo.read_only === true && /gmail_cadastrado/.test(corpo.query);
      if (typeof falhar.consulta === "number")
        return json(falhar.consulta, { message: SENHA_DE_APP });
      return json(
        201,
        linhasDoGmail ?? [
          { dominio_publico: DOMINIO, gmail_cadastrado: gmail },
        ],
      );
    }
    return json(404, { message: "rota que o dublê não conhece" });
  };
  const escritas = () => chamadas.filter((c) => !c.leitura);
  return { fetch, estado, chamadas, escritas, corposDoPatch };
}

async function ativar(api, { aplicar = true, ref = REF, cadastro } = {}) {
  return await ativarGanchoNovo({
    cliente: cliente(api),
    ref,
    aplicar,
    ...(cadastro === undefined ? {} : { cadastro }),
  });
}

function assertSemSegredoNaAtivacao(r) {
  const tudo = `${r.linhas.join("\n")}\n${JSON.stringify(r)}`;
  const proibidos = [
    TOKEN,
    SEGREDO_ANTIGO,
    hmac(SEGREDO_ANTIGO),
    createHash("sha256").update(SEGREDO_ANTIGO).digest("hex"),
    SENHA_DE_APP,
  ];
  for (const p of proibidos)
    assert(!tudo.includes(p), "a saída vazou um trecho secreto (não impresso)");
}

Deno.test("ativar: tudo pronto e Gmail cadastrado liga o gancho, sobe o limite para 30, relê e dá SIM", async () => {
  const api = apiDaAtivacao();
  const antes = structuredClone(api.estado.config);
  const r = await ativar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  const c = api.estado.config;
  assertEquals(c.hook_send_email_enabled, true);
  assertEquals(c.rate_limit_email_sent, 30);
  // o resto do Auth (inclusive endereço e segredo do gancho) ficou igual
  for (const k of Object.keys(antes))
    if (!CHAVES_DA_ATIVACAO.includes(k))
      assertEquals(Reflect.get(c, k), Reflect.get(antes, k), k);
  // releu depois do último PATCH
  const ultimoPatch = api.chamadas.findLastIndex((x) => x.metodo === "PATCH");
  assert(
    api.chamadas
      .slice(ultimoPatch + 1)
      .some(
        (x) =>
          x.metodo === "GET" && x.caminho === `/v1/projects/${REF}/config/auth`,
      ),
    "não releu o Auth depois de gravar",
  );
  assertSemSegredoNaAtivacao(r);
});

Deno.test("ativar: os PATCHes só levam as duas chaves permitidas (gancho primeiro, depois o limite)", async () => {
  assertEquals([...CHAVES_DA_ATIVACAO].sort(), Object.keys(ALVO).sort());
  const api = apiDaAtivacao();
  await ativar(api);
  assertEquals(api.corposDoPatch, [
    { hook_send_email_enabled: true },
    { rate_limit_email_sent: 30 },
  ]);
  // e nenhuma outra escrita (nem secret, nem consulta que grava)
  assertEquals(
    api.escritas().map((x) => `${x.metodo} ${x.caminho}`),
    [
      `PATCH /v1/projects/${REF}/config/auth`,
      `PATCH /v1/projects/${REF}/config/auth`,
    ],
  );
});

Deno.test("ativar: já ligado e com o limite de 30: 0 escritas e SIM (rodar duas vezes não grava de novo)", async () => {
  const api = apiDaAtivacao({ config: configPreparada(ALVO) });
  const r = await ativar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  assertEquals(api.escritas().length, 0);
  const segunda = apiDaAtivacao();
  await ativar(segunda);
  const r2 = await ativar(segunda);
  assertEquals(r2.veredito, "SIM", r2.linhas.join("\n"));
  assertEquals(segunda.corposDoPatch.length, 2, "a segunda rodada gravou");
});

Deno.test("ativar: ligado com limite baixo: só o PATCH do limite", async () => {
  const api = apiDaAtivacao({
    config: configPreparada({ hook_send_email_enabled: true }),
  });
  const r = await ativar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  assertEquals(api.corposDoPatch, [{ rate_limit_email_sent: 30 }]);
});

Deno.test("ativar: sem Gmail cadastrado: NÃO e 0 escritas", async () => {
  const api = apiDaAtivacao({ gmail: false });
  const antes = structuredClone(api.estado);
  const r = await ativar(api);
  assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
  assertEquals(api.escritas().length, 0);
  assertEquals(api.estado, antes);
  assertMatch(r.linhas.join("\n"), /FALTA — Gmail/);
  assertSemSegredoNaAtivacao(r);
});

const FUNCOES_RUINS = [
  ["function ausente", []],
  [
    "function de outro nome só",
    [funcaoDoGancho({ slug: "outra", name: "outra" })],
  ],
  ["function REMOVED", [funcaoDoGancho({ status: "REMOVED" })]],
  ["function THROTTLED", [funcaoDoGancho({ status: "THROTTLED" })]],
  ["verify_jwt ligado", [funcaoDoGancho({ verify_jwt: true })]],
  ["verify_jwt ausente", [funcaoDoGancho({ verify_jwt: undefined })]],
];

for (const [nome, funcoes] of FUNCOES_RUINS) {
  Deno.test(`ativar: ${nome}: NÃO e 0 escritas`, async () => {
    const api = apiDaAtivacao({ funcoes });
    const r = await ativar(api);
    assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
    assertEquals(api.escritas().length, 0);
    assertMatch(r.linhas.join("\n"), /FALTA — (function|verify_jwt)/);
  });
}

const GANCHOS_MEIO_CONFIGURADOS = [
  ["sem o secret na função", configPreparada(), []],
  [
    "secret com outro nome",
    configPreparada(),
    [secretDaFuncao("OUTRO_SEGREDO")],
  ],
  [
    "endereço de outro projeto",
    configPreparada({
      hook_send_email_uri:
        "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/auth-send-email",
    }),
    [secretDaFuncao()],
  ],
  [
    "sem endereço",
    configPreparada({ hook_send_email_uri: null }),
    [secretDaFuncao()],
  ],
  [
    "sem hash no Auth",
    configPreparada({ hook_send_email_secrets: null }),
    [secretDaFuncao()],
  ],
  [
    "hash fora do formato",
    configPreparada({ hook_send_email_secrets: "v1,whsec_textoPuroNaoEHash" }),
    [secretDaFuncao()],
  ],
];

for (const [nome, config, secrets] of GANCHOS_MEIO_CONFIGURADOS) {
  Deno.test(`ativar: gancho meio configurado (${nome}): NÃO e 0 escritas`, async () => {
    const api = apiDaAtivacao({ config, secrets });
    const antes = structuredClone(api.estado);
    const r = await ativar(api);
    assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
    assertEquals(api.escritas().length, 0);
    assertEquals(api.estado, antes);
    assertMatch(r.linhas.join("\n"), /FALTA — gancho de e-mail preparado/);
    assertSemSegredoNaAtivacao(r);
  });
}

Deno.test("ativar: sem aplicar: 0 escritas, mostra o plano e dá NÃO", async () => {
  for (const aplicar of [false, undefined, "sim"]) {
    const api = apiDaAtivacao();
    const r = await ativarGanchoNovo({
      cliente: cliente(api),
      ref: REF,
      aplicar,
    });
    assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
    assertEquals(api.escritas().length, 0);
    assertMatch(r.linhas.join("\n"), /plano — hook_send_email_enabled/);
    assertMatch(r.linhas.join("\n"), /ENSAIO/);
  }
});

Deno.test("ativar: PATCH responde OK mas a releitura diverge: INCERTO (nunca SIM)", async () => {
  const api = apiDaAtivacao({ falhar: { patchSemEfeito: true } });
  const r = await ativar(api);
  assertEquals(r.veredito, "INCERTO", r.linhas.join("\n"));
  assertSemSegredoNaAtivacao(r);
});

Deno.test("ativar: outro campo do Auth muda durante a operação: INCERTO", async () => {
  const api = apiDaAtivacao();
  const fetchOriginal = api.fetch;
  let patches = 0;
  const fetch = async (url, init = {}) => {
    const resposta = await fetchOriginal(url, init);
    if ((init.method ?? "GET") === "PATCH" && ++patches === 2)
      api.estado.config.site_url = "https://outra.exemplo.com.br";
    return resposta;
  };
  const r = await ativarGanchoNovo({
    cliente: criarClienteGestao({ token: TOKEN, fetch, prazoMs: 2000 }),
    ref: REF,
    aplicar: true,
  });
  assertEquals(r.veredito, "INCERTO", r.linhas.join("\n"));
});

Deno.test("ativar: PATCH recusado: nunca SIM, não manda o limite, e diz que nada mudou", async () => {
  const api = apiDaAtivacao({ falhar: { patch: 500 } });
  const r = await ativar(api);
  assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
  assertEquals(api.corposDoPatch, [{ hook_send_email_enabled: true }]);
  assertMatch(r.linhas.join("\n"), /nada mudou/);
  assertSemSegredoNaAtivacao(r);
});

Deno.test("ativar: rede cai no PATCH: nunca SIM e nada secreto na saída", async () => {
  const api = apiDaAtivacao({ falhar: { patch: "rede" } });
  const r = await ativar(api);
  assert(r.veredito !== "SIM", r.linhas.join("\n"));
  assertSemSegredoNaAtivacao(r);
});

Deno.test("ativar: leitura falha (Auth, consulta do Gmail): INCERTO e 0 escritas, sem segredo", async () => {
  for (const falhar of [{ lerConfig: 500 }, { consulta: 500 }]) {
    const api = apiDaAtivacao({ falhar });
    const r = await ativar(api);
    assertEquals(r.veredito, "INCERTO", r.linhas.join("\n"));
    assertEquals(api.escritas().length, 0);
    assertSemSegredoNaAtivacao(r);
  }
});

Deno.test("ativar: consulta do Gmail com coluna a mais (até a senha de app): INCERTO, 0 escritas e a senha não sai", async () => {
  const api = apiDaAtivacao({
    linhasDoGmail: [
      {
        dominio_publico: DOMINIO,
        gmail_cadastrado: true,
        senha_cifrada: SENHA_DE_APP,
      },
    ],
  });
  const r = await ativar(api);
  assertEquals(r.veredito, "INCERTO", r.linhas.join("\n"));
  assertEquals(api.escritas().length, 0);
  assertSemSegredoNaAtivacao(r);
});

Deno.test("ativar: a consulta do Gmail vai como read_only", async () => {
  const api = apiDaAtivacao();
  await ativar(api);
  const consultas = api.chamadas.filter((c) => c.caminho === CAMINHO_CONSULTA);
  assertEquals(consultas.length, 1);
  assert(consultas[0].leitura, "a consulta do Gmail não foi read_only");
});

Deno.test("ativar: IKCOUS e Savy (refs fixos do nova-loja) recusados antes de qualquer rede", async () => {
  assert(REFS_PROTEGIDOS.length >= 2);
  for (const ref of REFS_PROTEGIDOS) {
    const api = apiDaAtivacao();
    const r = await ativar(api, { ref });
    assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
    assertEquals(api.chamadas.length, 0);
  }
});

/** Cadastro inventado no formato de lojas.json (refs inventados). */
const cadastroInventado = () => ({
  lojas: {
    [LOJAS_PROTEGIDAS[0]]: { classe: "assinante", ref: "pppppppppppppppppppa" },
    [LOJAS_PROTEGIDAS[1]]: { classe: "assinante", ref: "pppppppppppppppppppb" },
    [LOJAS_LEGADAS[0]]: {
      classe: "legado",
      ref: "pppppppppppppppppppa",
      refDasFunctions: "llllllllllllllllllla",
    },
    "outro-legado": { classe: "legado", ref: "llllllllllllllllllld" },
    "loja-de-cliente": { classe: "assinante", ref: REF },
  },
});

Deno.test("ativar: alvo legado e loja que já vende pela lista do lojas.json: recusados antes de qualquer rede", async () => {
  for (const ref of [
    "pppppppppppppppppppa",
    "pppppppppppppppppppb",
    "llllllllllllllllllla",
    "llllllllllllllllllld",
  ]) {
    const api = apiDaAtivacao();
    const r = await ativar(api, { ref, cadastro: cadastroInventado() });
    assertEquals(r.veredito, "NÃO", `${ref}: ${r.linhas.join("\n")}`);
    assertEquals(api.chamadas.length, 0);
  }
  // uma loja nova que já entrou no cadastro como assinante segue
  const api = apiDaAtivacao();
  const r = await ativar(api, { cadastro: cadastroInventado() });
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
});

Deno.test("ativar: lojas.json ilegível (sem IKCOUS/Savy): INCERTO antes de qualquer rede", async () => {
  for (const cadastro of [null, {}, { lojas: {} }, { lojas: { savy: {} } }]) {
    const api = apiDaAtivacao();
    const r = await ativar(api, { cadastro });
    assertEquals(r.veredito, "INCERTO", r.linhas.join("\n"));
    assertEquals(api.chamadas.length, 0);
  }
});

Deno.test("ativar: ref fora do formato é uso errado, sem rede", async () => {
  const api = apiDaAtivacao();
  let erro;
  try {
    await ativar(api, { ref: "Ref-Invalido" });
  } catch (e) {
    erro = e;
  }
  assert(erro, "aceitou ref inválido");
  assertEquals(api.chamadas.length, 0);
});

Deno.test("ativar: limite JÁ acima de 30 (60) não baixa: sem PATCH do limite, SIM", async () => {
  const api = apiDaAtivacao({
    config: configPreparada({ rate_limit_email_sent: 60 }),
  });
  const r = await ativar(api);
  assertEquals(r.veredito, "SIM", r.linhas.join("\n"));
  assertEquals(api.corposDoPatch, [{ hook_send_email_enabled: true }]);
  assertEquals(api.estado.config.rate_limit_email_sent, 60);

  const ligado = apiDaAtivacao({
    config: configPreparada({
      hook_send_email_enabled: true,
      rate_limit_email_sent: 60,
    }),
  });
  const r2 = await ativar(ligado);
  assertEquals(r2.veredito, "SIM", r2.linhas.join("\n"));
  assertEquals(ligado.escritas().length, 0);
});

Deno.test("ativar: gancho JÁ ligado e a pré-condição cai (Gmail apagado): NÃO, 0 escritas, e diz que está LIGADO e o e-mail falha", async () => {
  const api = apiDaAtivacao({
    config: configPreparada({ hook_send_email_enabled: true }),
    gmail: false,
  });
  const r = await ativar(api);
  assertEquals(r.veredito, "NÃO", r.linhas.join("\n"));
  assertEquals(api.escritas().length, 0);
  const texto = r.linhas.join("\n");
  assertMatch(texto, /gancho de e-mail JÁ está LIGADO/);
  assertMatch(texto, /e-mail do login falha até/);
  assert(!/NÃO foi ligado/.test(texto), "diz que não foi ligado");
  assertSemSegredoNaAtivacao(r);
  // desligado e a pré-condição cai: continua o texto de "não foi ligado"
  const desligado = await ativar(apiDaAtivacao({ gmail: false }));
  assertMatch(desligado.linhas.join("\n"), /NÃO foi ligado/);
});
