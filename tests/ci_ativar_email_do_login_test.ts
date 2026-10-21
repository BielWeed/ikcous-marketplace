import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
// @ts-nocheck
/* eslint-disable security/detect-object-injection -- mapas e dublês locais de testes. */
/* eslint-disable security/detect-non-literal-require -- importa só o script local constante sob teste. */
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const SCRIPT = new URL(
  "../scripts/publicacao/ativar-email-do-login.cjs",
  import.meta.url,
);
const WORKFLOW = new URL(
  "../.github/workflows/ativar-email-do-login.yml",
  import.meta.url,
);
// Sem implementação, falha nas asserções de comportamento, não no import.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- URL constante local do script sob teste.
const mod = existsSync(SCRIPT)
  ? require(fileURLToPath(SCRIPT))
  : { executar: async () => undefined };
const SHA = "a".repeat(40);
const REF = "gnjsrucsmjkajijrakzr";
const URI = `https://${REF}.supabase.co/functions/v1/auth-send-email`;
const SECRET = `v1,whsec_${Buffer.from(new Uint8Array(32).fill(17)).toString("base64")}`;
const TOKEN = "token-ficticio-da-savy";
const clone = (v) => JSON.parse(JSON.stringify(v));

function cenario(op = {}) {
  const ref = op.projeto === "ikcous-publicada" ? "cafkrminfnokvgjqtkle" : REF;
  const token =
    op.projeto === "ikcous-publicada" ? "token-ficticio-da-caf" : TOKEN;
  let config = {
    hook_send_email_enabled: false,
    hook_send_email_uri: `https://${ref}.supabase.co/functions/v1/auth-send-email`,
    hook_send_email_secrets: createHmac("sha256", ref)
      .update(SECRET)
      .digest("hex"),
    smtp_pass: "senha-smtp-ficticia",
    mailer_autoconfirm: false,
    rate_limit_email_sent: 30,
    ...op.config,
  };
  let secrets = op.secrets ?? [
    { name: "SEND_EMAIL_HOOK_SECRET", value: "digest-ficticio" },
  ];
  const functions = op.functions ?? [
    { slug: "auth-send-email", status: "ACTIVE", verify_jwt: false },
  ];
  const eventos = [];
  const logs = [];
  const erros = [];
  const resumos = [];
  const mascaras = [];
  const chamadas = [];
  let leituras = 0;
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ url, path, init, body });
    eventos.push(`${init.method} ${path}`);
    assertEquals(init.redirect, "error");
    assertEquals(init.headers.Authorization, `Bearer ${token}`);
    assert(path.startsWith(`/v1/projects/${ref}/`), "nunca outro alvo");
    if (op.rede) throw new Error(`erro com segredo ${SECRET}`);
    let data;
    let status = 200;
    if (path.endsWith("/config/auth")) {
      if (init.method === "GET") {
        leituras++;
        if (op.antesInvalido && leituras === 1) data = [];
        else if (op.depoisInvalido && leituras > 1) data = [];
        else data = clone(config);
      } else {
        assertEquals(init.method, "PATCH");
        assert(
          Object.keys(body).every((k) =>
            [
              "hook_send_email_enabled",
              "hook_send_email_uri",
              "hook_send_email_secrets",
            ].includes(k),
          ),
          "nenhuma política fora do hook no PATCH",
        );
        if (!op.patchIgnorado) {
          config = { ...config, ...body };
          // O GET/PATCH do Auth retorna HMAC, nunca o texto puro recebido.
          if (Object.hasOwn(body, "hook_send_email_secrets"))
            config.hook_send_email_secrets = createHmac(
              "sha256",
              op.chaveDoHash ?? ref,
            )
              .update(body.hook_send_email_secrets)
              .digest("hex");
        }
        if (op.politicaAlterada) config.mailer_autoconfirm = true;
        data = clone(config);
      }
    } else if (path.endsWith("/secrets")) {
      if (init.method === "POST") {
        status = 201;
        secrets = body.map(({ name }) => ({ name, value: "digest-novo" }));
        data = {};
      } else data = clone(secrets);
    } else if (path.endsWith("/functions")) data = clone(functions);
    else if (path.endsWith("/database/query")) {
      assertEquals(init.method, "POST");
      assertEquals(body.read_only, true);
      assertMatch(body.query, /^SELECT EXISTS/i);
      assertStringIncludes(body.query, "public.app_settings");
      for (const chave of ["email_da_loja", "usuario", "senha_cifrada", "iv"])
        assertStringIncludes(body.query, chave);
      assert(!/SELECT\s+\*/i.test(body.query));
      status = 201;
      data = op.gmailResposta ?? [{ gmail_cadastrado: op.gmail ?? true }];
    } else throw new Error("endpoint inesperado");
    if (op.status) status = op.status;
    if (op.corpo !== undefined) data = op.corpo;
    return {
      status,
      text: async () =>
        op.postSemCorpo && init.method === "POST" && path.endsWith("/secrets")
          ? ""
          : JSON.stringify(data),
    };
  };
  const saida = {
    log: (v) => logs.push(v),
    erro: (v) => erros.push(v),
    resumo: (v) => resumos.push(v),
    mascarar: (v) => {
      mascaras.push(v);
      eventos.push(`mascara:${v}`);
    },
  };
  const rodar = (acao, extra = {}) =>
    mod.executar({
      projeto: op.projeto ?? "savy",
      acao,
      env: {
        EXPECTED_SHA: SHA,
        GITHUB_SHA: SHA,
        SUPABASE_ACCESS_TOKEN_SAVY: TOKEN,
        SUPABASE_ACCESS_TOKEN_IKCOUS: "token-ficticio-da-caf",
        ...extra.env,
      },
      fetchImpl,
      saida,
      ...extra,
    });
  return {
    rodar,
    fetchImpl,
    chamadas,
    eventos,
    logs,
    erros,
    mascaras,
    tudo: () => [...logs, ...erros, ...resumos].join("\n"),
  };
}
const patches = (c) => c.chamadas.filter((r) => r.init.method === "PATCH");
const escritas = (c) =>
  c.chamadas.filter(
    (r) =>
      r.init.method === "PATCH" ||
      (r.init.method === "POST" && r.path.endsWith("/secrets")),
  );

