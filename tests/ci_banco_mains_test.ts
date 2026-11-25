// @ts-nocheck
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste e as chaves vêm de constantes e mapas fechados do arquivo, nunca de entrada externa. */
/**
 * Os PROGRAMAS do job `db-ci` (scripts/ci/banco/*.cjs) — o que cada um decide
 * e com qual código de saída, sem Postgres.
 *
 * Achado por mutação: dos 32 defeitos plantados em aplicar-migrations.cjs, 30
 * passavam batido (inclusive `r.estado === "nativo"` virar `!==`); em
 * prova-dupla-aplicacao.cjs, 60 de 66; em objetos-do-codigo-efemero.cjs, 18 de
 * 18; em inventario-rollback.cjs, 39 de 52. O motivo: o `main()` de cada um
 * só rodava no job contra um Postgres de verdade ("a prova VIVA é a sequência
 * do db-ci.yml", diz o ci_banco_bloqueante_test.ts) e os testes em Deno só
 * olhavam o YAML e as funções de util.cjs. Ou seja: o que faz o job ficar
 * vermelho (exit 1), indeterminado (5) ou recusar o alvo (2) não tinha prova.
 *
 * COMO: cada script é executado como programa dentro de uma raiz descartável
 * (copiam-se scripts/ci/banco/*.cjs e o db-check-objetos; a raiz do repositório
 * é deduzida do caminho do script), com `--require` de um PRELOAD que troca o
 * módulo `pg` por um cliente FALSO: ele grava cada consulta num registro e
 * responde conforme as regras do cenário (erro para um texto exato, linhas de
 * catálogo para `pg_class`/`pg_proc`/`storage.buckets`). Nenhuma conexão real,
 * nenhum banco, nenhuma variável de ambiente do dono (o ambiente é limpo e a
 * URL é a de um localhost de mentira, sem senha).
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const REPO = new URL("../", import.meta.url);
const DIR_BANCO = new URL("../scripts/ci/banco/", import.meta.url);

const URL_EFEMERA = "postgres://postgres@localhost:5432/postgres";
const BUSCA = 'SET search_path = "$user", public, extensions';

const PRELOAD_PG = `
const Module = require("node:module");
const fs = require("node:fs");
const cen = JSON.parse(process.env.H36_PG || "{}");
const reg = (o) => fs.appendFileSync(cen.registro, JSON.stringify(o) + "\\n");
const regras = (cen.regras || []).map((r) => ({ ...r, usos: 0 }));
class Client {
  constructor(opts) { reg({ tipo: "novo", opts }); }
  async connect() {
    reg({ tipo: "connect" });
    if (cen.erroConexao) throw new Error(cen.erroConexao);
  }
  async query(sql, params) {
    sql = String(sql);
    reg({ tipo: "query", sql, params });
    for (const r of regras) {
      const casa = r.exato !== undefined ? sql === r.exato : sql.includes(r.quando);
      if (!casa) continue;
      if (r.param !== undefined && !(params && params[0] === r.param)) continue;
      if (r.usos >= (r.vezes ?? Infinity)) continue;
      r.usos++;
      if (r.lancarIndefinido) throw undefined;
      if (r.erro) {
        const e = new Error(r.erro.message);
        if (r.erro.code) e.code = r.erro.code;
        throw e;
      }
      const rows = r.rows ?? [];
      return { rows, rowCount: r.rowCount ?? rows.length };
    }
    return { rows: [], rowCount: 0 };
  }
  async end() {
    reg({ tipo: "end" });
    if (cen.erroNoEnd) throw new Error("end falhou");
  }
}
if (cen.ordem) {
  // readdirSync devolve na ordem do sistema de arquivos (varia entre Windows e
  // Linux): o cenário fixa a ordem para provar "o primeiro vence".
  const lerDir = fs.readdirSync;
  fs.readdirSync = function (...args) {
    const r = lerDir.apply(this, args);
    if (!Array.isArray(r) || !r.every((x) => typeof x === "string")) return r;
    const asc = [...r].sort();
    return cen.ordem === "desc" ? asc.reverse() : asc;
  };
}
const original = Module._load;
Module._load = function (request, ...resto) {
  if (request === "pg") return { Client };
  return original.call(this, request, ...resto);
};
`;

type Regra = {
  exato?: string;
  quando?: string;
  param?: string;
  rowCount?: number;
  vezes?: number;
  erro?: { message: string; code?: string };
  lancarIndefinido?: boolean;
  rows?: unknown[];
};

type Cenario = {
  script: string; // nome em scripts/ci/banco/
  args?: string[]; // relativos à raiz descartável
  arquivos?: Record<string, string>; // relativos à raiz descartável
  regras?: Regra[];
  env?: Record<string, string | null>; // null = não definir
  erroConexao?: string;
  erroNoEnd?: boolean;
  semSummary?: boolean;
  ordem?: "asc" | "desc"; // ordem fixa do fs.readdirSync no script
};

async function rodar(c: Cenario) {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "h36-bancomain-")));
  try {
    mkdirSync(join(raiz, "scripts", "ci", "banco"), { recursive: true });
    for (const e of readdirSync(DIR_BANCO)) {
      if (e.endsWith(".cjs")) {
        copyFileSync(
          new URL(e, DIR_BANCO),
          join(raiz, "scripts", "ci", "banco", e),
        );
      }
    }
    copyFileSync(
      new URL("scripts/db-check-objetos-do-codigo.mjs", REPO),
      join(raiz, "scripts", "db-check-objetos-do-codigo.mjs"),
    );
    for (const [rel, texto] of Object.entries(c.arquivos ?? {})) {
      const alvo = join(raiz, rel);
      mkdirSync(dirname(alvo), { recursive: true });
      writeFileSync(alvo, texto);
    }
    writeFileSync(join(raiz, "pg-falso.cjs"), PRELOAD_PG);
    const registro = join(raiz, "registro.jsonl");
    writeFileSync(registro, "");
    const summary = join(raiz, "summary.md");
    const env: Record<string, string> = {
      PATH: Deno.env.get("PATH") ?? "",
      SystemRoot: Deno.env.get("SystemRoot") ?? "",
      DATABASE_URL: URL_EFEMERA,
      CI_BANCO_EFEMERO: "1",
      H36_PG: JSON.stringify({
        registro,
        regras: c.regras ?? [],
        erroConexao: c.erroConexao,
        erroNoEnd: c.erroNoEnd,
        ordem: c.ordem,
      }),
    };
    if (!c.semSummary) env.GITHUB_STEP_SUMMARY = summary;
    for (const [k, v] of Object.entries(c.env ?? {})) {
      if (v === null) delete env[k];
      else env[k] = v;
    }
    const saida = await new Deno.Command("node", {
      args: [
        "--require",
        join(raiz, "pg-falso.cjs"),
        join(raiz, "scripts", "ci", "banco", c.script),
        ...(c.args ?? []).map((a) => join(raiz, a)),
      ],
      cwd: raiz,
      clearEnv: true,
      env,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const dec = new TextDecoder();
    const linhas = readFileSync(registro, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    let md = "";
    try {
      md = readFileSync(summary, "utf8");
    } catch {
      /* sem summary */
    }
    return {
      code: saida.code,
      stdout: dec.decode(saida.stdout),
      stderr: dec.decode(saida.stderr),
      md,
      consultas: linhas.filter((l) => l.tipo === "query").map((l) => l.sql),
      chamadas: linhas.filter((l) => l.tipo === "query"),
      construtores: linhas.filter((l) => l.tipo === "novo").map((l) => l.opts),
      encerrou: linhas.some((l) => l.tipo === "end"),
      conectou: linhas.some((l) => l.tipo === "connect"),
    };
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

