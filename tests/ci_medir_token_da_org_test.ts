// @ts-nocheck
/* eslint-disable security/detect-object-injection -- dublês de teste: as chaves vêm de constantes e mapas fechados do próprio arquivo, nunca de entrada externa. */
/* eslint-disable security/detect-non-literal-require -- carrega o script (real ou mutante) de um arquivo temporário criado aqui. */
/**
 * O workflow `medir-token-da-org.yml` e o script
 * `scripts/frota/medir-token-da-org.cjs` (A20 do plano da org central, com o
 * ADENDO da revisão Opus de 26/11/2026): PROVAR, só com GET, que o segredo da
 * org central (`SUPABASE_ACCESS_TOKEN_LOJAS`) enxerga SÓ a org "IKCOUS Lojas".
 *
 * O RISCO: um token PESSOAL do dono alcança a CONTA inteira (IKCOUS, Savy e
 * qualquer outro projeto). Guardado como segredo da org, ele daria a todo run
 * de toda loja da org o alcance da conta inteira. O que estes testes medem:
 *  - o workflow: só `workflow_dispatch`, permissões mínimas, `expected_sha`
 *    completo e igual ao do run no PRIMEIRO passo (o bloco `run:` é EXTRAÍDO e
 *    rodado em bash), checkout sem credencial gravada, nenhuma entrada
 *    interpolada em `run:`, e o segredo só no ÚLTIMO passo, com o nome que
 *    org-central.json dá, e esse passo não imprime o ambiente;
 *  - o script: só GET, sem redirecionamento, exatamente as duas leituras
 *    (`/v1/organizations` e `/v1/projects`); UMA org, com o slug de
 *    org-central.json; todo projeto com esse `organization_slug`; qualquer
 *    org ou projeto a mais = VERMELHO com "o segredo é amplo demais"; 401/403
 *    param sem segunda leitura; corpo fora do formato = VERMELHO (não dá para
 *    provar); o token, o nome de org alheia e o ref de projeto alheio nunca
 *    aparecem na saída (o log de um repositório público é público).
 *
 * MUTANTES: `verificarWorkflow`, `verificarScript` e `verificarComportamento`
 * são as MESMAS funções que julgam os arquivos de verdade; o bloco "mutantes"
 * planta cada defeito de volta e exige que a verificação fique VERMELHA.
 */
import { createRequire } from "node:module";
import { parse } from "https://deno.land/std@0.177.0/encoding/yaml.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const WORKFLOW = join(RAIZ, ".github/workflows/medir-token-da-org.yml");
const SCRIPT = join(RAIZ, "scripts/frota/medir-token-da-org.cjs");
const LOJAS_CJS = join(RAIZ, "scripts/frota/lojas.cjs");
const ORG_CJS = join(RAIZ, "scripts/frota/org-central.cjs");

const lojasMod = require(LOJAS_CJS);
const { carregarOrgCentral, validarOrgCentral } = require(ORG_CJS);
const SEGREDO_DA_ORG = carregarOrgCentral().segredoDoGitHub;

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };

// Fixtures INVENTADAS: slug de org e refs que não existem em lugar nenhum.
const SLUG = "abcdefghijorgcentral";
const SLUG_ALHEIO = "zyxwvutsrqorgalheiaa";
const NOME_ALHEIO = "Org Alheia Do Dono";
const REF_NOVA = "yzaaaaaaaaaaaaaaaaab";
const REF_ALHEIO = "yzqqqqqqqqqqqqqqqqqq";
const LOJA_NA_ORG = "loja-org-teste";
// Token de teste montado em tempo de execução (o secretlint barra literal).
const TOKEN = `sbp_fc${"ab".repeat(20)}`;

const ORG = validarOrgCentral({
  slug: SLUG,
  nome: "IKCOUS Lojas",
  chaveDoCofre: "org-ikcous-lojas",
  segredoDoGitHub: SEGREDO_DA_ORG,
});
const ORG_SEM_SLUG = validarOrgCentral({
  slug: null,
  nome: "IKCOUS Lojas",
  chaveDoCofre: "org-ikcous-lojas",
  segredoDoGitHub: SEGREDO_DA_ORG,
});

