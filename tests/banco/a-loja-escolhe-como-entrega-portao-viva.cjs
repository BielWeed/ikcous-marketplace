"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261244000000 (a loja escolhe como entrega na cidade e em quantos dias): as consultas
 * 47a-conferir-a-loja-escolhe-como-entrega-aplicado (DEPOIS, 9 linhas) e 47b-antes-a-loja-escolhe-como-entrega-base-vigente
 * (ANTES, 9 linhas), executadas num Postgres EFÊMERO como papel de LEITURA (BYPASSRLS + pg_read_all_data, transação
 * somente leitura) e levadas até o veredito (`conferir-banco.cjs`) e ao portão (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 47a é POSITIVA com o rol EXATO de ROL_DA_47A, rol=ok; a 47b NEGATIVA reprovando
 *       EXATAMENTE as cinco linhas que dependem do que a migration mudou (três corpos, a ausência das colunas/trigger, a view).
 *   (2) ANTES, em DOIS degraus: só o rollback COMUM (as colunas e a CHECK ficam): a 47b reprova só a linha da ausência e a
 *       47a reprova corpos, trigger e view mas NÃO as colunas; rollback comum + DESTRUTIVO (a base de antes de verdade): a 47b
 *       é POSITIVA e a 47a NEGATIVA nas seis linhas.
 *   (3) UM NEGATIVO POR LINHA da 47a e da 47b (corpo +1 byte, atributo trocado, sobrecarga, EXECUTE aberto/fechado por papel,
 *       função ausente, coluna sem default / sem NOT NULL, CHECK trocada ou ausente, trigger ausente / desligada / só UPDATE /
 *       com EXECUTE aberto, view com coluna a menos / fora de ordem / sem SELECT para um papel).
 *   (4) MUTANTES do texto das consultas: cada um deixa um positivo reprovar ou um negativo passar.
 *   (5) As antecessoras 8e, 9a, 31a, 37a e 40a seguem POSITIVAS com a migration no ar e desfeita (a 9a só no ar: ela prova o
 *       corpo MAIS NOVO); corpo estranho reprova SÓ a linha da função.
 *   (6) rol FECHADO: resposta parcial ou o rol de outra consulta nunca é POSITIVA.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a IKCOUS ou a
 * Savy estão (isso só o run da consulta contra o ref).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-escolhe-como-entrega-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório; as chaves de objeto, de constantes deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const A = "47a-conferir-a-loja-escolhe-como-entrega-aplicado";
const B = "47b-antes-a-loja-escolhe-como-entrega-base-vigente";
const E8 = "8e-conferir-92-a-202-aplicado";
const A9 = "9a-conferir-60-a-66-aplicado";
const A31 = "31a-conferir-endereco-da-compra-fica-no-pedido";
const A37 = "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado";
const A40 = "40a-conferir-identidade-legal-da-loja-aplicado";
const SQL = {};
for (const n of [A, B, E8, A9, A31, A37, A40])
  SQL[n] = fs.readFileSync(path.join(CONSULTAS, `${n}.sql`), "utf8");
const ROL = {
  [A]: CONF.ROL_DA_47A,
  [B]: CONF.ROL_DA_47B,
  [E8]: CONF.ROL_DA_8E,
  [A9]: CONF.ROL_DA_9A,
  [A31]: CONF.ROL_DA_31A,
  [A37]: CONF.ROL_DA_37A,
  [A40]: CONF.ROL_DA_40A,
};

const NOME = "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const RB = ler(`rollback-manual-${NOME}`);
const RBD = ler(`rollback-manual-destrutivo-${NOME}`);
const FN = {
  v23: "public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)",
  v24: "public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)",
  up: "public.upsert_store_config(jsonb)",
};
const FNTRIG = "public.store_config_so_retirada_exige_retirada()";
const HASH_NOVO = {
  v23: "79445d64a87843be2d42bf601c7090ec",
  v24: "85c37af4baa2f5ce1375bdd9e943c746",
  up: "391e8e1064400df5aea579f3472b203c",
};
const HASH_VIGENTE = {
  v23: "6cb5a00cfa290f00dc9de053fee40759",
  v24: "6002fc8db6c1d402bc704f018a0c2621",
  up: "b562669936df1cda31d4bdd4d075bff3",
};

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p47_ro_${SUF}`;

let resultados = 0;
const ok = (msg) => {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
};
let C;
let PORTAO;

/** BEGIN; `montar` (dono da conexão); SET LOCAL ROLE só-leitura; as consultas; ROLLBACK. */
async function noEstado(montar, consultas = [A, B]) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    await C.query(`SET LOCAL ROLE ${RO}`);
    await C.query("SET LOCAL transaction_read_only = on");
    const saidas = {};
    for (const nome of consultas) {
      const sql = SQL[nome] ?? nome;
      assert.equal(CONF.contarStatements(sql), 1, "exatamente 1 statement");
      const r = await C.query(sql);
      assert.deepEqual(
        r.fields.map((f) => f.name),
        ["item", "esperado", "vivo", "ok"],
      );
      saidas[nome] = r.rows;
    }
    return saidas;
  } finally {
    await C.query("ROLLBACK");
  }
}

const reprovadas = (rows) =>
  rows
    .filter((r) => r.ok !== true)
    .map((r) => r.item)
    .sort();
const veredito = (consulta, rows) =>
  CONF.veredictoDaConsulta({ consulta, ref: REF, sha: SHA40, linhas: rows });
let relogio = Date.parse("2026-10-15T12:00:00Z");
async function estadoNoPortao(consulta, rows) {
  relogio += 1000;
  const linha = veredito(consulta, rows);
  return (
    await PORTAO.evidenciaDaProva({
      consulta,
      projeto: "savy",
      ref: REF,
      sha: SHA40,
      topo: SHA40,
      validadeHoras: 6,
      agora: relogio + 60000,
      deps: {
        listarRuns: async (wf) =>
          wf === "conferir-banco-da-loja.yml"
            ? [
                {
                  databaseId: 1,
                  displayTitle: `conferir ${consulta} em savy`,
                  headSha: SHA40,
                  createdAt: new Date(relogio).toISOString(),
                  conclusion: "success",
                  status: "completed",
                },
              ]
            : [],
        logDoRun: async () => `saida do job\n${linha ?? ""}\n`,
        arvoreIgual: async () => true,
      },
    })
  ).estado;
}

function exigirFormato(consulta, rotulo, rows) {
  assert.equal(rows.length, ROL[consulta].length, `${rotulo}: nº de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL[consulta]),
    null,
    `${rotulo}: o rol fechado do código tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(typeof r.ok, "boolean", `${rotulo}: ok não booleano`);
    assert.deepEqual(
      [typeof r.item, typeof r.esperado, typeof r.vivo],
      ["string", "string", "string"],
    );
  }
  const oks = rows.map((r) => r.ok);
  assert.deepEqual(
    oks,
    [...oks].sort((a, b) => Number(a) - Number(b)),
    `${rotulo}: ok=false primeiro`,
  );
}
async function exigirPositiva(consulta, rotulo, rows) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(reprovadas(rows), [], `${rotulo}: nada podia reprovar`);
  assert.ok(
    veredito(consulta, rows).endsWith(
      `linhas=${rows.length} ok_false=0 ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${veredito(consulta, rows)}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "POSITIVA", rotulo);
}
async function exigirReprovadas(consulta, rotulo, rows, esperadas) {
  exigirFormato(consulta, rotulo, rows);
  assert.deepEqual(
    reprovadas(rows),
    [...esperadas].sort(),
    `${rotulo}: reprovou ${JSON.stringify(reprovadas(rows))}, esperava ${JSON.stringify(esperadas)}`,
  );
  assert.ok(
    veredito(consulta, rows).endsWith(
      `linhas=${rows.length} ok_false=${esperadas.length} ok_nao_booleano=0 rol=ok`,
    ),
    `${rotulo}: veredito ${veredito(consulta, rows)}`,
  );
  assert.equal(await estadoNoPortao(consulta, rows), "NEGATIVA", rotulo);
}