const MIG = "supabase/migrations";
const A = "20260101000000_a.sql";
const B = "20260102000000_b.sql";
const C = "20260103000000_c.sql";
const LISTADA = "20260807000000_reserva_com_expiracao.sql"; // está na lista de provisionamento
const FALTA_CRON = { message: 'schema "cron" does not exist' };

// ===========================================================================
// aplicar-migrations.cjs — 1ª passada
// ===========================================================================

Deno.test("aplicar: sem argumento ou pasta inexistente = INDETERMINADO (5) com o texto de uso e o nome do script", async () => {
  const semArg = await rodar({ script: "aplicar-migrations.cjs" });
  assertEquals(semArg.code, 5, semArg.stderr);
  assertStringIncludes(semArg.stdout, "[ci-banco] INDETERMINADO");
  assertStringIncludes(
    semArg.stdout,
    "Uso: node aplicar-migrations.cjs <pasta-de-migrations>",
  );
  assertEquals(semArg.conectou, false);

  const inexistente = await rodar({
    script: "aplicar-migrations.cjs",
    args: ["nao/existe"],
  });
  assertEquals(inexistente.code, 5);
  assertStringIncludes(inexistente.stdout, "Uso: node aplicar-migrations.cjs");
});

Deno.test("aplicar: pasta SEM nenhum .sql de migration = INDETERMINADO (5), sem conectar", async () => {
  const r = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/LEIA.md`]: "nada",
      [`${MIG}/rollback-manual-20260101000000_x.sql`]: "-- x",
    },
  });
  assertEquals(r.code, 5, r.stderr);
  assertStringIncludes(r.stdout, "Nenhum .sql na raiz de ");
  assertEquals(r.conectou, false);
});

Deno.test("aplicar: banco de host gerenciado ou sem a flag é RECUSADO (2) antes de qualquer conexão", async () => {
  const gerenciado = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    env: {
      DATABASE_URL: "postgres://postgres@db.abc.supabase.co:5432/postgres",
    },
  });
  assertEquals(gerenciado.code, 2);
  assertEquals(gerenciado.conectou, false);
  const semFlag = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    env: { CI_BANCO_EFEMERO: null },
  });
  assertEquals(semFlag.code, 2);
  assertEquals(semFlag.conectou, false);
});

Deno.test("aplicar: não conectar = INDETERMINADO (5) com o motivo", async () => {
  const r = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    erroConexao: "connect ECONNREFUSED 127.0.0.1:5432",
  });
  assertEquals(r.code, 5, r.stderr);
  assertStringIncludes(
    r.stdout,
    "Não conectei no banco efêmero: connect ECONNREFUSED 127.0.0.1:5432",
  );
  assertEquals(r.consultas, []);
});

Deno.test("aplicar: tudo aplica = OK (0); RESET ALL primeiro; por arquivo SET search_path + texto, em ordem de timestamp; encerra a conexão", async () => {
  const r = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/${B}`]: "SELECT 'segunda';",
      [`${MIG}/${A}`]: "SELECT 'primeira';",
      [`${MIG}/rollback-manual-${A}`]: "SELECT 'rollback nao entra';",
    },
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertEquals(r.consultas, [
    "RESET ALL",
    BUSCA,
    "SELECT 'primeira';",
    BUSCA,
    "SELECT 'segunda';",
  ]);
  assertEquals(r.encerrou, true);
  assertEquals(r.construtores, [{ connectionString: URL_EFEMERA }]);
  assertStringIncludes(
    r.stdout,
    "[ci-banco/1ª] arquivos na raiz (ordem de apply): 2",
  );
  assertStringIncludes(r.stdout, "[ci-banco] OK");
  assertStringIncludes(
    r.stdout,
    "A raiz inteira aplicou num banco zerado (2 aplicados, 0 deles com pg_cron/pg_net emulado, 0 pulados por provisionamento).",
  );
  assertStringIncludes(r.md, "### CI Banco — 1ª passada (aplica do zero)");
  assertStringIncludes(
    r.md,
    "**2/2 arquivos aplicados** do zero sem erro de SQL.",
  );
  assert(!r.md.includes("<details>"), r.md);
});

Deno.test("aplicar: erro de SQL real = FALHOU (1), PARA no arquivo, conta os aplicados antes e explica no log e no resumo", async () => {
  const r = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/${A}`]: "SELECT 'ok';",
      [`${MIG}/${B}`]: "SELECT quebra;",
      [`${MIG}/${C}`]: "SELECT 'nunca roda';",
    },
    regras: [
      {
        exato: "SELECT quebra;",
        erro: {
          message: `coluna "quebra" não existe\n${"x".repeat(300)}`,
          code: "42703",
        },
      },
    ],
  });
  assertEquals(r.code, 1, r.stderr);
  assertStringIncludes(r.stdout, "[ci-banco] FALHOU");
  assertStringIncludes(
    r.stdout,
    `arquivo:  ${B} (após 1 aplicados com sucesso)`,
  );
  assertStringIncludes(r.stdout, "código:   42703");
  assertStringIncludes(r.stdout, 'mensagem: coluna "quebra" não existe');
  assertStringIncludes(
    r.stdout,
    "A sequência inteira NÃO aplica num banco do zero.",
  );
  assert(
    !r.consultas.includes("SELECT 'nunca roda';"),
    "tem de parar no primeiro erro",
  );
  assertEquals(r.encerrou, true);
  assertStringIncludes(
    r.md,
    `**FALHOU em \`${B}\`** (após 1 arquivos aplicados): \`42703\` — coluna "quebra" não existe`,
  );
  assertStringIncludes(
    r.md,
    "A sequência inteira NÃO aplica num banco do zero.",
  );
  // O resumo leva só a PRIMEIRA linha da mensagem (e no máximo 200 caracteres).
  assert(!r.md.includes("xxxx"), "só a primeira linha vai ao resumo");
});

Deno.test("aplicar: o resumo do erro corta a primeira linha em 200 caracteres; erro sem código vira '(sem código)'", async () => {
  const longa = "y".repeat(260);
  const r = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT quebra;" },
    regras: [{ exato: "SELECT quebra;", erro: { message: longa } }],
  });
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "código:   (sem código)");
  assertStringIncludes(r.md, `\`(sem código)\` — ${"y".repeat(200)}\n`);
  assert(!r.md.includes("y".repeat(201)), "passou de 200 caracteres no resumo");
  assertStringIncludes(r.md, "(após 0 arquivos aplicados)");
});

Deno.test("aplicar: arquivo de provisionamento é REAPLICADO com pg_cron comentado — conta como aplicado, mostra no log e no resumo, exit 0", async () => {
  const texto = "CREATE EXTENSION IF NOT EXISTS pg_cron;\nSELECT 1;";
  const neutro =
    "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */\nSELECT 1;";
  const r = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;", [`${MIG}/${LISTADA}`]: texto },
    regras: [{ exato: texto, vezes: 1, erro: FALTA_CRON }],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertEquals(r.consultas, [
    "RESET ALL",
    BUSCA,
    "SELECT 1;",
    BUSCA,
    texto,
    "ROLLBACK",
    BUSCA,
    neutro,
  ]);
  assertStringIncludes(
    r.stdout,
    `[ci-banco/1ª] aplicado com emulação: ${LISTADA} (pg_cron emulado por stub (provisionar-efemero.cjs))`,
  );
  assertStringIncludes(
    r.stdout,
    "(2 aplicados, 1 deles com pg_cron/pg_net emulado, 0 pulados por provisionamento)",
  );
  assertStringIncludes(
    r.md,
    "**2/2 arquivos aplicados** do zero sem erro de SQL · 1 deles com pg_cron/pg_net emulado (corpo aplicado de verdade, agendamento não).",
  );
  assertStringIncludes(
    r.md,
    "<details><summary>Aplicados com pg_cron/pg_net emulado</summary>",
  );
  assertStringIncludes(
    r.md,
    `${LISTADA} → pg_cron emulado por stub (provisionar-efemero.cjs)`,
  );
  assert(!r.md.includes("Pulados por provisionamento"), r.md);
});

