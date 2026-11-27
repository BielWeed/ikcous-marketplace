// @ts-nocheck
/* eslint-disable security/detect-non-literal-require -- importa só o módulo local constante sob teste. */
/* eslint-disable security/detect-object-injection -- chaves de uma lista fixa do próprio teste. */
/**
 * As REGRAS puras do login da loja (scripts/publicacao/login-da-loja-regras.cjs,
 * 26/11/2026): o que o `acertar` grava no Auth da loja e o que o `conferir`
 * responde. Nenhuma rede aqui.
 *
 * O que estes testes medem:
 *  - `planejarPatchUrls`: localhost/nulo/vazio viram https://<dominio>; o que já
 *    está certo não gera PATCH; outro endereço PARA mostrando só o host; a lista
 *    de endereços autorizados é a união na ordem original + o padrão UMA vez;
 *    domínio fora da regra do CHECK de 20261140 PARA; o limite de 30 e-mails/h
 *    só entra com remetente próprio e valor vazio ou menor; nenhuma chave fora
 *    de CAMPOS_URLS sai do plano.
 *  - `diagnosticar`: itens OK/FALTA/ATENÇÃO/NÃO MEDIDO e veredito SIM/NÃO/INCERTO;
 *    "não medido" nunca vira SIM; smtp_pass e o segredo do hook nunca aparecem.
 *  - `enderecoAceito`: a regra do Supabase (internal/utilities/request.go,
 *    IsRedirectURLValid) — mesmo esquema+host+porta do site_url, ou um padrão da
 *    lista (glob com separadores '.' e '/').
 */
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const r = require(join(RAIZ, "scripts/publicacao/login-da-loja-regras.cjs"));

const DOMINIO = "loja.exemplo.com.br";
const PADRAO = `https://${DOMINIO}/**`;
const REF = "abcdefghijklmnopqrst";
const URI_HOOK = `https://${REF}.supabase.co/functions/v1/auth-send-email`;
const SMTP_PASS = "senha-smtp-ficticia-9f8e7d";
const HOOK_HASH = "c".repeat(64);