// --- as montagens -----------------------------------------------------------
const hashVivo = async (c, fn) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [fn],
    )
  ).rows[0]?.h;
const todosOs = async (c, tabela) => {
  for (const k of ["v23", "v24", "up"])
    assert.equal(
      await hashVivo(c, FN[k]),
      tabela[k],
      `${k}: o corpo vivo não é o esperado`,
    );
};
const DEPOIS = async (c) => {
  // O clone sai das migrations aplicadas do zero: a 20261244 está no ar.
  await todosOs(c, HASH_NOVO);
};
/** Só o rollback COMUM: os corpos e a view voltam, a trigger sai; as colunas e a CHECK FICAM. */
const ANTES_COMUM = async (c) => {
  await DEPOIS(c);
  await c.query(RB);
  await todosOs(c, HASH_VIGENTE);
};
/** Rollback comum + destrutivo: a base de antes de verdade (sem as colunas). */
const ANTES = async (c) => {
  await ANTES_COMUM(c);
  await c.query(RBD);
};
const em =
  (...passos) =>
  async (c) => {
    for (const p of passos) await p(c);
  };
const sql = (texto) => (c) => c.query(texto);
const defDe = async (c, fn) =>
  (await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn]))
    .rows[0].d;
/** Reescreve a função com UMA troca de texto (a definição inteira, com os atributos de sempre). */
const trocaNoCorpo = (fn, de, para) => async (c) => {
  const def = await defDe(c, fn);
  assert.ok(def.includes(de), `o trecho ${de} não existe na função`);
  await c.query(def.replace(de, () => para));
};
const maisUmByte = (fn) => trocaNoCorpo(fn, "BEGIN", "BEGIN ");
const trocarNaConsulta = (texto, de, para) => {
  assert.ok(texto.includes(de), `o trecho a mutar não existe: ${de}`);
  return texto.replace(de, () => para);
};
/** As colunas da view hoje, na ordem. */
const colunasDaView = async (c) =>
  (
    await c.query(
      `SELECT array_agg(attname::text ORDER BY attnum) AS c FROM pg_attribute
        WHERE attrelid = to_regclass('public.v_store_config') AND attnum > 0 AND NOT attisdropped`,
    )
  ).rows[0].c;