Deno.test("aplicar: arquivo PULADO por provisionamento NÃO é verde — FALHOU (1) nomeando o arquivo", async () => {
  const texto = "SELECT cron.schedule('x', '* * * * *', 'select 1');";
  const r = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${LISTADA}`]: texto },
    regras: [
      {
        exato: texto,
        erro: { message: "function cron.schedule(unknown) does not exist" },
      },
    ],
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stdout,
    "1 arquivo(s) PULADOS por provisionamento mesmo com o pg_cron emulado",
  );
  assertStringIncludes(
    r.stdout,
    `${LISTADA} → function cron.schedule(unknown) does not exist`,
  );
  assertStringIncludes(
    r.md,
    "**0/1 arquivos aplicados** do zero sem erro de SQL · 1 pulados por provisionamento (ver aviso).",
  );
  assertStringIncludes(
    r.md,
    "<details><summary>Pulados por provisionamento</summary>",
  );
  assert(!r.md.includes("FALHOU em"), "pulado não é falha de SQL");
});

Deno.test("aplicar: ROLLBACK/end que falham não mudam o veredito; erro inesperado do banco vira INDETERMINADO (5) com o texto", async () => {
  const fimQuebrado = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    erroNoEnd: true,
  });
  assertEquals(fimQuebrado.code, 0, fimQuebrado.stderr);

  const inesperado = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    regras: [
      { exato: "RESET ALL", erro: { message: "conexão caiu no RESET" } },
    ],
  });
  assertEquals(inesperado.code, 5, inesperado.stderr);
  assertStringIncludes(inesperado.stdout, "conexão caiu no RESET");

  const nulo = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    regras: [{ exato: "RESET ALL", lancarIndefinido: true }],
  });
  assertEquals(nulo.code, 5, nulo.stderr);
  assertStringIncludes(nulo.stdout, "undefined");
});

// ===========================================================================
// prova-dupla-aplicacao.cjs — 2ª passada
// ===========================================================================

const MARCA_ERRO = "-- H36ERRO";

Deno.test("dupla: sem pasta = INDETERMINADO (5); pasta sem .sql = 5; sem conexão = 5", async () => {
  assertEquals((await rodar({ script: "prova-dupla-aplicacao.cjs" })).code, 5);
  const vazia = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/LEIA.md`]: "x" },
  });
  assertEquals(vazia.code, 5);
  assertStringIncludes(vazia.stdout, "Nenhum .sql na raiz de ");
  const semBanco = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    erroConexao: "sem rota",
  });
  assertEquals(semBanco.code, 5);
  assertStringIncludes(
    semBanco.stdout,
    "Não conectei no banco efêmero: sem rota",
  );
});

Deno.test("dupla: tudo reaplica limpo = OK (0), RESET ALL antes, resumo com as contagens", async () => {
  const r = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/${A}`]: "CREATE OR REPLACE VIEW v AS SELECT 1;",
      [`${MIG}/${B}`]: "CREATE TABLE t (x int);",
    },
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertEquals(r.consultas[0], "RESET ALL");
  assertStringIncludes(
    r.stdout,
    "Dupla aplicação provada: 2 limpos na 2ª, 0 colisões de quem NÃO promete (relatório), 0 pulados.",
  );
  assertStringIncludes(
    r.md,
    "### CI Banco — prova de dupla aplicação (2ª passada)",
  );
  assertStringIncludes(r.md, "**2ª passada: 2/2 reaplicaram limpo.**");
  assertStringIncludes(
    r.md,
    "· Prometem idempotência e colidiram: **0** (isto SIM é defeito — reprova o job)",
  );
  assertStringIncludes(
    r.md,
    "· Não prometem (colisão esperada, relatório): **0**",
  );
  assertStringIncludes(
    r.md,
    "· Pulados por provisionamento (pg_cron/pg_net): **0**",
  );
  assertEquals(r.encerrou, true);
});

/** Cada forma: [nome curto, SQL, promete?]. */
const FORMAS: Array<[string, string, boolean]> = [
  [
    "or_replace",
    "CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql;",
    true,
  ],
  ["or_replace_minuscula", "create   or\nreplace view v as select 1;", true],
  ["tabela_if_not_exists", "CREATE TABLE IF NOT EXISTS t (x int);", true],
  [
    "indice_unico_if_not_exists",
    "CREATE UNIQUE INDEX IF NOT EXISTS i ON t (x);",
    true,
  ],
  ["extensao_if_not_exists", "CREATE EXTENSION IF NOT EXISTS pgcrypto;", true],
  ["drop_if_exists", "DROP TABLE IF EXISTS t;", true],
  ["drop_policy_if_exists", "DROP POLICY IF EXISTS p ON t;", true],
  ["grant", "GRANT SELECT ON t TO anon;", true],
  ["revoke", "REVOKE ALL ON t FROM anon;", true],
  ["comment_on", "COMMENT ON TABLE t IS 'x';", true],
  ["rls_enable", "ALTER TABLE t ENABLE ROW LEVEL SECURITY;", true],
  ["rls_disable", "ALTER TABLE public.t DISABLE ROW LEVEL SECURITY;", true],
  ["rls_force", "ALTER TABLE t FORCE ROW LEVEL SECURITY;", true],
  ["set", "SET search_path = public;", true],
  ["reset", "RESET ALL;", true],
  ["begin_commit", "BEGIN;\nCOMMIT;", true],
  ["start_transaction", "START TRANSACTION;\nROLLBACK;", true],
  ["savepoint", "SAVEPOINT a;\nRELEASE SAVEPOINT a;", true],
  [
    "varias_promessas",
    "-- cabeçalho\nGRANT SELECT ON t TO anon;\nCOMMENT ON TABLE t IS 'a; b';\nCREATE OR REPLACE VIEW v AS SELECT 1;",
    true,
  ],
  ["create_table", "CREATE TABLE t (x int);", false],
  ["create_index", "CREATE INDEX i ON t (x);", false],
  ["create_policy", "CREATE POLICY p ON t FOR SELECT USING (true);", false],
  [
    "create_trigger",
    "CREATE TRIGGER g BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();",
    false,
  ],
  ["add_column", "ALTER TABLE t ADD COLUMN y int;", false],
  ["add_constraint", "ALTER TABLE t ADD CONSTRAINT c CHECK (x > 0);", false],
  [
    "rls_mais_coluna",
    "ALTER TABLE t ENABLE ROW LEVEL SECURITY, ADD COLUMN y int;",
    false,
  ],
  ["drop_sem_if_exists", "DROP TABLE t;", false],
  ["insert", "INSERT INTO t VALUES (1);", false],
  ["update", "UPDATE t SET x = 1;", false],
  ["delete", "DELETE FROM t;", false],
  ["do_block", "DO $$ BEGIN PERFORM 1; END $$;", false],
  [
    "promessa_mais_create_table",
    "GRANT SELECT ON t TO anon;\nCREATE TABLE t2 (x int);",
    false,
  ],
  [
    "promessa_so_em_comentario",
    "-- CREATE OR REPLACE VIEW v AS SELECT 1;\nCREATE TABLE t3 (x int);",
    false,
  ],
  ["promessa_so_em_string", "SELECT 'CREATE OR REPLACE VIEW v';", false],
  ["so_comentario", "-- nada executavel\n/* nem aqui */", false],
  ["vazio", "", false],
];

Deno.test("dupla: cada forma de SQL é classificada como PROMETE ou NÃO PROMETE idempotência pelo texto — e só quem promete reprova", async () => {
  const arquivos: Record<string, string> = {};
  const nomes: Array<[string, boolean]> = [];
  FORMAS.forEach(([curto, sql, promete], i) => {
    const nome = `202601${String(i + 1).padStart(2, "0")}000000_${curto}.sql`;
    arquivos[`${MIG}/${nome}`] = `${MARCA_ERRO}\n${sql}\n`;
    nomes.push([nome, promete]);
  });
  const r = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos,
    regras: [
      {
        quando: MARCA_ERRO,
        erro: { message: "colisão H36\nsegunda linha que não entra" },
      },
    ],
  });
  // Quem PROMETE e explode reprova o job.
  assertEquals(r.code, 1, r.stdout + r.stderr);
  const quebrou = nomes.filter(([, p]) => p).map(([n]) => n);
  const colidiu = nomes.filter(([, p]) => !p).map(([n]) => n);
  // O relatório separa as duas listas: as que prometem ficam no bloco final
  // (sem <details>), as que não prometem dentro do <details> informativo.
  const [antes, depois] = r.md.split("</details>");
  assert(depois !== undefined, r.md);
  const blocoColidiu = antes.slice(antes.indexOf("Colisões de arquivos"));
  const blocoQuebrou = depois;
  for (const nome of colidiu) {
    assertStringIncludes(blocoColidiu, `${nome} → [sem código] colisão H36`);
    assert(
      !blocoQuebrou.includes(nome),
      `${nome} NÃO promete e foi parar no bloco de quem prometeu`,
    );
  }
  for (const nome of quebrou) {
    assertStringIncludes(blocoQuebrou, `${nome} → [sem código] colisão H36`);
    assert(
      !blocoColidiu.includes(nome),
      `${nome} PROMETE e foi parar no bloco de quem não promete`,
    );
  }
  assertStringIncludes(
    r.md,
    `· Prometem idempotência e colidiram: **${quebrou.length}**`,
  );
  assertStringIncludes(
    r.md,
    `· Não prometem (colisão esperada, relatório): **${colidiu.length}**`,
  );
  assert(
    !r.md.includes("segunda linha"),
    "só a primeira linha da mensagem vai ao relatório",
  );
  assertStringIncludes(
    r.stdout,
    `${quebrou.length} arquivo(s) que PROMETEM idempotência`,
  );
});

Deno.test("dupla: só quem NÃO promete colide = OK (0) com o relatório informativo; código do erro e corte de 140 caracteres", async () => {
  const longa = `${"z".repeat(200)}`;
  const r = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/${A}`]: "CREATE TABLE t (x int);",
      [`${MIG}/${B}`]: "GRANT SELECT ON t TO anon;",
    },
    regras: [
      {
        exato: "CREATE TABLE t (x int);",
        erro: { message: longa, code: "42P07" },
      },
    ],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(
    r.stdout,
    "Dupla aplicação provada: 1 limpos na 2ª, 1 colisões de quem NÃO promete (relatório), 0 pulados.",
  );
  assertStringIncludes(r.md, `${A} → [42P07] ${"z".repeat(140)}\n`);
  assert(
    !r.md.includes("z".repeat(141)),
    "passou de 140 caracteres no relatório",
  );
  assertStringIncludes(r.md, "**2ª passada: 1/2 reaplicaram limpo.**");
  assertStringIncludes(
    r.md,
    "<details><summary>Colisões de arquivos que NÃO prometem idempotência",
  );
});

