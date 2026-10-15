"use strict";

/**
 * Prova VIVA do PORTAO do lote 20261239000000 (a loja PODE declarar razao social, CNPJ/CPF e e-mail de
 * atendimento): as consultas 40a-conferir-identidade-legal-da-loja-aplicado (DEPOIS, 11 linhas) e
 * 40b-antes-identidade-legal-da-loja-base-vigente (ANTES, 10 linhas), executadas num Postgres EFEMERO como papel
 * de LEITURA (BYPASSRLS + pg_read_all_data, transacao somente leitura) e levadas ate o veredito
 * (`conferir-banco.cjs`) e ao portao (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 40a e POSITIVA com o rol EXATO de ROL_DA_40A, rol=ok; a 40b NEGATIVA
 *       reprovando EXATAMENTE as linhas do corpo, do marcador, das colunas, das CHECK e da lista de colunas da view.
 *   (2) ANTES (o rollback-manual aplicado: o corpo da 20261199, sem as tres colunas, a view de 42 colunas recriada
 *       por DROP VIEW + CREATE VIEW + GRANT ALL): a 40b e POSITIVA com o rol EXATO de ROL_DA_40B (inclusive a linha
 *       do ACL da view, a FOTOGRAFIA do que o rollback devolve); a 40a NEGATIVA nas mesmas linhas de cima.
 *   (3) UM NEGATIVO POR LINHA da 40a (cada defeito reprova a SUA linha e leva o portao a NEGATIVA): sobrecarga,
 *       corpo com 1 byte a mais, corpo sem um dos tres CASE, atributo trocado, EXECUTE aberto a PUBLIC e a anon e
 *       fechado a authenticated, coluna com default, CHECK ausente, CHECK com outra regra, CHECK nao validada, view
 *       com uma coluna a mais e uma a menos, opcao da view trocada, ACL da view (anon sem um privilegio, PUBLIC com
 *       SELECT, um papel a mais, GRANT OPTION, outro dono), funcao e view AUSENTES. A linha de controle nao tem
 *       negativo local (o catalogo e legivel por todo papel): LIMITE declarado.
 *   (4) A 40b: os mesmos defeitos nas linhas que ela mede (e a coluna e a CHECK que JA existem).
 *   (5) MUTANTES do texto das consultas (md5 trocado, marcador sempre 'sim', EXECUTE de anon sempre 'nao', o ACL da
 *       view aceitando qualquer privilegio, PUBLIC ignorado, GRANT OPTION ignorado, colunas e CHECK 'ainda nao
 *       existem' sempre verdadeiras): cada um deixa um positivo reprovar ou um negativo passar.
 *   (6) rol FECHADO: as duas consultas devolvem SO as linhas do rol, ok booleano, ok=false primeiro; resposta
 *       parcial ou o rol da outra consulta tem rol=invalido.
 *
 * Nada sai da maquina e nenhuma loja e tocada. A prova diz que as consultas DECIDEM certo, nao em que estado a
 * IKCOUS ou a Savy estao (isso so o run da consulta contra o ref).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/loja-declara-quem-e-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio; as chaves de objeto, de constantes deste arquivo. */

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
const A = "40a-conferir-identidade-legal-da-loja-aplicado";
const B = "40b-antes-identidade-legal-da-loja-base-vigente";
const SQL_A = fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8");
const SQL_B = fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const ROL = { [A]: CONF.ROL_DA_40A, [B]: CONF.ROL_DA_40B };

const NOME_39 =
  "20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const MIG39 = ler(NOME_39);
