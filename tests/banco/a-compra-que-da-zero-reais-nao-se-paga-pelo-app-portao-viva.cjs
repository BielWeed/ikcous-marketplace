"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261236000000 (a compra que dá R$ 0,00 não se paga pelo app): as consultas
 * 37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado (DEPOIS, 6 linhas) e
 * 37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente (ANTES, 5 linhas), executadas num Postgres
 * EFÊMERO como papel de LEITURA (BYPASSRLS + pg_read_all_data, transação somente leitura) e levadas até o
 * veredito (`conferir-banco.cjs`) e ao portão (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 37a é POSITIVA com o rol EXATO de ROL_DA_37A, rol=ok; a 37b NEGATIVA
 *       reprovando EXATAMENTE as duas linhas do corpo e do marcador.
 *   (2) ANTES (o rollback-manual aplicado, o corpo da 20261229000000): a 37b é POSITIVA com o rol EXATO de
 *       ROL_DA_37B; a 37a NEGATIVA reprovando EXATAMENTE o corpo e o marcador.
 *   (3) UM CORPO QUE NINGUÉM MEDIU (o da 20261174000000, a loja sem o lote da 20261229000000): a 37b NÃO é
 *       POSITIVA (reprova a linha do corpo) e a 37a reprova o corpo e o marcador: o portão nunca imprime o apply
 *       da 37 em cima de uma base que ninguém mediu.
 *   (4) UM NEGATIVO POR LINHA da 37a (cada defeito reprova a SUA linha e leva o portão a NEGATIVA): sobrecarga
 *       com outra assinatura, corpo com 1 byte a mais, corpo sem o identificador da recusa, corpo com a
 *       condição afrouxada (`<= 0` trocado por `< 0`), atributo trocado (SECURITY INVOKER), EXECUTE aberto a
 *       PUBLIC, a anon e a service_role, e fechado a authenticated, função AUSENTE. A linha de controle não tem
 *       negativo local (o catálogo é legível por todo papel): LIMITE declarado.
 *   (5) A 37b: sobrecarga, corpo com 1 byte a mais, atributo trocado e função ausente reprovam a linha delas.
 *   (6) MUTANTES do texto das consultas (o md5 do corpo novo trocado na 37a, o do vigente na 37b, o marcador
 *       sempre "sim" na 37a e sempre "nao" na 37b, o EXECUTE de anon e o de service_role sempre "nao"): cada
 *       um deixa um positivo reprovar ou um negativo passar.
 *   (7) rol FECHADO: as duas consultas devolvem SÓ as linhas do rol, ok booleano, ok=false primeiro; resposta
 *       parcial ou rol de outra consulta nunca é POSITIVA.
 *   (8) CADEIA com a 31a (o lote da 20261229000000): com o corpo NOVO no ar, a 31a segue POSITIVA (aceita o
 *       sucessor só na v24); no corpo da 20261174000000 ela reprova.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a
 * IKCOUS ou a Savy estão (isso só o run da consulta contra o ref). O COMPORTAMENTO da recusa (antes do pedido,
 * do estoque e do cupom) é de tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório; as chaves de objeto, de constantes deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  desfazerEntregaNaCidadeNaTransacao,
} = require("./a-loja-escolhe-como-entrega-posterior.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const A = "37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado";
const B = "37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente";
const A31 = "31a-conferir-endereco-da-compra-fica-no-pedido";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL_A = lerConsulta(A);
const SQL_B = lerConsulta(B);
const SQL_A31 = lerConsulta(A31);
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const ROL = {
  [A]: CONF.ROL_DA_37A,
  [B]: CONF.ROL_DA_37B,
  [A31]: CONF.ROL_DA_31A,
};

const NOME_29 = "20261229000000_o_endereco_da_compra_fica_no_pedido.sql";
const NOME_37 =
  "20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const MIG37 = ler(NOME_37);
const RB37 = ler(`rollback-manual-${NOME_37}`);
const RB29 = ler(`rollback-manual-${NOME_29}`);
const MIG29 = ler(NOME_29);
const VIVA_174 = ler("20261174000000_formas_de_pagamento_por_loja.sql");
const FN =
  "public.create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";

const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");
/** O corpo (entre `AS $function$` e `$function$;`) de `public.<fn>(` no arquivo de uma migration. */
function corpoDe(sql, fn) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `declaracao de ${fn} nao achada`);
  const i = sql.indexOf("AS $function$", ini) + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
}
const H37 = md5(corpoDe(MIG37, "create_marketplace_order_v24"));
const H29 = md5(corpoDe(MIG29, "create_marketplace_order_v24"));
const H174 = md5(corpoDe(VIVA_174, "create_marketplace_order_v24"));

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p37_ro_${SUF}`;

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
      const sql =
        nome === A ? SQL_A : nome === B ? SQL_B : nome === A31 ? SQL_A31 : nome;
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
const hashVivo = async (c) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.h ?? null;
const DEPOIS = async (c) => {
  // a árvore inteira: a 37 no ar (o corpo desta migration)
  assert.equal(
    await hashVivo(c),
    H37,
    "o clone tem de estar com a 20261236000000 no ar",
  );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB37);
  assert.equal(
    await hashVivo(c),
    H29,
    "o rollback não voltou ao corpo da 20261229000000",
  );
};
/** A loja que NÃO recebeu nem o lote da 20261229000000: o corpo da 20261174000000 (a base que ninguém mediu). */
const NO_CORPO_DA_174 = async (c) => {
  await ANTES(c);
  await c.query(RB29);
  assert.equal(
    await hashVivo(c),
    H174,
    "o rollback da 20261229000000 não voltou ao corpo da 20261174000000",
  );
};
const sobrecarga = async (c) => {
  await c.query(
    "CREATE FUNCTION public.create_marketplace_order_v24(p_isca_37 text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$",
  );
  const r = await c.query(
    "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'create_marketplace_order_v24' AND pronamespace = 'public'::regnamespace",
  );
  assert.equal(r.rows[0].n, 2);
};
/** Recria a função viva com `muda(def)` aplicado à definição (mesma declaração, ACL preservada pelo CREATE OR REPLACE). */
const redefinir = (rotulo, muda) => async (c) => {
  const antes = await hashVivo(c);
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN])
  ).rows[0].d;
  const novo = muda(def);
  assert.notEqual(novo, def, `${rotulo}: o trecho a mexer não existe no corpo`);
  await c.query(novo);
  assert.notEqual(await hashVivo(c), antes, `${rotulo}: o corpo não mudou`);
};
/** UM byte a mais num comentário do corpo (o marcador e os atributos ficam como estão). */
const corpoMaisUmByte = redefinir("1 byte a mais", (def) =>
  def.replace("-- 1.", "--  1."),
);
const semOIdentificador = redefinir("sem o identificador", (def) =>
  def.replaceAll(
    "pedido_sem_valor_a_pagar_pelo_app",
    "pedido_sem_valor_pelo_app",
  ),
);
const condicaoAfrouxada = redefinir("condição afrouxada", (def) =>
  def.replace(
    "IF p_payment_method = 'online' AND round(v_calculated_total, 2) <= 0 THEN",
    "IF p_payment_method = 'online' AND round(v_calculated_total, 2) < 0 THEN",
  ),
);
const atributoTrocado = async (c) => {
  await c.query(`ALTER FUNCTION ${FN} SECURITY INVOKER`);
};
const ausente = async (c) => {
  await c.query(`DROP FUNCTION ${FN}`);
};
const em =
  (...passos) =>
  async (c) => {
    for (const p of passos) await p(c);
  };

function trocar(sql, de, para) {
  assert.equal(
    sql.split(de).length - 1,
    1,
    `o trecho a mutar tem de aparecer UMA vez: ${de}`,
  );
  return sql.replace(de, () => para);
}

async function provar() {
  // os hashes do portão são os da migration, os do pré-voo dela e os do rollback
  assert.notEqual(H37, H29);
  assert.notEqual(H29, H174);
  for (const sql of [MIG37, RB37])
    for (const h of [H29, H37]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(SQL_A.includes(`'${H37}'`), "37a cita o md5 do corpo novo");
  assert.ok(!SQL_A.includes(H29), "37a não cita o corpo da 20261229000000");
  assert.ok(SQL_B.includes(`'${H29}'`), "37b cita o md5 do corpo de antes");
  assert.ok(!SQL_B.includes(H37), "37b não cita o corpo novo");
  assert.ok(!SQL_B.includes(H174), "37b não cita o corpo da 20261174000000");

  const ITEM_CORPO_A = ROL[A][2];
  const ITEM_MARCADOR_A = ROL[A][3];
  const ITEM_CORPO_B = ROL[B][2];
  const ITEM_MARCADOR_B = ROL[B][3];
  assert.match(ITEM_CORPO_A, /corpo e o da 20261236000000/);
  assert.match(ITEM_MARCADOR_A, /recusa o pedido pelo app/);
  assert.match(ITEM_CORPO_B, /corpo e o da 20261229000000/);
  assert.match(ITEM_MARCADOR_B, /ainda NAO recusa/);

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "37a depois", s[A]);
    await exigirReprovadas(B, "37b depois", s[B], [
      ITEM_CORPO_B,
      ITEM_MARCADOR_B,
    ]);
  }
  ok(
    "DEPOIS (a 20261236 no ar): 37a POSITIVA (rol exato, rol=ok, portão POSITIVA); 37b NEGATIVA só no corpo e no marcador",
  );

  // (2) ANTES
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "37b antes", s[B]);
    await exigirReprovadas(A, "37a antes", s[A], [
      ITEM_CORPO_A,
      ITEM_MARCADOR_A,
    ]);
  }
  ok(
    "ANTES (o corpo da 20261229): 37b POSITIVA; 37a NEGATIVA só no corpo e no marcador",
  );

  // (3) a base que ninguém mediu: o corpo da 20261174
  {
    const s = await noEstado(NO_CORPO_DA_174);
    await exigirReprovadas(B, "37b no corpo da 174", s[B], [ITEM_CORPO_B]);
    await exigirReprovadas(A, "37a no corpo da 174", s[A], [
      ITEM_CORPO_A,
      ITEM_MARCADOR_A,
    ]);
  }
  ok(
    "no corpo da 20261174 (sem o lote da 20261229): 37b NEGATIVA na linha do corpo (o portão não imprime o apply em cima de uma base que ninguém mediu); 37a NEGATIVA",
  );

  // (4) um negativo por linha da 37a
  const ITENS_A = ROL[A];
  const linhaDe = (nome) => ITENS_A.find((i) => i.includes(nome));
  const negativosA = [
    ["sobrecarga com outra assinatura", sobrecarga, [linhaDe("sobrecargas")]],
    ["corpo com 1 byte a mais", corpoMaisUmByte, [ITEM_CORPO_A]],
    [
      "corpo sem o identificador da recusa",
      semOIdentificador,
      [ITEM_CORPO_A, ITEM_MARCADOR_A],
    ],
    [
      "condição da recusa afrouxada (< 0)",
      condicaoAfrouxada,
      [ITEM_CORPO_A, ITEM_MARCADOR_A],
    ],
    [
      "atributo trocado (SECURITY INVOKER)",
      atributoTrocado,
      [linhaDe("atributos")],
    ],
    [
      "EXECUTE aberto a PUBLIC",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
      [linhaDe("EXECUTE")],
    ],
    [
      "EXECUTE fechado a anon",
      (c) => c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM anon`),
      [linhaDe("EXECUTE")],
    ],
    [
      "EXECUTE fechado a service_role",
      (c) => c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`),
      [linhaDe("EXECUTE")],
    ],
    [
      "EXECUTE fechado a authenticated",
      (c) => c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
      [linhaDe("EXECUTE")],
    ],
    ["função AUSENTE", ausente, ITENS_A.slice(1)],
  ];
  for (const [rotulo, defeito, esperadas] of negativosA) {
    const s = await noEstado(em(DEPOIS, defeito), [A]);
    await exigirReprovadas(A, `37a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    "37a: um negativo por linha (sobrecarga, corpo +1 byte, sem o identificador, condição afrouxada, atributo, EXECUTE de PUBLIC aberto e de anon/service_role/authenticated fechado, função ausente) — cada defeito reprova a SUA linha e leva o portão a NEGATIVA (a linha de controle não tem negativo local)",
  );

  // (5) 37b: parte do ANTES (corpo da 29); o defeito vem por cima dele
  const ITENS_B = ROL[B];
  const linhaDeB = (nome) => ITENS_B.find((i) => i.includes(nome));
  const negativosB = [
    ["sobrecarga com outra assinatura", sobrecarga, [linhaDeB("sobrecargas")]],
    ["corpo com 1 byte a mais", corpoMaisUmByte, [ITEM_CORPO_B]],
    [
      "atributo trocado (SECURITY INVOKER)",
      atributoTrocado,
      [linhaDeB("atributos")],
    ],
    ["função AUSENTE", ausente, ITENS_B.slice(1)],
  ];
  for (const [rotulo, defeito, esperadas] of negativosB) {
    const s = await noEstado(em(ANTES, defeito), [B]);
    await exigirReprovadas(B, `37b com ${rotulo}`, s[B], esperadas);
  }
  ok(
    "37b: sobrecarga, corpo +1 byte, atributo e função ausente reprovam a linha delas, portão NEGATIVA",
  );

  // (6) mutantes do texto
  const zero = "0".repeat(32);
  const REVOKE_SERVICE = (c) =>
    c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`);
  const mutantes = [
    [
      "37a com o md5 do corpo novo trocado",
      A,
      // so a linha `esperado` (a 37a repete o md5 no CASE que aceita a sucessora, a 20261244): o vivo segue o da migration
      trocar(
        SQL_A,
        `         '${H37}',