Deno.test("dupla: arquivo de provisionamento emulado conta entre os limpos; pulado reprova (1) mesmo sem promessa quebrada", async () => {
  const texto = "CREATE EXTENSION IF NOT EXISTS pg_cron;\nSELECT 1;";
  const emulado = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${LISTADA}`]: texto },
    regras: [{ exato: texto, vezes: 1, erro: FALTA_CRON }],
  });
  assertEquals(emulado.code, 0, emulado.stdout + emulado.stderr);
  assertStringIncludes(emulado.md, "**2ª passada: 1/1 reaplicaram limpo.**");
  assertStringIncludes(
    emulado.md,
    "· Reaplicados com pg_cron/pg_net emulado (contam entre os limpos): **1**",
  );
  assertStringIncludes(
    emulado.md,
    "<details><summary>Reaplicados com pg_cron/pg_net emulado</summary>",
  );
  assertStringIncludes(emulado.md, `${LISTADA}\n`);

  const solto = "SELECT cron.schedule('x', '* * * * *', 'select 1');";
  const pulado = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${LISTADA}`]: solto },
    regras: [
      {
        exato: solto,
        erro: { message: "function cron.schedule(unknown) does not exist" },
      },
    ],
  });
  assertEquals(pulado.code, 1, pulado.stdout + pulado.stderr);
  assertStringIncludes(
    pulado.stdout,
    `1 arquivo(s) PULADOS por provisionamento na 2ª passada mesmo com o pg_cron emulado: ${LISTADA}`,
  );
  assertStringIncludes(
    pulado.md,
    "· Pulados por provisionamento (pg_cron/pg_net): **1**",
  );
});

Deno.test("dupla: erro inesperado do banco = INDETERMINADO (5)", async () => {
  const r = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    regras: [{ exato: "RESET ALL", erro: { message: "queda no RESET" } }],
  });
  assertEquals(r.code, 5, r.stderr);
  assertStringIncludes(r.stdout, "queda no RESET");
  const nulo = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT 1;" },
    regras: [{ exato: "RESET ALL", lancarIndefinido: true }],
  });
  assertEquals(nulo.code, 5, nulo.stderr);
});

// ===========================================================================
// inventario-rollback.cjs — informativo, sempre 0
// ===========================================================================

Deno.test("inventário: sem pasta ou pasta inexistente = INDETERMINADO (5) com o uso", async () => {
  const r = await rodar({ script: "inventario-rollback.cjs" });
  assertEquals(r.code, 5);
  assertStringIncludes(
    r.stdout,
    "Uso: node inventario-rollback.cjs <pasta-de-migrations>",
  );
  assertEquals(
    (await rodar({ script: "inventario-rollback.cjs", args: ["nao/existe"] }))
      .code,
    5,
  );
});

