// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/* eslint-disable security/detect-non-literal-require -- carrega o script (real ou mutante) de um arquivo temporário criado aqui. */
/**
 * O workflow `medir-auth-da-loja.yml` e o script `scripts/publicacao/medir-auth-da-loja.cjs`
 * (14/10/2026): UMA leitura (GET) da configuração de e-mail do LOGIN (Supabase Auth)
 * de uma loja cliente, com o token de gestão que o repositório já guarda.
 *
 * O RISCO É O TOKEN E A SENHA DO REMETENTE (smtp_pass). O que estes testes medem:
 *  - o workflow: só `workflow_dispatch` (nada de `pull_request_target`), permissões
 *    mínimas, projeto FECHADO em ikcous-publicada|savy, `expected_sha` completo e
 *    igual ao do run no PRIMEIRO passo (o bloco `run:` é EXTRAÍDO e rodado em bash),
 *    cada alvo enxerga SÓ o seu segredo, nenhuma entrada interpolada em `run:`;
 *  - o script: uma única chamada, só GET, sem redirecionamento, a URL vem do ref
 *    resolvido (`resolverRef`), 401/403 PARA sem outro segredo, o corpo cru NUNCA
 *    é impresso, e a saída sai de uma LISTA FECHADA de campos (a senha entra como
 *    sim/não, e nada fora da lista chega ao log).
 *
 * MUTANTES (a prova de que o teste enxerga o defeito): `verificarWorkflow` e
 * `verificarScript` são as MESMAS funções que julgam os arquivos de verdade; o
 * bloco "mutantes" planta cada defeito de volta num texto/cópia e exige que a
 * verificação fique VERMELHA.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const WORKFLOW = join(RAIZ, ".github/workflows/medir-auth-da-loja.yml");
const SCRIPT = join(RAIZ, "scripts/publicacao/medir-auth-da-loja.cjs");
const CONFERIR_BANCO = join(RAIZ, "scripts/publicacao/conferir-banco.cjs");

const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_CAF = "cafkrminfnokvgjqtkle";
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SEGREDO = "SEGREDO-FICTICIO";
const USUARIO = "USUARIO-FICTICIO";
const TRES_TOKENS = {
  SUPABASE_ACCESS_TOKEN: "tk-legado",
  SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
  SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
};
const SEM_ACESSO_SAVY =
  "sem acesso legítimo à Savy por SUPABASE_ACCESS_TOKEN_SAVY — bloqueio concreto";
const SEM_ACESSO_CAF =
  "sem acesso legítimo à CAF por SUPABASE_ACCESS_TOKEN_IKCOUS — bloqueio concreto";
const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };

// ---------------------------------------------------------------- utilitários

/** O arquivo sem as linhas de comentário (os cabeçalhos explicam o que NÃO fazem). */
function semComentariosYaml(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

// O código JS sem comentários de linha inteira nem blocos de comentário.
function semComentariosJs(js: string): string {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
}

async function rodarBash(script: string, env: Record<string, string>) {
  const r = await new Deno.Command("bash", {
    args: ["-c", script],
    cwd: RAIZ,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { codigo: r.code, saida: dec.decode(r.stdout) + dec.decode(r.stderr) };
}

/** Carrega o script a partir de um TEXTO (o real ou um mutante), numa cópia
 * temporária cujo `require("./conferir-banco.cjs")` aponta para o arquivo real. */
function carregarScript(fonte: string) {
  const dir = Deno.makeTempDirSync({ prefix: "medir-auth-" });
  const arquivo = join(dir, "medir-auth-da-loja.cjs");
  const ajustada = fonte.replaceAll(
    '"./conferir-banco.cjs"',
    JSON.stringify(CONFERIR_BANCO),
  );
  Deno.writeTextFileSync(arquivo, ajustada);
  try {
    return require(arquivo);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

/** Um fetch falso que anota cada chamada e responde pela fila. */
function fetchFalso(respostas: Array<Record<string, unknown> | Error>) {
  const chamadas: Array<{ url: string; init: Record<string, unknown> }> = [];
  const fila = [...respostas];
  const impl = (url: string, init: Record<string, unknown>) => {
    chamadas.push({ url: String(url), init });
    const r = fila.shift();
    if (r === undefined)
      throw new Error("fetch chamado a mais do que o esperado");
    if (r instanceof Error) return Promise.reject(r);
    const status = r.status ?? 200;
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(String(r.corpo ?? "")),
    });
  };
  return { impl, chamadas };
}

function saidaFalsa() {
  const linhas: string[] = [];
  const mascaras: string[] = [];
  const resumo: string[] = [];
  const ordem: string[] = [];
  return {
    saida: {
      log: (l: string) => {
        linhas.push(l);
        ordem.push("log");
      },
      erro: (l: string) => {
        linhas.push(l);
        ordem.push("erro");
      },
      resumo: (m: string) => {
        resumo.push(m);
        ordem.push("resumo");
      },
      mascarar: (v: string) => {
        mascaras.push(v);
        ordem.push("mascara");
      },
    },
    linhas,
    mascaras,
    resumo,
    ordem,
    tudo: () => [...linhas, ...resumo].join("\n"),
  };
}

/** Uma configuração de Auth FICTÍCIA, com a senha, campos fora da lista e um
 * campo hostil — o corpo que a Management API poderia devolver. */
function configFicticia(extra: Record<string, unknown> = {}) {
  return {
    mailer_autoconfirm: false,
    external_email_enabled: true,
    disable_signup: false,
    smtp_host: "smtp.exemplo.com.br",
    smtp_port: "465",
    smtp_user: USUARIO,
    smtp_pass: SEGREDO,
    smtp_admin_email: "loja@exemplo.com.br",
    smtp_sender_name: "Loja Exemplo",
    rate_limit_email_sent: 30,
    // fora da lista: nada disto pode chegar ao log
    jwt_secret: "JWT-FICTICIO",
    external_google_secret: "GOOGLE-FICTICIO",
    hook_send_email_secrets: "v1,whsec_HOOK-FICTICIO",
    site_url: "https://site-ficticio.example",
    smtp_max_frequency: 61,
    ...extra,
  };
}

// ------------------------------------------------- verificação do WORKFLOW

/** Julga um texto de workflow (o real ou um mutante). Lança no 1º defeito. */
async function verificarWorkflow(yamlCru: string) {
  const yaml = semComentariosYaml(yamlCru);
  const doc = parse(yamlCru);

  // gatilho: SÓ workflow_dispatch
  const gatilhos = doc.on ?? doc[true];
  assertEquals(Object.keys(gatilhos), ["workflow_dispatch"], "só dispatch");
  for (const proibido of [
    "pull_request_target",
    "pull_request",
    "push:",
    "schedule",
    "workflow_run",
    "issue_comment",
    "workflow_call",
  ]) {
    assert(!yaml.includes(proibido), `gatilho proibido: ${proibido}`);
  }

  assertEquals(doc.permissions, { contents: "read" }, "permissões mínimas");
  assertEquals(doc["run-name"], "medir auth em ${{ inputs.projeto }}");
  assert(!yaml.includes("continue-on-error"), "sem continue-on-error");

  // entradas: projeto FECHADO e expected_sha exigido
  const entradas = gatilhos.workflow_dispatch.inputs;
  assertEquals(Object.keys(entradas).sort(), ["expected_sha", "projeto"]);
  assertEquals(entradas.projeto.type, "choice", "projeto é escolha fechada");
  assertEquals(entradas.projeto.options, ["ikcous-publicada", "savy"]);
  assertEquals(entradas.projeto.required, true);
  assertEquals(
    entradas.expected_sha.required,
    true,
    "expected_sha obrigatório",
  );

  const passos = doc.jobs.medir.steps;
  assertEquals(Object.keys(doc.jobs), ["medir"]);

  // PRIMEIRO passo: confere o sha, sem `uses` (antes do checkout e de rede)
  const primeiro = passos[0];
  assert(primeiro.run && !primeiro.uses, "o 1º passo é a conferência do sha");
  assertEquals(primeiro.env.EXPECTED_SHA, "${{ inputs.expected_sha }}");
  assert(!/curl|fetch|api\.supabase/.test(primeiro.run), "sem rede antes");
  assert(
    passos.findIndex((p) =>
      String(p.uses ?? "").startsWith("actions/checkout"),
    ) > 0,
    "o checkout vem depois da conferência",
  );
  assert(
    !JSON.stringify(primeiro).includes("secrets."),
    "o passo do sha não vê segredo",
  );

  // o bloco do 1º passo, RODADO: 40 hex, igual ao GITHUB_SHA, nas duas lojas
  for (const projeto of ["ikcous-publicada", "savy"]) {
    const rodar = (esperado: string) =>
      rodarBash(primeiro.run, {
        PATH: Deno.env.get("PATH") ?? "",
        PROJETO: projeto,
        EXPECTED_SHA: esperado,
        GITHUB_SHA: SHA,
      });
    assertEquals((await rodar(SHA)).codigo, 0, `${projeto}: sha igual`);
    assertEquals((await rodar(SHA.toUpperCase())).codigo, 0, "maiúsculas");
    const recusas: [string, string][] = [
      ["vazio", ""],
      ["curto (7)", SHA.slice(0, 7)],
      ["39 caracteres", SHA.slice(0, 39)],
      ["41 caracteres", `${SHA}a`],
      ["40 hex de OUTRO commit", "b".repeat(40)],
      ["40 caracteres não hex", "g".repeat(40)],
      ["com espaço no fim", `${SHA.slice(0, 39)} `],
    ];
    for (const [caso, esperado] of recusas) {
      const r = await rodar(esperado);
      assertEquals(r.codigo, 1, `${projeto} / ${caso}: ${r.saida}`);
      assertStringIncludes(
        r.saida,
        "expected_sha completo e igual ao GITHUB_SHA",
      );
    }
  }

  // checkout sem credencial gravada; node; e o passo final
  const checkout = passos.find((p) =>
    String(p.uses ?? "").startsWith("actions/checkout"),
  );
  assertEquals(checkout.with?.["persist-credentials"], false);
  const ultimo = passos[passos.length - 1];
  assertEquals(ultimo.run, "node scripts/publicacao/medir-auth-da-loja.cjs");

  // nenhuma entrada interpolada num `run:` (injeção de comando)
  for (const p of passos) {
    assert(
      !String(p.run ?? "").includes("${{"),
      `\${{ }} dentro de run: ${p.name}`,
    );
  }

  // SEGREDOS: só no passo final, cada alvo enxerga SÓ o seu
  const comSegredo = passos.filter((p) =>
    JSON.stringify(p).includes("secrets."),
  );
  assertEquals(comSegredo.length, 1, "um único passo vê segredo");
  assertEquals(comSegredo[0], ultimo, "e é o passo do script");
  assertEquals(ultimo.env, {
    SUPABASE_ACCESS_TOKEN_IKCOUS:
      "${{ inputs.projeto == 'ikcous-publicada' && secrets.SUPABASE_ACCESS_TOKEN_IKCOUS || '' }}",
    SUPABASE_ACCESS_TOKEN_SAVY:
      "${{ inputs.projeto == 'savy' && secrets.SUPABASE_ACCESS_TOKEN_SAVY || '' }}",
    PROJETO: "${{ inputs.projeto }}",
  });
  const usos = yaml.match(/secrets[.[]/g) ?? [];
  assertEquals(usos.length, 2, "exatamente dois segredos referenciados");
  assert(!/secrets\.SUPABASE_ACCESS_TOKEN\s*[}|]/.test(yaml), "sem o legado");
  assert(!/toJSON\(secrets\)|secrets\[/.test(yaml), "sem coleção de segredos");
}

// ---------------------------------------------------- verificação do SCRIPT (texto)

function verificarScript(fonte: string) {
  const js = semComentariosJs(fonte);
  assertEquals(
    (js.match(/fetchImpl\(/g) ?? []).length,
    1,
    "uma única chamada de rede",
  );
  assert(!/\bfetch\(/.test(js), "nenhum fetch direto fora do injetado");
  assertStringIncludes(js, 'method: "GET"');
  assertStringIncludes(js, 'redirect: "error"');
  assert(
    !/\b(POST|PUT|PATCH|DELETE)\b/i.test(js),
    "nenhum método de escrita no código",
  );
  assert(
    !/process\.env\.[A-Z_]*API_BASE/.test(js),
    "sem desvio de host por env",
  );
  assertStringIncludes(js, 'require("./conferir-banco.cjs")');
  assertStringIncludes(js, "resolverRef(");
}

// ------------------------------------------- verificação do COMPORTAMENTO do script

async function verificarComportamento(mod) {
  // (a) Savy, caminho feliz: a lista fechada, a senha só como sim/não
  {
    const f = fetchFalso([
      { status: 200, corpo: JSON.stringify(configFicticia()) },
    ]);
    const s = saidaFalsa();
    const codigo = await mod.medir({
      projeto: "savy",
      env: { ...TRES_TOKENS },
      fetchImpl: f.impl,
      saida: s.saida,
    });
    assertEquals(codigo, 0, s.tudo());
    assertEquals(f.chamadas.length, 1, "uma chamada só");
    const { url, init } = f.chamadas[0];
    assertEquals(
      url,
      `https://api.supabase.com/v1/projects/${REF_SAVY}/config/auth`,
    );
    assertEquals(init.method, "GET");
    assertEquals(init.redirect, "error");
    assertEquals(init.headers.Authorization, "Bearer tk-savy");
    assert(init.body === undefined, "GET sem corpo");

    const tudo = s.tudo();
    // a senha: nunca no log nem no resumo; só uma máscara para o runner
    assertEquals(s.mascaras, [SEGREDO], "a senha é mascarada, uma vez");
    assertEquals(
      s.ordem[0],
      "mascara",
      "a máscara vem ANTES de qualquer saída",
    );
    assert(!tudo.includes(SEGREDO), "a senha não aparece");
    assert(!tudo.includes(USUARIO), "o usuário SMTP não aparece");
    // campos fora da lista: descartados
    for (const proibido of [
      "JWT-FICTICIO",
      "GOOGLE-FICTICIO",
      "HOOK-FICTICIO",
      "site-ficticio",
      "jwt_secret",
      "external_google_secret",
      "site_url",
      "smtp_max_frequency",
      '"',
      "{",
    ]) {
      assert(!tudo.includes(proibido), `vazou: ${proibido}`);
    }
    // o que PRECISA aparecer
    for (const esperado of [
      "mailer_autoconfirm: false",
      "external_email_enabled: true",
      "disable_signup: false",
      "smtp_host: smtp.exemplo.com.br",
      "smtp_port: 465",
      "smtp_user preenchido: sim",
      "smtp_pass preenchido: sim",
      "smtp_admin_email: loja@exemplo.com.br",
      "smtp_sender_name: Loja Exemplo",
      "rate_limit_email_sent: 30",
      REF_SAVY,
    ]) {
      assertStringIncludes(tudo, esperado);
    }
    assertEquals(s.resumo.length, 1, "um resumo do run");
    assertStringIncludes(s.resumo[0], "| smtp_pass preenchido | sim |");
    assertStringIncludes(tudo, "Remetente próprio (SMTP): SIM");
  }

  // (b) a CAF usa o token da CAF e o ref da CAF (e só ele)
  {
    const f = fetchFalso([
      { status: 200, corpo: JSON.stringify(configFicticia()) },
    ]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "ikcous-publicada",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      0,
    );
    assertEquals(f.chamadas[0].init.headers.Authorization, "Bearer tk-caf");
    assertEquals(
      f.chamadas[0].url,
      `https://api.supabase.com/v1/projects/${REF_CAF}/config/auth`,
    );
  }

  // (c) projeto FECHADO: qualquer outro valor é recusado antes de qualquer rede
  for (const projeto of [
    "loja",
    "sandbox",
    "__proto__",
    "constructor",
    "toString",
    REF_SAVY,
    "",
    undefined,
    "savy/../x",
    "SAVY",
    "savy ",
  ]) {
    const f = fetchFalso([]);
    const s = saidaFalsa();
    const codigo = await mod.medir({
      projeto,
      env: { ...TRES_TOKENS },
      fetchImpl: f.impl,
      saida: s.saida,
    });
    assertEquals(codigo, 1, `projeto ${String(projeto)} devia ser recusado`);
    assertEquals(f.chamadas.length, 0, `sem rede para ${String(projeto)}`);
  }

  // (d) cada alvo enxerga SÓ o seu segredo: sem o dele, PARA (sem usar o vizinho)
  for (const [projeto, proprio, msg] of [
    ["savy", "SUPABASE_ACCESS_TOKEN_SAVY", SEM_ACESSO_SAVY],
    ["ikcous-publicada", "SUPABASE_ACCESS_TOKEN_IKCOUS", SEM_ACESSO_CAF],
  ]) {
    const env = { ...TRES_TOKENS };
    delete env[proprio];
    const f = fetchFalso([]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({ projeto, env, fetchImpl: f.impl, saida: s.saida }),
      1,
    );
    assertEquals(f.chamadas.length, 0, "sem token próprio, sem nenhuma rede");
    assertStringIncludes(s.tudo(), msg);
    for (const t of ["tk-legado", "tk-caf", "tk-savy"]) {
      assert(!s.tudo().includes(t), "token nunca impresso");
    }
  }

  // (e) 401 e 403: PARA, uma chamada só, só o status — nunca o corpo
  for (const status of [401, 403]) {
    const f = fetchFalso([
      { status, corpo: '{"message":"CORPO-DO-ERRO-NAO-IMPRIMIR tk-savy"}' },
      { status: 200, corpo: JSON.stringify(configFicticia()) },
    ]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "savy",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      1,
    );
    assertEquals(f.chamadas.length, 1, `${status}: sem 2ª tentativa`);
    assertStringIncludes(s.tudo(), SEM_ACESSO_SAVY);
    assertStringIncludes(s.tudo(), `HTTP ${status}`);
    assert(!s.tudo().includes("CORPO-DO-ERRO"), "corpo do erro não impresso");
    assertEquals(s.mascaras.length, 0);
  }

  // (f) 500 (e 429): só o status
  for (const status of [500, 429]) {
    const f = fetchFalso([{ status, corpo: `corpo-do-${SEGREDO}` }]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "ikcous-publicada",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      1,
    );
    assertEquals(f.chamadas.length, 1);
    assertStringIncludes(s.tudo(), `HTTP ${status}`);
    assert(!s.tudo().includes(SEGREDO), "corpo de erro não impresso");
  }

  // (g) 200 que não é JSON de objeto: falha sem imprimir o que veio
  for (const corpo of [
    `<html>${SEGREDO}</html>`,
    "null",
    "[1,2]",
    `"${SEGREDO}"`,
    "",
  ]) {
    const f = fetchFalso([{ status: 200, corpo }]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "savy",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      1,
      `corpo ${corpo}`,
    );
    assert(!s.tudo().includes(SEGREDO), "corpo inválido não impresso");
  }

  // (h) a chamada que lança (queda de rede) não carrega o token para o log
  {
    const f = fetchFalso([
      new Error("falhou com Bearer tk-savy e senha SEGREDO"),
    ]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "savy",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      1,
    );
    assertEquals(f.chamadas.length, 1);
    assert(!s.tudo().includes("tk-savy"), "token fora do log");
    assert(!s.tudo().includes("SEGREDO"), "mensagem do erro fora do log");
  }

  // (i) a loja SEM remetente próprio (o caso que motivou a medição)
  {
    const vazio = {
      mailer_autoconfirm: false,
      external_email_enabled: true,
      disable_signup: false,
      smtp_host: null,
      smtp_port: null,
      smtp_user: null,
      smtp_pass: null,
      smtp_admin_email: null,
      smtp_sender_name: null,
      rate_limit_email_sent: 2,
    };
    const f = fetchFalso([{ status: 200, corpo: JSON.stringify(vazio) }]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "savy",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      0,
    );
    assertStringIncludes(s.tudo(), "Remetente próprio (SMTP): NAO");
    assertStringIncludes(s.tudo(), "smtp_pass preenchido: nao");
    assertStringIncludes(s.tudo(), "smtp_user preenchido: nao");
    assertStringIncludes(s.tudo(), "ATENCAO");
    assertEquals(s.mascaras.length, 0, "sem senha, sem máscara");
  }

  // (j) remetente INCOMPLETO (falta a senha) e campos ausentes
  {
    const parcial = configFicticia({
      smtp_pass: "",
      rate_limit_email_sent: undefined, // some do JSON: campo ausente
    });
    const f = fetchFalso([{ status: 200, corpo: JSON.stringify(parcial) }]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "savy",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      0,
    );
    assertStringIncludes(s.tudo(), "Remetente próprio (SMTP): INCOMPLETO");
    assertStringIncludes(s.tudo(), "smtp_pass");
    assertStringIncludes(s.tudo(), "rate_limit_email_sent: (vazio)");
  }

  // (k) valores hostis nos campos permitidos: nada de comando de workflow,
  // nada de credencial embutida no host, nada de quebra de linha
  {
    const hostil = configFicticia({
      smtp_sender_name: "Loja\n::error::pwn\r::add-mask::x ::set-env name=A::b",
      smtp_host: `usuario:${SEGREDO}@host.exemplo.com`,
      smtp_admin_email: `a:b@${SEGREDO}`,
      smtp_port: `465${SEGREDO}`,
      rate_limit_email_sent: `30${SEGREDO}`,
      mailer_autoconfirm: `false${SEGREDO}`,
    });
    const f = fetchFalso([{ status: 200, corpo: JSON.stringify(hostil) }]);
    const s = saidaFalsa();
    assertEquals(
      await mod.medir({
        projeto: "savy",
        env: { ...TRES_TOKENS },
        fetchImpl: f.impl,
        saida: s.saida,
      }),
      0,
    );
    const tudo = s.tudo();
    assert(!tudo.includes(SEGREDO), "segredo em campo hostil não vaza");
    for (const linha of tudo.split("\n")) {
      assert(!linha.startsWith("::"), `linha começa como comando: ${linha}`);
    }
    assert(!tudo.includes("::"), "nenhum `::` vindo do corpo");
    assert(!tudo.includes("\r"), "sem retorno de carro");
  }
}

// --------------------------------------------------------------- os testes reais

const FONTE_SCRIPT = () => Deno.readTextFileSync(SCRIPT);
const FONTE_WORKFLOW = () => Deno.readTextFileSync(WORKFLOW);

Deno.test({
  name: "o workflow: dispatch só, projeto fechado, expected_sha no 1º passo, cada alvo com o seu segredo",
  ...SEM_SANITIZAR,
  fn: async () => {
    await verificarWorkflow(FONTE_WORKFLOW());
  },
});

Deno.test("o script: uma chamada, só GET, sem redirecionamento, ref por resolverRef", () => {
  verificarScript(FONTE_SCRIPT());
});

Deno.test({
  name: "o script: lista fechada, senha só como sim/não, 401/403 param, corpo cru nunca impresso",
  ...SEM_SANITIZAR,
  fn: async () => {
    await verificarComportamento(carregarScript(FONTE_SCRIPT()));
  },
});

Deno.test("o script exporta o necessário e não roda ao ser importado", () => {
  const mod = carregarScript(FONTE_SCRIPT());
  assertEquals(typeof mod.medir, "function");
  assertEquals(typeof mod.main, "function");
  assertEquals(Object.keys(mod.ALVOS).sort(), ["ikcous-publicada", "savy"]);
});

Deno.test({
  name: "o main() real, sem nenhum token: sai 1 (nos dois alvos e em loja) sem tocar a rede",
  ...SEM_SANITIZAR,
  fn: async () => {
    // processo filho SEM nenhum token: tem de sair 1 antes de qualquer rede
    for (const projeto of ["savy", "ikcous-publicada", "loja"]) {
      const r = await new Deno.Command("node", {
        args: [SCRIPT],
        cwd: RAIZ,
        env: { PATH: Deno.env.get("PATH") ?? "", PROJETO: projeto },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      assertEquals(r.code, 1, dec.decode(r.stderr));
    }
  },
});

Deno.test({
  name: "ponta a ponta: o main() real (node, fetch trocado por um stub no pré-carregamento) escreve a máscara primeiro, o log sem segredo e o resumo do run",
  ...SEM_SANITIZAR,
  fn: async () => {
    const dir = Deno.makeTempDirSync({ prefix: "medir-auth-e2e-" });
    const stub = join(dir, "stub-fetch.cjs");
    const resumo = join(dir, "resumo.md");
    const config = configFicticia({ smtp_pass: "se%gredo\nlinha2" });
    Deno.writeTextFileSync(
      stub,
      `const status = Number(process.env.STUB_STATUS || 200);
globalThis.fetch = async (url, init) => {
  process.stderr.write("STUB " + init.method + " " + url + "\\n");
  return { status, ok: status < 300, text: async () => process.env.STUB_CORPO };
};`,
    );
    const rodar = async (env: Record<string, string>) => {
      const r = await new Deno.Command("node", {
        args: ["--require", stub, SCRIPT],
        cwd: RAIZ,
        env: {
          PATH: Deno.env.get("PATH") ?? "",
          GITHUB_STEP_SUMMARY: resumo,
          STUB_CORPO: JSON.stringify(config),
          ...env,
        },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return {
        codigo: r.code,
        out: dec.decode(r.stdout),
        err: dec.decode(r.stderr),
      };
    };

    const ok = await rodar({
      PROJETO: "savy",
      SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
      SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
    });
    assertEquals(ok.codigo, 0, ok.err);
    assertStringIncludes(
      ok.err,
      `STUB GET https://api.supabase.com/v1/projects/${REF_SAVY}/config/auth`,
    );
    const linhas = ok.out.split("\n");
    assertEquals(
      linhas[0],
      "::add-mask::se%25gredo%0Alinha2",
      "máscara primeiro, escapada",
    );
    const resto = linhas.slice(1).join("\n");
    assert(
      !resto.includes("gredo"),
      "a senha não está no log depois da máscara",
    );
    assert(!ok.err.includes("gredo"), "nem no stderr");
    assertStringIncludes(resto, "smtp_pass preenchido: sim");
    const md = Deno.readTextFileSync(resumo);
    assert(!md.includes("gredo"), "nem no resumo do run");
    assertStringIncludes(md, "| smtp_host | smtp.exemplo.com.br |");
    assert(!md.includes("jwt_secret") && !md.includes("JWT-FICTICIO"));

    // 401: PARA, sem corpo, sem resumo novo
    const antes = Deno.readTextFileSync(resumo);
    const negado = await rodar({
      PROJETO: "savy",
      SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy",
      STUB_STATUS: "401",
      STUB_CORPO: "CORPO-NAO-IMPRIMIR",
    });
    assertEquals(negado.codigo, 1);
    assertStringIncludes(negado.err, `${"sem acesso legítimo à Savy"}`);
    assertStringIncludes(negado.err, "HTTP 401");
    assert(
      !negado.out.includes("CORPO-NAO") && !negado.err.includes("CORPO-NAO"),
    );
    assertEquals(
      Deno.readTextFileSync(resumo),
      antes,
      "falha não escreve resumo",
    );
    Deno.removeSync(dir, { recursive: true });
  },
});

// ------------------------------------------------------------------- MUTANTES

/** Aplica a troca e exige que ela tenha acontecido (senão o mutante é fantasma). */
function mutar(fonte: string, de: string | RegExp, para: string): string {
  const mutante = fonte.replace(de, para);
  assert(mutante !== fonte, `o mutante não mudou nada: ${String(de)}`);
  return mutante;
}

async function exigirVermelhoNoScript(nome: string, mutante: string) {
  let vermelho = false;
  try {
    verificarScript(mutante);
    await verificarComportamento(carregarScript(mutante));
  } catch {
    vermelho = true;
  }
  assert(vermelho, `mutante "${nome}" sobreviveu: o teste não o enxerga`);
}

async function exigirVermelhoNoWorkflow(nome: string, mutante: string) {
  let vermelho = false;
  try {
    await verificarWorkflow(mutante);
  } catch {
    vermelho = true;
  }
  assert(vermelho, `mutante "${nome}" sobreviveu: o teste não o enxerga`);
}

Deno.test({
  name: "mutantes do SCRIPT: cada defeito plantado de volta deixa a verificação VERMELHA",
  ...SEM_SANITIZAR,
  fn: async () => {
    const real = FONTE_SCRIPT();
    const mutantes: Record<string, string> = {
      "imprimir o corpo cru da resposta": mutar(
        real,
        "const filtrado = filtrarConfigAuth(config);",
        "saida.log(JSON.stringify(config)); const filtrado = filtrarConfigAuth(config);",
      ),
      "método de escrita (POST)": mutar(
        real,
        'method: "GET"',
        'method: "POST"',
      ),
      "método de escrita (PATCH com corpo)": mutar(
        real,
        'method: "GET",',
        'method: "PATCH", body: "{}",',
      ),
      "projeto de texto livre (cai na Savy)": mutar(
        real,
        /const alvo = Object\.hasOwn\(ALVOS, projeto\) \? ALVOS\[projeto\] : null;/,
        "const alvo = ALVOS[projeto] ?? ALVOS.savy;",
      ),
      "segredo do vizinho como reserva": mutar(
        real,
        "const token = env[alvo.segredo];",
        "const token = env[alvo.segredo] || env.SUPABASE_ACCESS_TOKEN_IKCOUS || env.SUPABASE_ACCESS_TOKEN;",
      ),
      "vazar a senha na saída": mutar(
        real,
        /config = null; \/\/ daqui[^\n]*/,
        'filtrado.campos.push(["smtp_pass", config.smtp_pass]);',
      ),
      "vazar todos os campos (sem lista fechada)": mutar(
        real,
        /config = null; \/\/ daqui[^\n]*/,
        "for (const [k, v] of Object.entries(config)) filtrado.campos.push([k, String(v)]);",
      ),
      "campo fora da lista (site_url) entra na saída": mutar(
        real,
        /config = null; \/\/ daqui[^\n]*/,
        'filtrado.campos.push(["site_url", config.site_url]);',
      ),
      "sem máscara para a senha": mutar(
        real,
        /if \(preenchido\(config\.smtp_pass\)\) saida\.mascarar\(config\.smtp_pass\);/,
        "",
      ),
      "máscara só depois da saída": mutar(
        mutar(
          real,
          /if \(preenchido\(config\.smtp_pass\)\) saida\.mascarar\(config\.smtp_pass\);/,
          "const senhaAdiada = config.smtp_pass;",
        ),
        "saida.resumo(markdown);",
        "saida.resumo(markdown); saida.mascarar(senhaAdiada);",
      ),
      "siga o redirecionamento": mutar(
        real,
        'redirect: "error"',
        'redirect: "follow"',
      ),
      "imprimir o corpo do erro HTTP": mutar(
        real,
        "if (!r.ok) {",
        "if (!r.ok) {\n    saida.erro(await r.text());",
      ),
      "401/403 não param (segue lendo o corpo)": mutar(
        real,
        /if \(status === 401 \|\| status === 403\) \{/,
        "if (false) {",
      ),
      "host por variável de ambiente": mutar(
        real,
        'const API_BASE = "https://api.supabase.com";',
        'const API_BASE = process.env.API_BASE || "https://api.supabase.com";',
      ),
      "mensagem do erro de rede vai ao log": mutar(
        real,
        "(${nomeSeguro(erro)})",
        "(${erro.message})",
      ),
      "nome do remetente sem limpeza": mutar(
        real,
        "preenchido(c.smtp_sender_name) ? textoSeguro(c.smtp_sender_name) : VAZIO",
        "String(c.smtp_sender_name ?? VAZIO)",
      ),
      "host impresso sem validar o formato": mutar(
        real,
        "return HOST.test(v) ? v : `preenchido ${INESPERADO}`;",
        "return v;",
      ),
    };
    for (const [nome, mutante] of Object.entries(mutantes)) {
      await exigirVermelhoNoScript(nome, mutante);
    }
  },
});

Deno.test({
  name: "mutantes do WORKFLOW: cada defeito plantado de volta deixa a verificação VERMELHA",
  ...SEM_SANITIZAR,
  fn: async () => {
    const real = FONTE_WORKFLOW();
    const mutantes: Record<string, string> = {
      "pull_request_target como gatilho": mutar(
        real,
        /\non:\n/,
        "\non:\n  pull_request_target:\n    branches: [main]\n",
      ),
      "projeto em texto livre": mutar(real, /type: choice/, "type: string"),
      "opção a mais no projeto (loja)": mutar(
        real,
        /(\n\s+- savy\n)/,
        "$1          - loja\n",
      ),
      "sem expected_sha obrigatório": mutar(
        real,
        /(expected_sha:[\s\S]*?required: )true/,
        "$1false",
      ),
      "sem o passo do expected_sha": mutar(
        real,
        /\n {6}- name: Confere o alvo[\s\S]*?(?=\n {6}- uses: actions\/checkout)/,
        "",
      ),
      // (a regex de 40 hex sozinha é redundante com a igualdade ao GITHUB_SHA, que já é
      // de 40 hex: enfraquecê-la é mutante equivalente; o que importa é a igualdade)
      "expected_sha não comparado ao GITHUB_SHA": mutar(
        real,
        /\|\| \[ "\$\{EXPECTED_SHA,,\}" != "\$\{GITHUB_SHA,,\}" \]/,
        "",
      ),
      "Savy cai no segredo da CAF": mutar(
        real,
        /secrets\.SUPABASE_ACCESS_TOKEN_SAVY \|\| ''/,
        "secrets.SUPABASE_ACCESS_TOKEN_SAVY || secrets.SUPABASE_ACCESS_TOKEN_IKCOUS",
      ),
      "segredo legado no passo": mutar(
        real,
        /(\n\s+PROJETO: \$\{\{ inputs\.projeto \}\}\n\s+run: node)/,
        "\n          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}$1",
      ),
      "permissão de escrita": mutar(real, /contents: read/, "contents: write"),
      "entrada interpolada num run:": mutar(
        real,
        /run: node scripts\/publicacao\/medir-auth-da-loja\.cjs/,
        "run: PROJETO=${{ inputs.projeto }} node scripts/publicacao/medir-auth-da-loja.cjs",
      ),
      "checkout guarda a credencial": mutar(
        real,
        /persist-credentials: false/,
        "persist-credentials: true",
      ),
      "run-name sem o projeto": mutar(
        real,
        /run-name: .*\n/,
        'run-name: "medir auth"\n',
      ),
    };
    for (const [nome, mutante] of Object.entries(mutantes)) {
      await exigirVermelhoNoWorkflow(nome, mutante);
    }
  },
});

Deno.test("o teste não é vazio: o verificador de comportamento RECUSA um módulo falso", async () => {
  await assertRejects(() =>
    verificarComportamento({
      medir: () => Promise.resolve(0),
    }),
  );
});
