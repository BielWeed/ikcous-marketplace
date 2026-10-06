// @ts-nocheck
/**
 * O LEDGER (`supabase_migrations.schema_migrations`) nos workflows de banco
 * (06/10/2026). Duas peças:
 *
 * 1. aplicar-migrations.yml: o apply de um arquivo de MIGRATION registra a versão
 *    no ledger DENTRO da mesma transação (mesma requisição BEGIN … COMMIT), com o
 *    formato de scripts/db-apply.cjs — (version, name) ON CONFLICT (version) DO
 *    NOTHING —, entre o corpo e a impressão digital DEPOIS; a PROVA (BEGIN …
 *    ROLLBACK) também o inclui, para que um schema ausente apareça ali; o
 *    arquivo rollback-manual-<versão> APAGA a linha daquela versão (DELETE
 *    WHERE version = '<14 dígitos do NOME>') na mesma posição e transação do
 *    corpo do rollback, e a prova o inclui; migration nunca apaga e rollback
 *    nunca insere; e a impressão digital não conta o ledger como "dado
 *    existente alterado".
 *
 * 2. conferir-banco-da-loja.yml / conferir-banco.cjs: a faixa de ledger `92-202`
 *    (BACKFILL das 9 migrations 20261192..20261202 sem a 201), permitida também
 *    em `ikcous-publicada` e `savy`, SÓ depois da pré-checagem da 8e
 *    (todas as linhas ok=true), com INSERT fixo pinado por SHA-256.
 */
import { createRequire } from "node:module";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const APLICAR = join(RAIZ, ".github/workflows/aplicar-migrations.yml");
const CONFERIR = join(RAIZ, ".github/workflows/conferir-banco-da-loja.yml");
const SCRIPT = join(RAIZ, "scripts/publicacao/conferir-banco.cjs");
const CONSULTAS = join(RAIZ, "scripts/publicacao/consultas");
const MIGRATIONS = join(RAIZ, "supabase/migrations");
const REF_CAF = "cafkrminfnokvgjqtkle";
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const SEM_SANITIZAR = { sanitizeOps: false, sanitizeResources: false };
const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

// ---------------------------------------------------------------------------
// Parte 1 — o registro no ledger dentro do apply
// ---------------------------------------------------------------------------
const requireLocal = createRequire(import.meta.url);

function blocoRunDoStep(yaml: string, nomeDoStep: string): string {
  const linhas = yaml.split(/\r?\n/);
  const iNome = linhas.findIndex(
    (l) => l.includes("name:") && l.includes(nomeDoStep),
  );
  assert(iNome >= 0, `step "${nomeDoStep}" não achado`);
  const iRun = linhas.findIndex(
    (l, i) => i > iNome && /^\s*run:\s*\|\s*$/.test(l),
  );
  assert(iRun > iNome);
  const recuoDe = (l: string) => l.match(/^\s*/)[0].length;
  const recuoRun = recuoDe(linhas[iRun]);
  const corpo: string[] = [];
  for (const l of linhas.slice(iRun + 1)) {
    if (l.trim() === "") {
      corpo.push("");
      continue;
    }
    if (recuoDe(l) <= recuoRun) break;
    corpo.push(l);
  }
  const menor = Math.min(
    ...corpo.filter((l) => l.trim() !== "").map((l) => recuoDe(l)),
  );
  return corpo.map((l) => l.slice(menor)).join("\n");
}