Deno.test("inventário: casa por nome exato, por timestamp (nome diverge), acha órfão, conta sem companion, raiz e _arquivadas — e sai 0", async () => {
  const r = await rodar({
    script: "inventario-rollback.cjs",
    args: [MIG],
    arquivos: {
      // migrations
      [`${MIG}/20260101000000_a.sql`]: "-- a",
      [`${MIG}/20260102000000_b.sql`]: "-- b",
      [`${MIG}/20260103000000_nome_novo.sql`]: "-- c",
      // rollbacks
      [`${MIG}/rollback-manual-20260101000000_a.sql`]: "-- r a", // exato
      [`${MIG}/rollback-manual-20260103000000_nome_velho.sql`]: "-- r c", // diverge
      [`${MIG}/rollback-manual-20269999999999_orfao.sql`]: "-- r orfao", // sem irmã
      [`${MIG}/rollback-manual-2026010300000_curto.sql`]: "-- r 13 digitos", // 13 dígitos: não casa por timestamp
      // ruído que não conta
      [`${MIG}/LEIA.md`]: "x",
      [`${MIG}/rollback-manual-20260102000000_b.sql.bak`]: "-- nao e .sql",
      // fora da fila
      "rollback-legado.sql": "-- raiz",
      "rollback-outro.sql": "-- raiz 2",
      "nao-e-rollback.sql": "-- x",
      [`${MIG}/_arquivadas/rollback-manual-20250101000000_velho.sql`]: "-- arq",
      [`${MIG}/_arquivadas/20250101000000_velho.sql`]: "-- arq migration",
    },
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "[ci-banco] OK");
  assertStringIncludes(
    r.stdout,
    "Inventário de rollback publicado no summary: 4 rollbacks, 1 com nome divergente, 2 órfãos, 2 na raiz.",
  );
  assertStringIncludes(
    r.md,
    "### CI Banco — inventário de rollback (informativo, ressalva da #535)",
  );
  assertStringIncludes(
    r.md,
    "**4** `rollback-manual-*` na fila · casamento exato: **1** · nome diverge (casou por timestamp): **1** · sem migration irmã: **2**",
  );
  assertStringIncludes(
    r.md,
    "**3** migrations na fila · **2** sem `rollback-manual` companion",
  );
  assertStringIncludes(
    r.md,
    "Rollback em OUTRO lugar (a armadilha da #535): **2** `rollback-*` na raiz do repositório (legado pré-baseline) · **1** em `_arquivadas/` (histórico não executável)",
  );
  assertStringIncludes(
    r.md,
    "rollback-manual-20260103000000_nome_velho.sql ↔ 20260103000000_nome_novo.sql (NOME DIVERGE do arquivo irmão)",
  );
  assertStringIncludes(
    r.md,
    "<details><summary>Rollbacks com nome divergente da migration irmã</summary>",
  );
  assertStringIncludes(
    r.md,
    "<details><summary>Rollbacks SEM migration irmã (órfãos — conferir à mão)</summary>",
  );
  assertStringIncludes(r.md, "rollback-manual-20269999999999_orfao.sql");
  assertStringIncludes(r.md, "rollback-manual-2026010300000_curto.sql");
  assertStringIncludes(
    r.md,
    "<details><summary>Arquivos de rollback na RAIZ do repositório (fora da fila)</summary>",
  );
  assertStringIncludes(r.md, "rollback-legado.sql");
  assertStringIncludes(r.md, "rollback-outro.sql");
  assert(!r.md.includes("nao-e-rollback.sql"), r.md);
});

Deno.test("inventário: sem divergência, órfão, raiz nem _arquivadas não abre nenhum <details> e mostra zeros", async () => {
  const r = await rodar({
    script: "inventario-rollback.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/${A}`]: "-- a",
      [`${MIG}/rollback-manual-${A}`]: "-- r",
    },
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assert(!r.md.includes("<details>"), r.md);
  assertStringIncludes(
    r.md,
    "**1** `rollback-manual-*` na fila · casamento exato: **1** · nome diverge (casou por timestamp): **0** · sem migration irmã: **0**",
  );
  assertStringIncludes(
    r.md,
    "**1** migrations na fila · **0** sem `rollback-manual` companion",
  );
  assertStringIncludes(
    r.md,
    "**0** `rollback-*` na raiz do repositório (legado pré-baseline) · **0** em `_arquivadas/`",
  );
});

// ===========================================================================
// objetos-do-codigo-efemero.cjs
// ===========================================================================

const TODOS = { anon: true, authenticated: true, service_role: true };
const ARQ_CODIGO = {
  "src/a.ts": 'x.from("produtos")\nx.rpc("confirmar")',
  "supabase/functions/f/index.ts": 'x.from("pedidos")',
};
const CATALOGO_OK: Regra[] = [
  {
    quando: "pg_class",
    rows: [
      {
        nome: "produtos",
        anon: true,
        authenticated: false,
        service_role: false,
      },
      {
        nome: "pedidos",
        anon: false,
        authenticated: false,
        service_role: true,
      },
      { nome: "sobrando", ...TODOS },
    ],
  },
  {
    quando: "pg_proc",
    rows: [
      {
        nome: "confirmar",
        anon: false,
        authenticated: true,
        service_role: false,
      },
    ],
  },
  { quando: "storage.buckets", rows: [{ id: "avatars" }] },
];

Deno.test("objetos: tudo existe e é alcançável = exit 0 com as contagens e a frase de aprovação", async () => {
  const r = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: ARQ_CODIGO,
    regras: CATALOGO_OK,
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(
    r.stdout,
    "[ci-banco/(b)] Referências literais no código: 3 (3 objetos únicos) — 3 relações e 1 funções no catálogo public do EFÊMERO.",
  );
  assertStringIncludes(
    r.stdout,
    "[ci-banco/(b)] TODAS as referências do código existem e são alcançáveis no banco que nasceu do zero.",
  );
  assert(!r.stderr.includes("::warning::"), r.stderr);
});

Deno.test("objetos: objeto ausente = FALHOU (1) com o relatório e a explicação", async () => {
  const r = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: { "src/a.ts": 'x.from("vw_sumida")' },
    regras: CATALOGO_OK,
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "AUSENTE — o código usa e o banco NÃO TEM");
  assert(
    r.stdout
      .replaceAll("\\", "/")
      .includes('tabela/view "vw_sumida" usada em src/a.ts:1'),
    r.stdout,
  );
  assertStringIncludes(r.stdout, "[ci-banco] FALHOU");
  assertStringIncludes(
    r.stdout,
    "O banco que nasceu do zero NÃO cobre o que o código usa.",
  );
});

Deno.test("objetos: objeto existente mas sem papel que o alcance (SELECT/EXECUTE) = FALHOU (1) como INALCANÇÁVEL", async () => {
  const r = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: { "src/a.ts": 'x.from("pedidos")\nx.rpc("so_service")' },
    regras: [
      {
        quando: "pg_class",
        rows: [
          {
            nome: "pedidos",
            anon: false,
            authenticated: false,
            service_role: true,
          },
        ],
      },
      {
        quando: "pg_proc",
        rows: [
          {
            nome: "so_service",
            anon: false,
            authenticated: false,
            service_role: true,
          },
        ],
      },
      { quando: "storage.buckets", rows: [] },
    ],
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "INALCANÇÁVEL");
});

Deno.test("objetos: sobrecargas da mesma função somam os papéis (qualquer uma alcançável basta)", async () => {
  const r = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: { "src/a.ts": 'x.rpc("sobrecarga")' },
    regras: [
      { quando: "pg_class", rows: [] },
      {
        quando: "pg_proc",
        rows: [
          {
            nome: "sobrecarga",
            anon: false,
            authenticated: false,
            service_role: true,
          },
          {
            nome: "sobrecarga",
            anon: true,
            authenticated: false,
            service_role: false,
          },
        ],
      },
      { quando: "storage.buckets", rows: [] },
    ],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
});

Deno.test("objetos: storage inacessível deixa o bucket CEGO — avisa e segue (exit 0) se o resto bate", async () => {
  const r = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: ARQ_CODIGO,
    regras: [
      CATALOGO_OK[0],
      CATALOGO_OK[1],
      {
        quando: "storage.buckets",
        erro: { message: 'schema "storage" does not exist' },
      },
    ],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(
    r.stderr,
    "::warning::Sem acesso a storage.buckets no efêmero",
  );
});

Deno.test("objetos: bucket de storage ausente reprova; presente aprova", async () => {
  const arquivos = { "src/a.ts": 'x.storage.from("avatars")' };
  const ausente = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos,
    regras: [
      { quando: "pg_class", rows: [] },
      { quando: "pg_proc", rows: [] },
      { quando: "storage.buckets", rows: [{ id: "outro" }] },
    ],
  });
  assertEquals(ausente.code, 1);
  assertStringIncludes(ausente.stdout, 'bucket de storage "avatars"');
  const presente = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos,
    regras: [
      { quando: "pg_class", rows: [] },
      { quando: "pg_proc", rows: [] },
      { quando: "storage.buckets", rows: [{ id: "avatars" }] },
    ],
  });
  assertEquals(presente.code, 0, presente.stdout + presente.stderr);
});