const RB39 = ler(`rollback-manual-${NOME_39}`);
const FN = "public.upsert_store_config(jsonb)";
const VISTA = "public.v_store_config";

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p40_ro_${SUF}`;
const ISCA = `p40_isca_${SUF}`;
const DONO = `p40_dono_${SUF}`;

let resultados = 0;
const ok = (msg) => {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
};
let C;
let PORTAO;

// os hashes lidos do PREFLIGHT da migration: ('public.upsert_store_config(jsonb)', 'vigente', 'desta')
function hashesDe(sql) {
  const ini = sql.indexOf(`('${FN}', '`);
  const tupla = ini < 0 ? "" : sql.slice(ini, sql.indexOf("')", ini) + 2);
  const hs = tupla.match(/[0-9a-f]{32}/g);
  assert.ok(hs && hs.length === 2, "preflight sem o par de hashes");
  return { vigente: hs[0], desta: hs[1] };
}
const P39 = hashesDe(MIG39);
const H39 = P39.desta;
const H99 = P39.vigente;
// a lista das 45 colunas da view = a SEGUNDA lista do preflight (a das 42 mais as tres)
const m45 = MIG39.match(/'(id,free_shipping_min,[^']*store_support_email)'/);
assert.ok(m45, "a lista das 45 colunas nao esta no preflight");
const COLS45 = m45[1].split(",");
assert.equal(COLS45.length, 45);
const COLS42 = COLS45.slice(0, 42);
assert.deepEqual(COLS45.slice(42), [
  "store_legal_name",
  "store_legal_document",
  "store_support_email",
]);

/** BEGIN; `montar` (dono da conexao); SET LOCAL ROLE so-leitura; as consultas; ROLLBACK. */
async function noEstado(montar, consultas = [A, B]) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    await C.query(`SET LOCAL ROLE ${RO}`);
    await C.query("SET LOCAL transaction_read_only = on");
    const saidas = {};
    for (const nome of consultas) {
      const sql = nome === A ? SQL_A : nome === B ? SQL_B : nome;
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
let relogio = Date.parse("2026-10-14T12:00:00Z");
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
  assert.equal(rows.length, ROL[consulta].length, `${rotulo}: n de linhas`);
  assert.equal(
    CONF.estruturaDoRolFechado(rows, ROL[consulta]),
    null,
    `${rotulo}: o rol fechado do codigo tem de ser EXATAMENTE o que a consulta devolveu`,
  );
  for (const r of rows) {
    assert.equal(typeof r.ok, "boolean", `${rotulo}: ok nao booleano`);
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
const hashVivo = async (c) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.h ?? null;
const DEPOIS = async (c) => {
  // a arvore inteira: a 20261239 no ar
  assert.equal(
    await hashVivo(c),
    H39,
    "o clone tem de estar com a 20261239000000 no ar",
  );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB39);
  assert.equal(
    await hashVivo(c),
    H99,
    "o rollback nao voltou ao corpo da 20261199000000",
  );
};
const definicaoDaFuncao = async (c) =>
  (await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN]))
    .rows[0].d;
const sobrecarga = async (c) => {
  await c.query(
    "CREATE FUNCTION public.upsert_store_config(p_isca_40 text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$",
  );
  const r = await c.query(
    "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'upsert_store_config' AND pronamespace = 'public'::regnamespace",
  );
  assert.equal(r.rows[0].n, 2);
};
const MARCA_DO_COMENTARIO = "-- Handle text[] casting safely";
const corpoMaisUmByte = async (c) => {
  const def = await definicaoDaFuncao(c);
  const novo = def.replace(MARCA_DO_COMENTARIO, `${MARCA_DO_COMENTARIO} `);
  assert.notEqual(novo, def);
  await c.query(novo);
  const h = await hashVivo(c);
  assert.ok(
    h !== H39 && h !== H99,
    "o corpo com 1 byte a mais tem de ser outro",
  );
};
const MARCADOR_DO_EMAIL =
  "store_support_email = CASE WHEN config_json ? 'store_support_email'";
const semUmDosCase = async (c) => {
  const def = await definicaoDaFuncao(c);
  const novo = def.replace(
    MARCADOR_DO_EMAIL,
    "store_support_email = CASE WHEN config_json ? 'store_support_emaiL'",
  );
  assert.notEqual(novo, def);
  await c.query(novo);
};
const atributoTrocado = async (c) => {
  await c.query(`ALTER FUNCTION ${FN} SECURITY INVOKER`);
};
const funcaoAusente = async (c) => {
  await c.query(`DROP FUNCTION ${FN}`);
};
const colunaComDefault = async (c) => {
  await c.query(
    "ALTER TABLE public.store_config ALTER COLUMN store_legal_name SET DEFAULT 'x'",
  );
};
const checkAusente = async (c) => {
  await c.query(
    "ALTER TABLE public.store_config DROP CONSTRAINT store_config_store_legal_name_check",
  );
};
const REGRA_DO_NOME =
  "CHECK (store_legal_name IS NULL OR char_length(btrim(store_legal_name)) BETWEEN 1 AND";