/** O cadastro de hoje + uma loja assinante no segredo da org. */
function cadastroComLojaNaOrg() {
  const j = JSON.parse(
    Deno.readTextFileSync(join(RAIZ, "scripts/frota/lojas.json")),
  );
  j.lojas[LOJA_NA_ORG] = {
    ref: REF_NOVA,
    classe: "assinante",
    apelido: "Loja Org Teste",
    segredoDoToken: SEGREDO_DA_ORG,
    functionsNomeadas: true,
  };
  return lojasMod.validarCadastro(j);
}
const CADASTRO_REAL = lojasMod.carregarLojas();
const REF_IKCOUS = CADASTRO_REAL.lojas["ikcous-publicada"].ref;
const REF_SAVY = CADASTRO_REAL.lojas.savy.ref;

// ---------------------------------------------------------------- utilitários

function semComentariosYaml(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

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
 * temporária cujos `require` relativos apontam para os módulos reais. */
function carregarScript(fonte: string) {
  const dir = Deno.makeTempDirSync({ prefix: "medir-token-org-" });
  const arquivo = join(dir, "medir-token-da-org.cjs");
  const ajustada = fonte
    .replaceAll('"./lojas.cjs"', JSON.stringify(LOJAS_CJS))
    .replaceAll('"./org-central.cjs"', JSON.stringify(ORG_CJS));
  Deno.writeTextFileSync(arquivo, ajustada);
  try {
    return require(arquivo);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

/** Um fetch falso que anota cada chamada e responde pelo CAMINHO pedido. */
function fetchFalso(
  respostas: Record<string, Record<string, unknown> | Error>,
) {
  const chamadas: Array<{ url: string; init: Record<string, unknown> }> = [];
  const impl = (url: string, init: Record<string, unknown>) => {
    chamadas.push({ url: String(url), init });
    const caminho = String(url).replace("https://api.supabase.com", "");
    const r = respostas[caminho];
    if (r === undefined) throw new Error(`fetch inesperado: ${url}`);
    if (r instanceof Error) return Promise.reject(r);
    const status = r.status ?? 200;
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      text: () =>
        Promise.resolve(
          typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo),
        ),
    });
  };
  return { impl, chamadas };
}

function saidaFalsa() {
  const linhas: string[] = [];
  const erros: string[] = [];
  const resumo: string[] = [];
  return {
    saida: {
      log: (l: string) => linhas.push(l),
      erro: (l: string) => erros.push(l),
      resumo: (m: string) => resumo.push(m),
    },
    linhas,
    erros,
    resumo,
    tudo: () => [...linhas, ...erros, ...resumo].join("\n"),
  };
}

const org = (slug: string, name = "IKCOUS Lojas") => ({ id: slug, slug, name });
const projeto = (ref: string, slug: string, extra = {}) => ({
  id: ref,
  ref,
  organization_id: slug,
  organization_slug: slug,
  name: `ikcous-${ref.slice(0, 4)}`,
  region: "sa-east-1",
  created_at: "2026-12-01T00:00:00Z",
  status: "ACTIVE_HEALTHY",
  database: { host: `db.${ref}.supabase.co`, version: "17" },
  ...extra,
});

async function rodarMedicao(
  mod,
  respostas,
  { orgCentral = ORG, cadastro = CADASTRO_REAL, env = undefined } = {},
) {
  const f = fetchFalso(respostas);
  const s = saidaFalsa();
  const codigo = await mod.medir({
    env: env ?? { [SEGREDO_DA_ORG]: TOKEN },
    fetchImpl: f.impl,
    saida: s.saida,
    org: orgCentral,
    cadastro,
  });
  return { codigo, f, s };
}

// ------------------------------------------------- verificação do WORKFLOW

