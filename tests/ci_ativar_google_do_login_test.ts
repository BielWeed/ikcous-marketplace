// @ts-nocheck
/* eslint-disable security/detect-object-injection -- mapas locais de teste, sem dado real. */
/* eslint-disable security/detect-non-literal-require -- importa somente o script constante sob teste. */
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
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

const SCRIPT = new URL(
  "../scripts/publicacao/ativar-google-do-login.cjs",
  import.meta.url,
);
const WORKFLOW = new URL(
  "../.github/workflows/ativar-google-do-login.yml",
  import.meta.url,
);
const require = createRequire(import.meta.url);
// Sem implementação: vermelho por comportamento ausente, não por import quebrado.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- URL constante local.
const mod = existsSync(SCRIPT)
  ? require(fileURLToPath(SCRIPT))
  : { executar: async () => undefined };
const SHA = "a".repeat(40);
const SECRET = "google-segredo-FALSO-123456";
const TOKEN = "token-SAVY-FALSO";
const CLIENT = "123456789-abcdef.apps.googleusercontent.com";
const ORIGEM = "https://loja.exemplo.invalid";
const clone = (v) => JSON.parse(JSON.stringify(v));
function cenario(op = {}) {
  const ref =
    op.projeto === "ikcous-publicada"
      ? "cafkrminfnokvgjqtkle"
      : "gnjsrucsmjkajijrakzr";
  const token = op.projeto === "ikcous-publicada" ? "token-CAF-FALSO" : TOKEN;
  let config = {
    external_google_enabled: false,
    external_google_client_id: null,
    external_google_secret: null,
    uri_allow_list:
      "https://antiga.invalid/callback,https://*.antiga.invalid/**",
    site_url: "https://site-original.invalid",
    mailer_autoconfirm: false,
    smtp_pass: "smtp-FALSO",
    hook_send_email_secrets: "hook-FALSO",
    politica_futura: { qualquer: [1, 2] },
    ...op.config,
  };
  const chamadas = [],
    logs = [],
    erros = [],
    resumos = [],
    mascaras = [],
    eventos = [];
  let leituras = 0;
  const fetchImpl = async (url, init) => {
    assertEquals(
      url,
      `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    );
    assertEquals(init.redirect, "error");
    assertEquals(init.headers.Authorization, `Bearer ${token}`);
    assert(mascaras.includes(token), "token mascarado ANTES da rede");
    const body = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ init, body });
    eventos.push(init.method);
    if (op.rede) throw new Error(SECRET + TOKEN);
    if (init.method === "GET") {
      leituras++;
      if (op.leituraFalha === leituras)
        return { status: 500, text: async () => SECRET };
    } else {
      assertEquals(init.method, "PATCH");
      if (body.external_google_secret)
        assert(mascaras.includes(SECRET), "segredo mascarado antes do PATCH");
      if (!op.ignorarPatch) {
        config = { ...config, ...body };
        if (Object.hasOwn(body, "external_google_secret"))
          config.external_google_secret = createHmac(
            "sha256",
            op.chaveHash ?? ref,
          )
            .update(body.external_google_secret)
            .digest("hex");
      }
      if (op.politicaAlterada) config.site_url = "https://mudou.invalid";
      if (op.campoNovo) config.novo_campo_inesperado = SECRET;
      if (op.campoRemovido) delete config.mailer_autoconfirm;
    }
    return {
      status: op.status ?? 200,
      text: async () =>
        op.jsonInvalido ||
        (op.jsonInicialInvalido && leituras === 1 && init.method === "GET")
          ? SECRET
          : JSON.stringify(
              op.corpo ??
                ((op.antesInvalido &&
                  leituras === 1 &&
                  init.method === "GET") ||
                (op.depoisInvalido && leituras > 1)
                  ? []
                  : clone(config)),
            ),
    };
  };
  const saida = {
    log: (v) => logs.push(v),
    erro: (v) => erros.push(v),
    resumo: (v) => resumos.push(v),
    mascarar: (v) => {
      mascaras.push(v);
      eventos.push("mascara");
    },
  };
  const env = {
    EXPECTED_SHA: SHA,
    GITHUB_SHA: SHA,
    SUPABASE_ACCESS_TOKEN_SAVY: TOKEN,
    SUPABASE_ACCESS_TOKEN_IKCOUS: "token-CAF-FALSO",
    TURMA: "turma-1",
    GOOGLE_OAUTH_SECRET_TURMA_1: SECRET,
    CLIENT_ID: CLIENT,
    ORIGENS: ORIGEM,
    ...op.env,
  };
  const rodar = (acao = "ativar", extra = {}) =>
    mod.executar({
      projeto: op.projeto ?? "savy",
      acao,
      env,
      fetchImpl,
      saida,
      ...extra,
    });
  return {
    rodar,
    chamadas,
    logs,
    erros,
    mascaras,
    eventos,
    env,
    fetchImpl,
    tudo: () => [...logs, ...erros, ...resumos].join("\n"),
  };
}
const patches = (c) => c.chamadas.filter((r) => r.init.method === "PATCH");

Deno.test("ativar: preserva entradas antigas, inclui origens sem duplicar e prova por releitura", async () => {
  const c = cenario({
    env: { ORIGENS: `${ORIGEM},${ORIGEM},https://outra.invalid` },
  });
  assertEquals(await c.rodar(), 0);
  assertEquals(
    c.chamadas.map((r) => r.init.method),
    ["GET", "PATCH", "GET"],
  );
  assertEquals(
    patches(c).map((r) => r.body),
    [
      {
        external_google_enabled: true,
        external_google_client_id: CLIENT,
        external_google_secret: SECRET,
        uri_allow_list: `https://antiga.invalid/callback,https://*.antiga.invalid/**,${ORIGEM}/**,https://outra.invalid/**`,
      },
    ],
  );
  assertStringIncludes(c.tudo(), "outras configurações: preservadas");
  assertStringIncludes(c.tudo(), "ok");
  for (const segredo of [SECRET, TOKEN, "smtp-FALSO", "hook-FALSO"])
    assert(!c.tudo().includes(segredo));
});