const configNova = (extra = {}) => ({
  site_url: "http://localhost:3000",
  uri_allow_list: "",
  rate_limit_email_sent: 2,
  mailer_autoconfirm: false,
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

const smtpCompleto = {
  smtp_host: "smtp.exemplo.com",
  smtp_port: "587",
  smtp_user: "loja@exemplo.com",
  smtp_pass: SMTP_PASS,
  smtp_admin_email: "loja@exemplo.com",
};

const planejar = (config, dominio = DOMINIO) =>
  r.planejarPatchUrls(config, dominio);
const pararCom = (fn, trecho) => {
  const erro = assertThrows(fn);
  assert(erro instanceof r.Parada, `esperava Parada, veio ${erro}`);
  if (trecho) assertStringIncludes(erro.message, trecho);
  return erro;
};

// ---------------------------------------------------------------------------
// Tarefa 1 — planejarPatchUrls
// ---------------------------------------------------------------------------
Deno.test("CAMPOS_URLS é exatamente site_url, uri_allow_list e rate_limit_email_sent, e é imutável", () => {
  assertEquals(
    [...r.CAMPOS_URLS],
    ["site_url", "uri_allow_list", "rate_limit_email_sent"],
  );
  assert(Object.isFrozen(r.CAMPOS_URLS));
  assertEquals(r.LIMITE_EMAIL_POR_HORA, 30);
});

Deno.test("site_url localhost, nulo, vazio ou só espaço vira https://<dominio>", () => {
  for (const site of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://0.0.0.0",
    "https://localhost",
    null,
    "",
    "   ",
  ]) {
    const { patch } = planejar(
      configNova({ site_url: site, uri_allow_list: PADRAO }),
    );
    assertEquals(patch, { site_url: `https://${DOMINIO}` }, String(site));
  }
});

Deno.test("site_url já certo (com ou sem barra final) e lista com o padrão: plano vazio", () => {
  for (const site of [`https://${DOMINIO}`, `https://${DOMINIO}/`]) {
    const plano = planejar(
      configNova({ site_url: site, uri_allow_list: PADRAO }),
    );
    assertEquals(plano.patch, {}, site);
    assertEquals(plano.mudancas, []);
  }
});

Deno.test("site_url de OUTRO endereço PARA e mostra só o host (nunca caminho, consulta ou credencial)", () => {
  for (const site of [
    "https://outra-loja.com.br/caminho?x=segredo-na-consulta",
    // credencial na URL montada em pedaços (o secretlint barra o literal)
    ["https://usuario", "senha@outra-loja.com.br"].join(":"),
    `http://${DOMINIO}`,
    `https://${DOMINIO}:8443`,
    `https://${DOMINIO}/loja`,
    "https://LOJA.exemplo.com.br",
  ]) {
    const erro = pararCom(() => planejar(configNova({ site_url: site })));
    assert(!erro.message.includes("segredo-na-consulta"), erro.message);
    assert(!erro.message.includes("senha"), erro.message);
    assert(!erro.message.includes("/caminho"), erro.message);
  }
  pararCom(
    () => planejar(configNova({ site_url: "https://outra-loja.com.br/x" })),
    "outra-loja.com.br",
  );
});

Deno.test("site_url ilegível ou de tipo errado PARA sem imprimir o valor", () => {
  const erro = pararCom(() =>
    planejar(configNova({ site_url: "nao e url :: %0A" })),
  );
  assert(!erro.message.includes("%0A"));
  pararCom(() => planejar(configNova({ site_url: 42 })));
  pararCom(() => planejar(configNova({ uri_allow_list: ["x"] })));
  pararCom(() => planejar(null));
  pararCom(() => planejar([]));
});

Deno.test("uri_allow_list: união na ordem original + o padrão UMA vez", () => {
  const casos = [
    [null, PADRAO],
    ["", PADRAO],
    ["https://a.com/**", `https://a.com/**,${PADRAO}`],
    [
      "http://localhost:3000/**,https://a.com/x",
      `http://localhost:3000/**,https://a.com/x,${PADRAO}`,
    ],
    // vírgula sobrando não vira entrada vazia
    ["https://a.com/**,", `https://a.com/**,${PADRAO}`],
    // entrada com espaço (que o Supabase não apara) é mantida e o padrão limpo entra
    [` ${PADRAO}`, ` ${PADRAO},${PADRAO}`],
  ];
  for (const [antes, depois] of casos) {
    const { patch } = planejar(
      configNova({ site_url: `https://${DOMINIO}`, uri_allow_list: antes }),
    );
    assertEquals(patch, { uri_allow_list: depois }, String(antes));
  }
  // já tem o padrão (em qualquer posição): nada
  for (const lista of [
    PADRAO,
    `https://a.com/**,${PADRAO}`,
    `${PADRAO},${PADRAO}`,
  ]) {
    const { patch } = planejar(
      configNova({ site_url: `https://${DOMINIO}`, uri_allow_list: lista }),
    );
    assertEquals(patch, {}, lista);
  }
});

Deno.test("loja recém-nascida: site_url e lista no mesmo plano, sem limite (não há remetente próprio)", () => {
  const { patch, mudancas } = planejar(configNova());
  assertEquals(patch, {
    site_url: `https://${DOMINIO}`,
    uri_allow_list: PADRAO,
  });
  assertEquals(
    mudancas.map((m) => m.campo),
    ["site_url", "uri_allow_list"],
  );
  assertEquals(mudancas[0].antes, "http://localhost:3000");
});

Deno.test("domínio fora da regra do CHECK de 20261140 PARA (esquema, porta, maiúscula, sem ponto, barra, vazio)", () => {
  for (const d of [
    `https://${DOMINIO}`,
    `${DOMINIO}:443`,
    "Loja.exemplo.com",
    "localhost",
    `${DOMINIO}/`,
    "-loja.com",
    "loja-.com",
    "loja..com",
    "",
    "   ",
    null,
    undefined,
    42,
    `${"a".repeat(250)}.com`,
  ])
    pararCom(() => r.planejarPatchUrls(configNova(), d));
  // e o que o CHECK aceita, aceita
  for (const d of ["a.co", "loja-1.exemplo.com", "xn--loja-9la.com.br"])
    planejar(configNova(), d);
});

Deno.test("limite de 30/h: só com remetente próprio (SMTP completo ou hook ligado) e valor vazio ou menor", () => {
  const certo = { site_url: `https://${DOMINIO}`, uri_allow_list: PADRAO };
  // sem remetente próprio: nunca
  for (const rl of [null, 2, 29])
    assertEquals(
      planejar(configNova({ ...certo, rate_limit_email_sent: rl })).patch,
      {},
    );
  // SMTP incompleto não conta
  assertEquals(
    planejar(
      configNova({
        ...certo,
        ...smtpCompleto,
        smtp_pass: "",
        rate_limit_email_sent: 2,
      }),
    ).patch,
    {},
  );
  for (const remetente of [smtpCompleto, { hook_send_email_enabled: true }]) {
    for (const rl of [null, 1, 2, 29])
      assertEquals(
        planejar(
          configNova({ ...certo, ...remetente, rate_limit_email_sent: rl }),
        ).patch,
        { rate_limit_email_sent: 30 },
        `${JSON.stringify(remetente)} ${rl}`,
      );
    for (const rl of [30, 31, 500])
      assertEquals(
        planejar(
          configNova({ ...certo, ...remetente, rate_limit_email_sent: rl }),
        ).patch,
        {},
      );
  }
  // valor de formato inesperado PARA
  pararCom(() =>
    planejar(
      configNova({ ...certo, ...smtpCompleto, rate_limit_email_sent: "30" }),
    ),
  );
  pararCom(() =>
    planejar(configNova({ ...certo, rate_limit_email_sent: 2.5 })),
  );
});

Deno.test("nenhuma chave fora de CAMPOS_URLS sai do plano, mesmo com tudo para mudar; mudanças nunca carregam segredo", () => {
  const { patch, mudancas } = planejar(
    configNova({
      ...smtpCompleto,
      hook_send_email_secrets: HOOK_HASH,
      rate_limit_email_sent: null,
    }),
  );
  assertEquals(Object.keys(patch), [
    "site_url",
    "uri_allow_list",
    "rate_limit_email_sent",
  ]);
  for (const k of Object.keys(patch)) assert(r.CAMPOS_URLS.includes(k));
  const texto = JSON.stringify({ patch, mudancas });
  assert(!texto.includes(SMTP_PASS));
  assert(!texto.includes(HOOK_HASH));
  assert(Object.isFrozen(patch));
});

Deno.test("conferirPatch recusa qualquer chave fora de CAMPOS_URLS (a trava que o executor usa antes do PATCH)", () => {
  r.conferirPatch({ site_url: "https://a.com" });
  r.conferirPatch({ rate_limit_email_sent: 30 });
  for (const ruim of [
    { mailer_autoconfirm: true },
    { site_url: "https://a.com", smtp_pass: "x" },
    { hook_send_email_enabled: true },
    {},
    null,
    [],
  ])
    pararCom(() => r.conferirPatch(ruim));
});

// ---------------------------------------------------------------------------
// A regra "endereço aceito" (cópia de IsRedirectURLValid)
// ---------------------------------------------------------------------------
Deno.test("enderecoAceito copia a regra do Supabase: mesmo esquema+host+porta do site_url, ou padrão da lista", () => {
  const aceito = (site, lista, url) =>
    r.enderecoAceito({ site_url: site, uri_allow_list: lista }, url);
  const site = `https://${DOMINIO}`;
  assertEquals(aceito(site, "", `https://${DOMINIO}`), true);
  assertEquals(aceito(site, "", `https://${DOMINIO}/auth?type=recovery`), true);
  assertEquals(aceito(site, "", `http://${DOMINIO}/`), false);
  assertEquals(aceito(site, "", `https://${DOMINIO}:8443/`), false);
  assertEquals(aceito(site, "", "https://outra.com/"), false);
  assertEquals(aceito(site, "", ""), false);
  // localhost como site_url: porta livre só para loopback
  assertEquals(
    aceito("http://localhost:3000", "", "http://localhost:5173/x"),
    true,
  );
  assertEquals(
    aceito("http://localhost:3000", "", `https://${DOMINIO}/`),
    false,
  );
  // pela lista: ** atravessa '.' e '/', * não
  const lista = PADRAO;
  assertEquals(
    aceito("http://localhost:3000", lista, `https://${DOMINIO}/`),
    true,
  );
  assertEquals(
    aceito(
      "http://localhost:3000",
      lista,
      `https://${DOMINIO}/auth?type=recovery`,
    ),
    true,
  );
  assertEquals(
    aceito("http://localhost:3000", lista, `https://${DOMINIO}`),
    false,
  );
  assertEquals(
    aceito(
      "http://localhost:3000",
      `https://${DOMINIO}/*`,
      `https://${DOMINIO}/a/b`,
    ),
    false,
  );
  assertEquals(
    aceito(
      "http://localhost:3000",
      `https://${DOMINIO}/*`,
      `https://${DOMINIO}/ab`,
    ),
    true,
  );
  assertEquals(
    aceito(
      "http://localhost:3000",
      "https://*.com.br/**",
      `https://${DOMINIO}/`,
    ),
    false, // * não atravessa '.'
  );
  assertEquals(
    aceito(
      "http://localhost:3000",
      "https://*.exemplo.com.br/**",
      `https://${DOMINIO}/`,
    ),
    true,
  );
  // fragmento não conta para a lista
  assertEquals(
    aceito(
      "http://localhost:3000",
      `https://${DOMINIO}/x`,
      `https://${DOMINIO}/x#frag`,
    ),
    true,
  );
  // host com caractere fora do comum, ou IP decimal, nunca pela lista
  assertEquals(aceito("http://localhost:3000", "**", "https://123456/"), false);
  // padrão com sintaxe que esta cópia não interpreta: não decide (null), nunca "sim"
  assertEquals(
    aceito(
      "http://localhost:3000",
      "https://{a}.com/**",
      `https://${DOMINIO}/`,
    ),
    null,
  );
});

// ---------------------------------------------------------------------------
// Tarefa 2 — diagnosticar
// ---------------------------------------------------------------------------
const pronta = (extra = {}) => ({
  config: configNova({
    site_url: `https://${DOMINIO}`,
    uri_allow_list: PADRAO,
    rate_limit_email_sent: 30,
    hook_send_email_enabled: true,
    hook_send_email_uri: URI_HOOK,
    hook_send_email_secrets: HOOK_HASH,
    ...(extra.config ?? {}),
  }),
  dominio: DOMINIO,
  ref: REF,
  funcao: true,
  verifyJwt: false,
  segredoPresente: true,
  gmail: true,
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "config")),
});
const estados = (d) =>
  Object.fromEntries(d.itens.map((i) => [i.nome, i.estado]));

