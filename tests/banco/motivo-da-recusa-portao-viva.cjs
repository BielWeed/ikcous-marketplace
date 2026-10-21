"use strict";
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Caminhos, nomes de banco e chaves sao constantes da prova; so PG efemero. */
/**
 * Prova VIVA das consultas 56a/56b, com a migration 20261260 real.
 * Mesmo harness dos portoes anteriores: efemero.cjs, provisionar.cjs,
 * aplicar-migrations.cjs e clones descartaveis. Nunca conecta em loja.
 *
 * A base nasce do zero com SOMENTE as migrations anteriores a 20261260:
 * 56b prova ausencia; aplica a 60 e 56a fica POSITIVA; CHECK afrouxada
 * reprova a linha da forma e o portao. Outro banco novo prova o rollback:
 * tabela vazia some com indices/tipos, pedidos ficam intactos, historico
 * ou identificacao divergente recusam sem apagar nada.
 * Consultas rodam como papel de leitura, em transacao somente leitura.
 * Nao prova PostgREST, o Supabase hospedado nem o estado de loja alguma.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/motivo-da-recusa-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const VERSAO = "20261260000000";
const NOME = `${VERSAO}_o_cartao_guarda_o_motivo_da_recusa.sql`;
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const A = "56a-conferir-motivo-da-recusa-do-cartao-aplicado";
const B = "56b-antes-motivo-da-recusa-do-cartao-base-vigente";
const SQL = Object.fromEntries(
  [A, B].map((nome) => [
    nome,
    fs.readFileSync(
      path.join(ROOT, "scripts", "publicacao", "consultas", `${nome}.sql`),
      "utf8",
    ),
  ]),
);
const FORMA =
  "tentativas_cartao_diagnostico: forma conhecida (colunas, restricoes, valores padrao, comentario)";
const AUSENCIA =
  "tentativas_cartao_diagnostico: tabela, indices e restricao unica ainda nao existem";
const SUF = `${process.pid.toString(36)}${Date.now().toString(36)}`;
const RO = `p56_ro_${SUF}`;
const BANCOS = [];
const REF = "abcdefghijklmnopqrst";
const SHA = "a".repeat(40);
const PEDIDO = "d1600000-0000-4000-8000-000000000001";
let urlBase;
let PORTAO;
const passou = [];
function marcar(msg) {
  passou.push(msg);
  console.log(`PASSOU ${msg}`);
}
function urlDe(db) {
  const u = new URL(urlBase);
  u.pathname = `/${db}`;
  return u.toString();
}
async function usar(db, fn) {
  const c = new Client({ connectionString: urlDe(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function criar(rotulo, molde) {
  const nome = `p56_${SUF}_${rotulo}`;
  await usar("template1", (c) =>
    c.query(
      molde
        ? `CREATE DATABASE "${nome}" TEMPLATE "${molde}"`
        : `CREATE DATABASE "${nome}" TEMPLATE template0`,
    ),
  );
  BANCOS.push(nome);
  return nome;
}
function rodarScriptNode(argv, db) {
  const r = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: urlDe(db) },
    encoding: "utf8",
  });
  assert.equal(
    r.status,
    0,
    `${path.basename(argv[0])} falhou:\n${r.stdout || ""}\n${r.stderr || ""}`,
  );
}
async function montarBase() {
  const db = await criar("antes");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p56-"));
  try {
    const nomes = fs
      .readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((e) => e.isFile() && /^\d{14}_.*\.sql$/.test(e.name))
      .map((e) => e.name)
      .filter((n) => n.slice(0, 14) < VERSAO)
      .sort();
    assert.ok(nomes.length > 0, "base anterior nao pode estar vazia");
    for (const n of nomes) {
      fs.copyFileSync(path.join(MIGRATIONS, n), path.join(dir, n));
    }
    rodarScriptNode([path.join(__dirname, "provisionar.cjs")], db);
    rodarScriptNode(
      [path.join(__dirname, "aplicar-migrations.cjs"), dir],
      db,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return db;
}
async function emTransacao(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
async function isolado(c, fn) {
  await c.query("SAVEPOINT caso");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso");
    await c.query("RELEASE SAVEPOINT caso");
  }
}
async function evidencia(nome, linhas) {
  const quando = Date.parse("2026-10-20T12:00:00Z");
  return PORTAO.evidenciaDaProva({
    consulta: nome,
    projeto: "fixture",
    ref: REF,
    sha: SHA,
    topo: SHA,
    validadeHoras: 6,
    agora: quando + 60000,
    deps: {
      listarRuns: async (wf) =>
        wf === "conferir-banco-da-loja.yml"
          ? [
              {
                databaseId: 1,
                displayTitle: `conferir ${nome} em fixture`,
                headSha: SHA,
                createdAt: new Date(quando).toISOString(),
                conclusion: "success",
                status: "completed",
              },
            ]
          : [],
      logDoRun: async () =>
        CONF.veredictoDaConsulta({
          consulta: nome,
          ref: REF,
          sha: SHA,
          linhas,
        }),
      arvoreIgual: async () => true,
    },
  });
}
async function consulta(c, nome, reprovadas = []) {
  // SAVEPOINT restaura o papel e transaction_read_only sem desfazer o cenario.
  return isolado(c, async () => {
    await c.query(`SET LOCAL ROLE ${RO}`);
    await c.query("SET LOCAL transaction_read_only = on");
    assert.equal(CONF.contarStatements(SQL[nome]), 1);
    const r = await c.query(SQL[nome]);
    assert.deepEqual(
      r.fields.map((f) => f.name),
      ["item", "esperado", "vivo", "ok"],
    );
    assert.equal(
      CONF.estruturaDoRolFechado(
        r.rows,
        CONF.ROL_FECHADO_POR_CONSULTA[nome],
      ),
      null,
      nome,
    );
    for (const linha of r.rows) assert.equal(typeof linha.ok, "boolean");
    const oks = r.rows.map((l) => l.ok);
    assert.deepEqual(
      oks,
      [...oks].sort((a, b) => Number(a) - Number(b)),
    );
    assert.deepEqual(
      r.rows
        .filter((l) => !l.ok)
        .map((l) => l.item)
        .sort(),
      [...reprovadas].sort(),
      nome,
    );
    const e = await evidencia(nome, r.rows);
    assert.equal(
      e.estado,
      reprovadas.length ? "NEGATIVA" : "POSITIVA",
      nome,
    );
    return r.rows;
  });
}
async function fotoDosPedidos(c) {
  return (
    await c.query(`SELECT
    (SELECT oid::text FROM pg_class WHERE oid = 'public.marketplace_orders'::regclass) AS oid,
    (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb)
      FROM public.marketplace_orders p) AS pedidos,
    (SELECT jsonb_agg(jsonb_build_array(relname, oid::text) ORDER BY relname)
      FROM pg_class WHERE relnamespace = 'public'::regnamespace
        AND relname NOT LIKE 'tentativas_cartao_diagnostico%') AS objetos`)
  ).rows;
}
async function provarRollback(db) {
  await usar(db, (c) =>
    emTransacao(c, async () => {
      await consulta(c, B);
      await c.query(MIGRATION);
      await consulta(c, A);
      // Fixture minima, inteiramente inventada, sem conta nem dado de cliente.
      await c.query(
        `INSERT INTO public.marketplace_orders
        (id, customer_name, customer_data, total, subtotal, status, canal, payment_method, payment_status)
        VALUES ($1, 'Prova motivo da recusa', '{}'::jsonb, 37.27, 37.27, 'pending', 'online', 'online', 'aguardando')`,
        [PEDIDO],
      );
      const foto = await fotoDosPedidos(c);
      await isolado(c, async () => {
        await c.query(
          `INSERT INTO public.tentativas_cartao_diagnostico
          (pedido_id, mp_order_id, mp_payment_id, status, parcelas, valor)
          VALUES ($1, 'ORDPROVA56', 'PAYPROVA56', 'failed', 2, 37.27)`,
          [PEDIDO],
        );
        const historico = (
          await c.query("SELECT * FROM public.tentativas_cartao_diagnostico")
        ).rows;
        await isolado(c, async () =>
          assert.rejects(c.query(ROLLBACK), /HISTORICO_EXISTENTE/),
        );
        assert.deepEqual(
          (
            await c.query(
              "SELECT * FROM public.tentativas_cartao_diagnostico",
            )
          ).rows,
          historico,
          "rollback recusado nao pode apagar o historico",
        );
        await consulta(c, A);
      });
      marcar("rollback com historico recusa sem apagar a tentativa");
      await isolado(c, async () => {
        await c.query(
          "COMMENT ON TABLE public.tentativas_cartao_diagnostico IS 'outra_origem'",
        );
        await isolado(c, async () =>
          assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/),
        );
        assert.equal(
          (
            await c.query(
              "SELECT count(*)::int AS n FROM public.tentativas_cartao_diagnostico",
            )
          ).rows[0].n,
          0,
        );
      });
      marcar("rollback recusa tabela sem o marcador da migration");
      await c.query(ROLLBACK);
      await consulta(c, B);
      assert.deepEqual(
        await fotoDosPedidos(c),
        foto,
        "rollback so remove a tabela do diagnostico",
      );
      await isolado(c, async () =>
        assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/),
      );
      marcar(
        "rollback vazio remove tabela, indices e tipos; preserva pedidos e outros objetos; reaplicacao recusa",
      );
    }),
  );
}
async function main() {
  urlBase = lerDatabaseUrlEfemera();
  PORTAO = await import(
    pathToFileURL(path.join(ROOT, "scripts/frota/publicar-release.mjs")).href
  );
  const lote = PORTAO.lerCanais().provasDeObjetos.find((l) => l.consulta === A);
  assert.deepEqual(lote.versoes, [VERSAO]);
  assert.equal(lote.ausenciaConfirmadaPor, B);
  await usar("template1", async (c) => {
    await c.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
    await c.query(`GRANT pg_read_all_data TO ${RO}`);
  });
  try {
    const antes = await montarBase();
    await usar(antes, (c) => emTransacao(c, () => consulta(c, B)));
    marcar(
      "56b: ausencia provada na base criada so com migrations anteriores a 20261260",
    );
    const depois = await criar("depois", antes);
    await usar(depois, (c) =>
      emTransacao(c, async () => {
        await c.query(MIGRATION);
        await consulta(c, A);
        await consulta(c, B, [AUSENCIA]);
        marcar(
          "56a: todas as 7 linhas ok=true apos aplicar a 20261260; 56b reprova",
        );
        for (const [rotulo, nome, regra] of [
          ["valor negativo permitido", "valor", "valor > -100"],
          [
            "status adicional permitido",
            "status",
            "status IN ('failed', 'rejected', 'processing', 'in_process', 'pending', 'action_required', 'approved')",
          ],
        ]) {
          await isolado(c, async () => {
            const constraint = `tentativas_cartao_diagnostico_${nome}_check`;
            await c.query(`ALTER TABLE public.tentativas_cartao_diagnostico DROP CONSTRAINT ${constraint},
              ADD CONSTRAINT ${constraint} CHECK (${regra})`);
            const def = (
              await c.query(
                `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
                WHERE conrelid = 'public.tentativas_cartao_diagnostico'::regclass AND conname = $1`,
                [constraint],
              )
            ).rows[0].d;
            assert.ok(
              def.includes(nome === "valor" ? "-100" : "approved"),
              "mutacao nao aplicou",
            );
            await consulta(c, A, [FORMA]);
          });
          await consulta(c, A);
          marcar(
            `mutacao: ${rotulo} reprova so a forma na 56a; restaurada volta a POSITIVA`,
          );
        }
      }),
    );
    await provarRollback(await criar("rollback", antes));
  } finally {
    for (const db of [...BANCOS].reverse()) {
      await usar("template1", (c) => c.query(`DROP DATABASE "${db}"`));
    }
    await usar("template1", (c) => c.query(`DROP ROLE ${RO}`));
  }
  anexarAoSummary(
    "Portao do motivo da recusa do cartao (56a/56b)",
    passou.map((s) => `- ${s}`).join("\n"),
  );
  console.log(`\nmotivo-da-recusa-portao-viva: ${passou.length} ok`);
}
main().catch((erro) => falhar("PORTAO-56", erro.stack || String(erro)));