Deno.test("medir: só GET, relata booleanos e URI fixa sem corpos nem nomes arbitrários", async () => {
  const c = cenario({
    secrets: [
      { name: "SEND_EMAIL_HOOK_SECRET", value: SECRET },
      { name: "::warning::NAO-IMPRIMIR", value: "valor-privado" },
    ],
  });
  assertEquals(await c.rodar("medir"), 0);
  assertEquals(
    c.chamadas.map((r) => r.init.method),
    ["GET", "GET", "GET"],
  );
  assertStringIncludes(c.tudo(), "hook ativado: não");
  assertStringIncludes(c.tudo(), URI);
  assertStringIncludes(c.tudo(), "segredo da função: presente");
  assertStringIncludes(
    c.tudo(),
    "nomes de segredos medidos: SEND_EMAIL_HOOK_SECRET",
  );
  for (const v of [
    SECRET,
    TOKEN,
    "senha-smtp-ficticia",
    "NAO-IMPRIMIR",
    "valor-privado",
  ])
    assert(!c.tudo().includes(v));
});

// SHA-256 da lista de segredos e HMAC do Auth são valores diferentes.
const DIGEST =
  "f4d8f82bd257325f43cece208e7b047e9f26e570b2945e532876ff9e3afcfee8";
// HMAC obtido separadamente com a chave REF e o texto SECRET completo.
const AUTH_HASH =
  "f7df797e81d028ecefe8d472aceffdea2f720f849daf3a0654bb4bb19d085017";