Deno.test("objetos: referência DINÂMICA entra no relatório sem reprovar", async () => {
  const r = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: { ...ARQ_CODIGO, "src/b.ts": "x.rpc(nomeDaFuncao)" },
    regras: CATALOGO_OK,
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "FORA DA AUDITORIA");
});

Deno.test("objetos: TLS só quando a URL pede (`sslmode` require/verify-ca/verify-full/no-verify); localhost puro vai sem ssl", async () => {
  const semSsl = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: ARQ_CODIGO,
    regras: CATALOGO_OK,
  });
  assertEquals(semSsl.construtores, [{ connectionString: URL_EFEMERA }]);
  for (const modo of ["require", "verify-ca", "verify-full", "no-verify"]) {
    const url = `${URL_EFEMERA}?sslmode=${modo}`;
    const r = await rodar({
      script: "objetos-do-codigo-efemero.cjs",
      arquivos: ARQ_CODIGO,
      regras: CATALOGO_OK,
      env: { DATABASE_URL: url },
    });
    assertEquals(
      r.construtores,
      [{ connectionString: url, ssl: { rejectUnauthorized: false } }],
      modo,
    );
  }
  for (const modo of ["disable", "prefer", "allow"]) {
    const url = `${URL_EFEMERA}?sslmode=${modo}`;
    const r = await rodar({
      script: "objetos-do-codigo-efemero.cjs",
      arquivos: ARQ_CODIGO,
      regras: CATALOGO_OK,
      env: { DATABASE_URL: url },
    });
    assertEquals(r.construtores, [{ connectionString: url }], modo);
  }
});

// ===========================================================================
// provisionar-efemero.cjs
// ===========================================================================

const PAPEIS = ["anon", "authenticated", "service_role"];