async function verificarWorkflow(yamlCru: string) {
  const yaml = semComentariosYaml(yamlCru);
  const doc = parse(yamlCru);

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
  assert(!yaml.includes("continue-on-error"), "sem continue-on-error");
  assert(!/^\s*env:/m.test(yaml.split(/^jobs:/m)[0]), "sem env de topo");

  const entradas = gatilhos.workflow_dispatch.inputs;
  assertEquals(Object.keys(entradas), ["expected_sha"]);
  assertEquals(entradas.expected_sha.required, true);

  assertEquals(Object.keys(doc.jobs), ["medir"]);
  const job = doc.jobs.medir;
  assert(job.env === undefined, "sem env de job (o segredo fica num passo só)");
  const passos = job.steps;

  // PRIMEIRO passo: confere o sha, sem `uses`, sem rede, sem segredo
  const primeiro = passos[0];
  assert(primeiro.run && !primeiro.uses, "o 1º passo é a conferência do sha");
  assertEquals(primeiro.env, { EXPECTED_SHA: "${{ inputs.expected_sha }}" });
  assert(!/curl|fetch|api\.supabase/.test(primeiro.run), "sem rede antes");
  assert(!JSON.stringify(primeiro).includes("secrets."), "sem segredo");
  const rodar = (esperado: string) =>
    rodarBash(primeiro.run, {
      PATH: Deno.env.get("PATH") ?? "",
      EXPECTED_SHA: esperado,
      GITHUB_SHA: SHA,
    });
  assertEquals((await rodar(SHA)).codigo, 0, "sha igual");
  assertEquals((await rodar(SHA.toUpperCase())).codigo, 0, "maiúsculas");
  for (const [caso, esperado] of [
    ["vazio", ""],
    ["curto (7)", SHA.slice(0, 7)],
    ["39 caracteres", SHA.slice(0, 39)],
    ["41 caracteres", `${SHA}a`],
    ["40 hex de OUTRO commit", "b".repeat(40)],
    ["40 caracteres não hex", "g".repeat(40)],
    ["com espaço no fim", `${SHA.slice(0, 39)} `],
  ]) {
    const r = await rodar(esperado);
    assertEquals(r.codigo, 1, `${caso}: ${r.saida}`);
    assertStringIncludes(
      r.saida,
      "expected_sha completo e igual ao GITHUB_SHA",
    );
  }

  // checkout sem credencial gravada, depois da conferência
  const iCheckout = passos.findIndex((p) =>
    String(p.uses ?? "").startsWith("actions/checkout"),
  );
  assert(iCheckout > 0, "o checkout vem depois da conferência");
  assertEquals(passos[iCheckout].with?.["persist-credentials"], false);

  // nenhuma entrada interpolada num `run:` (injeção de comando)
  for (const p of passos) {
    assert(
      !String(p.run ?? "").includes("${{"),
      `\${{ }} dentro de run: ${p.name}`,
    );
  }

  // SEGREDO: um passo só, o último, com o NOME de org-central.json
  const comSegredo = passos.filter((p) =>
    JSON.stringify(p).includes("secrets."),
  );
  assertEquals(comSegredo.length, 1, "um único passo vê segredo");
  const ultimo = passos[passos.length - 1];
  assertEquals(comSegredo[0], ultimo, "e é o passo do script");
  assertEquals(ultimo.env, {
    [SEGREDO_DA_ORG]: `\${{ secrets.${SEGREDO_DA_ORG} }}`,
  });
  assertEquals(ultimo.run, "node scripts/frota/medir-token-da-org.cjs");
  const usos = yaml.match(/secrets[.[]/g) ?? [];
  assertEquals(usos.length, 1, "um segredo referenciado, e só");
  assert(!/toJSON\(secrets\)|secrets\[/.test(yaml), "sem coleção de segredos");
  // nenhum passo imprime o ambiente nem o segredo
  for (const p of passos) {
    const run = String(p.run ?? "");
    assert(
      !/\benv\b|printenv|set -x|\$\{?SUPABASE_ACCESS_TOKEN/.test(run),
      `passo que imprime ambiente ou segredo: ${p.name}`,
    );
  }
}

// ---------------------------------------------------- verificação do SCRIPT (texto)

function verificarScript(fonte: string) {
  const js = semComentariosJs(fonte);
  assertEquals(
    (js.match(/fetchImpl\(/g) ?? []).length,
    1,
    "uma única função faz a rede",
  );
  assert(!/\bfetch\(/.test(js), "nenhum fetch direto fora do injetado");
  assertStringIncludes(js, 'method: "GET"');
  assertStringIncludes(js, 'redirect: "error"');
  assert(
    !/\b(POST|PUT|PATCH|DELETE)\b/i.test(js),
    "nenhum método de escrita no código",
  );
  assert(!/\bbody\s*:/.test(js), "nenhum corpo de pedido");
  assert(!/process\.env\.[A-Z_]*API/.test(js), "sem desvio de host por env");
  assertStringIncludes(js, 'require("./org-central.cjs")');
}

// ------------------------------------------- verificação do COMPORTAMENTO do script

async function verificarComportamento(mod) {
  const ORGS = "/v1/organizations";
  const PROJS = "/v1/projects";

  // (a) caminho feliz: UMA org, a central; os projetos todos dela
  {
    const { codigo, f, s } = await rodarMedicao(
      mod,
      {
        [ORGS]: { corpo: [org(SLUG)] },
        [PROJS]: { corpo: [projeto(REF_NOVA, SLUG)] },
      },
      { cadastro: cadastroComLojaNaOrg() },
    );
    assertEquals(codigo, 0, s.tudo());
    assertEquals(
      f.chamadas.map((c) => c.url),
      [`https://api.supabase.com${ORGS}`, `https://api.supabase.com${PROJS}`],
    );
    for (const { init } of f.chamadas) {
      assertEquals(init.method, "GET");
      assertEquals(init.redirect, "error");
      assertEquals(init.headers.Authorization, `Bearer ${TOKEN}`);
      assert(init.body === undefined, "GET sem corpo");
    }
    const tudo = s.tudo();
    assert(!tudo.includes(TOKEN), "o token não aparece");
    assert(!tudo.includes(TOKEN.slice(0, 12)), "nem o começo do token");
    assertStringIncludes(tudo, "PROVADO");
    assertStringIncludes(tudo, SLUG);
    assertStringIncludes(tudo, REF_NOVA);
    assertStringIncludes(tudo, `${LOJA_NA_ORG}: sim`);
    assertStringIncludes(tudo, "ikcous-publicada: nao");
    assert(!tudo.includes("db."), "o host do banco não vai para o log");
    assert(s.resumo.length === 1, "um resumo do run");
  }

  // (b) org central com ZERO projetos (o esperado em B3): verde
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [org(SLUG)] },
      [PROJS]: { corpo: [] },
    });
    assertEquals(codigo, 0, s.tudo());
    assertStringIncludes(s.tudo(), "0 projeto");
  }

  // (c) DUAS orgs (o token pessoal do dono): VERMELHO, amplo demais, sem nome alheio
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [org(SLUG), org(SLUG_ALHEIO, NOME_ALHEIO)] },
      [PROJS]: { corpo: [projeto(REF_NOVA, SLUG)] },
    });
    assertEquals(codigo, 1, s.tudo());
    assertStringIncludes(s.tudo(), "o segredo é amplo demais");
    assert(!s.tudo().includes(SLUG_ALHEIO), "o slug alheio não aparece");
    assert(!s.tudo().includes(NOME_ALHEIO), "o nome alheio não aparece");
  }

  // (d) UMA org, mas não a central: VERMELHO
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [org(SLUG_ALHEIO, NOME_ALHEIO)] },
      [PROJS]: { corpo: [] },
    });
    assertEquals(codigo, 1, s.tudo());
    assert(!s.tudo().includes(SLUG_ALHEIO));
    assert(!s.tudo().includes("PROVADO"));
  }

  // (e) nenhuma org: VERMELHO (não prova nada)
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [] },
      [PROJS]: { corpo: [] },
    });
    assertEquals(codigo, 1, s.tudo());
  }

  // (f) projeto de fora (a IKCOUS antes da transferência e um alheio):
  //     VERMELHO, amplo demais; a loja conhecida é nomeada, o ref alheio não
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [org(SLUG)] },
      [PROJS]: {
        corpo: [
          projeto(REF_NOVA, SLUG),
          projeto(REF_IKCOUS, SLUG_ALHEIO),
          projeto(REF_ALHEIO, SLUG_ALHEIO),
        ],
      },
    });
    assertEquals(codigo, 1, s.tudo());
    assertStringIncludes(s.tudo(), "o segredo é amplo demais");
    assertStringIncludes(s.tudo(), "ikcous-publicada");
    assert(!s.tudo().includes(REF_ALHEIO), "ref alheio não aparece");
    assert(!s.tudo().includes(SLUG_ALHEIO), "slug alheio não aparece");
  }

  // (g) projeto sem organization_slug: VERMELHO (não dá para provar)
  {
    // `undefined` some no JSON.stringify do fetch falso: o campo não vem
    const p = { ...projeto(REF_NOVA, SLUG), organization_slug: undefined };
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [org(SLUG)] },
      [PROJS]: { corpo: [p] },
    });
    assertEquals(codigo, 1, s.tudo());
    assertStringIncludes(s.tudo(), "fora do formato");
  }

  // (h) org sem slug (só o `id` velho): VERMELHO, nunca cai no `id`
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [{ id: SLUG, name: "IKCOUS Lojas" }] },
      [PROJS]: { corpo: [] },
    });
    assertEquals(codigo, 1, s.tudo());
    assertStringIncludes(s.tudo(), "fora do formato");
  }

  // (i) corpo que não é lista: VERMELHO, corpo não impresso
  for (const corpo of ['{"slug":"x"}', "nao-json-CORPO-CRU", "null"]) {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo },
      [PROJS]: { corpo: [] },
    });
    assertEquals(codigo, 1, `${corpo}: ${s.tudo()}`);
    assert(!s.tudo().includes("CORPO-CRU"), "corpo cru não impresso");
  }

  // (j) 401 e 403 nas orgs: VERMELHO, sem a segunda leitura
  for (const status of [401, 403]) {
    const { codigo, f, s } = await rodarMedicao(mod, {
      [ORGS]: { status, corpo: "CORPO-DO-ERRO" },
      [PROJS]: { corpo: [] },
    });
    assertEquals(codigo, 1, s.tudo());
    assertEquals(f.chamadas.length, 1, `${status}: para na primeira`);
    assertStringIncludes(s.tudo(), `HTTP ${status}`);
    assertStringIncludes(s.tudo(), `recusou o ${SEGREDO_DA_ORG}`);
    assert(!s.tudo().includes("CORPO-DO-ERRO"));
  }

  // (k) 401/403 nos projetos e 500 em qualquer um: VERMELHO
  for (const [orgs, projs] of [
    [{ corpo: [org(SLUG)] }, { status: 403, corpo: "x" }],
    [{ corpo: [org(SLUG)] }, { status: 401, corpo: "x" }],
    [{ corpo: [org(SLUG)] }, { status: 500, corpo: "CORPO-DO-ERRO" }],
    [{ status: 429, corpo: "CORPO-DO-ERRO" }, { corpo: [] }],
  ]) {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: orgs,
      [PROJS]: projs,
    });
    assertEquals(codigo, 1, s.tudo());
    assert(!s.tudo().includes("PROVADO"));
    assert(!s.tudo().includes("CORPO-DO-ERRO"), "corpo do erro não impresso");
  }

  // (l) rede que cai: VERMELHO, sem a mensagem do erro (pode ter URL)
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: new TypeError(`falhou em ${TOKEN}`),
      [PROJS]: { corpo: [] },
    });
    assertEquals(codigo, 1);
    assert(!s.tudo().includes(TOKEN));
  }

  // (m) org central sem slug em org-central.json: VERMELHO sem rede
  {
    const { codigo, f, s } = await rodarMedicao(
      mod,
      {},
      {
        orgCentral: ORG_SEM_SLUG,
      },
    );
    assertEquals(codigo, 1, s.tudo());
    assertEquals(f.chamadas.length, 0, "nenhuma leitura sem o slug");
    assertStringIncludes(s.tudo(), "org-central.json");
  }

  // (n) sem o segredo no ambiente (ou só os de loja): VERMELHO sem rede
  for (const env of [
    {},
    { [SEGREDO_DA_ORG]: "" },
    {
      SUPABASE_ACCESS_TOKEN: "tk-legado",
      SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf",
    },
  ]) {
    const { codigo, f } = await rodarMedicao(mod, {}, { env });
    assertEquals(codigo, 1);
    assertEquals(f.chamadas.length, 0, "sem segredo, sem rede");
  }

  // (o) loja do cadastro no segredo da org que o token NÃO enxerga: VERMELHO
  {
    const { codigo, s } = await rodarMedicao(
      mod,
      {
        [ORGS]: { corpo: [org(SLUG)] },
        [PROJS]: { corpo: [] },
      },
      { cadastro: cadastroComLojaNaOrg() },
    );
    assertEquals(codigo, 1, s.tudo());
    assertStringIncludes(s.tudo(), LOJA_NA_ORG);
  }

  // (p) a IKCOUS e a Savy DEPOIS da transferência (B5): verdes, "sim"
  {
    const { codigo, s } = await rodarMedicao(mod, {
      [ORGS]: { corpo: [org(SLUG)] },
      [PROJS]: { corpo: [projeto(REF_IKCOUS, SLUG), projeto(REF_SAVY, SLUG)] },
    });
    assertEquals(codigo, 0, s.tudo());
    assertStringIncludes(s.tudo(), "ikcous-publicada: sim");
    assertStringIncludes(s.tudo(), "savy: sim");
  }
}