for (const [nome, valor, presente, rotulo] of [
  ["HMAC presente", AUTH_HASH, true, "hash presente"],
  ["só formato conhecido", "0".repeat(64), true, "hash presente"],
  ["ausente", null, false, "ausente"],
  ["vazio", "", false, "ausente"],
  ["texto puro", SECRET, false, "presente, mas fora do formato de hash"],
  [
    "maiúsculas",
    AUTH_HASH.toUpperCase(),
    false,
    "presente, mas fora do formato de hash",
  ],
  ["curto", AUTH_HASH.slice(1), false, "presente, mas fora do formato de hash"],
  [
    "não hexadecimal",
    "z".repeat(64),
    false,
    "presente, mas fora do formato de hash",
  ],
])
  Deno.test(`medir: relata presença, nunca igualdade dos segredos — ${nome}`, async () => {
    const c = cenario({
      secrets: [{ name: "SEND_EMAIL_HOOK_SECRET", value: DIGEST }],
      config: { hook_send_email_secrets: valor },
    });
    assertEquals(await c.rodar("medir"), 0);
    assertEquals(escritas(c), []);
    assertStringIncludes(c.tudo(), `campo do Auth: ${rotulo}`);
    assertStringIncludes(
      c.tudo(),
      `hook preparado: ${presente ? "sim" : "não"}`,
    );
    assertStringIncludes(c.tudo(), "segredo da função: presente");
    assertStringIncludes(
      c.tudo(),
      "igualdade entre Auth e função: não verificada (texto puro indisponível)",
    );
    assert(!c.tudo().includes("comparação dos segredos:"));
    for (const v of [SECRET, SECRET.slice(9), DIGEST, AUTH_HASH])
      assert(!c.tudo().includes(v));
    if (valor !== null && valor !== "") {
      assert(
        c.mascaras.includes(valor),
        "todo campo secreto recebido precisa de máscara",
      );
      assert(!c.tudo().includes(valor));
    }
    assert(c.mascaras.includes("senha-smtp-ficticia"));
    assert(c.mascaras.includes(TOKEN));
  });

Deno.test("medir: hash no Auth sem segredo da função não é preparado", async () => {
  const c = cenario({ secrets: [] });
  assertEquals(await c.rodar("medir"), 0);
  assertStringIncludes(c.tudo(), "campo do Auth: hash presente");
  assertStringIncludes(c.tudo(), "segredo da função: ausente");
  assertStringIncludes(c.tudo(), "hook preparado: não");
  assertStringIncludes(
    c.tudo(),
    "igualdade entre Auth e função: não verificada",
  );
});

for (const [nome, campos, esperado] of [
  ["false", { verify_jwt: false }, "false"],
  ["true", { verify_jwt: true }, "true"],
  ["ausente", {}, "desconhecido"],
  ["texto remoto", { verify_jwt: "::warning::NAO-IMPRIMIR" }, "desconhecido"],
])
  Deno.test(`medir: informa verify_jwt em saída fechada — ${nome}`, async () => {
    const c = cenario({
      functions: [{ slug: "auth-send-email", status: "ACTIVE", ...campos }],
    });
    assertEquals(await c.rodar("medir"), 0);
    assertStringIncludes(c.tudo(), `verify_jwt da função: ${esperado}`);
    assert(!c.tudo().includes("NAO-IMPRIMIR"));
  });

Deno.test("CAF: só o token próprio e o ref fechado, mesmo com Savy no ambiente", async () => {
  const c = cenario({ projeto: "ikcous-publicada" });
  assertEquals(await c.rodar("ativar"), 0);
  assert(
    c.chamadas.every((r) =>
      r.url.startsWith(
        "https://api.supabase.com/v1/projects/cafkrminfnokvgjqtkle/",
      ),
    ),
  );
  assertEquals(
    patches(c).map((p) => p.body),
    [{ hook_send_email_enabled: true }],
  );
});