/** Refaz a view com a lista dada (a ordem dada), com os GRANT de sempre. */
const refazAView = (mexe) => async (c) => {
  const cols = mexe(await colunasDaView(c));
  await c.query("DROP VIEW public.v_store_config");
  await c.query(
    `CREATE VIEW public.v_store_config WITH (security_invoker=on) AS SELECT ${cols.join(", ")} FROM store_config WHERE id = 1`,
  );
  await c.query(
    "GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role",
  );
};

async function provar() {
  const L = (consulta, trecho) => {
    const achadas = ROL[consulta].filter((i) => i.includes(trecho));
    assert.equal(
      achadas.length,
      1,
      `a linha "${trecho}" tem de ser única no rol de ${consulta} (achei ${achadas.length})`,
    );
    return achadas[0];
  };
  const A_V23 = L(A, "create_marketplace_order_v23: corpo");
  const A_V24 = L(A, "create_marketplace_order_v24: corpo");
  const A_UP = L(A, "upsert_store_config: corpo");
  const A_ATRIB = L(A, "atributos de sempre");
  const A_EXEC = L(A, "EXECUTE como sempre");
  const A_COLS = L(A, "store_config: local_delivery_enabled boolean");
  const A_TRIG = L(A, "trigger ligada");
  const A_VIEW = L(A, "v_store_config: as 47 colunas");
  const B_V23 = L(B, "create_marketplace_order_v23: corpo");
  const B_V24 = L(B, "create_marketplace_order_v24: corpo");
  const B_UP = L(B, "upsert_store_config: corpo");
  const B_ATRIB = L(B, "atributos de sempre");
  const B_EXEC = L(B, "EXECUTE como sempre");
  const B_AUSENCIA = L(B, "ainda nao existem");
  const B_VIEW = L(B, "as 45 colunas de hoje");
  const B_LIDAS = L(B, "enabled_shipping_methods");

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "47a depois", s[A]);
    await exigirReprovadas(B, "47b depois", s[B], [
      B_V23,
      B_V24,
      B_UP,
      B_AUSENCIA,
      B_VIEW,
    ]);
  }
  ok(
    "DEPOIS (a 20261244 no ar): 47a POSITIVA (9 linhas, rol=ok, portão POSITIVA); 47b NEGATIVA só nas 5 linhas que a migration mudou (os três corpos, as colunas/trigger já existem, a view de 47 colunas)",
  );

  // (2) ANTES, em dois degraus
  {
    const s = await noEstado(ANTES_COMUM);
    await exigirReprovadas(A, "47a só com o rollback comum", s[A], [
      A_V23,
      A_V24,
      A_UP,
      A_TRIG,
      A_VIEW,
    ]);
    await exigirReprovadas(B, "47b só com o rollback comum", s[B], [
      B_AUSENCIA,
    ]);
  }
  ok(
    "ANTES, 1º degrau (só o rollback-manual comum): as colunas e a CHECK FICAM — a 47a segue verdadeira na linha das colunas e reprova corpos, trigger e view; a 47b reprova SÓ a ausência (loja ainda não está na base de antes)",
  );
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "47b antes", s[B]);
    await exigirReprovadas(A, "47a antes", s[A], [
      A_V23,
      A_V24,
      A_UP,
      A_COLS,
      A_TRIG,
      A_VIEW,
    ]);
  }
  ok(
    "ANTES, 2º degrau (rollback comum + destrutivo): 47b POSITIVA; 47a NEGATIVA nas 6 linhas (três corpos, colunas, trigger, view); atributos e EXECUTE seguem verdadeiros",
  );

  // (3) um negativo por linha da 47a
  const negativosA = [
    ["v23 com 1 byte a mais", maisUmByte(FN.v23), [A_V23]],
    ["v24 com 1 byte a mais", maisUmByte(FN.v24), [A_V24]],
    ["upsert com 1 byte a mais", maisUmByte(FN.up), [A_UP]],
    [
      "v24 SECURITY INVOKER",
      sql(`ALTER FUNCTION ${FN.v24} SECURITY INVOKER`),
      [A_ATRIB],
    ],
    [
      "v23 com search_path aberto",
      sql(`ALTER FUNCTION ${FN.v23} RESET search_path`),
      [A_ATRIB],
    ],
    ["upsert STABLE", sql(`ALTER FUNCTION ${FN.up} STABLE`), [A_ATRIB]],
    [
      "sobrecarga da v23",
      sql(
        "CREATE FUNCTION public.create_marketplace_order_v23(p_isca_47 text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$",
      ),
      [A_ATRIB],
    ],
    [
      "EXECUTE da v23 aberto a PUBLIC",
      sql(`GRANT EXECUTE ON FUNCTION ${FN.v23} TO PUBLIC`),
      [A_EXEC],
    ],
    [
      "EXECUTE da upsert aberto a anon",
      sql(`GRANT EXECUTE ON FUNCTION ${FN.up} TO anon`),
      [A_EXEC],
    ],
    [
      "EXECUTE da v23 fechado a anon (a compra do convidado)",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN.v23} FROM anon`),
      [A_EXEC],
    ],
    [
      "EXECUTE da v24 fechado a authenticated",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN.v24} FROM authenticated`),
      [A_EXEC],
    ],
    [
      "EXECUTE da upsert fechado a service_role",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN.up} FROM service_role`),
      [A_EXEC],
    ],
    ["v23 AUSENTE", sql(`DROP FUNCTION ${FN.v23}`), [A_V23, A_ATRIB, A_EXEC]],
    [
      "CHECK do prazo ausente",
      sql(
        "ALTER TABLE public.store_config DROP CONSTRAINT store_config_local_delivery_days_check",
      ),
      [A_COLS],
    ],
    [
      "CHECK do prazo com outro teto (31)",
      em(
        sql(
          "ALTER TABLE public.store_config DROP CONSTRAINT store_config_local_delivery_days_check",
        ),
        sql(
          "ALTER TABLE public.store_config ADD CONSTRAINT store_config_local_delivery_days_check CHECK (local_delivery_days BETWEEN 0 AND 31)",
        ),
      ),
      [A_COLS],
    ],
    [
      "prazo sem DEFAULT",
      sql(
        "ALTER TABLE public.store_config ALTER COLUMN local_delivery_days DROP DEFAULT",
      ),
      [A_COLS],
    ],
    [
      "modo sem NOT NULL",
      sql(
        "ALTER TABLE public.store_config ALTER COLUMN local_delivery_enabled DROP NOT NULL",
      ),
      [A_COLS],
    ],
    [
      "trigger AUSENTE",
      sql(
        "DROP TRIGGER store_config_so_retirada_exige_retirada ON public.store_config",
      ),
      [A_TRIG],
    ],
    [
      "trigger DESLIGADA",
      sql(
        "ALTER TABLE public.store_config DISABLE TRIGGER store_config_so_retirada_exige_retirada",
      ),
      [A_TRIG],
    ],
    [
      "trigger só no UPDATE",
      em(
        sql(
          "DROP TRIGGER store_config_so_retirada_exige_retirada ON public.store_config",
        ),
        sql(
          "CREATE TRIGGER store_config_so_retirada_exige_retirada BEFORE UPDATE ON public.store_config FOR EACH ROW EXECUTE FUNCTION public.store_config_so_retirada_exige_retirada()",
        ),
      ),
      [A_TRIG],
    ],
    ["função da trigger com 1 byte a mais", maisUmByte(FNTRIG), [A_TRIG]],
    [
      "função da trigger executável por authenticated",
      sql(`GRANT EXECUTE ON FUNCTION ${FNTRIG} TO authenticated`),
      [A_TRIG],
    ],
    [
      "view sem SELECT para anon",
      sql("REVOKE SELECT ON TABLE public.v_store_config FROM anon"),
      [A_VIEW],
    ],
    [
      "view com a última coluna a menos",
      refazAView((cols) => cols.slice(0, -1)),
      [A_VIEW],
    ],
    [
      "view com as duas últimas colunas trocadas",
      refazAView((cols) => [...cols.slice(0, -2), cols.at(-1), cols.at(-2)]),
      [A_VIEW],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosA) {
    const s = await noEstado(em(DEPOIS, defeito), [A]);
    await exigirReprovadas(A, `47a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    `47a: ${negativosA.length} negativos (corpo +1 byte nos três, atributos de quatro jeitos, EXECUTE aberto/fechado por papel, função ausente, CHECK ausente/trocada, default e NOT NULL, trigger ausente/desligada/só UPDATE/função alterada/executável, view sem papel/sem coluna/fora de ordem) — cada defeito reprova a SUA linha e leva o portão a NEGATIVA (a linha de controle não tem negativo local: o catálogo é legível por todo papel)`,
  );

  // a 47b
  const negativosB = [
    ["v23 com 1 byte a mais", maisUmByte(FN.v23), [B_V23]],
    ["v24 com 1 byte a mais", maisUmByte(FN.v24), [B_V24]],
    ["upsert com 1 byte a mais", maisUmByte(FN.up), [B_UP]],
    [
      "v23 SECURITY INVOKER",
      sql(`ALTER FUNCTION ${FN.v23} SECURITY INVOKER`),
      [B_ATRIB],
    ],
    [
      "sobrecarga da upsert",
      sql(
        "CREATE FUNCTION public.upsert_store_config(p_isca_47 text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$",
      ),
      [B_ATRIB],
    ],
    [
      "EXECUTE da v24 aberto a PUBLIC",
      sql(`GRANT EXECUTE ON FUNCTION ${FN.v24} TO PUBLIC`),
      [B_EXEC],
    ],
    [
      "EXECUTE da upsert aberto a anon",
      sql(`GRANT EXECUTE ON FUNCTION ${FN.up} TO anon`),
      [B_EXEC],
    ],
    [
      "EXECUTE da v24 fechado a anon",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN.v24} FROM anon`),
      [B_EXEC],
    ],
    [
      "EXECUTE da v23 fechado a authenticated",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN.v23} FROM authenticated`),
      [B_EXEC],
    ],
    ["upsert AUSENTE", sql(`DROP FUNCTION ${FN.up}`), [B_UP, B_ATRIB, B_EXEC]],
    [
      "a coluna do modo já existe",
      sql(
        "ALTER TABLE public.store_config ADD COLUMN local_delivery_enabled boolean NOT NULL DEFAULT true",
      ),
      [B_AUSENCIA],
    ],
    [
      "a função da trigger já existe",
      sql(
        "CREATE FUNCTION public.store_config_so_retirada_exige_retirada() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
      ),
      [B_AUSENCIA],
    ],
    [
      "a view ganhou uma coluna (e a coluna existe)",
      em(
        sql(
          "ALTER TABLE public.store_config ADD COLUMN local_delivery_enabled boolean NOT NULL DEFAULT true",
        ),
        refazAView((cols) => [...cols, "local_delivery_enabled"]),
      ),
      [B_AUSENCIA, B_VIEW],
    ],
    [
      "is_local_cep(text, text, text) ausente",
      sql(
        "ALTER FUNCTION public.is_local_cep(text, text, text) RENAME TO is_local_cep_isca_47",
      ),
      [B_LIDAS],
    ],
    [
      "store_address renomeada (coluna ausente)",
      sql(
        "ALTER TABLE public.store_config RENAME COLUMN store_address TO store_address_isca_47",
      ),
      [B_LIDAS],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosB) {
    const s = await noEstado(em(ANTES, defeito), [B]);
    await exigirReprovadas(B, `47b com ${rotulo}`, s[B], esperadas);
  }
  ok(
    `47b: ${negativosB.length} negativos (corpo +1 byte nos três, atributo, sobrecarga, EXECUTE aberto/fechado, função ausente, coluna/função da trigger que já existem, view com coluna a mais, is_local_cep e store_address ausentes) reprovam a linha delas e levam o portão a NEGATIVA`,
  );

  // (4) mutantes do texto
  const mutantes = [
    [
      "47a com o md5 do corpo da v23 trocado",
      A,
      trocarNaConsulta(SQL[A], `'${HASH_NOVO.v23}'`, `'${"0".repeat(32)}'`),
      DEPOIS,
      "positivo",
    ],
    [
      "47b com o md5 vigente da v24 trocado",
      B,
      trocarNaConsulta(SQL[B], `'${HASH_VIGENTE.v24}'`, `'${"0".repeat(32)}'`),
      ANTES,
      "positivo",
    ],
    [
      "47a cega ao EXECUTE de anon",
      A,
      trocarNaConsulta(
        SQL[A],
        "ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec",
        "ELSE v.anon_esperado END AS anon_exec",
      ),
      em(DEPOIS, sql(`REVOKE EXECUTE ON FUNCTION ${FN.v23} FROM anon`)),
      "negativo",
    ],
    [
      "47b cega ao EXECUTE de authenticated",
      B,
      trocarNaConsulta(
        SQL[B],
        "ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec",
        "ELSE true END AS auth_exec",
      ),
      em(ANTES, sql(`REVOKE EXECUTE ON FUNCTION ${FN.v23} FROM authenticated`)),
      "negativo",
    ],
    [
      "47a sem olhar a CHECK do prazo",
      A,
      trocarNaConsulta(
        SQL[A],
        "WHEN (SELECT n FROM colunas) = 2 AND (SELECT n FROM checagem) = 1 THEN",
        "WHEN (SELECT n FROM colunas) = 2 THEN",
      ),
      em(
        DEPOIS,
        sql(
          "ALTER TABLE public.store_config DROP CONSTRAINT store_config_local_delivery_days_check",
        ),
      ),
      "negativo",
    ],
    [
      "47a sem olhar se a trigger está ligada",
      A,
      trocarNaConsulta(
        SQL[A],
        "AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 23",
        "AND NOT t.tgisinternal",
      ),
      em(
        DEPOIS,
        sql(
          "ALTER TABLE public.store_config DISABLE TRIGGER store_config_so_retirada_exige_retirada",
        ),
      ),
      "negativo",
    ],
    [
      "47b sem olhar se as colunas novas já existem",
      B,
      trocarNaConsulta(
        SQL[B],
        "WHEN (SELECT n FROM presentes) = 0 THEN 'nenhum'",
        "WHEN true THEN 'nenhum'",
      ),
      em(
        ANTES,
        sql(
          "ALTER TABLE public.store_config ADD COLUMN local_delivery_enabled boolean NOT NULL DEFAULT true",
        ),
      ),
      "negativo",
    ],
  ];
  for (const [rotulo, consulta, sqlMutante, montar, tipo] of mutantes) {
    const s = await noEstado(montar, [consulta, sqlMutante]);
    const real = s[consulta];
    const mutante = s[sqlMutante];
    let pego = false;
    try {
      if (tipo === "positivo") {
        await exigirPositiva(consulta, `mutante ${rotulo}`, mutante);
      } else {
        assert.deepEqual(
          reprovadas(mutante),
          reprovadas(real),
          `mutante ${rotulo}`,
        );
      }
    } catch (e) {
      pego = true;
      assert.ok(e instanceof assert.AssertionError, String(e));
    }
    assert.ok(pego, `MUTANTE SOBREVIVEU: ${rotulo}`);
    if (tipo === "negativo")
      assert.ok(
        reprovadas(mutante).length < reprovadas(real).length,
        `${rotulo}: o mutante não afrouxou nada`,
      );
  }
  ok(
    `MUTANTES do texto das consultas (${mutantes.length}): md5 do corpo e md5 vigente trocados, EXECUTE cego em cada uma, CHECK, trigger ligada e a ausência das colunas não olhadas — todos pegos`,
  );

  // (5) as antecessoras seguem POSITIVAS com a migration no ar e desfeita
  {
    const linha = (consulta, trecho) => L(consulta, trecho);
    const casos = [
      [
        A31,
        [
          linha(A31, "create_marketplace_order_v23: corpo"),
          linha(A31, "create_marketplace_order_v24: corpo"),
        ],
        FN.v24,
        FN.v23,
      ],
      [A37, [linha(A37, "create_marketplace_order_v24: corpo")], FN.v24, null],
      [A40, [linha(A40, "upsert_store_config: corpo")], FN.up, null],
      [E8, [linha(E8, "corpo final upsert_store_config")], FN.up, null],
    ];
    for (const [consulta, linhasDoCorpo, fn1, fn2] of casos) {
      let s = await noEstado(DEPOIS, [consulta]);
      await exigirPositiva(consulta, `${consulta} com a 44 no ar`, s[consulta]);
      s = await noEstado(ANTES_COMUM, [consulta]);
      await exigirPositiva(
        consulta,
        `${consulta} com a 44 desfeita`,
        s[consulta],
      );
      // corpo estranho (a função desta consulta): reprova SÓ a linha do corpo
      const reprova = consulta === A31 ? [linhasDoCorpo[1]] : linhasDoCorpo;
      s = await noEstado(em(DEPOIS, maisUmByte(fn1)), [consulta]);
      await exigirReprovadas(
        consulta,
        `${consulta} com corpo estranho`,
        s[consulta],
        reprova,
      );
      if (fn2) {
        s = await noEstado(em(DEPOIS, maisUmByte(fn2)), [consulta]);
        await exigirReprovadas(
          consulta,
          `${consulta} com corpo estranho (v23)`,
          s[consulta],
          [linhasDoCorpo[0]],
        );
      }
    }
    // a 9a prova o corpo MAIS NOVO: positiva com a 44 no ar; desfeita, reprova SÓ o corpo final do upsert
    const C9 = L(A9, "corpo final upsert_store_config");
    let s = await noEstado(DEPOIS, [A9]);
    await exigirPositiva(A9, "9a com a 44 no ar", s[A9]);
    s = await noEstado(ANTES_COMUM, [A9]);
    await exigirReprovadas(A9, "9a com a 44 desfeita", s[A9], [C9]);
  }
  ok(
    "8e, 31a, 37a e 40a seguem POSITIVAS com a 20261244 no ar e desfeita (aceitam o corpo novo como sucessor; corpo estranho reprova SÓ a linha da função); a 9a (corpo mais novo) é POSITIVA com ela no ar e reprova SÓ o corpo final do upsert_store_config desfeita",
  );

  // (6) rol fechado
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 47b julgadas pelo rol da 47a",
    );
  }
  ok(
    "rol FECHADO: resposta parcial ou o rol da outra consulta tem rol=invalido e o portão nunca a trata como POSITIVA",
  );
}

async function main() {
  PORTAO = await import(
    pathToFileURL(path.join(REPO, "scripts", "frota", "publicar-release.mjs"))
      .href
  );
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  await C.query("BEGIN");
  // A 20261350000000 (sucessora dos corpos de v23/v24) cai ANTES: ver a-compra-online-trava-posterior.cjs.
  await require("./a-compra-online-trava-posterior.cjs").desfazerCompraOnlineTravaNaTransacao(
    C,
  );
  await require("./estilo-card-frete-posterior.cjs").desfazerEstiloCardFreteNaTransacao(
    C,
  );
  await C.query("COMMIT");
  await C.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
  try {
    await C.query(`GRANT pg_read_all_data TO ${RO}`);
    await provar();
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(`\na-loja-escolhe-como-entrega-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-47", erro?.stack ? erro.stack : String(erro)),
);