Deno.test("ativar: idempotente para origem que já está na lista, inclusive lista nula", async () => {
  for (const lista of [
    null,
    "",
    `${ORIGEM}/**,https://antiga.invalid/callback`,
    ORIGEM,
  ]) {
    const c = cenario({ config: { uri_allow_list: lista } });
    assertEquals(await c.rodar(), 0);
    const entradas = patches(c)[0].body.uri_allow_list.split(",");
    assertEquals(entradas.filter((v) => v === `${ORIGEM}/**`).length, 1);
    if (lista)
      for (const entrada of lista.split(","))
        assert(entradas.includes(entrada));
    if (lista?.includes("/**")) assertEquals(entradas, lista.split(","));
  }
});
Deno.test("desativar: apenas enabled=false, preserva id, segredo e lista sem exigir segredo novo", async () => {
  const c = cenario({
    config: {
      external_google_enabled: true,
      external_google_client_id: CLIENT,
      external_google_secret: SECRET,
    },
    env: { GOOGLE_OAUTH_SECRET_TURMA_1: "", CLIENT_ID: "", ORIGENS: "" },
  });
  assertEquals(await c.rodar("desativar"), 0);
  assertEquals(
    patches(c).map((r) => r.body),
    [{ external_google_enabled: false }],
  );
});
Deno.test("medir: só GET, id booleano e seis caracteres, não mostra políticas nem segredos", async () => {
  const c = cenario({
    config: {
      external_google_enabled: true,
      external_google_client_id: CLIENT,
      external_google_secret: SECRET,
      uri_allow_list: `${ORIGEM}/**`,
    },
  });
  assertEquals(await c.rodar("medir"), 0);
  assertEquals(
    c.chamadas.map((r) => r.init.method),
    ["GET"],
  );
  assertStringIncludes(c.tudo(), "Google ligado: sim");
  assertStringIncludes(c.tudo(), "client id configurado: sim");
  assertStringIncludes(c.tudo(), CLIENT.slice(-6));
  assertStringIncludes(c.tudo(), "redirecionamento da volta liberado: sim");
  assertStringIncludes(c.tudo(), "somente leitura");
  for (const v of [CLIENT, SECRET, TOKEN, "site-original", "smtp-FALSO"])
    assert(!c.tudo().includes(v));
});
Deno.test("medir: origem pelada NÃO libera a volta; molde com /** libera", async () => {
  for (const [lista, esperado] of [
    [ORIGEM, "não"],
    [`${ORIGEM}/**`, "sim"],
  ]) {
    const c = cenario({
      config: { uri_allow_list: lista },
      env: { GOOGLE_OAUTH_SECRET_TURMA_1: "" },
    });
    assertEquals(await c.rodar("medir"), 0);
    assertStringIncludes(
      c.tudo(),
      `redirecionamento da volta liberado: ${esperado}`,
    );
    assertEquals(patches(c), []);
  }
});
Deno.test("medir: ausente ou id ilegível não imprime valor; origem não cadastrada é não", async () => {
  for (const id of [null, "", "::warning::SEGREDO-NAO-IMPRIMIR"]) {
    const c = cenario({ config: { external_google_client_id: id } });
    assertEquals(await c.rodar("medir"), 0);
    assertStringIncludes(c.tudo(), "redirecionamento da volta liberado: não");
    assert(!c.tudo().includes("SEGREDO-NAO-IMPRIMIR"));
  }
});
for (const [nome, env] of [
  ["id vazio", { CLIENT_ID: "" }],
  ["id inválido", { CLIENT_ID: "qualquer.apps.googleusercontent.com.evil" }],
  ["id só sufixo", { CLIENT_ID: ".apps.googleusercontent.com" }],
  ["id com comando", { CLIENT_ID: "::warning::x.apps.googleusercontent.com" }],
  ["sem segredo", { GOOGLE_OAUTH_SECRET_TURMA_1: "" }],
  ["turma inexistente", { TURMA: "turma-9" }],
  [
    "segredo só de outra turma",
    { GOOGLE_OAUTH_SECRET_TURMA_1: "", GOOGLE_OAUTH_SECRET_TURMA_2: SECRET },
  ],
  ["mais de uma turma com segredo", { GOOGLE_OAUTH_SECRET_TURMA_2: SECRET }],
  ["SHA curto", { EXPECTED_SHA: "abc" }],
  ["SHA divergente", { EXPECTED_SHA: "b".repeat(40) }],
  ["SHA do run inválido", { GITHUB_SHA: "não-hex" }],
  ["sem token Savy sem fallback", { SUPABASE_ACCESS_TOKEN_SAVY: "" }],
])
  Deno.test(`recusa antes da rede: ${nome}`, async () => {
    const c = cenario({ env });
    assertEquals(await c.rodar(), 1);
    assertEquals(c.chamadas, []);
    assert(!c.tudo().includes(SECRET));
  });