Deno.test("loja pronta com hook: veredito SIM e todos os itens OK", () => {
  const d = r.diagnosticar(pronta());
  assertEquals(d.veredito, "SIM", JSON.stringify(d));
  for (const i of d.itens) assertEquals(i.estado, "OK", i.nome);
});

Deno.test("loja pronta com SMTP próprio (sem hook): SIM, sem exigir função nem Gmail", () => {
  const d = r.diagnosticar({
    ...pronta({
      config: {
        hook_send_email_enabled: false,
        hook_send_email_uri: null,
        hook_send_email_secrets: null,
        ...smtpCompleto,
      },
    }),
    funcao: undefined,
    verifyJwt: undefined,
    segredoPresente: undefined,
    gmail: undefined,
  });
  assertEquals(d.veredito, "SIM", JSON.stringify(d));
});

Deno.test("site_url localhost, vazio ou de outro endereço: NÃO", () => {
  for (const site of ["http://localhost:3000", "", null, "https://outra.com"]) {
    const d = r.diagnosticar(pronta({ config: { site_url: site } }));
    assertEquals(d.veredito, "NÃO", String(site));
  }
});

Deno.test("sem hook e sem SMTP com mailer_autoconfirm=false: NÃO; com autoconfirm=true: ATENÇÃO; desconhecido: INCERTO", () => {
  const semRemetente = {
    hook_send_email_enabled: false,
    hook_send_email_uri: null,
    hook_send_email_secrets: null,
  };
  assertEquals(
    r.diagnosticar(
      pronta({ config: { ...semRemetente, mailer_autoconfirm: false } }),
    ).veredito,
    "NÃO",
  );
  // Google desligado declarado: aqui só o remetente está em jogo (o risco do
  // Google com a confirmação desligada tem teste próprio, abaixo).
  const comAuto = r.diagnosticar(
    pronta({
      config: {
        ...semRemetente,
        mailer_autoconfirm: true,
        external_google_enabled: false,
      },
    }),
  );
  assertEquals(comAuto.veredito, "SIM");
  assert(comAuto.itens.some((i) => i.estado === "ATENÇÃO"));
  assertEquals(
    r.diagnosticar(
      pronta({ config: { ...semRemetente, mailer_autoconfirm: null } }),
    ).veredito,
    "INCERTO",
  );
  // SMTP incompleto conta como sem remetente
  assertEquals(
    r.diagnosticar(
      pronta({
        config: {
          ...semRemetente,
          ...smtpCompleto,
          smtp_host: "",
          mailer_autoconfirm: false,
        },
      }),
    ).veredito,
    "NÃO",
  );
});

