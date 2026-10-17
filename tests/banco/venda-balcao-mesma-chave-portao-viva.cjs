"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261235000000 (a venda repetida do balcão devolve a venda feita): as consultas
 * 36a-conferir-venda-repetida-do-balcao-aplicado (DEPOIS, 6 linhas) e
 * 36b-antes-venda-repetida-do-balcao-corpo-vigente (ANTES, 5 linhas), executadas num Postgres EFÊMERO
 * como papel de LEITURA (BYPASSRLS + pg_read_all_data, transação somente leitura) e levadas até o
 * veredito (`conferir-banco.cjs`) e ao portão (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 36a é POSITIVA com o rol EXATO de ROL_DA_36A, rol=ok; a 36b NEGATIVA
 *       reprovando EXATAMENTE as duas linhas do corpo e do marcador.
 *   (2) ANTES (o rollback-manual aplicado, o corpo da 20261199): a 36b é POSITIVA com o rol EXATO de
 *       ROL_DA_36B; a 36a NEGATIVA reprovando EXATAMENTE o corpo e o marcador.
 *   (3) UM NEGATIVO POR LINHA da 36a (cada defeito reprova a SUA linha e leva o portão a NEGATIVA): sobrecarga
 *       com outra assinatura, corpo com 1 byte a mais, atributo trocado (SECURITY INVOKER), EXECUTE aberto a
 *       PUBLIC, a anon e a service_role, e fechado a authenticated, função AUSENTE. A linha de controle não tem
 *       negativo local (o catálogo é legível por todo papel): LIMITE declarado.
 *   (4) A 36b: sobrecarga, corpo com 1 byte a mais, atributo trocado e função ausente reprovam a linha delas.
 *   (5) MUTANTES do texto das consultas (o md5 do corpo novo trocado na 36a, o do vigente na 36b, o marcador
 *       sempre "sim" na 36a e sempre "nao" na 36b, o EXECUTE de anon e o de service_role sempre "nao"): cada
 *       um deixa um positivo reprovar ou um negativo passar.
 *   (6) Lote 52: 52a/52b com 249, 235 e 99; negativos de corpo, sobrecarga, atributos, ACL, indice,
 *       tabela ausente/fechada e resposta parcial. Usa o mesmo papel somente leitura e portao real.
 *   (7) rol FECHADO: as duas consultas devolvem SÓ as linhas do rol, ok booleano, ok=false primeiro; resposta
 *       parcial ou rol de outra consulta nunca é POSITIVA.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a
 * IKCOUS ou a Savy estão (isso só o run da consulta contra o ref). O COMPORTAMENTO da função (a espera pela
 * primeira, o `ja_existia` com o mesmo pedido) é de tests/banco/venda-balcao-mesma-chave-viva.cjs.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/venda-balcao-mesma-chave-portao-viva.cjs
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
const A = "36a-conferir-venda-repetida-do-balcao-aplicado";
const B = "36b-antes-venda-repetida-do-balcao-corpo-vigente";
const SQL_A = fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8");
const SQL_B = fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8");
const A52 = "52a-conferir-motivo-do-balcao-privado-aplicado";
const B52 = "52b-antes-motivo-do-balcao-base-vigente";
const SQL_52A = fs.readFileSync(path.join(CONSULTAS, `${A52}.sql`), "utf8");
const SQL_52B = fs.readFileSync(path.join(CONSULTAS, `${B52}.sql`), "utf8");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const ROL = {
  [A]: CONF.ROL_DA_36A,
  [B]: CONF.ROL_DA_36B,
  [A52]: CONF.ROL_DA_52A,
  [B52]: CONF.ROL_DA_52B,
};
const SQL = { [A]: SQL_A, [B]: SQL_B, [A52]: SQL_52A, [B52]: SQL_52B };

const NOME_99 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const NOME_36 =
  "20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const RB36 = ler(`rollback-manual-${NOME_36}`);
const NOME_SUCESSORA =
  "20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql";
const RB_SUCESSORA = ler(`rollback-manual-${NOME_SUCESSORA}`);
const SQL_SUCESSORA = ler(NOME_SUCESSORA);
const FN =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)";

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p36_ro_${SUF}`;

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
  // A arvore inteira tem a 249. Desfaz SO ela antes de medir o estado historico;
  // noEstado termina em ROLLBACK, que repoe a sucessora sem tocar nas notas privadas.
  if ((await hashVivo(c)) === H249) await c.query(RB_SUCESSORA);
  assert.equal(
    await hashVivo(c),
    H36,
    "o clone tem de estar com a 20261235000000 no ar",
  );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB36);
  assert.equal(
    await hashVivo(c),
    H99,
    "o rollback não voltou ao corpo da 20261199000000",
  );
};
const sobrecarga = async (c) => {
  await c.query(
    "CREATE FUNCTION public.registrar_venda_presencial(p_isca_36 text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$",
  );
  const r = await c.query(
    "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'registrar_venda_presencial' AND pronamespace = 'public'::regnamespace",
  );
  assert.equal(r.rows[0].n, 2);
};
/** O corpo vivo com UM byte a mais num comentário (o marcador e os atributos ficam como estão). */
const corpoMaisUmByte = async (c) => {
  const antes = await hashVivo(c);
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN])
  ).rows[0].d;
  const novo = def.replace("-- (1) O GATE VEM", "-- (1)  O GATE VEM");
  assert.notEqual(novo, def, "o trecho a mexer não existe no corpo vivo");
  await c.query(novo);
  assert.notEqual(await hashVivo(c), antes);
};
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

// os hashes lidos dos PREFLIGHTS
function hashesDe(sql) {
  const ini = sql.indexOf(`('${FN}', '`);
  const tupla = ini < 0 ? "" : sql.slice(ini, sql.indexOf("')", ini) + 2);
  const hs = tupla.match(/[0-9a-f]{32}/g);
  assert.ok(hs && hs.length === 2, "preflight sem o par de hashes");
  return { vigente: hs[0], desta: hs[1] };
}
const P36 = hashesDe(ler(NOME_36));
const P99 = hashesDe(ler(NOME_99));
const H36 = P36.desta;
const H99 = P36.vigente;
const P249 = hashesDe(SQL_SUCESSORA);
const H249 = P249.desta;