for (const origens of [
  "",
  "http://loja.invalid",
  "https://localhost",
  "https://localhost.localdomain",
  "https://127.0.0.1",
  "https://[::1]",
  "https://*.invalid",
  "https://loja.invalid/",
  "https://loja.invalid/callback",
  "https://loja.invalid?x=y",
  "https://loja.invalid#x",
  "https://user:pass@loja.invalid",
  "https://loja.invalid:444",
  "https://loja.invalid,",
  "https://loja.invalid\n::warning::x",
  "https://loja.invalid\\evil",
  Array.from({ length: 6 }, (_, i) => `https://loja${i}.invalid`).join(","),
])
  Deno.test(`recusa origens inválidas sem escrita: ${JSON.stringify(origens)}`, async () => {
    const c = cenario({ env: { ORIGENS: origens } });
    assertEquals(await c.rodar(), 1);
    assertEquals(c.chamadas, []);
  });
for (const projeto of ["loja", "__proto__", "constructor", "savy/../outro"])
  Deno.test(`projeto fechado: ${projeto}`, async () => {
    const c = cenario({ projeto });
    assertEquals(await c.rodar(), 1);
    assertEquals(c.chamadas, []);
  });
Deno.test("cada loja e turma usam somente o token e segredo selecionados", async () => {
  for (const projeto of ["ikcous-publicada", "savy"])
    for (const n of [1, 2, 3, 4]) {
      const c = cenario({
        projeto,
        env: {
          TURMA: `turma-${n}`,
          GOOGLE_OAUTH_SECRET_TURMA_1: "",
          [`GOOGLE_OAUTH_SECRET_TURMA_${n}`]: SECRET,
        },
      });
      assertEquals(await c.rodar(), 0);
    }
});
for (const op of [
  { rede: true },
  { leituraFalha: 1 },
  { status: 401 },
  { status: 403 },
  { status: 429 },
  { jsonInvalido: true },
  { corpo: [] },
  { corpo: {} },
  { config: { external_google_enabled: "false" } },
  { config: { uri_allow_list: [] } },
])
  Deno.test(`ativar/medir: leitura inicial inesperada impede TODA escrita: ${JSON.stringify(op)}`, async () => {
    for (const acao of ["ativar", "medir"]) {
      const c = cenario(op);
      assertEquals(await c.rodar(acao), 1);
      assertEquals(patches(c), []);
      assert(!c.tudo().includes(SECRET));
    }
  });