Deno.test("preparar: segredo aleatório mascarado antes do POST, HMAC confirmado na releitura, sem ligar", async () => {
  const c = cenario({
    config: { hook_send_email_uri: null, hook_send_email_secrets: null },
    secrets: [],
  });
  assertEquals(await c.rodar("preparar"), 0);
  const post = c.chamadas.find(
    (r) => r.path.endsWith("/secrets") && r.init.method === "POST",
  );
  assertEquals(post.body.length, 1);
  assertEquals(post.body[0].name, "SEND_EMAIL_HOOK_SECRET");
  const gerado = post.body[0].value;
  assertMatch(gerado, /^v1,whsec_[A-Za-z0-9+/]{43}=$/);
  assertEquals(Buffer.from(gerado.slice(9), "base64").length, 32);
  assert(c.mascaras.includes(gerado));
  assert(
    c.eventos.indexOf(`mascara:${gerado}`) <
      c.eventos.indexOf(`POST ${post.path}`),
  );
  assertEquals(
    patches(c).map((p) => p.body),
    [
      {
        hook_send_email_enabled: false,
        hook_send_email_uri: URI,
        hook_send_email_secrets: gerado,
      },
    ],
  );
  const hash = createHmac("sha256", REF).update(gerado).digest("hex");
  assert(c.mascaras.includes(hash));
  assert(!c.tudo().includes(gerado));
  assert(!c.tudo().includes(gerado.slice(9)));
  assert(!c.tudo().includes(hash));
  assertStringIncludes(
    c.tudo(),
    "igualdade entre Auth e função: confirmada nesta preparação",
  );
  assertEquals(await c.rodar("preparar"), 0);
  assertEquals(escritas(c).length, 2, "repetir não gira nem regrava segredo");
  assertStringIncludes(
    c.tudo(),
    "igualdade entre Auth e função: não verificada (texto puro indisponível)",
  );
});

Deno.test("preparar: HMAC de outro projeto não confirma o PATCH", async () => {
  const c = cenario({
    chaveDoHash: "cafkrminfnokvgjqtkle",
    secrets: [],
    config: { hook_send_email_uri: null, hook_send_email_secrets: null },
  });
  assertEquals(await c.rodar("preparar"), 1);
  assertEquals(
    patches(c).length,
    1,
    "a falha foi na conferência, depois do PATCH",
  );
  assertStringIncludes(c.tudo(), "releitura não confirmou o PATCH");
  assertStringIncludes(c.tudo(), "estado do hook DESCONHECIDO");
  assertStringIncludes(c.tudo(), "rode medir");
  const gerado = patches(c)[0].body.hook_send_email_secrets;
  assert(!c.tudo().includes(gerado));
  assert(
    !c.tudo().includes(createHmac("sha256", REF).update(gerado).digest("hex")),
  );
});

Deno.test("preparar: CAF usa a chave do próprio projeto para confirmar HMAC", async () => {
  const c = cenario({
    projeto: "ikcous-publicada",
    secrets: [],
    config: { hook_send_email_uri: null, hook_send_email_secrets: null },
  });
  assertEquals(await c.rodar("preparar"), 0, c.tudo());
  assertEquals(patches(c).length, 1);
  assertStringIncludes(
    c.tudo(),
    "igualdade entre Auth e função: confirmada nesta preparação",
  );
});

Deno.test("preparar: POST secrets 201 sem corpo é documentado; confirma pela releitura", async () => {
  const c = cenario({
    postSemCorpo: true,
    secrets: [],
    config: { hook_send_email_uri: null, hook_send_email_secrets: null },
  });
  assertEquals(await c.rodar("preparar"), 0);
  assertEquals(patches(c).length, 1);
});

Deno.test("preparar: duas lojas novas recebem segredos diferentes", async () => {
  const op = {
    config: { hook_send_email_uri: "", hook_send_email_secrets: "" },
    secrets: [],
  };
  const a = cenario(op);
  const b = cenario(op);
  assertEquals(await a.rodar("preparar"), 0);
  assertEquals(await b.rodar("preparar"), 0);
  assert(
    patches(a)[0].body.hook_send_email_secrets !==
      patches(b)[0].body.hook_send_email_secrets,
  );
});

Deno.test("preparar: já preparado não gera nem grava outro segredo", async () => {
  const c = cenario();
  assertEquals(await c.rodar("preparar"), 0);
  assertEquals(escritas(c), []);
});

Deno.test("preparar: já preparado e ligado não desliga nem rotaciona", async () => {
  const c = cenario({ config: { hook_send_email_enabled: true } });
  assertEquals(await c.rodar("preparar"), 0);
  assertEquals(escritas(c), []);
  assert(c.chamadas.every((r) => r.init.method === "GET"));
  assertStringIncludes(c.tudo(), "hook já ligado, nada a preparar");
  assertStringIncludes(c.tudo(), "hook ativado: sim");
});