function argumentoDoNodeE(blocoRun: string): string {
  const linhas = blocoRun.split("\n");
  const iAbre = linhas.findIndex((l) => /^\s*node -e "\s*$/.test(l));
  assert(iAbre >= 0);
  const iFecha = linhas.findIndex((l, i) => i > iAbre && /^\s*"\s*$/.test(l));
  assert(iFecha > iAbre);
  return linhas.slice(iAbre + 1, iFecha).join("\n");
}

const desescaparBash = (js: string) => js.replace(/\\([\\$"`])/g, "$1");

type Resposta = { status?: number; corpo?: string };
const SONDA = JSON.stringify([
  {
    sonda1: JSON.stringify({
      isolamento: "repeatable read",
      somente_leitura: "on",
      pid: 123,
      agora: "2026-10-06 18:00:00+00",
      relogio: 1000.0,
    }),
    sonda2: JSON.stringify({
      isolamento: "repeatable read",
      somente_leitura: "on",
      pid: 123,
      agora: "2026-10-06 18:00:00+00",
      relogio: 1000.2,
    }),
  },
]);
const FP_OK = JSON.stringify([
  {
    tabela: "marketplace_orders",
    linhas_antes: 3,
    md5_antes: "aa",
    linhas_depois: 3,
    md5_depois: "aa",
    colunas_novas: "-",
    defaults_alterados: "-",
    resultado: "igual",
  },
]);
const ENVELOPE = "BEGIN ISOLATION LEVEL REPEATABLE READ;\n";

function respostaSaudavel(q: string): Resposta {
  if (q.includes("ikcous.sonda1")) return { corpo: SONDA };
  if (q.includes("txid_current_if_assigned"))
    return { corpo: '[{"pid":123,"txid":null}]' };
  if (q.includes("marketplace_orders where status"))
    return { corpo: '[{"pedidos":3,"cancelados":0}]' };
  if (q.startsWith(ENVELOPE)) return { corpo: FP_OK };
  if (q.startsWith("BEGIN;\n")) return { corpo: "[]" };
  if (q.includes("query_to_xml"))
    return { corpo: '[{"tabela":"marketplace_orders","linhas_agora":3}]' };
  if (q.includes("has_function_privilege"))
    return { corpo: '[{"paged8":true}]' };
  throw new Error(`consulta inesperada no stub: ${q.slice(0, 80)}`);
}

async function rodarAplicar(
  migracoes: string,
  responder: (q: string) => Resposta,
  opcoes: {
    projeto?: string;
    segredos?: Record<string, string>;
    ref?: string;
    fsFalso?: Record<string, string>;
  } = {},
) {
  const {
    projeto = "loja",
    segredos = { SUPABASE_ACCESS_TOKEN: "tk-legado" },
    ref = REF_CAF,
    fsFalso,
  } = opcoes;
  const yaml = await Deno.readTextFile(APLICAR);
  const codigo = desescaparBash(
    argumentoDoNodeE(blocoRunDoStep(yaml, "Prova, apply e verificação")),
  );
  const chamadas: string[] = [];
  const saida: string[] = [];
  let resolver!: (v: { exit?: number; fim?: boolean }) => void;
  const terminou = new Promise<{ exit?: number; fim?: boolean }>(
    (r) => (resolver = r),
  );
  let saiu = false;
  const fetchFalso = async (url: string, init: { body: string }) => {
    if (saiu) return await new Promise<never>(() => {});
    assertStringIncludes(url, `/v1/projects/${ref}/database/query`);
    const query = JSON.parse(init.body).query;
    chamadas.push(query);
    const r = responder(query);
    const status = r.status ?? 201;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => r.corpo ?? "[]",
    };
  };
  const consoleFalso = {
    log: (...a: unknown[]) => {
      const l = a.join(" ");
      saida.push(l);
      if (l.startsWith("FIM:")) resolver({ fim: true });
    },
    error: (...a: unknown[]) => saida.push(`ERR ${a.join(" ")}`),
  };
  const processFalso = {
    env: { ...segredos, MIGRACOES: migracoes, PROJETO: projeto },
    exit: (c: number) => {
      saiu = true;
      resolver({ exit: c });
    },
  };
  const antes = Deno.cwd();
  Deno.chdir(RAIZ);
  try {
    const reqLocal = (p: string) => {
      if (p === "node:fs" && fsFalso) {
        const real = requireLocal("node:fs");
        const chave = (c: string) =>
          Object.keys(fsFalso).find((k) => String(c).endsWith(k));
        return {
          ...real,
          existsSync: (c: string) => !!chave(c) || real.existsSync(c),
          readFileSync: (c: string, enc?: string) =>
            chave(c) ? fsFalso[chave(c)] : real.readFileSync(c, enc),
        };
      }
      return requireLocal(p.startsWith(".") ? join(RAIZ, p) : p);
    };
    new Function("require", "process", "fetch", "console", codigo)(
      reqLocal,
      processFalso,
      fetchFalso,
      consoleFalso,
    );
    const fim = await terminou;
    return { ...fim, chamadas, texto: saida.join("\n") };
  } finally {
    Deno.chdir(antes);
  }
}

const M201 = "20261201000000_linha_nova_nasce_sob_autorizacao.sql";
const RB201 =
  "rollback-manual-20261201000000_linha_nova_nasce_sob_autorizacao.sql";
const REMOCAO_RB201 =
  "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261201000000';";
const REGISTRO_M201 =
  "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261201000000', 'linha_nova_nasce_sob_autorizacao') ON CONFLICT (version) DO NOTHING;";

Deno.test({
  name: "aplicar: o registro do ledger vai NA MESMA requisição do apply (BEGIN … COMMIT), entre o corpo e a impressão digital DEPOIS, e na PROVA; nenhuma requisição à parte toca o ledger",
  ...SEM_SANITIZAR,
  fn: async () => {
    const corpo = await Deno.readTextFile(join(MIGRATIONS, M201));
    const r = await rodarAplicar(M201, respostaSaudavel);
    assertEquals(r.fim, true, r.texto);
    const apply = r.chamadas.filter((q) => q.startsWith(ENVELOPE));
    const prova = r.chamadas.filter((q) => q.startsWith("BEGIN;\n"));
    assertEquals(apply.length, 1);
    assertEquals(prova.length, 1);
    // idempotente por construção e no formato da casa (scripts/db-apply.cjs)
    assertStringIncludes(apply[0], REGISTRO_M201);
    assertStringIncludes(prova[0], REGISTRO_M201);
    assertEquals(apply[0].split("schema_migrations").length - 1, 1);
    // ordem: corpo < registro < impressão digital DEPOIS < COMMIT
    const iCorpo = apply[0].indexOf(corpo);
    const iReg = apply[0].indexOf(REGISTRO_M201);
    const iFp = apply[0].indexOf("DO $fp_depois$");
    const iCommit = apply[0].lastIndexOf("COMMIT;");
    assert(iCorpo >= 0 && iCorpo < iReg && iReg < iFp && iFp < iCommit);
    // a prova termina em ROLLBACK, com o registro dentro dela
    assertEquals(prova[0], `BEGIN;\n${corpo}\n${REGISTRO_M201}\nROLLBACK;`);
    assertEquals(
      r.chamadas.filter((q) => q !== apply[0] && q !== prova[0]).filter((q) => /schema_migrations/i.test(q)),
      [],
      "o ledger só aparece na prova e no apply",
    );
  },
});

Deno.test({
  name: "aplicar: o rollback-manual APAGA a versão do ledger (DELETE, versão do NOME) na MESMA requisição, entre o corpo e a impressão digital DEPOIS, e na PROVA; nunca insere; a migration nunca apaga",
  ...SEM_SANITIZAR,
  fn: async () => {
    const corpo = await Deno.readTextFile(join(MIGRATIONS, RB201));
    const r = await rodarAplicar(RB201, respostaSaudavel);
    assertEquals(r.fim, true, r.texto);
    const apply = r.chamadas.filter((q) => q.startsWith(ENVELOPE));
    const prova = r.chamadas.filter((q) => q.startsWith("BEGIN;\n"));
    assertEquals(apply.length, 1);
    assertEquals(prova.length, 1);
    assertStringIncludes(apply[0], REMOCAO_RB201);
    assertEquals(apply[0].split("schema_migrations").length - 1, 1);
    assert(!/INSERT INTO supabase_migrations/i.test(apply[0] + prova[0]), "rollback nunca insere");
    const iCorpo = apply[0].indexOf(corpo);
    const iDel = apply[0].indexOf(REMOCAO_RB201);
    const iFp = apply[0].indexOf("DO $fp_depois$");
    const iCommit = apply[0].lastIndexOf("COMMIT;");
    assert(iCorpo >= 0 && iCorpo < iDel && iDel < iFp && iFp < iCommit);
    assertEquals(prova[0], `BEGIN;\n${corpo}\n${REMOCAO_RB201}\nROLLBACK;`);
    // nenhuma requisição à parte toca o ledger
    assertEquals(
      r.chamadas.filter((q) => /schema_migrations/i.test(q.replace(corpo, ""))),
      [prova[0], apply[0]],
    );
    // a migration, ao contrário, nunca apaga
    const m = await rodarAplicar(M201, respostaSaudavel);
    assert(!m.chamadas.some((q) => /DELETE FROM supabase_migrations/i.test(q)), "migration nunca apaga");
  },
});

Deno.test({
  name: "aplicar: a versão do DELETE sai do NOME por regex estrita de 14 dígitos — nome malformado é recusado antes da rede e nunca vira SQL; lista de rollbacks apaga CADA versão na sua transação",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const ruim of [
      "rollback-manual-1234_x.sql",
      "rollback-manual-20261201000000_x.sql/../../x.sql",
      "rollback-manual-20261201000000_X.sql",
      "rollback-manual-2026120100000a_x.sql",
      "rollback-manual-20261201000000_a'; DROP TABLE x;--.sql",
    ]) {
      const r = await rodarAplicar(ruim, respostaSaudavel);
      assertEquals(r.exit, 1, `${ruim}: ${r.texto}`);
      assertEquals(r.chamadas.length, 0, `${ruim}: nada sai`);
    }
    const a = "rollback-manual-20261298000000_a-b_c9.sql";
    const b = "rollback-manual-20261299000000_segunda.sql";
    const r = await rodarAplicar(`${a}, ${b}`, respostaSaudavel, {
      fsFalso: { [a]: "SELECT 1;\n", [b]: "SELECT 2;\n" },
    });
    assertEquals(r.fim, true, r.texto);
    const applies = r.chamadas.filter((q) => q.startsWith(ENVELOPE));
    assertEquals(applies.length, 2);
    assertStringIncludes(applies[0], "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261298000000';");
    assertStringIncludes(applies[1], "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261299000000';");
    assert(!applies[0].includes("20261299000000"), "cada transação só apaga a sua versão");
  },
});

Deno.test({
  name: "aplicar: version e name saem do nome do arquivo (14 dígitos + resto sem .sql), e a lista de vários arquivos registra CADA um na sua transação",
  ...SEM_SANITIZAR,
  fn: async () => {
    const a = "20261298000000_a-b_c9.sql";
    const b = "20261299000000_segunda_migration.sql";
    const r = await rodarAplicar(`${a}, ${b}`, respostaSaudavel, {
      fsFalso: { [a]: "SELECT 1;\n", [b]: "SELECT 2;\n" },
    });
    assertEquals(r.fim, true, r.texto);
    const applies = r.chamadas.filter((q) => q.startsWith(ENVELOPE));
    assertEquals(applies.length, 2);
    assertStringIncludes(
      applies[0],
      "VALUES ('20261298000000', 'a-b_c9') ON CONFLICT (version) DO NOTHING;",
    );
    assertStringIncludes(
      applies[1],
      "VALUES ('20261299000000', 'segunda_migration') ON CONFLICT (version) DO NOTHING;",
    );
    assert(!applies[0].includes("20261299000000"), "cada transação só registra o seu arquivo");
  },
});

Deno.test({
  name: "aplicar: schema_migrations ausente (ou sem permissão) falha na PROVA — o apply nunca é enviado e nada sai depois; falha no apply PARA como ESTADO DESCONHECIDO sem retry",
  ...SEM_SANITIZAR,
  fn: async () => {
    const ausente = {
      status: 400,
      corpo: 'relation "supabase_migrations.schema_migrations" does not exist',
    };
    // 1) falha já na prova: a transação de prova inclui o INSERT
    const naProva = await rodarAplicar(M201, (q) =>
      q.startsWith("BEGIN;\n") && q.includes("schema_migrations")
        ? ausente
        : respostaSaudavel(q),
    );
    assertEquals(naProva.exit, 1, naProva.texto);
    assertEquals(
      naProva.chamadas.filter((q) => q.startsWith(ENVELOPE)).length,
      0,
      "o apply nunca é enviado",
    );
    // 2) falha no apply (ex.: o INSERT quebra só lá): uma requisição, sem retry
    const noApply = await rodarAplicar(M201, (q) =>
      q.startsWith(ENVELOPE) ? ausente : respostaSaudavel(q),
    );
    assertEquals(noApply.exit, 1, noApply.texto);
    assertStringIncludes(noApply.texto, "ESTADO DESCONHECIDO");
    assertEquals(
      noApply.chamadas.filter((q) => q.startsWith(ENVELOPE)).length,
      1,
      "sem retry",
    );
  },
});

Deno.test({
  name: "aplicar na Savy e na CAF: o mesmo registro, com o segredo e o ref de cada uma",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const [projeto, ref, segredos] of [
      ["savy", REF_SAVY, { SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" }],
      ["ikcous-publicada", REF_CAF, { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" }],
    ]) {
      const r = await rodarAplicar(M201, respostaSaudavel, {
        projeto,
        ref,
        segredos,
      });
      assertEquals(r.fim, true, `${projeto}: ${r.texto}`);
      assert(r.chamadas.some((q) => q.startsWith(ENVELOPE) && q.includes(REGISTRO_M201)));
    }
  },
});

Deno.test("impressão digital: não enxerga o ledger — só tabelas do schema public, e nenhuma menção a supabase_migrations (o registro não conta como dado existente alterado)", async () => {
  const sql = await Deno.readTextFile(
    join(RAIZ, "scripts/publicacao/impressao-digital.sql"),
  );
  const semComentarios = sql
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
  assert(!/supabase_migrations|schema_migrations/i.test(semComentarios));
  // toda varredura de catálogo da impressão digital filtra por public
  const varreduras = semComentarios.match(/FROM pg_class c JOIN pg_namespace n/g) ?? [];
  assert(varreduras.length >= 2);
  assertEquals(
    (semComentarios.match(/n\.nspname = 'public'/g) ?? []).length,
    varreduras.length,
    "toda varredura de tabelas filtra nspname = 'public'",
  );
  // a lista de conteúdo medido são as 11 tabelas de public nomeadas (nenhuma do ledger)
  assertStringIncludes(semComentarios, "'marketplace_orders'");
});

// ---------------------------------------------------------------------------
// Parte 2 — a faixa 92-202 (backfill) em conferir-banco-da-loja / conferir-banco.cjs
// ---------------------------------------------------------------------------
function semComentarios(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}
function bloco(yaml: string, job: string): string {
  const i = yaml.indexOf(`\n  ${job}:`);
  assert(i >= 0, `job ${job} não achado`);
  const resto = yaml.slice(i + 1);
  const prox = resto.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return prox < 0 ? resto : resto.slice(0, prox + 1);
}

Deno.test("ledger-92-202.sql: as 9 migrations 20261192..20261202 SEM a 201, com version e name exatamente os dos arquivos em supabase/migrations", async () => {
  const sql = await Deno.readTextFile(join(CONSULTAS, "ledger-92-202.sql"));
  const linhas = [...sql.matchAll(/\('(\d{14})', '([a-z0-9_]+)'\)/g)].map(
    (m) => [m[1], m[2]],
  );
  const noDisco: string[][] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) {
    const m = e.name.match(/^(2026119[2-9]|2026120[0-2])(000000)_([a-z0-9_-]+)\.sql$/);
    if (e.isFile && m) noDisco.push([m[1] + m[2], m[3]]);
  }
  noDisco.sort((a, b) => a[0].localeCompare(b[0]));
  const semA201 = noDisco.filter(([v]) => v !== "20261201000000");
  assertEquals(semA201.length, 9);
  assertEquals(linhas, semA201, "o INSERT é exatamente a lista dos arquivos, sem a 201");
  assert(!sql.replace(/^--.*$/gm, "").includes("20261201000000"));
  assertStringIncludes(sql, "ON CONFLICT (version) DO NOTHING;");
  // um statement só, pinado por hash: qualquer edição é recusada
  const { contarStatements, conferirHashDoLedger, SHA256_DO_LEDGER } = require(SCRIPT);
  assertEquals(contarStatements(sql), 1);
  conferirHashDoLedger("92-202", sql);
  assert(SHA256_DO_LEDGER["92-202"]);
  let lancou = false;
  try {
    conferirHashDoLedger("92-202", sql.replace("20261192000000", "20261201000000"));
  } catch {
    lancou = true;
  }
  assert(lancou, "o hash pinado recusa o arquivo editado");
});

Deno.test("conferir-banco-da-loja.yml: gravar_ledger tem a opção 92-202; o job do ledger exige expected_sha no PRIMEIRO passo e só entra nas lojas explícitas com 92-202; cada alvo com o seu segredo", async () => {
  const bruto = await Deno.readTextFile(CONFERIR);
  assertStringIncludes(bruto, 'options:\n          - nao\n          - 72-74\n          - 75-78\n          - 79-82\n          - "83"\n          - 92-202\n');
  const yaml = semComentarios(bruto);
  const ledger = bloco(yaml, "ledger");
  const passos = ledger.slice(ledger.indexOf("    steps:\n") + "    steps:\n".length);
  assert(passos.trimStart().startsWith("- name: Confere o alvo"));
  assert(passos.indexOf("Confere o alvo") < passos.indexOf("actions/checkout"));
  assertStringIncludes(passos, '[ "$PROJETO" = "savy" ]');
  const envs = [...ledger.matchAll(/\$\{\{[^\n]*secrets\.SUPABASE_ACCESS_TOKEN\w*[^\n]*/g)].map((m) => m[0]);
  assertEquals(envs.sort(), [
    "${{ inputs.projeto != 'ikcous-publicada' && inputs.projeto != 'savy' && secrets.SUPABASE_ACCESS_TOKEN || '' }}",
    "${{ inputs.projeto == 'ikcous-publicada' && secrets.SUPABASE_ACCESS_TOKEN_IKCOUS || '' }}",
    "${{ inputs.projeto == 'savy' && secrets.SUPABASE_ACCESS_TOKEN_SAVY || '' }}",
  ].sort());
  assert(!/secrets\.SUPABASE_ACCESS_TOKEN\w*\s*\|\|\s*secrets/.test(ledger));
  // a expressão do `if`: loja/sandbox como sempre MENOS a 92-202; as explícitas só com 92-202; confirmar == GRAVAR sempre
  const linhaIf = ledger.split("\n").find((l) => l.trimStart().startsWith("if:"));
  assertStringIncludes(
    linhaIf,
    "((inputs.projeto != 'ikcous-publicada' && inputs.projeto != 'savy' && inputs.gravar_ledger != '92-202') || ((inputs.projeto == 'ikcous-publicada' || inputs.projeto == 'savy') && inputs.gravar_ledger == '92-202'))",
  );
  assertStringIncludes(linhaIf, "inputs.confirmar == 'GRAVAR'");
  assertStringIncludes(linhaIf, "inputs.gravar_ledger != 'nao'");
});

// --- scripts/publicacao/conferir-banco.cjs contra um stub que separa leitura e escrita ---
type Chamada = { url: string; auth: string | null; query: string };

function subirStub(opcoes: {
  leitura8e: () => { status: number; corpo: string };
}) {
  const chamadas: Chamada[] = [];
  const srv = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    async (req) => {
      const url = new URL(req.url).pathname;
      const query = JSON.parse(await req.text()).query as string;
      chamadas.push({ url, auth: req.headers.get("authorization"), query });
      let r = { status: 201, corpo: "[]" };
      if (url.endsWith("/database/query/read-only")) {
        if (query.includes("corpo final")) r = opcoes.leitura8e();
        else r = { status: 201, corpo: '[{"version":"20261192000000","name":"x"}]' };
      }
      return new Response(r.corpo, { status: r.status, headers: { "content-type": "application/json" } });
    },
  );
  return {
    chamadas,
    base: `http://127.0.0.1:${srv.addr.port}`,
    parar: () => srv.shutdown(),
    escritas: () => chamadas.filter((c) => c.url.endsWith("/database/query")),
    leituras: () => chamadas.filter((c) => c.url.endsWith("/database/query/read-only")),
  };
}

async function rodarScript(env: Record<string, string>, base: string) {
  const r = await new Deno.Command("node", {
    args: [SCRIPT],
    cwd: RAIZ,
    env: {
      SUPABASE_ACCESS_TOKEN: "",
      SUPABASE_ACCESS_TOKEN_IKCOUS: "",
      SUPABASE_ACCESS_TOKEN_SAVY: "",
      PROJETO: "",
      CONSULTA: "",
      LEDGER: "",
      GITHUB_STEP_SUMMARY: "",
      CONFERIR_BANCO_API_BASE: base,
      ...env,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  return { codigo: r.code, saida: dec.decode(r.stdout) + dec.decode(r.stderr) };
}

const OITO_E_OK = () => ({
  status: 201,
  corpo: JSON.stringify([
    { item: "controle: funcoes de public visiveis a este papel", esperado: ">0", vivo: ">0", ok: true },
    { item: "corpo final fin_dre", esperado: "e58a", vivo: "e58a", ok: true },
  ]),
});
const OITO_E_COM_FALHA = () => ({
  status: 201,
  corpo: JSON.stringify([
    { item: "corpo final fin_dre", esperado: "e58a", vivo: "AUSENTE", ok: false },
    { item: "controle: funcoes de public visiveis a este papel", esperado: ">0", vivo: ">0", ok: true },
  ]),
});

const ALVOS: [string, string, Record<string, string>, string][] = [
  ["ikcous-publicada", REF_CAF, { SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf", SUPABASE_ACCESS_TOKEN: "tk-legado", SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy" }, "Bearer tk-caf"],
  ["savy", REF_SAVY, { SUPABASE_ACCESS_TOKEN_SAVY: "tk-savy", SUPABASE_ACCESS_TOKEN: "tk-legado", SUPABASE_ACCESS_TOKEN_IKCOUS: "tk-caf" }, "Bearer tk-savy"],
];

Deno.test({
  name: "conferir-banco.cjs LEDGER=92-202 em ikcous-publicada e savy: 8e toda ok=true -> UMA escrita (o INSERT pinado, sem a 201), DEPOIS da leitura da 8e, no ref e com o segredo do alvo",
  ...SEM_SANITIZAR,
  fn: async () => {
    const ins = await Deno.readTextFile(join(CONSULTAS, "ledger-92-202.sql"));
    for (const [projeto, ref, segredos, auth] of ALVOS) {
      const stub = subirStub({ leitura8e: OITO_E_OK });
      try {
        const r = await rodarScript({ PROJETO: projeto, LEDGER: "92-202", ...segredos }, stub.base);
        assertEquals(r.codigo, 0, `${projeto}: ${r.saida}`);
        const escritas = stub.escritas();
        assertEquals(escritas.length, 1, `${projeto}: uma escrita`);
        assertEquals(escritas[0].query, ins);
        assertEquals(escritas[0].url, `/v1/projects/${ref}/database/query`);
        assertEquals(escritas[0].auth, auth);
        assert(!escritas[0].query.includes("20261201000000"), "a 201 não entra");
        // ordem: a leitura da 8e vem ANTES da escrita
        const iEscrita = stub.chamadas.indexOf(escritas[0]);
        const i8e = stub.chamadas.findIndex((c) => c.query.includes("corpo final"));
        assert(i8e >= 0 && i8e < iEscrita, `${projeto}: 8e antes do INSERT`);
        for (const c of stub.chamadas) assertEquals(c.auth, auth, "só o segredo do alvo");
        for (const s of ["tk-caf", "tk-savy", "tk-legado"]) assert(!r.saida.includes(s));
      } finally {
        await stub.parar();
      }
    }
  },
});

Deno.test({
  name: "conferir-banco.cjs LEDGER=92-202 em loja/sandbox: RECUSADO antes de qualquer requisição (a faixa é só das lojas explícitas)",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const projeto of ["loja", "sandbox"]) {
      const stub = subirStub({ leitura8e: OITO_E_OK });
      try {
        const r = await rodarScript({ PROJETO: projeto, LEDGER: "92-202", SUPABASE_ACCESS_TOKEN: "tk-legado" }, stub.base);
        assertEquals(r.codigo, 1, `${projeto}: ${r.saida}`);
        assertStringIncludes(r.saida, "só roda para ikcous-publicada ou savy");
        assertEquals(stub.chamadas.length, 0, `${projeto}: nenhuma requisição`);
      } finally {
        await stub.parar();
      }
    }
  },
});

Deno.test({
  name: "conferir-banco.cjs LEDGER=92-202: a 8e com QUALQUER linha ok=false (ou 0 linhas) PARA ANTES de gravar — zero escritas, nas lojas explícitas",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const [projeto, , segredos] of ALVOS) {
      for (const [caso, leitura] of [
        ["linha ok=false", OITO_E_COM_FALHA],
        ["0 linhas", () => ({ status: 201, corpo: "[]" })],
      ] as const) {
        const stub = subirStub({ leitura8e: leitura });
        try {
          const r = await rodarScript({ PROJETO: projeto, LEDGER: "92-202", ...segredos }, stub.base);
          assertEquals(r.codigo, 1, `${projeto}/${caso}: ${r.saida}`);
          assertStringIncludes(r.saida, "pré-checagem do ledger 92-202 falhou");
          assertEquals(stub.escritas().length, 0, `${projeto}/${caso}: NENHUMA escrita`);
          assertEquals(stub.leituras().length, 1, "parou na primeira leitura");
        } finally {
          await stub.parar();
        }
      }
    }
  },
});

Deno.test({
  name: "conferir-banco.cjs LEDGER=92-202: 401/403 na pré-checagem PARA com o bloqueio concreto, UMA requisição, nenhuma escrita; sem o segredo próprio, zero requisições",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const [projeto, , segredos, auth] of ALVOS) {
      for (const status of [401, 403]) {
        const stub = subirStub({ leitura8e: () => ({ status, corpo: '{"message":"forbidden"}' }) });
        try {
          const r = await rodarScript({ PROJETO: projeto, LEDGER: "92-202", ...segredos }, stub.base);
          assertEquals(r.codigo, 1, r.saida);
          assertStringIncludes(r.saida, "bloqueio concreto");
          assertStringIncludes(r.saida, `HTTP ${status}`);
          assertEquals(stub.chamadas.length, 1);
          assertEquals(stub.chamadas[0].auth, auth);
          assertEquals(stub.escritas().length, 0);
        } finally {
          await stub.parar();
        }
      }
      // sem o segredo PRÓPRIO (só os dos vizinhos): zero requisições
      const stub = subirStub({ leitura8e: OITO_E_OK });
      try {
        const vizinhos = { ...segredos };
        delete vizinhos[projeto === "savy" ? "SUPABASE_ACCESS_TOKEN_SAVY" : "SUPABASE_ACCESS_TOKEN_IKCOUS"];
        const r = await rodarScript({ PROJETO: projeto, LEDGER: "92-202", ...vizinhos }, stub.base);
        assertEquals(r.codigo, 1, r.saida);
        assertStringIncludes(r.saida, "bloqueio concreto");
        assertEquals(stub.chamadas.length, 0);
      } finally {
        await stub.parar();
      }
    }
  },
});

Deno.test({
  name: "conferir-banco.cjs: nas lojas explícitas as OUTRAS faixas (72-74, 75-78, 79-82, 83) e qualquer valor fora da lista continuam recusados antes de qualquer requisição",
  ...SEM_SANITIZAR,
  fn: async () => {
    for (const [projeto, , segredos] of ALVOS) {
      for (const faixa of ["72-74", "75-78", "79-82", "83", "92-203", "92-202 ", "99-99"]) {
        const stub = subirStub({ leitura8e: OITO_E_OK });
        try {
          const r = await rodarScript({ PROJETO: projeto, LEDGER: faixa, ...segredos }, stub.base);
          assertEquals(r.codigo, 1, `${projeto}/${faixa}: ${r.saida}`);
          assertEquals(stub.chamadas.length, 0, `${projeto}/${faixa}`);
        } finally {
          await stub.parar();
        }
      }
    }
  },
});