// ------------------------------------------------------------------- os testes

const FONTE_SCRIPT = () => Deno.readTextFileSync(SCRIPT);
const FONTE_WORKFLOW = () => Deno.readTextFileSync(WORKFLOW);

Deno.test({
  name: "o workflow: dispatch só, expected_sha no 1º passo, o segredo da org num passo só, sem imprimir ambiente",
  ...SEM_SANITIZAR,
  fn: async () => {
    await verificarWorkflow(FONTE_WORKFLOW());
  },
});

Deno.test("o script: só GET, sem redirecionamento, sem corpo, org pelo org-central.cjs", () => {
  verificarScript(FONTE_SCRIPT());
});

Deno.test({
  name: "o script: uma org só (a central), projetos só dela, o resto é VERMELHO com 'o segredo é amplo demais'",
  ...SEM_SANITIZAR,
  fn: async () => {
    await verificarComportamento(carregarScript(FONTE_SCRIPT()));
  },
});

Deno.test({
  name: "o main() real com o org-central.json de hoje (slug null) e sem token: sai 1 sem tocar a rede",
  ...SEM_SANITIZAR,
  fn: async () => {
    assertEquals(carregarOrgCentral().slug, null, "controle: slug null hoje");
    const dir = Deno.makeTempDirSync({ prefix: "medir-token-org-main-" });
    const stub = join(dir, "sem-rede.cjs");
    Deno.writeTextFileSync(
      stub,
      `globalThis.fetch = async () => { process.stderr.write("REDE-TOCADA\\n"); throw new Error("sem rede"); };`,
    );
    for (const env of [{}, { [SEGREDO_DA_ORG]: TOKEN }]) {
      const r = await new Deno.Command("node", {
        args: ["--require", stub, SCRIPT],
        cwd: RAIZ,
        env: { PATH: Deno.env.get("PATH") ?? "", ...env },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      const saida = dec.decode(r.stdout) + dec.decode(r.stderr);
      assertEquals(r.code, 1, saida);
      assert(!saida.includes("REDE-TOCADA"), saida);
      assert(!saida.includes(TOKEN), "o token não aparece");
    }
    Deno.removeSync(dir, { recursive: true });
  },
});

// ------------------------------------------------------------------- MUTANTES

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
      "aceitar mais de uma org": mutar(
        real,
        "orgs.length !== 1",
        "orgs.length < 1",
      ),
      "não conferir o slug da org": mutar(
        real,
        "orgs[0].slug !== org.slug",
        "false",
      ),
      "ignorar projeto de fora": mutar(
        real,
        "(p) => p.organization_slug !== org.slug",
        "() => false",
      ),
      "cair no organization_id velho": mutar(
        real,
        'typeof p.organization_slug !== "string"',
        "false",
      ),
      "401/403 viram aviso": mutar(
        real,
        "if (status === 401 || status === 403) {",
        "if (false) {",
      ),
      "método de escrita": mutar(real, 'method: "GET"', 'method: "POST"'),
      "siga o redirecionamento": mutar(
        real,
        'redirect: "error"',
        'redirect: "follow"',
      ),
      "imprimir a lista crua de projetos": mutar(
        real,
        "const projetos = lidaProjetos.lista;",
        "const projetos = lidaProjetos.lista; saida.log(JSON.stringify(projetos));",
      ),
      "imprimir o corpo do erro HTTP": mutar(
        real,
        "if (!r.ok) {",
        "if (!r.ok) { return { falha: await r.text() };",
      ),
      "imprimir o token": mutar(
        real,
        "const token = env[org.segredoDoGitHub];",
        "const token = env[org.segredoDoGitHub]; saida.log(String(token));",
      ),
      "imprimir as orgs alheias": mutar(
        real,
        "const alheias = orgs.filter((o) => o.slug !== org.slug).length;",
        "const alheias = orgs.filter((o) => o.slug !== org.slug).length; saida.log(orgs.map((o) => o.slug + o.name).join());",
      ),
      "segredo de loja como reserva": mutar(
        real,
        "const token = env[org.segredoDoGitHub];",
        "const token = env[org.segredoDoGitHub] || env.SUPABASE_ACCESS_TOKEN_IKCOUS;",
      ),
      "loja da org invisível não reprova": mutar(
        real,
        "if (naOrgInvisiveis.length > 0)",
        "if (false)",
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
    const linhaDoSegredo = `${SEGREDO_DA_ORG}: \${{ secrets.${SEGREDO_DA_ORG} }}`;
    const mutantes: Record<string, string> = {
      "gatilho pull_request_target": mutar(
        real,
        "  workflow_dispatch:",
        "  pull_request_target:\n  workflow_dispatch:",
      ),
      "permissão de escrita": mutar(
        real,
        "  contents: read",
        "  contents: write",
      ),
      "checkout grava a credencial": mutar(
        real,
        "persist-credentials: false",
        "persist-credentials: true",
      ),
      "segredo no env do job": mutar(
        real,
        "    runs-on: ubuntu-latest",
        `    runs-on: ubuntu-latest\n    env:\n      ${linhaDoSegredo}`,
      ),
      "expected_sha interpolado no run": mutar(
        real,
        '"$EXPECTED_SHA" =~',
        '"${{ inputs.expected_sha }}" =~',
      ),
      "sem conferir o sha do run": mutar(
        real,
        ' || [ "${EXPECTED_SHA,,}" != "${GITHUB_SHA,,}" ]',
        "",
      ),
      "imprimir o ambiente no passo do segredo": mutar(
        real,
        "run: node scripts/frota/medir-token-da-org.cjs",
        "run: env; node scripts/frota/medir-token-da-org.cjs",
      ),
      "o segredo pessoal (outro nome)": mutar(
        real,
        linhaDoSegredo,
        `${SEGREDO_DA_ORG}: \${{ secrets.SUPABASE_ACCESS_TOKEN_IKCOUS }}`,
      ),
    };
    for (const [nome, mutante] of Object.entries(mutantes)) {
      await exigirVermelhoNoWorkflow(nome, mutante);
    }
  },
});