for (const [nome, op] of [
  [
    "hook ligado sem segredos e URI vazia",
    {
      config: {
        hook_send_email_enabled: true,
        hook_send_email_uri: "",
        hook_send_email_secrets: null,
      },
      secrets: [],
    },
  ],
  [
    "hook ligado sem segredos e nossa URI",
    {
      config: {
        hook_send_email_enabled: true,
        hook_send_email_uri: URI,
        hook_send_email_secrets: null,
      },
      secrets: [],
    },
  ],
  ["segredo só na função", { config: { hook_send_email_secrets: "" } }],
  ["segredo só no Auth", { secrets: [] }],
  [
    "URI alheia",
    { config: { hook_send_email_uri: "https://outro.invalid/hook" } },
  ],
  [
    "segredo ilegível",
    { config: { hook_send_email_secrets: "valor inesperado" } },
  ],
])
  Deno.test(`preparar: estado parcial recusa sem rotacionar — ${nome}`, async () => {
    const c = cenario(op);
    assertEquals(await c.rodar("preparar"), 1);
    assertEquals(escritas(c), []);
  });

Deno.test("ativar: todas guardas passam, PATCH só enabled e relê", async () => {
  const c = cenario();
  assertEquals(await c.rodar("ativar"), 0);
  assertEquals(
    patches(c).map((p) => p.body),
    [{ hook_send_email_enabled: true }],
  );
  assertEquals(c.chamadas.at(-1).init.method, "GET");
  assertStringIncludes(c.tudo(), "hook ativado: sim");
  assertStringIncludes(c.tudo(), "Gmail cadastrado: sim");
});

for (const [nome, campos] of [
  ["true", { verify_jwt: true }],
  ["ausente", {}],
  ["null", { verify_jwt: null }],
  ["texto false", { verify_jwt: "false" }],
])
  Deno.test(`ativar: exige verify_jwt false antes de consultar Gmail ou escrever — ${nome}`, async () => {
    const c = cenario({
      functions: [{ slug: "auth-send-email", status: "ACTIVE", ...campos }],
    });
    assertEquals(await c.rodar("ativar"), 1);
    assertEquals(escritas(c), []);
    assert(!c.chamadas.some((r) => r.path.endsWith("/database/query")));
    assertStringIncludes(c.tudo(), "publicada sem verificação de login");
    assertStringIncludes(c.tudo(), "assinatura de webhook, não com login");
  });

for (const [nome, segredo] of [
  ["diferente", { value: "0".repeat(64) }],
  ["desconhecido", { sha256: "outro-formato" }],
])
  Deno.test(`ativar: digest ${nome} da função não substitui a guarda de presença`, async () => {
    const c = cenario({
      secrets: [{ name: "SEND_EMAIL_HOOK_SECRET", ...segredo }],
    });
    assertEquals(await c.rodar("ativar"), 0);
    assertEquals(
      patches(c).map((p) => p.body),
      [{ hook_send_email_enabled: true }],
    );
  });

for (const [nome, op] of [
  ["sem função", { functions: [] }],
  [
    "função inativa",
    { functions: [{ slug: "auth-send-email", status: "REMOVED" }] },
  ],
  ["sem segredo", { secrets: [] }],
  ["sem hook", { config: { hook_send_email_secrets: "" } }],
  [
    "texto puro não é resposta do Auth",
    { config: { hook_send_email_secrets: SECRET } },
  ],
  [
    "hash maiúsculo",
    { config: { hook_send_email_secrets: AUTH_HASH.toUpperCase() } },
  ],
  [
    "URI errada",
    { config: { hook_send_email_uri: "https://outro.invalid/hook" } },
  ],
  ["sem Gmail", { gmail: false }],
  ["Gmail texto true", { gmailResposta: [{ gmail_cadastrado: "true" }] }],
  [
    "Gmail resposta extra",
    { gmailResposta: [{ gmail_cadastrado: true, segredo: SECRET }] },
  ],
])
  Deno.test(`ativar: recusa sem escrita — ${nome}`, async () => {
    const c = cenario(op);
    assertEquals(await c.rodar("ativar"), 1);
    assertEquals(escritas(c), []);
    assert(!c.tudo().includes(SECRET));
  });