const checkComOutraRegra = async (c) => {
  await c.query(
    "ALTER TABLE public.store_config DROP CONSTRAINT store_config_store_legal_name_check",
  );
  await c.query(
    `ALTER TABLE public.store_config ADD CONSTRAINT store_config_store_legal_name_check ${REGRA_DO_NOME} 500)`,
  );
};
const checkNaoValidada = async (c) => {
  await c.query(
    "ALTER TABLE public.store_config DROP CONSTRAINT store_config_store_legal_name_check",
  );
  await c.query(
    `ALTER TABLE public.store_config ADD CONSTRAINT store_config_store_legal_name_check ${REGRA_DO_NOME} 200) NOT VALID`,
  );
};
const viewComUmaColunaAMais = async (c) => {
  const def = (
    await c.query("SELECT pg_get_viewdef($1::regclass, true) AS d", [VISTA])
  ).rows[0].d.replace(/;\s*$/, "");
  await c.query(
    `CREATE OR REPLACE VIEW ${VISTA} WITH (security_invoker=on) AS SELECT v.*, 1 AS isca_40 FROM (${def}) v`,
  );
};
/** Recria a view SEM a ULTIMA coluna da lista (mesma ordem), com o ACL de sempre (GRANT ALL). */
const viewSemUmaColuna = (colunas) => async (c) => {
  const lista = colunas.slice(0, -1);
  assert.equal(lista.length, colunas.length - 1);
  await c.query(`DROP VIEW ${VISTA}`);
  await c.query(
    `CREATE VIEW ${VISTA} WITH (security_invoker=on) AS SELECT ${lista.join(", ")} FROM store_config WHERE id = 1`,
  );
  await c.query(
    `GRANT ALL ON TABLE ${VISTA} TO anon, authenticated, service_role`,
  );
};
const viewAusente = async (c) => {
  await c.query(`DROP VIEW ${VISTA}`);
};
const opcaoDaViewTrocada = async (c) => {
  await c.query(`ALTER VIEW ${VISTA} SET (security_invoker = off)`);
};
const aclDaView = [
  [
    "anon sem um privilegio",
    (c) => c.query(`REVOKE INSERT ON TABLE ${VISTA} FROM anon`),
  ],
  [
    "PUBLIC com SELECT",
    (c) => c.query(`GRANT SELECT ON TABLE ${VISTA} TO PUBLIC`),
  ],
  [
    "um papel a mais",
    async (c) => {
      await c.query(`CREATE ROLE ${ISCA} NOLOGIN`);
      await c.query(`GRANT SELECT ON TABLE ${VISTA} TO ${ISCA}`);
    },
  ],
  [
    "GRANT OPTION",
    (c) =>
      c.query(
        `GRANT SELECT ON TABLE ${VISTA} TO authenticated WITH GRANT OPTION`,
      ),
  ],
  [
    "outro dono",
    async (c) => {
      await c.query(`CREATE ROLE ${DONO} NOLOGIN`);
      await c.query(`ALTER VIEW ${VISTA} OWNER TO ${DONO}`);
    },
  ],
];
const em =
  (...passos) =>
  async (c) => {
    for (const p of passos) await p(c);
  };

function trocar(sql, de, para) {
  assert.ok(sql.includes(de), `o trecho a mutar nao existe: ${de}`);
  return sql.replace(de, () => para);
}