`,
        `         '${zero}',
`,
      ),
      DEPOIS,
      "positivo",
    ],
    [
      "37b com o md5 do vigente trocado",
      B,
      trocar(SQL_B, `'${H29}'`, `'${zero}'`),
      ANTES,
      "positivo",
    ],
    [
      "37a com o marcador sempre 'sim'",
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
      "37b com o marcador sempre 'nao'",
      B,
      trocar(
        SQL_B,
        "THEN 'sim' ELSE 'nao' END AS marcador",
        "THEN 'nao' ELSE 'nao' END AS marcador",
      ),
      DEPOIS,
      "negativo",
    ],
    [
      "37a com o EXECUTE de anon sempre 'sim'",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN true THEN 'sim'",
      ),
      em(DEPOIS, (c) => c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM anon`)),
      "negativo",
    ],
    [
      "37a com o EXECUTE de service_role sempre 'sim'",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN true THEN 'sim'",
      ),
      em(DEPOIS, REVOKE_SERVICE),
      "negativo",
    ],
    [
      "37a com o EXECUTE de PUBLIC sempre 'nao'",
      A,
      trocar(
        SQL_A,
        "AND a.privilege_type = 'EXECUTE') THEN 'sim' ELSE 'nao' END",
        "AND a.privilege_type = 'EXECUTE') THEN 'nao' ELSE 'nao' END",
      ),
      em(DEPOIS, (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`)),
      "negativo",
    ],
    [
      "37a com o EXECUTE de anon sempre 'nao' (positivo cai)",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN false THEN 'sim'",
      ),
      DEPOIS,
      "positivo",
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
        `${rotulo}: o mutante não afrouxou nada`,
      );
  }
  ok(
    "MUTANTES do texto das consultas: md5 do corpo novo trocado (37a), md5 do vigente trocado (37b), marcador sempre 'sim' (37a) e sempre 'nao' (37b), EXECUTE de anon, de service_role e de PUBLIC cegos — todos pegos",
  );

  // (7) rol fechado: resposta parcial ou rol de outra consulta nunca é POSITIVA
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 37b julgadas pelo rol da 37a",
    );
  }
  ok(
    "rol FECHADO: resposta parcial ou o rol da outra consulta tem rol=invalido e o portão nunca a trata como POSITIVA",
  );

  // (8) a cadeia com a 31a: com o corpo NOVO no ar a 31a segue POSITIVA; no corpo da 174 ela reprova
  {
    const depois = await noEstado(DEPOIS, [A31]);
    await exigirPositiva(A31, "31a com a 20261236 no ar", depois[A31]);
    const antes = await noEstado(ANTES, [A31]);
    await exigirPositiva(A31, "31a no corpo da 20261229", antes[A31]);
    const velho = await noEstado(NO_CORPO_DA_174, [A31]);
    exigirFormato(A31, "31a no corpo da 174", velho[A31]);
    assert.ok(reprovadas(velho[A31]).length > 0, "31a no corpo da 174 passou");
    assert.equal(
      await estadoNoPortao(A31, velho[A31]),
      "NEGATIVA",
      "31a no corpo da 174",
    );
  }
  ok(
    "CADEIA com a 31a: POSITIVA com o corpo da 20261236 no ar e com o da 20261229; NEGATIVA no corpo da 20261174",
  );
}

async function main() {
  PORTAO = await import(
    pathToFileURL(path.join(REPO, "scripts", "frota", "publicar-release.mjs"))
      .href
  );
  C = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await C.connect();
  // SUCESSORA: a 20261244000000 (a loja escolhe como entrega na cidade) redefine a v24 em cima do corpo
  // desta migration. Esta prova mede a migration dela ISOLADA, entao desfaz a sucessora (pelo rollback-manual dela, que
  // so reescreve corpos, apaga a trigger e refaz a view) no clone descartavel antes da primeira prova.
  await desfazerEntregaNaCidadeNaTransacao(C);
  await C.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
  try {
    await C.query(`GRANT pg_read_all_data TO ${RO}`);
    await provar();
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(
    `\na-compra-que-da-zero-reais-nao-se-paga-pelo-app-portao-viva: ${resultados} ok`,
  );
}

main().catch((erro) =>
  falhar("PORTAO-37", erro?.stack ? erro.stack : String(erro)),
);