// 27/11/2026: com a confirmação de e-mail DESLIGADA (mailer_autoconfirm=true),
// quem cria conta com o e-mail de outra pessoa e uma senha já nasce
// confirmado; quando a dona do e-mail entra pelo Google, o Supabase liga as
// duas identidades na mesma conta e só remove as NÃO confirmadas
// (supabase.com/docs/guides/auth/identities, "How Auth links identities"):
// a senha de quem criou a conta continua entrando na conta dela.
const GOOGLE = "login pelo Google com confirmação de e-mail";

Deno.test("Google ligado com a confirmação de e-mail desligada: FALTA, com o risco e o conserto no texto", () => {
  const d = r.diagnosticar(
    pronta({
      config: { external_google_enabled: true, mailer_autoconfirm: true },
    }),
  );
  assertEquals(d.veredito, "NÃO", JSON.stringify(d));
  const it = d.itens.find((i) => i.nome === GOOGLE);
  assert(it, JSON.stringify(d.itens));
  assertEquals(it.estado, "FALTA");
  assertStringIncludes(it.detalhe, "e-mail de outra pessoa");
  assertStringIncludes(it.detalhe, "ligue a confirmação de e-mail");
});

Deno.test("Google ligado com a confirmação ligada: OK; confirmação desconhecida: NÃO MEDIDO (INCERTO)", () => {
  const ok = r.diagnosticar(
    pronta({
      config: { external_google_enabled: true, mailer_autoconfirm: false },
    }),
  );
  assertEquals(ok.veredito, "SIM", JSON.stringify(ok));
  assertEquals(estados(ok)[GOOGLE], "OK");
  for (const v of [null, undefined, "true"]) {
    const d = r.diagnosticar(
      pronta({
        config: { external_google_enabled: true, mailer_autoconfirm: v },
      }),
    );
    assertEquals(estados(d)[GOOGLE], "NÃO MEDIDO", String(v));
    assert(d.veredito !== "SIM", String(v));
  }
});