Deno.test("desativar: sem função, segredo, URI ou Gmail não impede desfazer", async () => {
  const c = cenario({
    functions: [],
    secrets: [],
    gmail: false,
    config: {
      hook_send_email_enabled: true,
      hook_send_email_uri: null,
      hook_send_email_secrets: null,
    },
  });
  assertEquals(await c.rodar("desativar"), 0);
  assertEquals(
    patches(c).map((p) => p.body),
    [{ hook_send_email_enabled: false }],
  );
  assert(c.chamadas.every((r) => r.path.endsWith("/config/auth")));
  assertStringIncludes(c.tudo(), "hook ativado: não");
});

Deno.test("desativar: leitura inicial inválida não bloqueia PATCH de emergência, mas não declara prova completa", async () => {
  const c = cenario({ antesInvalido: true });
  assertEquals(await c.rodar("desativar"), 1);
  assertEquals(
    patches(c).map((p) => p.body),
    [{ hook_send_email_enabled: false }],
  );
  assertStringIncludes(c.tudo(), "hook desativado confirmado por releitura");
  assertStringIncludes(c.tudo(), "verificação incompleta das outras políticas");
  assert(!c.tudo().includes("DESCONHECIDO"));
});

for (const [nome, op] of [
  ["config não objeto", { corpo: [] }],
  ["enabled ilegível", { config: { hook_send_email_enabled: "false" } }],
  ["HTTP 401", { status: 401 }],
  ["HTTP 500", { status: 500 }],
  ["rede", { rede: true }],
  ["funções malformadas", { functions: {} }],
  [
    "estado da função desconhecido",
    { functions: [{ slug: "auth-send-email", status: "UNKNOWN" }] },
  ],
  ["segredos malformados", { secrets: {} }],
])
  Deno.test(`resposta inesperada fecha sem escrita — ${nome}`, async () => {
    const c = cenario(op);
    assertEquals(await c.rodar("ativar"), 1);
    assertEquals(escritas(c), []);
    assert(!c.tudo().includes(SECRET));
  });

for (const op of [
  { politicaAlterada: true },
  { patchIgnorado: true },
  { depoisInvalido: true },
])
  Deno.test(`pós-PATCH divergente não declara sucesso ${JSON.stringify(op)}`, async () => {
    const c = cenario(op);
    assertEquals(await c.rodar("ativar"), 1);
    assert(!c.tudo().includes("hook ativado: sim"));
    assertStringIncludes(c.tudo(), "estado do hook DESCONHECIDO");
    assertStringIncludes(c.tudo(), "rode medir");
    assert(!c.tudo().includes(SECRET));
  });

for (const extra of [
  {
    env: {
      EXPECTED_SHA: "b".repeat(40),
      GITHUB_SHA: SHA,
      SUPABASE_ACCESS_TOKEN_SAVY: TOKEN,
    },
  },
  { projeto: "loja" },
  { projeto: "__proto__" },
  { acao: "rotacionar" },
  {
    env: {
      EXPECTED_SHA: SHA,
      GITHUB_SHA: SHA,
      SUPABASE_ACCESS_TOKEN_IKCOUS: TOKEN,
    },
  },
])
  Deno.test(`entrada ou token inválido recusa antes da rede ${Object.keys(extra).join()}`, async () => {
    const c = cenario();
    assertEquals(await c.rodar("ativar", extra), 1);
    assertEquals(c.chamadas, []);
  });