Deno.test("provisionar: banco vazio cria os 3 papéis, os default privileges, as 4 extensões, auth.*, publication, storage e o stub de cron — exit 0", async () => {
  const r = await rodar({ script: "provisionar-efemero.cjs" });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  const sqls = r.consultas;
  assertEquals(sqls[0], "RESET ALL");
  assertEquals(sqls[1], 'CREATE SCHEMA IF NOT EXISTS "public"');
  const consultasDePapel = r.chamadas.filter(
    (c) => c.sql === "SELECT 1 FROM pg_roles WHERE rolname = $1",
  );
  assertEquals(
    consultasDePapel.map((c) => c.params),
    [["anon"], ["authenticated"], ["service_role"]],
  );
  for (const papel of PAPEIS) {
    assert(sqls.includes(`CREATE ROLE "${papel}" NOLOGIN`), papel);
    for (const alvo of ["TABLES", "SEQUENCES"]) {
      assert(
        sqls.includes(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ${alvo} TO "${papel}"`,
        ),
        `${papel} ${alvo}`,
      );
    }
    assert(
      sqls.includes(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "${papel}"`,
      ),
      `${papel} funções`,
    );
  }
  assertStringIncludes(
    r.stdout,
    "[provisionar] papéis de fábrica: anon, authenticated, service_role criados",
  );
  assertStringIncludes(
    r.stdout,
    "[provisionar] default privileges de fábrica (public: ALL em tabelas/sequências, EXECUTE em funções → anon/authenticated/service_role).",
  );
  assert(sqls.includes('CREATE SCHEMA IF NOT EXISTS "extensions"'));
  for (const ext of ["unaccent", "pg_trgm", "uuid-ossp", "pgcrypto"]) {
    assert(
      sqls.includes(
        `CREATE EXTENSION IF NOT EXISTS "${ext}" WITH SCHEMA "extensions"`,
      ),
      ext,
    );
    assertStringIncludes(
      r.stdout,
      `[provisionar] extensão ${ext} → schema extensions`,
    );
  }
  for (const e of ["pg_cron", "pg_net"]) {
    assertStringIncludes(
      r.stdout,
      `[provisionar] AVISO: extensão ${e} não existe no image oficial do postgres`,
    );
  }
  assert(sqls.includes("CREATE SCHEMA IF NOT EXISTS auth"));
  assert(
    sqls.some((q) => q.includes("CREATE FUNCTION auth.uid() RETURNS uuid")),
  );
  assert(
    sqls.some((q) => q.includes("CREATE FUNCTION auth.role() RETURNS text")),
  );
  assert(
    sqls.some(
      (q) =>
        q.includes("CREATE TABLE auth.users (") &&
        q.includes("raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb"),
    ),
  );
  assertStringIncludes(
    r.stdout,
    "[provisionar] auth.* de fábrica emulado (uid/role stubs + auth.users id/email/phone/raw_app_meta_data).",
  );
  assert(
    sqls.includes(
      "SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'",
    ),
  );
  assert(sqls.includes("CREATE PUBLICATION supabase_realtime"));
  assertStringIncludes(
    r.stdout,
    "[provisionar] publication supabase_realtime criada",
  );
  assert(sqls.includes("CREATE SCHEMA IF NOT EXISTS storage"));
  assert(
    sqls.some((q) => q.includes("CREATE TABLE IF NOT EXISTS storage.buckets")),
  );
  assert(
    sqls.some((q) => q.includes("CREATE TABLE IF NOT EXISTS storage.objects")),
  );
  assert(
    sqls.includes("ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY"),
  );
  assertStringIncludes(
    r.stdout,
    "[provisionar] storage.buckets + storage.objects mínimos criados",
  );
  assert(sqls.includes('CREATE SCHEMA IF NOT EXISTS "cron"'));
  assert(sqls.some((q) => q.includes("CREATE TABLE IF NOT EXISTS cron.job")));
  assert(
    sqls.some((q) => q.includes("CREATE OR REPLACE FUNCTION cron.schedule(")),
  );
  assert(
    sqls.some((q) => q.includes("CREATE OR REPLACE FUNCTION cron.unschedule(")),
  );
  assertStringIncludes(r.stdout, "[provisionar] pg_cron emulado por stub");
  assertStringIncludes(r.stdout, "[ci-banco] OK");
  assertStringIncludes(
    r.stdout,
    "Banco efêmero provisionado: papéis, extensões contrib, auth.* de fábrica e pg_cron emulado.",
  );
  assertEquals(r.encerrou, true);
});

Deno.test("provisionar: papel que JÁ existe não é recriado; os outros são", async () => {
  const r = await rodar({
    script: "provisionar-efemero.cjs",
    regras: [
      {
        quando: "pg_roles",
        param: "authenticated",
        rowCount: 1,
        rows: [{ "?column?": 1 }],
      },
    ],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assert(!r.consultas.includes('CREATE ROLE "authenticated" NOLOGIN'));
  assert(r.consultas.includes('CREATE ROLE "anon" NOLOGIN'));
  assert(r.consultas.includes('CREATE ROLE "service_role" NOLOGIN'));
  assertStringIncludes(
    r.stdout,
    "papéis de fábrica: anon, service_role criados",
  );
});

Deno.test("provisionar: os três papéis já existem = 'já existiam' e nenhum CREATE ROLE", async () => {
  const r = await rodar({
    script: "provisionar-efemero.cjs",
    regras: [{ quando: "pg_roles", rowCount: 1, rows: [{ "?column?": 1 }] }],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assert(!r.consultas.some((q) => q.startsWith("CREATE ROLE")));
  assertStringIncludes(
    r.stdout,
    "[provisionar] papéis de fábrica: já existiam",
  );
});

Deno.test("provisionar: publication que já existe não é recriada", async () => {
  const r = await rodar({
    script: "provisionar-efemero.cjs",
    regras: [
      { quando: "pg_publication", rowCount: 1, rows: [{ "?column?": 1 }] },
    ],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assert(!r.consultas.includes("CREATE PUBLICATION supabase_realtime"));
  assert(!r.stdout.includes("publication supabase_realtime criada"), r.stdout);
});

Deno.test("provisionar: extensão contrib indisponível = FALHOU (1) listando TODAS as que faltam, sem seguir para auth.*", async () => {
  const r = await rodar({
    script: "provisionar-efemero.cjs",
    regras: [
      {
        exato:
          'CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions"',
        erro: { message: "sem pgcrypto" },
      },
      {
        exato:
          'CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions"',
        erro: { message: "sem unaccent" },
      },
    ],
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stdout,
    "Extensão contrib indisponível no image (não é provisioning de Supabase, é falta real): unaccent: sem unaccent; pgcrypto: sem pgcrypto",
  );
  assert(
    !r.consultas.includes("CREATE SCHEMA IF NOT EXISTS auth"),
    "não pode seguir adiante",
  );
  assertStringIncludes(r.stdout, "extensão pg_trgm → schema extensions");
});

Deno.test("provisionar: erro de SQL no meio = FALHOU (1) 'Provisionamento falhou: …' e a conexão é encerrada", async () => {
  const r = await rodar({
    script: "provisionar-efemero.cjs",
    regras: [
      {
        quando: "CREATE TABLE auth.users",
        erro: { message: "relação já existe" },
      },
    ],
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "Provisionamento falhou: relação já existe");
  assertEquals(r.encerrou, true);
  assert(
    !r.consultas.includes("CREATE PUBLICATION supabase_realtime"),
    "não segue depois do erro",
  );
});

Deno.test("provisionar: end() que falha não esconde o motivo; sem conexão = INDETERMINADO (5) com a dica; alvo gerenciado = RECUSADO (2)", async () => {
  const fim = await rodar({
    script: "provisionar-efemero.cjs",
    regras: [
      {
        quando: "CREATE TABLE auth.users",
        erro: { message: "relação já existe" },
      },
    ],
    erroNoEnd: true,
  });
  assertEquals(fim.code, 1);
  assertStringIncludes(fim.stdout, "Provisionamento falhou: relação já existe");

  const semBanco = await rodar({
    script: "provisionar-efemero.cjs",
    erroConexao: "ECONNREFUSED",
  });
  assertEquals(semBanco.code, 5, semBanco.stderr);
  assertStringIncludes(
    semBanco.stdout,
    "Não conectei no banco efêmero: ECONNREFUSED",
  );
  assertStringIncludes(
    semBanco.stdout,
    "(DATABASE_URL correta? Este script nunca conecta a banco real",
  );
  assertEquals(semBanco.consultas, []);

  const gerenciado = await rodar({
    script: "provisionar-efemero.cjs",
    env: {
      DATABASE_URL: "postgres://postgres@db.abc.supabase.co:5432/postgres",
    },
  });
  assertEquals(gerenciado.code, 2);
  assertEquals(gerenciado.conectou, false);
});

Deno.test("provisionar: falha no RESET ALL (dentro do try) nunca é verde", async () => {
  const r = await rodar({
    script: "provisionar-efemero.cjs",
    regras: [{ exato: "RESET ALL", erro: { message: "queda no RESET" } }],
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "Provisionamento falhou: queda no RESET");
});

Deno.test("objetos: host gerenciado = RECUSADO (2) sem conectar; falha de conexão = INDETERMINADO (5)", async () => {
  const gerenciado = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: ARQ_CODIGO,
    regras: CATALOGO_OK,
    env: {
      DATABASE_URL: "postgres://postgres@db.abc.supabase.co:5432/postgres",
    },
  });
  assertEquals(gerenciado.code, 2);
  assertEquals(gerenciado.conectou, false);
  const semBanco = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: ARQ_CODIGO,
    regras: CATALOGO_OK,
    erroConexao: "ECONNREFUSED",
  });
  assertEquals(semBanco.code, 5, semBanco.stderr);
  assertStringIncludes(semBanco.stdout, "ECONNREFUSED");
});

// ===========================================================================
// Segunda rodada de mutação: texto exato das mensagens, linhas do resumo e
// bordas dos classificadores (o que o `assertStringIncludes` frouxo deixava
// passar: "<pasta-de-migrations>=" ainda INCLUI o texto de uso).
// ===========================================================================

const linhasDe = (texto: string) =>
  texto.split("\n").map((l) => l.replace(/\r$/, ""));

Deno.test("uso: aplicar, dupla e inventário imprimem a linha de uso EXATA (nome do script e nada a mais) sem argumento e com pasta inexistente", async () => {
  for (const script of [
    "aplicar-migrations.cjs",
    "prova-dupla-aplicacao.cjs",
    "inventario-rollback.cjs",
  ]) {
    for (const args of [undefined, ["nao/existe"]]) {
      const r = await rodar({ script, args });
      assertEquals(r.code, 5, `${script} ${args}: ${r.stdout}${r.stderr}`);
      assertEquals(r.conectou, false);
      assert(
        linhasDe(r.stdout).includes(
          `Uso: node ${script} <pasta-de-migrations>`,
        ),
        `${script} ${args}: ${r.stdout}`,
      );
    }
  }
});

Deno.test("aplicar: falha de SQL abre o resumo da 1ª passada com o título certo; pulado reprova com a mensagem inteira", async () => {
  const falha = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${A}`]: "SELECT quebra;" },
    regras: [
      { exato: "SELECT quebra;", erro: { message: "ruim", code: "42703" } },
    ],
  });
  assertEquals(falha.code, 1);
  assertStringIncludes(
    falha.md,
    "### CI Banco — 1ª passada (aplica do zero)\n",
  );

  const texto = "SELECT cron.schedule('x', '* * * * *', 'select 1');";
  const pulado = await rodar({
    script: "aplicar-migrations.cjs",
    args: [MIG],
    arquivos: { [`${MIG}/${LISTADA}`]: texto },
    regras: [
      {
        exato: texto,
        erro: { message: "function cron.schedule(unknown) does not exist" },
      },
    ],
  });
  assertEquals(pulado.code, 1);
  assertStringIncludes(
    pulado.stdout,
    `1 arquivo(s) PULADOS por provisionamento mesmo com o pg_cron emulado — o banco do zero ficou diferente do de uma loja. Confira o passo 6 do provisionar-efemero.cjs.\n${LISTADA} → function cron.schedule(unknown) does not exist`,
  );
});

/** Formas que só diferem da tabela principal por onde a promessa aparece (minúscula / no meio). */
const FORMAS_DE_BORDA: Array<[string, string, boolean]> = [
  ["grant_minuscula", "grant select on t to anon;", true],
  ["revoke_minuscula", "revoke all on t from anon;", true],
  ["comment_minuscula", "comment on table t is 'x';", true],
  ["rls_minuscula", "alter table t enable row level security;", true],
  ["set_minuscula", "set search_path = public;", true],
  ["reset_minuscula", "reset all;", true],
  ["begin_minuscula", "begin;\ncommit;", true],
  ["drop_if_exists_minuscula", "drop table if exists t;", true],
  ["meio_or_replace", "SELECT create or replace;", false],
  ["meio_if_not_exists", "SELECT create table if not exists;", false],
  ["meio_drop_if_exists", "SELECT drop table if exists;", false],
  ["meio_grant", "SELECT grant;", false],
  ["meio_revoke", "SELECT revoke;", false],
  ["meio_comment_on", "SELECT comment on;", false],
  ["meio_rls", "SELECT 1 ALTER TABLE t ENABLE ROW LEVEL SECURITY;", false],
  ["meio_begin", "SELECT begin;", false],
];

Deno.test("dupla: a promessa vale em minúscula, mas SÓ no começo da instrução (a mesma palavra no meio não promete)", async () => {
  const arquivos: Record<string, string> = {};
  FORMAS_DE_BORDA.forEach(([curto, sql], i) => {
    arquivos[
      `${MIG}/202602${String(i + 1).padStart(2, "0")}000000_${curto}.sql`
    ] = `${MARCA_ERRO}\n${sql}\n`;
  });
  const r = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos,
    regras: [{ quando: MARCA_ERRO, erro: { message: "colisão H36" } }],
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  const [antes, depois] = r.md.split("</details>");
  for (const [curto, , promete] of FORMAS_DE_BORDA) {
    const dentroDeQuemNaoPromete = antes.includes(`_${curto}.sql →`);
    const dentroDeQuemPromete = depois.includes(`_${curto}.sql →`);
    assertEquals(
      dentroDeQuemPromete,
      promete,
      `${curto} promete=${promete}\n${r.md}`,
    );
    assertEquals(
      dentroDeQuemNaoPromete,
      !promete,
      `${curto} promete=${promete}\n${r.md}`,
    );
  }
});

Deno.test("dupla: UM arquivo que promete e explode já reprova (1), com a mensagem inteira", async () => {
  const r = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/${A}`]: `${MARCA_ERRO}\nGRANT SELECT ON t TO anon;\n`,
    },
    regras: [{ quando: MARCA_ERRO, erro: { message: "colisão H36" } }],
  });
  assertEquals(r.code, 1, r.stdout + r.stderr);
  assertStringIncludes(
    r.stdout,
    "1 arquivo(s) que PROMETEM idempotência (só formas CREATE OR REPLACE / IF NOT EXISTS / DROP IF EXISTS / GRANT…) explodiram na 2ª passada — a promessa do desenho não se cumpre. Veja o relatório acima.",
  );
});

Deno.test("dupla: cada bloco <details> do relatório abre e fecha com a linha EXATA", async () => {
  const texto = "CREATE EXTENSION IF NOT EXISTS pg_cron;\nSELECT 1;";
  const r = await rodar({
    script: "prova-dupla-aplicacao.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/${A}`]: "CREATE TABLE t (x int);",
      [`${MIG}/${LISTADA}`]: texto,
    },
    regras: [
      { exato: texto, vezes: 1, erro: FALTA_CRON },
      { exato: "CREATE TABLE t (x int);", erro: { message: "já existe" } },
    ],
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  const linhas = linhasDe(r.md);
  assert(
    linhas.includes(
      "<details><summary>Reaplicados com pg_cron/pg_net emulado</summary>",
    ),
    r.md,
  );
  assert(
    linhas.includes(
      "<details><summary>Colisões de arquivos que NÃO prometem idempotência (informativo — migration de versão roda uma vez)</summary>",
    ),
    r.md,
  );
  assertEquals(linhas.filter((l) => l === "</details>").length, 2, r.md);
  assertEquals(linhas.filter((l) => l.includes("</details>")).length, 2, r.md);
});

Deno.test("inventário: o título e o fim de cada <details> são exatos; só `rollback-*` NO COMEÇO do nome conta na raiz; dígitos no meio do nome não são timestamp", async () => {
  const r = await rodar({
    script: "inventario-rollback.cjs",
    args: [MIG],
    arquivos: {
      [`${MIG}/20260101000000_a.sql`]: "-- a",
      [`${MIG}/20260103000000_nome_novo.sql`]: "-- c",
      [`${MIG}/v20260105000000_x.sql`]: "-- digitos no meio",
      [`${MIG}/rollback-manual-20260101000000_a.sql`]: "-- exato",
      [`${MIG}/rollback-manual-20260103000000_nome_velho.sql`]: "-- diverge",
      [`${MIG}/rollback-manual-v20260101000000_a.sql`]:
        "-- digitos no meio do rollback",
      [`${MIG}/rollback-manual-20260105000000_y.sql`]:
        "-- irmã só tem dígitos no meio",
      "rollback-legado.sql": "-- raiz",
      "meu-rollback-legado.sql": "-- NÃO começa com rollback-",
    },
  });
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(
    r.md,
    "**4** `rollback-manual-*` na fila · casamento exato: **1** · nome diverge (casou por timestamp): **1** · sem migration irmã: **2**",
  );
  assertStringIncludes(r.md, "**1** `rollback-*` na raiz do repositório");
  assert(!r.md.includes("meu-rollback-legado.sql"), r.md);
  const linhas = linhasDe(r.md);
  for (const titulo of [
    "<details><summary>Rollbacks com nome divergente da migration irmã</summary>",
    "<details><summary>Rollbacks SEM migration irmã (órfãos — conferir à mão)</summary>",
    "<details><summary>Arquivos de rollback na RAIZ do repositório (fora da fila)</summary>",
  ]) {
    assert(linhas.includes(titulo), `${titulo}\n${r.md}`);
  }
  assertEquals(linhas.filter((l) => l === "</details>").length, 3, r.md);
  assertEquals(linhas.filter((l) => l.includes("</details>")).length, 3, r.md);
});

Deno.test("inventário: dois arquivos com o MESMO timestamp — vence o primeiro da fila, qualquer que seja a ordem do disco", async () => {
  const arquivos = {
    [`${MIG}/20260110000000_a.sql`]: "-- a",
    [`${MIG}/20260110000000_b.sql`]: "-- b",
    [`${MIG}/rollback-manual-20260110000000_z.sql`]: "-- r",
  };
  const asc = await rodar({
    script: "inventario-rollback.cjs",
    args: [MIG],
    arquivos,
    ordem: "asc",
  });
  assertEquals(asc.code, 0, asc.stdout + asc.stderr);
  assertStringIncludes(
    asc.md,
    "rollback-manual-20260110000000_z.sql ↔ 20260110000000_a.sql (NOME DIVERGE",
  );
  const desc = await rodar({
    script: "inventario-rollback.cjs",
    args: [MIG],
    arquivos,
    ordem: "desc",
  });
  assertEquals(desc.code, 0, desc.stdout + desc.stderr);
  assertStringIncludes(
    desc.md,
    "rollback-manual-20260110000000_z.sql ↔ 20260110000000_b.sql (NOME DIVERGE",
  );
});

Deno.test("objetos: a explicação da falha cita as duas issues de referência; erro sem corpo (undefined) vira INDETERMINADO (5), não explosão", async () => {
  const falta = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: { "src/a.ts": 'x.from("vw_sumida")' },
    regras: CATALOGO_OK,
  });
  assertEquals(falta.code, 1);
  assertStringIncludes(
    falta.stdout,
    "O banco que nasceu do zero NÃO cobre o que o código usa. Ou falta migration, ou falta GRANT — exatamente a classe da #139 (vw_produtos_admin) e da #114 (EXECUTE de RPC).",
  );

  const nulo = await rodar({
    script: "objetos-do-codigo-efemero.cjs",
    arquivos: ARQ_CODIGO,
    regras: [{ quando: "pg_class", lancarIndefinido: true }],
  });
  assertEquals(nulo.code, 5, nulo.stdout + nulo.stderr);
  assertStringIncludes(nulo.stdout, "[ci-banco] INDETERMINADO");
  assertStringIncludes(nulo.stdout, "undefined");
});