Deno.test("Google desligado não muda nada; estado do Google não lido com a confirmação desligada: NÃO MEDIDO", () => {
  for (const g of [false, null]) {
    const d = r.diagnosticar(
      pronta({
        config: { external_google_enabled: g, mailer_autoconfirm: true },
      }),
    );
    assertEquals(d.veredito, "SIM", String(g));
    assertEquals(estados(d)[GOOGLE], undefined, String(g));
  }
  // Leitura sem o campo do Google: com a confirmação LIGADA não há risco a
  // medir; com ela desligada o risco não pode ser descartado.
  assertEquals(estados(r.diagnosticar(pronta()))[GOOGLE], undefined);
  const semLeitura = r.diagnosticar(
    pronta({ config: { mailer_autoconfirm: true } }),
  );
  assertEquals(estados(semLeitura)[GOOGLE], "NÃO MEDIDO");
  assertEquals(semLeitura.veredito, "INCERTO");
  // Tipo inesperado no campo do Google não passa por "desligado".
  assertEquals(
    estados(
      r.diagnosticar(
        pronta({
          config: { external_google_enabled: "true", mailer_autoconfirm: true },
        }),
      ),
    )[GOOGLE],
    "NÃO MEDIDO",
  );
});

Deno.test("hook ligado com URI de OUTRO projeto, ou sem o hash no Auth: NÃO", () => {
  assertEquals(
    r.diagnosticar(
      pronta({
        config: {
          hook_send_email_uri:
            "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/auth-send-email",
        },
      }),
    ).veredito,
    "NÃO",
  );
  assertEquals(
    r.diagnosticar(pronta({ config: { hook_send_email_secrets: null } }))
      .veredito,
    "NÃO",
  );
});