Deno.test("main real: segredo só no protocolo de máscara, nunca no log comum, stderr ou argumentos", async () => {
  const c = cenario({
    secrets: [],
    config: { hook_send_email_uri: null, hook_send_email_secrets: null },
  });
  const stdout = [];
  const stderr = [];
  const env = {
    PROJETO: "savy",
    ACAO: "preparar",
    EXPECTED_SHA: SHA,
    GITHUB_SHA: SHA,
    SUPABASE_ACCESS_TOKEN_SAVY: TOKEN,
    GITHUB_STEP_SUMMARY: "",
  };
  const anterior = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  const fetchOriginal = globalThis.fetch;
  const logOriginal = console.log;
  const errorOriginal = console.error;
  const writeOriginal = process.stdout.write;
  const exitOriginal = process.exitCode;
  const argvOriginal = [...process.argv];
  try {
    Object.assign(process.env, env);
    globalThis.fetch = c.fetchImpl;
    console.log = (s) => stdout.push(`${s}\n`);
    console.error = (s) => stderr.push(`${s}\n`);
    process.stdout.write = (s) => {
      stdout.push(s);
      return true;
    };
    await mod.main();
    assertEquals(process.exitCode, 0);
    const post = c.chamadas.find(
      (r) => r.path.endsWith("/secrets") && r.init.method === "POST",
    );
    const segredo = post.body[0].value;
    const raw = stdout.join("");
    assertStringIncludes(raw, `::add-mask::${segredo}\n`);
    const comum = raw
      .split("\n")
      .filter((l) => !l.startsWith("::add-mask::"))
      .join("\n");
    assert(!comum.includes(segredo));
    assert(!stderr.join("").includes(segredo));
    assert(!process.argv.join(" ").includes(segredo));
    assertEquals(process.argv, argvOriginal);
  } finally {
    for (const [k, v] of Object.entries(anterior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    console.error = errorOriginal;
    process.stdout.write = writeOriginal;
    process.exitCode = exitOriginal;
  }
});

Deno.test("workflow: dispatch fechado, SHA antes de checkout, ações pinadas e segredo só no último passo", async () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- URL constante local do workflow sob teste.
  const doc = existsSync(WORKFLOW)
    ? parse(await Deno.readTextFile(WORKFLOW))
    : {};
  assertEquals(Object.keys(doc.on ?? {}), ["workflow_dispatch"]);
  const inputs = doc.on.workflow_dispatch.inputs;
  assertEquals(Object.keys(inputs).sort(), ["acao", "expected_sha", "projeto"]);
  assertEquals(inputs.projeto.options, ["ikcous-publicada", "savy"]);
  assertEquals(inputs.acao.options, [
    "medir",
    "preparar",
    "ativar",
    "desativar",
  ]);
  assertEquals(inputs.expected_sha.required, true);
  assertEquals(doc.permissions, { contents: "read" });
  assertEquals(doc.concurrency["cancel-in-progress"], false);
  const passos = doc.jobs.email.steps;
  assert(passos[0].run);
  assert(!JSON.stringify(passos[0]).includes("secrets."));
  for (const [projeto, acao, sha, codigo] of [
    ["savy", "ativar", SHA, 0],
    ["ikcous-publicada", "medir", SHA.toUpperCase(), 0],
    ["savy", "desativar", "b".repeat(40), 1],
    ["loja", "medir", SHA, 1],
    ["savy", "outro", SHA, 1],
    ["savy", "ativar", "", 1],
  ]) {
    const r = await new Deno.Command("bash", {
      args: ["-c", passos[0].run],
      env: { PROJETO: projeto, ACAO: acao, EXPECTED_SHA: sha, GITHUB_SHA: SHA },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(r.code, codigo);
  }
  for (const p of passos) {
    if (p.uses) assertMatch(p.uses, /^[\w/-]+@[a-f0-9]{40}$/);
    assert(!String(p.run ?? "").includes("${{"));
  }
  const checkout = passos.find((p) => p.uses?.startsWith("actions/checkout@"));
  assertEquals(checkout.with["persist-credentials"], false);
  assertEquals(checkout.with.ref, "${{ github.sha }}");
  const ultimo = passos.at(-1);
  assertEquals(ultimo.run, "node scripts/publicacao/ativar-email-do-login.cjs");
  assertEquals(
    passos.filter((p) => JSON.stringify(p).includes("secrets.")).length,
    1,
  );
  for (const [nome, projeto] of [
    ["SUPABASE_ACCESS_TOKEN_IKCOUS", "ikcous-publicada"],
    ["SUPABASE_ACCESS_TOKEN_SAVY", "savy"],
  ])
    assertEquals(
      ultimo.env[nome],
      `\${{ inputs.projeto == '${projeto}' && secrets.${nome} || '' }}`,
    );
});