function trocar(sql, de, para) {
  assert.equal(
    sql.split(de).length - 1,
    1,
    `o trecho a mutar tem de aparecer UMA vez: ${de}`,
  );
  return sql.replace(de, () => para);
}

async function provar() {
  assert.equal(H99, P99.desta, "o vigente da 36 é o que a 99 deixa");
  assert.notEqual(H36, H99);
  assert.equal(P249.vigente, H36, "a 249 parte do corpo exato da 235");
  const ITEM_CORPO_A = ROL[A][2];
  const ITEM_MARCADOR_A = ROL[A][3];
  const ITEM_CORPO_B = ROL[B][2];
  const ITEM_MARCADOR_B = ROL[B][3];
  assert.match(ITEM_CORPO_A, /corpo e o da 20261235000000/);
  assert.match(ITEM_MARCADOR_A, /toma a trava consultiva/);
  assert.match(ITEM_CORPO_B, /corpo e o da 20261199000000/);
  assert.match(ITEM_MARCADOR_B, /ainda NAO toma a trava/);

  // A sucessora preserva a trava: 36a positiva com o corpo FINAL, 36b negativa.
  const SUCESSORA = async (c) => {
    assert.equal(await hashVivo(c), H249, "o clone tem de trazer a 249 no ar");
  };
  {
    const s = await noEstado(SUCESSORA);
    await exigirPositiva(A, "36a com a 249", s[A]);
    await exigirReprovadas(B, "36b com a 249", s[B], [
      ITEM_CORPO_B,
      ITEM_MARCADOR_B,
    ]);
  }
  ok(
    "249 no ar: 36a aceita o corpo exato e a trava; 36b reprova o corpo e o marcador",
  );

  // Portao 52: mesmas consultas/contrato usados pela release, como papel somente leitura.
  // A tabela privada continua operacional ao desfazer a 249, porque seu rollback preserva a 247.
  {
    for (const [rotulo, montar] of [
      ["249", SUCESSORA],
      ["235", DEPOIS],
    ]) {
      const s = await noEstado(montar, [A52, B52]);
      await exigirPositiva(B52, `52b na ${rotulo}`, s[B52]);
      if (montar === SUCESSORA) {
        await exigirPositiva(A52, "52a na 249", s[A52]);
      } else {
        await exigirReprovadas(A52, "52a na 235", s[A52], [ROL[A52][2]]);
      }
    }
    const s99 = await noEstado(ANTES, [A52, B52]);
    for (const consulta of [A52, B52]) {
      await exigirReprovadas(consulta, `${consulta} na 99`, s99[consulta], [
        ROL[consulta][2],
      ]);
    }
    const negativos52 = [
      ["sobrecarga", sobrecarga, [1]],
      ["corpo estranho", corpoMaisUmByte, [2]],
      ["atributo divergente", atributoTrocado, [3]],
      [
        "EXECUTE para anon",
        (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
        [4],
      ],
      [
        "GRANT OPTION",
        (c) =>
          c.query(
            `GRANT EXECUTE ON FUNCTION ${FN} TO authenticated WITH GRANT OPTION`,
          ),
        [4],
      ],
      [
        "indice ausente",
        (c) =>
          c.query("DROP INDEX public.marketplace_orders_chave_da_compra_unica"),
        [5],
      ],
      [
        "tabela privada ausente",
        (c) => c.query("DROP TABLE public.marketplace_order_internal_notes"),
        [6, 7, 8, 9],
      ],
      [
        "tabela privada fechada",
        async (c) => {
          await c.query(
            "DROP POLICY nota_interna_so_admin_atual ON public.marketplace_order_internal_notes",
          );
          await c.query(
            "REVOKE ALL ON public.marketplace_order_internal_notes FROM authenticated",
          );
        },
        [7, 8],
      ],
    ];
    for (const [rotulo, defeito, indices] of negativos52) {
      const s = await noEstado(em(SUCESSORA, defeito), [A52, B52]);
      for (const consulta of [A52, B52]) {
        await exigirReprovadas(
          consulta,
          `${consulta}: ${rotulo}`,
          s[consulta],
          indices.map((i) => ROL[consulta][i]),
        );
      }
    }
    const cheia = await noEstado(SUCESSORA, [A52, B52]);
    for (const consulta of [A52, B52]) {
      const parcial = cheia[consulta].slice(1);
      assert.ok(veredito(consulta, parcial).includes("rol=invalido"));
      assert.notEqual(await estadoNoPortao(consulta, parcial), "POSITIVA");
    }
  }
  ok(
    "52a/52b: 249 e 235, corpo da 99 recusado, negativos por objeto e rol parcial fechado no portao",
  );

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "36a depois", s[A]);
    await exigirReprovadas(B, "36b depois", s[B], [
      ITEM_CORPO_B,
      ITEM_MARCADOR_B,
    ]);
  }
  ok(
    "DEPOIS (a 20261235 no ar): 36a POSITIVA (rol exato, rol=ok, portão POSITIVA); 36b NEGATIVA só no corpo e no marcador",
  );

  // (2) ANTES
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "36b antes", s[B]);
    await exigirReprovadas(A, "36a antes", s[A], [
      ITEM_CORPO_A,
      ITEM_MARCADOR_A,
    ]);
  }
  ok(
    "ANTES (o corpo da 20261199): 36b POSITIVA; 36a NEGATIVA só no corpo e no marcador",
  );

  {
    const s = await noEstado(async (c) => {
      await ANTES(c);
      await c.query(ler(NOME_36));
      await c.query(SQL_SUCESSORA);
      assert.equal(
        await hashVivo(c),
        H249,
        "repor a sucessora devolve o corpo final",
      );
    });
    await exigirPositiva(A, "36a com a cadeia reposta", s[A]);
  }
  ok(
    "rollback 249 -> rollback 235 -> apply 235 -> apply 249 repoe a cadeia final",
  );

  // (3) um negativo por linha da 36a
  const ITENS_A = ROL[A];
  const linhaDe = (nome) => ITENS_A.find((i) => i.includes(nome));
  const negativosA = [
    ["sobrecarga com outra assinatura", sobrecarga, [linhaDe("sobrecargas")]],
    ["corpo com 1 byte a mais", corpoMaisUmByte, [ITEM_CORPO_A]],
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
      "EXECUTE aberto a anon",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
      [linhaDe("EXECUTE")],
    ],
    [
      "EXECUTE aberto a service_role",
      (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO service_role`),
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
    await exigirReprovadas(A, `36a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    "36a: um negativo por linha (sobrecarga, corpo +1 byte, atributo, EXECUTE de PUBLIC/anon/service_role/authenticated, função ausente) — cada defeito reprova a SUA linha e leva o portão a NEGATIVA (a linha de controle não tem negativo local)",
  );

  // (4) 36b: parte do ANTES (corpo da 99); o defeito vem por cima dele
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
    await exigirReprovadas(B, `36b com ${rotulo}`, s[B], esperadas);
  }
  ok(
    "36b: sobrecarga, corpo +1 byte, atributo e função ausente reprovam a linha delas, portão NEGATIVA",
  );

  // (5) mutantes do texto
  const zero = "0".repeat(32);
  const GRANT_ANON = (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`);
  const GRANT_SERVICE = (c) =>
    c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO service_role`);
  const mutantes = [
    [
      "36a sem o md5 da sucessora",
      A,
      trocar(SQL_A, `'${H249}'`, `'${zero}'`),
      SUCESSORA,
      "positivo",
    ],
    [
      "36a com o md5 do corpo novo trocado",
      A,
      trocar(SQL_A, `         '${H36}',`, `         '${zero}',`),
      DEPOIS,
      "positivo",
    ],
    [
      "36b com o md5 do vigente trocado",
      B,
      trocar(SQL_B, `'${H99}'`, `'${zero}'`),
      ANTES,
      "positivo",
    ],
    [
      "36a com o marcador sempre 'sim'",
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
      "36b com o marcador sempre 'nao'",
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
      "36a com o EXECUTE de anon sempre 'nao'",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN false THEN 'sim'",
      ),
      em(DEPOIS, GRANT_ANON),
      "negativo",
    ],
    [
      "36a com o EXECUTE de service_role sempre 'nao'",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN false THEN 'sim'",
      ),
      em(DEPOIS, GRANT_SERVICE),
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
        `${rotulo}: o mutante não afrouxou nada`,
      );
  }
  ok(
    "MUTANTES do texto das consultas: md5 do corpo novo trocado (36a), md5 do vigente trocado (36b), marcador sempre 'sim' (36a) e sempre 'nao' (36b), EXECUTE de anon e de service_role sempre 'nao' — todos pegos (o mutante 'PUBLIC ignorado' é EQUIVALENTE: um GRANT a PUBLIC também abre anon, que a consulta mede; por isso não entra)",
  );

  // (6) rol fechado: resposta parcial ou rol de outra consulta nunca é POSITIVA
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 36b julgadas pelo rol da 36a",
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
  await C.query(`CREATE ROLE ${RO} NOLOGIN BYPASSRLS`);
  try {
    await C.query(`GRANT pg_read_all_data TO ${RO}`);
    await provar();
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  console.log(`\nvenda-balcao-mesma-chave-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-36", erro?.stack ? erro.stack : String(erro)),
);