async function provar() {
  const ITENS_A = ROL[A];
  const ITENS_B = ROL[B];
  const achar = (itens, trecho) => {
    const l = itens.filter((i) => i.includes(trecho));
    assert.equal(
      l.length,
      1,
      `esperava 1 item com "${trecho}", achei ${l.length}`,
    );
    return l[0];
  };
  const A_SOBRE = achar(ITENS_A, "sobrecargas");
  const A_CORPO = achar(ITENS_A, "corpo e o da 20261239000000");
  const A_MARCADOR = achar(ITENS_A, "so grava razao social");
  const A_ATRIB = achar(ITENS_A, "atributos de sempre");
  const A_EXEC = achar(ITENS_A, "EXECUTE fechado");
  const A_COLUNAS = achar(ITENS_A, "sao text, nulos e sem default");
  const A_CHECKS = achar(ITENS_A, "as tres CHECK de forma existem");
  const A_VISTA_COLS = achar(ITENS_A, "as 45 colunas");
  const A_VISTA_OPC = achar(ITENS_A, "opcoes de sempre");
  const A_VISTA_ACL = achar(ITENS_A, "ACL de sempre");
  const B_SOBRE = achar(ITENS_B, "sobrecargas");
  const B_CORPO = achar(ITENS_B, "corpo e o da 20261199000000");
  const B_MARCADOR = achar(ITENS_B, "ainda NAO grava");
  const B_ATRIB = achar(ITENS_B, "atributos de sempre");
  const B_COLUNAS = achar(ITENS_B, "e-mail ainda NAO existem");
  const B_CHECKS = achar(ITENS_B, "CHECK de forma ainda NAO existem");
  const B_VISTA_COLS = achar(ITENS_B, "as 42 colunas");
  const B_VISTA_OPC = achar(ITENS_B, "opcoes de sempre");
  const B_VISTA_ACL = achar(ITENS_B, "ACL que o rollback devolve");
  assert.equal(ITENS_A.length, 11);
  assert.equal(ITENS_B.length, 10);
  assert.notEqual(
    B_COLUNAS,
    B_CHECKS,
    "as duas linhas 'ainda NAO' sao distintas",
  );

  // o que a 40b reprova DEPOIS e o que a 40a reprova ANTES (o resto do rol nao depende do lado)
  const B_DEPOIS = [B_CORPO, B_MARCADOR, B_COLUNAS, B_CHECKS, B_VISTA_COLS];
  const A_ANTES = [A_CORPO, A_MARCADOR, A_COLUNAS, A_CHECKS, A_VISTA_COLS];

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "40a depois", s[A]);
    await exigirReprovadas(B, "40b depois", s[B], B_DEPOIS);
  }
  ok(
    "DEPOIS (a 20261239 no ar): 40a POSITIVA (rol exato, rol=ok, portao POSITIVA); 40b NEGATIVA so no corpo, no marcador, nas colunas, nas CHECK e na lista de colunas da view (o ACL e as opcoes da view seguem iguais)",
  );

  // (2) ANTES
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "40b antes", s[B]);
    await exigirReprovadas(A, "40a antes", s[A], A_ANTES);
  }
  ok(
    "ANTES (o rollback aplicado: corpo da 20261199, sem as colunas, view de 42 colunas recriada por DROP+CREATE+GRANT ALL): 40b POSITIVA com o ACL da view que o rollback devolve; 40a NEGATIVA so nas mesmas cinco linhas",
  );

  // (3) um negativo por linha da 40a (a partir do DEPOIS)
  const negativosA = [
    ["sobrecarga com outra assinatura", sobrecarga, [A_SOBRE]],
    ["corpo com 1 byte a mais", corpoMaisUmByte, [A_CORPO]],
    ["corpo sem um dos tres CASE", semUmDosCase, [A_CORPO, A_MARCADOR]],
    ["atributo trocado (SECURITY INVOKER)", atributoTrocado, [A_ATRIB]],
    [
      "EXECUTE aberto a PUBLIC",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
      [A_EXEC],
    ],
    [
      "EXECUTE aberto a anon",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
      [A_EXEC],
    ],
    [
      "EXECUTE fechado a authenticated",
      (c) => c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
      [A_EXEC],
    ],
    ["coluna com default", colunaComDefault, [A_COLUNAS]],
    ["CHECK ausente", checkAusente, [A_CHECKS]],
    [
      "CHECK com outra regra (500 no lugar de 200)",
      checkComOutraRegra,
      [A_CHECKS],
    ],
    ["CHECK nao validada", checkNaoValidada, [A_CHECKS]],
    ["view com uma coluna a mais", viewComUmaColunaAMais, [A_VISTA_COLS]],
    ["view com uma coluna a menos", viewSemUmaColuna(COLS45), [A_VISTA_COLS]],
    ["opcao da view trocada", opcaoDaViewTrocada, [A_VISTA_OPC]],
    ...aclDaView.map(([rotulo, defeito]) => [
      `ACL da view: ${rotulo}`,
      defeito,
      [A_VISTA_ACL],
    ]),
    ["view AUSENTE", viewAusente, [A_VISTA_COLS, A_VISTA_OPC, A_VISTA_ACL]],
    [
      "funcao AUSENTE",
      funcaoAusente,
      [A_SOBRE, A_CORPO, A_MARCADOR, A_ATRIB, A_EXEC],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosA) {
    const s = await noEstado(em(DEPOIS, defeito), [A]);
    await exigirReprovadas(A, `40a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    `40a: um negativo por linha (${negativosA.length} defeitos: sobrecarga, corpo +1 byte, corpo sem um CASE, atributo, EXECUTE de PUBLIC/anon/authenticated, coluna com default, CHECK ausente/outra regra/nao validada, view com coluna a mais e a menos, opcao da view, ACL da view em cinco formas, view e funcao ausentes) — cada defeito reprova a SUA linha e leva o portao a NEGATIVA (a linha de controle nao tem negativo local)`,
  );

  // (4) a 40b (a partir do ANTES)
  const negativosB = [
    ["sobrecarga com outra assinatura", sobrecarga, [B_SOBRE]],
    ["corpo com 1 byte a mais", corpoMaisUmByte, [B_CORPO]],
    ["atributo trocado (SECURITY INVOKER)", atributoTrocado, [B_ATRIB]],
    [
      "uma das colunas JA existe",
      (c) =>
        c.query(
          "ALTER TABLE public.store_config ADD COLUMN store_legal_name text",
        ),
      [B_COLUNAS],
    ],
    [
      "uma das CHECK JA existe",
      (c) =>
        c.query(
          "ALTER TABLE public.store_config ADD CONSTRAINT store_config_store_legal_name_check CHECK (true)",
        ),
      [B_CHECKS],
    ],
    ["view com uma coluna a mais", viewComUmaColunaAMais, [B_VISTA_COLS]],
    ["view com uma coluna a menos", viewSemUmaColuna(COLS42), [B_VISTA_COLS]],
    ["opcao da view trocada", opcaoDaViewTrocada, [B_VISTA_OPC]],
    ...aclDaView.map(([rotulo, defeito]) => [
      `ACL da view: ${rotulo}`,
      defeito,
      [B_VISTA_ACL],
    ]),
    ["view AUSENTE", viewAusente, [B_VISTA_COLS, B_VISTA_OPC, B_VISTA_ACL]],
    ["funcao AUSENTE", funcaoAusente, [B_SOBRE, B_CORPO, B_MARCADOR, B_ATRIB]],
  ];
  for (const [rotulo, defeito, esperadas] of negativosB) {
    const s = await noEstado(em(ANTES, defeito), [B]);
    await exigirReprovadas(B, `40b com ${rotulo}`, s[B], esperadas);
  }
  // o corpo da 40b com 1 byte a mais: o marcador segue 'nao' (so o md5 reprova); ja coberto acima.
  ok(
    `40b: ${negativosB.length} defeitos (sobrecarga, corpo +1 byte, atributo, coluna e CHECK que ja existem, view com coluna a mais e a menos, opcao da view, ACL da view em cinco formas, view e funcao ausentes) reprovam a linha delas, portao NEGATIVA`,
  );

  // (5) mutantes do texto
  const ZERO = "0".repeat(32);
  const mutantes = [
    [
      "40a com o md5 do corpo novo trocado",
      A,
      trocar(SQL_A, `'${H39}'`, `'${ZERO}'`),
      DEPOIS,
      "positivo",
    ],
    [
      "40b com o md5 do vigente trocado",
      B,
      trocar(SQL_B, `'${H99}'`, `'${ZERO}'`),
      ANTES,
      "positivo",
    ],
    [
      "40a com o marcador sempre 'sim'",
      A,
      trocar(
        SQL_A,
        "THEN 'sim' ELSE 'nao' END AS marcador",
        "THEN 'sim' ELSE 'sim' END AS marcador",
      ),
      ANTES,
      "negativo",
    ],
    [
      "40a com o EXECUTE de anon sempre 'nao'",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN false THEN 'sim'",
      ),
      em(DEPOIS, (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`)),
      "negativo",
    ],
    [
      "40a com o ACL da view aceitando qualquer privilegio como ALL",
      A,
      trocar(
        SQL_A,
        "WHEN p.privs = (SELECT privs FROM tudo_de_tabela) THEN 'ALL'",
        "WHEN p.privs IS NOT NULL THEN 'ALL'",
      ),
      em(DEPOIS, (c) => c.query(`REVOKE INSERT ON TABLE ${VISTA} FROM anon`)),
      "negativo",
    ],
    [
      "40b com o ACL da view aceitando qualquer privilegio como ALL",
      B,
      trocar(
        SQL_B,
        "WHEN p.privs = (SELECT privs FROM tudo_de_tabela) THEN 'ALL'",
        "WHEN p.privs IS NOT NULL THEN 'ALL'",
      ),
      em(ANTES, (c) => c.query(`REVOKE INSERT ON TABLE ${VISTA} FROM anon`)),
      "negativo",
    ],
    [
      "40a ignorando PUBLIC na view",
      A,
      trocar(
        SQL_A,
        "CASE WHEN EXISTS (SELECT 1 FROM aclexplode(v.acl) g WHERE g.grantee = 0) THEN 'sim' ELSE 'nao' END",
        "'nao'",
      ),
      em(DEPOIS, (c) => c.query(`GRANT SELECT ON TABLE ${VISTA} TO PUBLIC`)),
      "negativo",
    ],
    [
      "40b ignorando o GRANT OPTION na view",
      B,
      trocar(
        SQL_B,
        "WHERE g.is_grantable AND g.grantee <> v.relowner",
        "WHERE false",
      ),
      em(ANTES, (c) =>
        c.query(
          `GRANT SELECT ON TABLE ${VISTA} TO authenticated WITH GRANT OPTION`,
        ),
      ),
      "negativo",
    ],
    [
      "40b com 'as colunas ainda nao existem' sempre verdadeira",
      B,
      trocar(
        SQL_B,
        "COALESCE((SELECT c.def FROM colunas_vivas c), 'nenhuma')",
        "'nenhuma'",
      ),
      em(ANTES, (c) =>
        c.query(
          "ALTER TABLE public.store_config ADD COLUMN store_legal_name text",
        ),
      ),
      "negativo",
    ],
    [
      "40b com 'as CHECK ainda nao existem' sempre verdadeira",
      B,
      trocar(
        SQL_B,
        "COALESCE((SELECT c.def FROM checks_vivas c), 'nenhuma')",
        "'nenhuma'",
      ),
      em(ANTES, (c) =>
        c.query(
          "ALTER TABLE public.store_config ADD CONSTRAINT store_config_store_legal_name_check CHECK (true)",
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
        // um negativo cujo mutante deixa de reprovar o que a consulta real reprova
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
        `${rotulo}: o mutante nao afrouxou nada`,
      );
  }
  ok(
    `MUTANTES do texto das consultas (${mutantes.length}): md5 do corpo novo e do vigente trocados, marcador sempre 'sim', EXECUTE de anon sempre 'nao', o ACL da view aceitando qualquer privilegio (nas duas consultas), PUBLIC ignorado, GRANT OPTION ignorado, 'colunas ainda nao existem' e 'CHECK ainda nao existem' sempre verdadeiras — todos pegos`,
  );

  // (6) rol fechado: resposta parcial ou rol de outra consulta nunca e POSITIVA
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 40b julgadas pelo rol da 40a",
    );
  }
  ok(
    "rol FECHADO: resposta parcial ou o rol da outra consulta tem rol=invalido e o portao nunca a trata como POSITIVA",
  );
}

async function main() {
  PORTAO = await import(
    pathToFileURL(path.join(REPO, "scripts", "frota", "publicar-release.mjs"))
      .href
  );
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  await C.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
  try {
    await C.query(`GRANT pg_read_all_data TO ${RO}`);
    await provar();
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(`\nloja-declara-quem-e-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-40", erro?.stack ? erro.stack : String(erro)),
);