for (const op of [
  { politicaAlterada: true },
  { campoNovo: true },
  { campoRemovido: true },
  { ignorarPatch: true },
  { depoisInvalido: true },
  { leituraFalha: 2 },
  { chaveHash: "outro-ref" },
])
  Deno.test(`snapshot ou releitura divergente não declara ok: ${JSON.stringify(op)}`, async () => {
    const c = cenario(op);
    assertEquals(await c.rodar(), 1);
    assertStringIncludes(c.tudo(), "DESCONHECIDO");
    assert(!c.tudo().includes("ok"));
    assert(!c.tudo().includes(SECRET));
  });
Deno.test("importar não lê entradas ou credenciais, não chama rede nem escreve saída", async () => {
  const r = await new Deno.Command("node", {
    args: [
      "-e",
      `
      globalThis.fetch = () => { throw new Error("rede indevida"); };
      const original = process.env;
      process.env = new Proxy({}, { get(_obj, nome) {
        if (/^(SUPABASE_|GOOGLE_)/.test(String(nome)) ||
          ["PROJETO", "ACAO", "TURMA", "CLIENT_ID", "ORIGENS", "EXPECTED_SHA", "GITHUB_SHA"].includes(nome))
          throw new Error("entrada ou credencial lida no import");
        return undefined;
      } });
      require(process.argv[1]);
      process.env = original;
    `,
      fileURLToPath(SCRIPT),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(r.code, 0, new TextDecoder().decode(r.stderr));
  assertEquals(new TextDecoder().decode(r.stdout), "");
  assertEquals(new TextDecoder().decode(r.stderr), "");
});
Deno.test("ação inválida recusa antes da rede e SHA maiúsculo equivalente é aceito", async () => {
  const c = cenario();
  assertEquals(await c.rodar("rotacionar"), 1);
  assertEquals(c.chamadas, []);
  const valido = cenario({ env: { EXPECTED_SHA: SHA.toUpperCase() } });
  assertEquals(await valido.rodar(), 0);
});
Deno.test("desativar: leitura inicial inválida não bloqueia PATCH de emergência, mas não declara prova completa", async () => {
  for (const op of [
    { leituraFalha: 1 },
    { antesInvalido: true },
    { jsonInicialInvalido: true },
  ]) {
    const c = cenario({
      ...op,
      env: { GOOGLE_OAUTH_SECRET_TURMA_1: "", ORIGENS: "", CLIENT_ID: "" },
    });
    assertEquals(await c.rodar("desativar"), 1);
    assertEquals(
      c.chamadas.map((r) => r.init.method),
      ["GET", "PATCH", "GET"],
    );
    assertEquals(
      patches(c).map((r) => r.body),
      [{ external_google_enabled: false }],
    );
    assertStringIncludes(
      c.tudo(),
      "Google desativado confirmado por releitura",
    );
    assertStringIncludes(
      c.tudo(),
      "verificação incompleta das outras políticas",
    );
    assert(!c.tudo().includes("preservadas"));
    assert(!c.tudo().includes("DESCONHECIDO"));
    assert(!c.tudo().includes("ok"));
  }
});
Deno.test("desativar: falha também na releitura tenta PATCH sem declarar estado conhecido", async () => {
  const c = cenario({ rede: true });
  assertEquals(await c.rodar("desativar"), 1);
  assertEquals(
    patches(c).map((r) => r.body),
    [{ external_google_enabled: false }],
  );
  assertStringIncludes(c.tudo(), "DESCONHECIDO");
  assert(!c.tudo().includes("ok"));
});
Deno.test("medir/desativar não leem segredo de turma, mesmo ausente ou inacessível", async () => {
  for (const acao of ["medir", "desativar"]) {
    const c = cenario();
    const env = new Proxy(c.env, {
      get(alvo, nome) {
        if (String(nome).startsWith("GOOGLE_OAUTH_SECRET_"))
          throw new Error("segredo não deve ser lido fora de ativar");
        return Reflect.get(alvo, nome);
      },
    });
    assertEquals(await c.rodar(acao, { env }), 0);
    assert(!c.mascaras.includes(SECRET));
  }
});
Deno.test("medir/desativar não exigem segredo e desativação também confere snapshot", async () => {
  const medir = cenario({ env: { GOOGLE_OAUTH_SECRET_TURMA_1: "" } });
  assertEquals(await medir.rodar("medir"), 0);
  const c = cenario({
    politicaAlterada: true,
    env: { GOOGLE_OAUTH_SECRET_TURMA_1: "" },
  });
  assertEquals(await c.rodar("desativar"), 1);
  assert(!c.tudo().includes("ok"));
});
Deno.test("main real: nenhum segredo em stdout comum, stderr, argumento; máscara precede uso", async () => {
  const c = cenario();
  const env = {
    ...c.env,
    PROJETO: "savy",
    ACAO: "ativar",
    GITHUB_STEP_SUMMARY: "",
  };
  const antigo = Object.fromEntries(
    Object.keys(env).map((k) => [k, process.env[k]]),
  );
  const originais = {
    fetch: globalThis.fetch,
    log: console.log,
    error: console.error,
    write: process.stdout.write,
    exit: process.exitCode,
  };
  const stdout = [],
    stderr = [],
    argv = [...process.argv];
  try {
    Object.assign(process.env, env);
    globalThis.fetch = async (...args) => {
      const texto = stdout.join("");
      assertStringIncludes(texto, `::add-mask::${TOKEN}\n`);
      assertStringIncludes(texto, `::add-mask::${SECRET}\n`);
      return c.fetchImpl(...args);
    };
    // O dublê de fetch deste teste confere as máscaras reais, acima.
    c.mascaras.push(TOKEN, SECRET);
    console.log = (s) => stdout.push(`${s}\n`);
    console.error = (s) => stderr.push(`${s}\n`);
    process.stdout.write = (s) => {
      stdout.push(s);
      return true;
    };
    await mod.main();
    assertEquals(process.exitCode, 0);
    const comum = stdout
      .join("")
      .split("\n")
      .filter((l) => !l.startsWith("::add-mask::"))
      .join("\n");
    for (const valor of [SECRET, TOKEN, "smtp-FALSO", "hook-FALSO"]) {
      assert(!comum.includes(valor));
      assert(!stderr.join("").includes(valor));
      assert(!process.argv.join(" ").includes(valor));
    }
    assertEquals(process.argv, argv);
  } finally {
    for (const [k, v] of Object.entries(antigo)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    globalThis.fetch = originais.fetch;
    console.log = originais.log;
    console.error = originais.error;
    process.stdout.write = originais.write;
    process.exitCode = originais.exit;
  }
});
Deno.test("workflow: SHA antes dos segredos, alvos/turmas fechados, tokens condicionais e actions pinadas", async () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- URL constante local.
  const doc = existsSync(WORKFLOW)
    ? parse(await Deno.readTextFile(WORKFLOW))
    : {};
  assertEquals(Object.keys(doc.on ?? {}), ["workflow_dispatch"]);
  const inputs = doc.on.workflow_dispatch.inputs;
  assertEquals(Object.keys(inputs).sort(), [
    "acao",
    "client_id",
    "expected_sha",
    "origens",
    "projeto",
    "turma",
  ]);
  assertEquals(inputs.projeto.options, ["ikcous-publicada", "savy"]);
  assertEquals(inputs.acao.options, ["medir", "ativar", "desativar"]);
  assertEquals(inputs.turma.options, [
    "turma-1",
    "turma-2",
    "turma-3",
    "turma-4",
  ]);
  assertEquals(inputs.expected_sha.required, true);
  assertEquals(doc.permissions, { contents: "read" });
  assertEquals(doc.concurrency.group, "google-do-login-${{ inputs.projeto }}");
  assertEquals(doc.concurrency["cancel-in-progress"], false);
  const steps = doc.jobs.google.steps;
  assert(!JSON.stringify(steps[0]).includes("secrets."));
  assertStringIncludes(steps[0].run, "GITHUB_SHA");
  assertStringIncludes(steps[0].run, "{40}");
  for (const [projeto, acao, turma, sha, codigo] of [
    ["savy", "ativar", "turma-1", SHA, 0],
    ["ikcous-publicada", "medir", "turma-4", SHA.toUpperCase(), 0],
    ["savy", "desativar", "turma-2", "b".repeat(40), 1],
    ["loja", "medir", "turma-1", SHA, 1],
    ["savy", "outra", "turma-1", SHA, 1],
    ["savy", "ativar", "turma-9", SHA, 1],
    ["savy", "ativar", "turma-1", "", 1],
  ]) {
    const r = await new Deno.Command("bash", {
      args: ["-c", steps[0].run],
      env: {
        PROJETO: projeto,
        ACAO: acao,
        TURMA: turma,
        EXPECTED_SHA: sha,
        GITHUB_SHA: SHA,
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(r.code, codigo);
  }
  for (const s of steps) {
    if (s.uses) assertMatch(s.uses, /^[\w/-]+@[a-f0-9]{40}$/);
    assert(!String(s.run ?? "").includes("${{"));
  }
  assertEquals(
    steps[1].uses,
    "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683",
  );
  assertEquals(steps[1].with, {
    ref: "${{ github.sha }}",
    "persist-credentials": false,
  });
  assertEquals(
    steps[2].uses,
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  );
  const ultimo = steps.at(-1);
  assertEquals(
    ultimo.run,
    "node scripts/publicacao/ativar-google-do-login.cjs",
  );
  assertEquals(
    steps.filter((s) => JSON.stringify(s).includes("secrets.")).length,
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
  for (const n of [1, 2, 3, 4])
    assertEquals(
      ultimo.env[`GOOGLE_OAUTH_SECRET_TURMA_${n}`],
      `\${{ inputs.acao == 'ativar' && inputs.turma == 'turma-${n}' && secrets.GOOGLE_OAUTH_SECRET_TURMA_${n} || '' }}`,
    );
});
