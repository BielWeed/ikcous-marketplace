"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-fs-filename --
 * Toda chave indexada vem de constante do proprio teste; os unicos caminhos de arquivo sao os da migration 20261510, dos dois rollbacks
 * dela e das consultas 188a/188b/188m/181a dentro do repositorio. */
/**
 * PROVA VIVA das consultas do lote 188 (migration 20261510000000, o livro de registro) contra o Postgres EFEMERO com as migrations
 * aplicadas do zero (rodar-isolado.cjs, clone exclusivo; nunca banco real). Tudo numa transacao DESFEITA.
 *
 * O PAPEL: um papel NOLOGIN novo, so com USAGE em public, cron e auth e SELECT nas colunas jobid, jobname, schedule e active de
 * cron.job (nunca em command), e NENHUM privilegio nas 17 tabelas nem no livro (precondicao conferida). E' o papel mais pobre que
 * ainda roda as tres consultas; em producao quem roda e' o supabase_read_only_user, que tem mais.
 * O pg_cron do banco local e' um stub sem a coluna `active` (tests/banco/provisionar.cjs): ganha a coluna (default true, como o real).
 *
 * O QUE SE PROVA:
 *   (1) 188m roda com esse papel, sem ler linha: as 17 tabelas medidas, o job da limpeza visivel sem o comando, o livro presente e a
 *       estimativa; uma leitura PLANTADA de public.coupons recebe 42501 (o papel e' mesmo pobre), e ler cron.job.command tambem;
 *       sem USAGE no schema cron, a consulta ERRA (42501), nunca sai vazia;
 *   (2) 188a POSITIVA depois do apply (tambem com a migration reaplicada em CRLF) e com a chave DESLIGADA; 188b NEGATIVA nas 3 linhas
 *       dos objetos;
 *   (3) depois do rollback comum + destrutivo, 188b POSITIVA e 188a reprova tudo menos o controle;
 *   (4) defeitos plantados: cada um reprova EXATAMENTE o item certo (188a: 18; 188b: 7); papel cego do cron (RLS sem job visivel)
 *       deixa a linha do job em 'sim' e a linha volta a ser estrita quando ele ve algum job;
 *   (5) 181a (os fornecedores) continua POSITIVA com os gatilhos do livro em public.fornecedores, e um gatilho alheio ainda reprova.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/o-livro-de-registro-portao-viva.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");

const NOME = "20261510000000_o_livro_de_registro_guarda_a_versao_antiga.sql";
const ler = (n) =>
  fs
    .readFileSync(path.join(__dirname, "../../supabase/migrations", n), "utf8")
    .replace(/\r/g, "");
const MIGRATION = ler(NOME);
const ROLLBACK = ler(`rollback-manual-${NOME}`);
const DESTRUTIVO = ler(`rollback-manual-destrutivo-${NOME}`);
const CONSULTAS = path.join(__dirname, "../../scripts/publicacao/consultas");
const A188 = "188a-conferir-o-livro-de-registro-aplicado";
const B188 = "188b-antes-o-livro-de-registro-ausente";
const M188 = "188m-medir-o-volume-para-o-livro-de-registro";
const A181 = "181a-conferir-os-fornecedores-aplicado";
const PAPEL = "prova_1510_portao";
const SEM_CRON = "prova_1510_sem_cron";
const TABELAS = [
  "marketplace_orders",
  "marketplace_order_items",
  "order_refunds",
  "marketplace_order_payment_history",
  "devolucoes",
  "devolucao_itens",
  "produtos",
  "product_variants",
  "categorias",
  "coupons",
  "fornecedores",
  "fin_lancamentos",
  "fin_contas",
  "fin_categorias",
  "store_config",
  "config_pagamento_cartao",
  "politica_devolucao",
];
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");

let contaSavepoint = 0;
async function emSavepoint(c, fn) {
  const sp = `sp_portao_1510_${++contaSavepoint}`;
  await c.query(`SAVEPOINT ${sp}`);
  try {
    return await fn();
  } finally {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await c.query(`RELEASE SAVEPOINT ${sp}`);
  }
}
/** Roda `sql` como `papel`; devolve as linhas ou o erro (sempre desfeito). */
async function comoPapel(c, papel, sql) {
  return emSavepoint(c, async () => {
    await c.query(`SET LOCAL ROLE ${papel}`);
    try {
      return { linhas: (await c.query(sql)).rows, erro: null };
    } catch (e) {
      return { linhas: null, erro: e };
    }
  });
}
/** Uma consulta de rol fechado, como o papel pobre: confere o rol e devolve os itens que reprovaram. */
async function reprovados(c, nome, papel = PAPEL) {
  const sql = lerConsulta(nome);
  assert.equal(CONF.contarStatements(sql), 1, `${nome}: UM statement`);
  const r = await comoPapel(c, papel, sql);
  if (r.erro) throw r.erro;
  assert.equal(
    CONF.estruturaDoRolFechado(r.linhas, CONF.ROL_FECHADO_POR_CONSULTA[nome]),
    null,
    `${nome}: rol fechado`,
  );
  return r.linhas
    .filter((x) => x.ok !== true)
    .map((x) => x.item)
    .sort();
}
const item = (rol, inicio) => {
  const x = CONF.ROL_FECHADO_POR_CONSULTA[rol].filter((i) =>
    i.startsWith(inicio),
  );
  assert.equal(x.length, 1, `item de ${rol}: ${inicio}`);
  return x[0];
};
/** A instrucao CREATE OR REPLACE FUNCTION de uma funcao da migration, com um comentario a mais no corpo (corpo diferente, resto igual). */
function funcaoComOutroCorpo(nome) {
  const i = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}()`);
  assert.ok(i >= 0, nome);
  const fim =
    MIGRATION.indexOf("$function$;", MIGRATION.indexOf("AS $function$", i)) +
    "$function$;".length;
  const sql = MIGRATION.slice(i, fim);
  return sql.replace(
    "AS $function$\nDECLARE",
    "AS $function$\n-- corpo alterado\nDECLARE",
  );
}

async function prepararPapeis(c) {
  await c.query(
    "ALTER TABLE cron.job ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true",
  );
  await c.query(`CREATE ROLE ${PAPEL} NOLOGIN`);
  await c.query(`GRANT USAGE ON SCHEMA public, cron, auth TO ${PAPEL}`);
  await c.query(
    `GRANT SELECT (jobid, jobname, schedule, active) ON cron.job TO ${PAPEL}`,
  );
  await c.query(`CREATE ROLE ${SEM_CRON} NOLOGIN`);
  await c.query(`GRANT USAGE ON SCHEMA public, auth TO ${SEM_CRON}`);
  const comPrivilegio = (
    await c.query(
      `SELECT t FROM unnest($1::text[]) AS t
        WHERE has_table_privilege($2, to_regclass('public.' || t), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
           OR has_any_column_privilege($2, to_regclass('public.' || t), 'SELECT, INSERT, UPDATE, REFERENCES')`,
      [
        [
          ...TABELAS,
          "livro_de_registro",
          "livro_de_registro_chave",
          "livro_de_registro_falhas",
        ],
        PAPEL,
      ],
    )
  ).rows.map((x) => x.t);
  assert.deepEqual(
    comPrivilegio,
    [],
    "precondicao: o papel da prova nao tem privilegio nas 17 tabelas nem no livro",
  );
  assert.equal(
    (
      await c.query(
        "SELECT has_column_privilege($1, 'cron.job', 'command', 'SELECT') AS x",
        [PAPEL],
      )
    ).rows[0].x,
    false,
    "precondicao: o papel nao le o comando dos jobs",
  );
}

async function medicao(c) {
  const sql = lerConsulta(M188);
  assert.equal(CONF.contarStatements(sql), 1);
  const r = await comoPapel(c, PAPEL, sql);
  assert.equal(r.erro, null, `188m com o papel pobre: ${r.erro?.message}`);
  const de = (tipo) => r.linhas.filter((x) => x.tipo === tipo);
  const tabelas = de("tabela");
  assert.deepEqual(
    tabelas.map((x) => x.objeto).sort(),
    [...TABELAS].sort(),
    "188m mede as 17",
  );
  for (const t of tabelas) {
    assert.notEqual(t.detalhe, "AUSENTE", t.objeto);
    assert.match(
      t.detalhe,
      /^n_tup_upd=\d+\|n_tup_hot_upd=\d+\|n_tup_del=\d+\|n_tup_ins=\d+\|n_live_tup=\d+\|reltuples=-?\d+\|bytes_tabela=\d+\|bytes_total=\d+\|gatilhos=/,
    );
    assert.match(
      t.detalhe,
      /tr_livro_alteracao,tr_livro_exclusao|tr_livro_alteracao.*tr_livro_exclusao/,
      `${t.objeto}: gatilhos do livro`,
    );
  }
  assert.deepEqual(
    de("cron")
      .filter((x) => x.objeto === "limpar-livro-de-registro")
      .map((x) => x.detalhe),
    ["schedule=17 6 * * *|active=true"],
    "o job da limpeza visivel, sem o comando",
  );
  assert.ok(
    !r.linhas.some((x) =>
      /SELECT public\.livro_de_registro_limpar/.test(x.detalhe),
    ),
    "nenhum comando de job na saida",
  );
  assert.deepEqual(
    de("livro")
      .map((x) => `${x.objeto}=${x.detalhe}`)
      .sort(),
    [
      "livro_de_registro=presente",
      "livro_de_registro_anotar=presente",
      "livro_de_registro_chave=presente",
      "livro_de_registro_falhas=presente",
      "livro_de_registro_limpar=presente",
    ],
  );
  const total = de("ESTIMATIVA").find((x) => x.objeto === "total das 17");
  assert.match(
    total?.detalhe ?? "",
    /^anotacoes_90d=\d+\|mb_90d=[\d.]+\|teto_linhas=200000\|teto_banco_mb=400$/,
  );
  assert.equal(de("ESTIMATIVA").length, 18);
  assert.match(
    de("controle").find((x) => x.objeto === "servidor").detalhe,
    /^server_version_num=\d+$/,
  );

  // O papel e' mesmo pobre: a leitura PLANTADA de uma das 17 recebe 42501; o comando dos jobs tambem.
  const fim = ")\nSELECT tipo, objeto, detalhe";
  const base = sql.replace(/\r/g, "");
  assert.equal(base.split(fim).length, 2);
  const plantada = base.replace(
    fim,
    `  UNION ALL SELECT 98, 'plantada', 'coupons', (SELECT count(*)::text FROM public.coupons)\n${fim}`,
  );
  assert.equal(
    (await comoPapel(c, PAPEL, plantada)).erro?.code,
    "42501",
    "leitura plantada de public.coupons",
  );
  const comando = base.replace(
    fim,
    `  UNION ALL SELECT 98, 'plantada', j.jobname, j.command FROM cron.job j\n${fim}`,
  );
  assert.equal(
    (await comoPapel(c, PAPEL, comando)).erro?.code,
    "42501",
    "leitura plantada de cron.job.command",
  );
  assert.equal(
    (await comoPapel(c, SEM_CRON, sql)).erro?.code,
    "42501",
    "sem USAGE no cron, a 188m ERRA",
  );
}

async function positivas(c) {
  assert.deepEqual(
    await reprovados(c, A188),
    [],
    "188a POSITIVA depois do apply",
  );
  assert.deepEqual(
    await reprovados(c, B188),
    [
      item(B188, "livro_de_registro_anotar e"),
      item(B188, "livro_de_registro, livro_de_registro_chave"),
      item(B188, "nenhum gatilho"),
    ].sort(),
    "188b NEGATIVA so nas linhas dos objetos",
  );
  await emSavepoint(c, async () => {
    await c.query(
      "UPDATE public.livro_de_registro_chave SET ligado = false, motivo = 'prova' WHERE id = 1",
    );
    assert.deepEqual(
      await reprovados(c, A188),
      [],
      "188a nao exige a chave ligada",
    );
  });
  await emSavepoint(c, async () => {
    await c.query(MIGRATION.replace(/\n/g, "\r\n"));
    assert.deepEqual(
      await reprovados(c, A188),
      [],
      "188a POSITIVA com a migration reaplicada em CRLF",
    );
  });
  assert.equal(
    (await comoPapel(c, SEM_CRON, lerConsulta(A188))).erro?.code,
    "42501",
    "188a sem USAGE no cron ERRA",
  );
  await emSavepoint(c, async () => {
    await c.query(ROLLBACK);
    await c.query("SET LOCAL app.confirmo_apagar_livro = 'APAGAR'");
    await c.query(DESTRUTIVO);
    assert.deepEqual(
      await reprovados(c, B188),
      [],
      "188b POSITIVA depois do rollback comum + destrutivo",
    );
    assert.deepEqual(
      await reprovados(c, A188),
      CONF.ROL_FECHADO_POR_CONSULTA[A188]
        .filter((i) => !i.startsWith("controle"))
        .sort(),
      "188a reprova tudo menos o controle sem o livro",
    );
  });
  await emSavepoint(c, async () => {
    await c.query(ROLLBACK);
    assert.deepEqual(
      await reprovados(c, B188),
      [
        item(B188, "livro_de_registro_anotar e"),
        item(B188, "livro_de_registro, livro_de_registro_chave"),
      ].sort(),
      "depois so do rollback comum, as tabelas e a funcao de limpar ficam (188b nao passa, de proposito)",
    );
  });
}

async function defeitos(c) {
  let n = 0;
  const plantar = async (rol, sabotagem, esperados, papel = PAPEL) => {
    await emSavepoint(c, async () => {
      for (const s of [].concat(sabotagem)) await c.query(s);
      assert.deepEqual(
        await reprovados(c, rol, papel),
        esperados.map((i) => item(rol, i)).sort(),
        `${rol} com o defeito "${[].concat(sabotagem).join("; ").slice(0, 100)}" reprova exatamente o item certo`,
      );
    });
    n++;
  };
  // 188a
  await plantar(A188, funcaoComOutroCorpo("livro_de_registro_anotar"), [
    "livro_de_registro_anotar: uma so",
  ]);
  await plantar(
    A188,
    "ALTER FUNCTION public.livro_de_registro_anotar() RESET lock_timeout",
    ["livro_de_registro_anotar: plpgsql"],
  );
  await plantar(
    A188,
    "GRANT EXECUTE ON FUNCTION public.livro_de_registro_anotar() TO authenticated",
    ["livro_de_registro_anotar: plpgsql"],
  );
  await plantar(
    A188,
    "ALTER FUNCTION public.livro_de_registro_anotar() SECURITY INVOKER",
    ["livro_de_registro_anotar: plpgsql"],
  );
  await plantar(A188, funcaoComOutroCorpo("livro_de_registro_limpar"), [
    "livro_de_registro_limpar: uma so",
  ]);
  await plantar(
    A188,
    "ALTER FUNCTION public.livro_de_registro_limpar() SET statement_timeout = '10s'",
    ["livro_de_registro_limpar: plpgsql"],
  );
  await plantar(
    A188,
    "GRANT EXECUTE ON FUNCTION public.livro_de_registro_limpar() TO PUBLIC",
    ["livro_de_registro_limpar: plpgsql"],
  );
  await plantar(A188, "GRANT SELECT ON public.livro_de_registro TO anon", [
    "livro_de_registro, livro_de_registro_chave",
  ]);
  await plantar(
    A188,
    "GRANT SELECT (antes) ON public.livro_de_registro TO authenticated",
    ["livro_de_registro, livro_de_registro_chave"],
  );
  await plantar(
    A188,
    "CREATE POLICY prova_1510 ON public.livro_de_registro_falhas FOR SELECT USING (true)",
    ["livro_de_registro, livro_de_registro_chave"],
  );
  await plantar(
    A188,
    "ALTER TABLE public.livro_de_registro_chave DISABLE ROW LEVEL SECURITY",
    ["livro_de_registro, livro_de_registro_chave"],
  );
  await plantar(
    A188,
    "GRANT USAGE ON SEQUENCE public.livro_de_registro_id_seq TO service_role",
    ["livro_de_registro_id_seq"],
  );
  await plantar(
    A188,
    "ALTER TABLE public.livro_de_registro_chave ADD COLUMN prova_1510 integer",
    ["as 3 tabelas do livro"],
  );
  await plantar(
    A188,
    "ALTER TABLE public.coupons DISABLE TRIGGER tr_livro_alteracao",
    ["as 17 tabelas"],
  );
  await plantar(
    A188,
    "DROP TRIGGER tr_livro_exclusao ON public.politica_devolucao",
    ["as 17 tabelas"],
  );
  await plantar(
    A188,
    [
      "DROP TRIGGER tr_livro_exclusao ON public.marketplace_orders",
      "CREATE TRIGGER tr_livro_exclusao AFTER DELETE ON public.marketplace_orders REFERENCING OLD TABLE AS antigos FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar('order_id')",
    ],
    ["as 17 tabelas"],
  );
  await plantar(
    A188,
    "CREATE TRIGGER prova_1510_extra AFTER TRUNCATE ON public.categorias FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar()",
    ["as 17 tabelas"],
  );
  await plantar(
    A188,
    "UPDATE cron.job SET schedule = '0 3 * * *' WHERE jobname = 'limpar-livro-de-registro'",
    ["o job"],
  );
  await plantar(
    A188,
    "UPDATE cron.job SET active = false WHERE jobname = 'limpar-livro-de-registro'",
    ["o job"],
  );
  await plantar(
    A188,
    "DELETE FROM cron.job WHERE jobname = 'limpar-livro-de-registro'",
    ["o job"],
  );
  // Papel cego do cron: RLS no cron.job sem politica, o papel nao ve job nenhum -> a linha do job nao conclui ('sim').
  await plantar(
    A188,
    [
      "DELETE FROM cron.job WHERE jobname = 'limpar-livro-de-registro'",
      "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY",
    ],
    [],
  );
  // ... e volta a ser estrita quando ele ve algum job (uma politica que mostra so um job alheio).
  await plantar(
    A188,
    [
      "DELETE FROM cron.job WHERE jobname = 'limpar-livro-de-registro'",
      "INSERT INTO cron.job (jobname, schedule, command) VALUES ('prova_1510_isca', '0 0 * * *', 'SELECT 1')",
      "ALTER TABLE cron.job ENABLE ROW LEVEL SECURITY",
      `CREATE POLICY prova_1510_ve_isca ON cron.job FOR SELECT TO ${PAPEL} USING (jobname = 'prova_1510_isca')`,
    ],
    ["o job"],
  );
  // 188b, no estado de antes (rollback comum + destrutivo).
  const antes = [
    ROLLBACK,
    "SET LOCAL app.confirmo_apagar_livro = 'APAGAR'",
    DESTRUTIVO,
  ];
  await plantar(B188, antes, []);
  await plantar(
    B188,
    [
      ...antes,
      "ALTER TABLE public.fornecedores RENAME TO fornecedores_prova_1510",
    ],
    ["as 17 tabelas existem"],
  );
  await plantar(
    B188,
    [
      ...antes,
      "ALTER TABLE public.devolucao_itens RENAME COLUMN devolucao_id TO devolucao_prova_1510",
    ],
    ["as colunas do titular"],
  );
  await plantar(
    B188,
    [
      ...antes,
      "ALTER FUNCTION cron.schedule(text, text, text) RENAME TO schedule_prova_1510",
    ],
    ["Postgres 14"],
  );
  await plantar(
    B188,
    [
      ...antes,
      "CREATE FUNCTION public.livro_de_registro_limpar() RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb'",
    ],
    ["livro_de_registro_anotar e"],
  );
  await plantar(
    B188,
    [...antes, "CREATE TABLE public.livro_de_registro_falhas (x integer)"],
    ["livro_de_registro, livro_de_registro_chave"],
  );
  await plantar(
    B188,
    [
      ...antes,
      "CREATE FUNCTION public.prova_1510_gatilho() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'",
      "CREATE TRIGGER tr_livro_alteracao AFTER UPDATE ON public.coupons FOR EACH STATEMENT EXECUTE FUNCTION public.prova_1510_gatilho()",
    ],
    ["nenhum gatilho"],
  );
  await plantar(
    B188,
    [
      ...antes,
      "SELECT cron.schedule('limpar-livro-de-registro', '17 6 * * *', 'SELECT 1')",
    ],
    ["nenhum gatilho"],
  );
  return n;
}

async function fornecedores(c) {
  const nos = (
    await c.query(
      "SELECT string_agg(tgname, ',' ORDER BY tgname) AS g FROM pg_trigger WHERE tgrelid = 'public.fornecedores'::regclass AND NOT tgisinternal",
    )
  ).rows[0].g;
  assert.equal(
    nos,
    "fornecedores_carimba_atualizado_em,tr_livro_alteracao,tr_livro_exclusao",
    "precondicao: os gatilhos do livro estao em public.fornecedores",
  );
  const r181 = async () => {
    const sql = lerConsulta(A181);
    const r = await comoPapel(c, "authenticated", sql);
    if (r.erro) throw r.erro;
    assert.equal(
      CONF.estruturaDoRolFechado(r.linhas, CONF.ROL_FECHADO_POR_CONSULTA[A181]),
      null,
    );
    return r.linhas.filter((x) => x.ok !== true).map((x) => x.item);
  };
  assert.deepEqual(
    await r181(),
    [],
    "181a POSITIVA com os gatilhos do livro em public.fornecedores",
  );
  await emSavepoint(c, async () => {
    await c.query(
      "CREATE TRIGGER prova_1510_alheio AFTER UPDATE ON public.fornecedores FOR EACH STATEMENT EXECUTE FUNCTION public.livro_de_registro_anotar()",
    );
    assert.deepEqual(
      await r181(),
      [item(A181, "fornecedores: um unico gatilho")],
      "181a: so o prefixo tr_livro_ sai da conta; outro gatilho ainda reprova",
    );
  });
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  let provas = 0;
  const provar = async (nome, fn) => {
    const r = await fn();
    provas++;
    console.log(`  ok ${provas}: ${nome}`);
    return r;
  };
  try {
    assert.equal(
      (
        await c.query(
          "SELECT to_regprocedure('public.livro_de_registro_anotar()') IS NOT NULL AS x",
        )
      ).rows[0].x,
      true,
      "o clone deve estar com a migration nova",
    );
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL TIME ZONE 'UTC'");
      await provar(
        "papeis: o pobre (USAGE em public, cron e auth; 4 colunas de cron.job) e o sem cron; nenhum privilegio nas 17",
        () => prepararPapeis(c),
      );
      await provar(
        "188m com o papel pobre: 17 tabelas, job sem comando, livro presente, estimativa; leitura plantada = 42501",
        () => medicao(c),
      );
      await provar(
        "188a positiva (LF, CRLF, chave desligada), 188b negativa; depois do rollback comum + destrutivo, 188b positiva e 188a vermelha",
        () => positivas(c),
      );
      const n = await provar(
        "defeitos plantados: cada um reprova exatamente o item certo",
        () => defeitos(c),
      );
      await provar(
        "181a positiva com os gatilhos do livro em fornecedores; gatilho alheio ainda reprova",
        () => fornecedores(c),
      );
      console.log(
        `\no-livro-de-registro-portao-viva: ${provas} provas ok; ${n} defeitos plantados`,
      );
      anexarAoSummary(
        "Portao do livro de registro (188a/188b/188m)",
        `${provas} provas, ${n} defeitos plantados.`,
      );
    } finally {
      await c.query("ROLLBACK");
    }
  } finally {
    await c.end();
  }
}
main().catch((e) => falhar("LIVRO_PORTAO", e.stack || e.message));