Deno.test("verify_jwt diferente de false: NÃO (true, null, ausente com função medida)", () => {
  for (const v of [true, null, "false", undefined]) {
    const d = r.diagnosticar(pronta({ verifyJwt: v }));
    assertEquals(d.veredito, "NÃO", String(v));
  }
});

Deno.test("função inativa, segredo ausente ou Gmail não cadastrado com hook ligado: NÃO", () => {
  assertEquals(r.diagnosticar(pronta({ funcao: false })).veredito, "NÃO");
  assertEquals(
    r.diagnosticar(pronta({ segredoPresente: false })).veredito,
    "NÃO",
  );
  assertEquals(r.diagnosticar(pronta({ gmail: false })).veredito, "NÃO");
});

Deno.test("'não medido' nunca vira SIM: vira INCERTO (e NÃO vence INCERTO)", () => {
  for (const campo of ["funcao", "segredoPresente", "gmail", "dominio"]) {
    const entrada = pronta();
    entrada[campo] = undefined;
    if (campo === "funcao") entrada.verifyJwt = undefined;
    const d = r.diagnosticar(entrada);
    assertEquals(d.veredito, "INCERTO", campo);
    assert(
      d.itens.some((i) => i.estado === "NÃO MEDIDO"),
      campo,
    );
  }
  const ambos = pronta({
    gmail: undefined,
    config: { site_url: "http://localhost:3000" },
  });
  assertEquals(r.diagnosticar(ambos).veredito, "NÃO");
  // config que não é objeto: INCERTO, nunca SIM
  assertEquals(
    r.diagnosticar({ ...pronta(), config: null }).veredito,
    "INCERTO",
  );
});

Deno.test("dominio_publico nulo ou fora do formato: NÃO", () => {
  for (const d of [null, "", "https://x.com", "X.com"])
    assertEquals(
      r.diagnosticar(pronta({ dominio: d })).veredito,
      "NÃO",
      String(d),
    );
});

Deno.test("limite < 30 ou vazio e localhost na lista: ATENÇÃO (o veredito segue SIM)", () => {
  for (const rl of [2, 29, null]) {
    const d = r.diagnosticar(pronta({ config: { rate_limit_email_sent: rl } }));
    assertEquals(d.veredito, "SIM");
    assert(
      d.itens.some((i) => i.estado === "ATENÇÃO"),
      String(rl),
    );
  }
  const d = r.diagnosticar(
    pronta({
      config: { uri_allow_list: `http://localhost:3000/**,${PADRAO}` },
    }),
  );
  assertEquals(d.veredito, "SIM");
  assertEquals(
    estados(d)["lista de endereços autorizados sem localhost"],
    "ATENÇÃO",
  );
});

Deno.test("smtp_pass e o segredo do hook NUNCA aparecem no diagnóstico (nem em NÃO)", () => {
  for (const entrada of [
    pronta({ config: { ...smtpCompleto } }),
    pronta({
      config: {
        ...smtpCompleto,
        hook_send_email_enabled: false,
        mailer_autoconfirm: false,
      },
    }),
    pronta({
      config: { ...smtpCompleto, site_url: "http://localhost:3000" },
      gmail: false,
    }),
  ]) {
    const texto = JSON.stringify(r.diagnosticar(entrada));
    assert(!texto.includes(SMTP_PASS), texto);
    assert(!texto.includes(HOOK_HASH), texto);
  }
});

// ---------------------------------------------------------------------------
// A consulta fixa
// ---------------------------------------------------------------------------
Deno.test("CONSULTA_GMAIL é só leitura: dominio_publico da linha id=1 e sim/não de Gmail, nenhuma credencial devolvida", () => {
  const q = r.CONSULTA_GMAIL;
  assert(/^SELECT\b/.test(q));
  assertStringIncludes(q, "public.store_config");
  assertStringIncludes(q, "WHERE id = 1");
  assertStringIncludes(q, "AS dominio_publico");
  assertStringIncludes(q, "AS gmail_cadastrado");
  assertStringIncludes(q, "public.app_settings");
  assert(
    !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|TRUNCATE)\b/i.test(q),
  );
  assert(!/SELECT\s+\*/i.test(q));
  // a senha cifrada só aparece dentro de testes de presença, nunca projetada
  assert(!/->>\s*'senha_cifrada'\s*(AS|,)/i.test(q));
});
