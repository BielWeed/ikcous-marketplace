"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261234000000 (o lucro só conta produto com custo): as consultas
 * 35a-conferir-lucro-so-com-custo-aplicado (DEPOIS, 6 linhas) e
 * 35b-antes-lucro-so-com-custo-corpo-vigente (ANTES, 5 linhas), executadas num Postgres EFÊMERO
 * como papel de LEITURA (BYPASSRLS + pg_read_all_data, transação somente leitura) e levadas até o
 * veredito (`conferir-banco.cjs`) e ao portão (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 35a é POSITIVA com o rol EXATO de ROL_DA_35A, rol=ok; a 35b NEGATIVA
 *       reprovando EXATAMENTE as duas linhas do corpo e do marcador.
 *   (2) ANTES (o rollback-manual aplicado, o corpo da 20261214): a 35b é POSITIVA com o rol EXATO de
 *       ROL_DA_35B; a 35a NEGATIVA reprovando EXATAMENTE o corpo e o marcador.
 *   (3) A loja ainda no corpo da 20261199 (o lote 17 não aplicado): a 35b reprova SÓ o corpo (o marcador
 *       segue "nao") e a 35a reprova corpo e marcador — o portão não manda aplicar a 34 por cima.
 *   (4) UM NEGATIVO POR LINHA da 35a (cada defeito reprova a SUA linha e leva o portão a NEGATIVA): sobrecarga
 *       com outra assinatura, corpo com 1 byte a mais, atributo trocado (SECURITY INVOKER), EXECUTE aberto a
 *       PUBLIC, a anon, e fechado a authenticated, função AUSENTE. A linha de controle não tem negativo local
 *       (o catálogo é legível por todo papel): LIMITE declarado.
 *   (5) A 35b: sobrecarga, corpo com 1 byte a mais, atributo trocado e função ausente reprovam a linha delas.
 *   (6) MUTANTES do texto das consultas (o md5 do corpo novo trocado na 35a, o do vigente na 35b, o marcador
 *       sempre "sim"): cada um deixa um positivo reprovar ou um negativo passar.
 *   (7) rol FECHADO: as duas consultas devolvem SÓ as linhas do rol, ok booleano, ok=false primeiro.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a
 * IKCOUS ou a Savy estão (isso só o run da consulta contra o ref).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/lucro-so-com-custo-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm do próprio repositório; as chaves de objeto, de constantes deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");
const {
  devolverAoEstadoAnteriorAoCustoDoDia,
} = require("./sucessoras-da-99.cjs");

const REPO = path.resolve(__dirname, "..", "..");
process.chdir(REPO);
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const A = "35a-conferir-lucro-so-com-custo-aplicado";
const B = "35b-antes-lucro-so-com-custo-corpo-vigente";
const SQL_A = fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8");
const SQL_B = fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const ROL = { [A]: CONF.ROL_DA_35A, [B]: CONF.ROL_DA_35B };

const NOME_14 =
  "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql";
const NOME_34 = "20261234000000_o_lucro_so_conta_produto_com_custo.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const RB34 = ler(`rollback-manual-${NOME_34}`);
const RB14 = ler(`rollback-manual-${NOME_14}`);
const FN = "public.get_admin_analytics_v2(integer)";

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p35_ro_${SUF}`;

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
  // A 20261242000000 (o custo do dia) sucede a 34 no mesmo corpo: dentro da transação desta montagem, devolve
  // o clone ao estado "34 no ar" (idempotente; o ROLLBACK de noEstado desfaz).
  await devolverAoEstadoAnteriorAoCustoDoDia(c);
  // a árvore inteira: a 34 no ar (o corpo desta migration)
  assert.equal(
    await hashVivo(c),
    H34,
    "o clone tem de estar com a 20261234000000 no ar",
  );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB34);
  assert.equal(
    await hashVivo(c),
    H14,
    "o rollback não voltou ao corpo da 20261214000000",
  );
};
const ESTADO_99 = async (c) => {
  await ANTES(c);
  await c.query(RB14);
  assert.equal(
    await hashVivo(c),
    H99,
    "o rollback da 14 não voltou ao corpo da 20261199000000",
  );
};
const sobrecarga = async (c) => {
  await c.query(
    "CREATE FUNCTION public.get_admin_analytics_v2(p_isca_35 text) RETURNS json LANGUAGE sql AS $$ SELECT NULL::json $$",
  );
  const r = await c.query(
    "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'get_admin_analytics_v2' AND pronamespace = 'public'::regnamespace",
  );
  assert.equal(r.rows[0].n, 2);
};
const corpoMaisUmByte = async (c) => {
  const def = (
    await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN])
  ).rows[0].d;
  const novo = def.replace("-- 0. Security Check", "-- 0. Security Check ");
  assert.notEqual(novo, def);
  await c.query(novo);
  assert.notEqual(await hashVivo(c), H34);
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
const P34 = hashesDe(ler(NOME_34));
const P14 = hashesDe(ler(NOME_14));
const H34 = P34.desta;
const H14 = P34.vigente;
const H99 = P14.vigente;

function trocar(sql, de, para) {
  assert.ok(sql.includes(de), `o trecho a mutar não existe: ${de}`);
  return sql.replace(de, () => para);
}

async function provar() {
  assert.equal(H14, P14.desta, "o vigente da 34 é o que a 14 deixa");
  const ITEM_CORPO_A = ROL[A][2];
  const ITEM_MARCADOR_A = ROL[A][3];
  const ITEM_CORPO_B = ROL[B][2];
  const ITEM_MARCADOR_B = ROL[B][3];
  assert.match(ITEM_CORPO_A, /corpo e o da 20261234000000/);
  assert.match(ITEM_MARCADOR_A, /so soma lucro/);
  assert.match(ITEM_CORPO_B, /corpo e o da 20261214000000/);
  assert.match(ITEM_MARCADOR_B, /ainda NAO conta/);

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "35a depois", s[A]);
    await exigirReprovadas(B, "35b depois", s[B], [
      ITEM_CORPO_B,
      ITEM_MARCADOR_B,
    ]);
  }
  ok(
    "DEPOIS (a 20261234 no ar): 35a POSITIVA (rol exato, rol=ok, portão POSITIVA); 35b NEGATIVA só no corpo e no marcador",
  );

  // (2) ANTES
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "35b antes", s[B]);
    await exigirReprovadas(A, "35a antes", s[A], [
      ITEM_CORPO_A,
      ITEM_MARCADOR_A,
    ]);
  }
  ok(
    "ANTES (o corpo da 20261214): 35b POSITIVA; 35a NEGATIVA só no corpo e no marcador",
  );

  // (3) lote 17 não aplicado
  {
    const s = await noEstado(ESTADO_99);
    await exigirReprovadas(B, "35b no corpo da 99", s[B], [ITEM_CORPO_B]);
    await exigirReprovadas(A, "35a no corpo da 99", s[A], [
      ITEM_CORPO_A,
      ITEM_MARCADOR_A,
    ]);
  }
  ok(
    "loja ainda no corpo da 20261199 (lote 17 não aplicado): 35b reprova SÓ o corpo (o marcador segue 'nao'), 35a reprova corpo e marcador",
  );

  // (4) um negativo por linha da 35a
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
      "EXECUTE fechado a authenticated",
      (c) => c.query(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
      [linhaDe("EXECUTE")],
    ],
    ["função AUSENTE", ausente, ITENS_A.slice(1)],
  ];
  for (const [rotulo, defeito, esperadas] of negativosA) {
    const s = await noEstado(em(DEPOIS, defeito), [A]);
    await exigirReprovadas(A, `35a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    "35a: um negativo por linha (sobrecarga, corpo +1 byte, atributo, EXECUTE de PUBLIC/anon/authenticated, função ausente) — cada defeito reprova a SUA linha e leva o portão a NEGATIVA (a linha de controle não tem negativo local)",
  );

  // (5) 35b
  const ITENS_B = ROL[B];
  const linhaDeB = (nome) => ITENS_B.find((i) => i.includes(nome));
  const negativosB = [
    ["sobrecarga com outra assinatura", sobrecarga, [linhaDeB("sobrecargas")]],
    [
      "corpo com 1 byte a mais",
      corpoMaisUmByte,
      [ITEM_CORPO_B, ITEM_MARCADOR_B],
    ],
    [
      "atributo trocado (SECURITY INVOKER)",
      atributoTrocado,
      [linhaDeB("atributos")],
    ],
    ["função AUSENTE", ausente, ITENS_B.slice(1)],
  ];
  for (const [rotulo, defeito, esperadas] of negativosB) {
    // a 35b parte do ANTES (corpo da 14): o defeito vem por cima dele
    const sobreAntes =
      rotulo === "corpo com 1 byte a mais"
        ? async (c) => {
            const def = (
              await c.query(
                "SELECT pg_get_functiondef(to_regprocedure($1)) AS d",
                [FN],
              )
            ).rows[0].d;
            await c.query(
              def.replace("-- 0. Security Check", "-- 0. Security Check "),
            );
          }
        : defeito;
    const s = await noEstado(em(ANTES, sobreAntes), [B]);
    if (rotulo === "corpo com 1 byte a mais")
      await exigirReprovadas(B, `35b com ${rotulo}`, s[B], [ITEM_CORPO_B]);
    else await exigirReprovadas(B, `35b com ${rotulo}`, s[B], esperadas);
  }
  ok(
    "35b: sobrecarga, corpo +1 byte, atributo e função ausente reprovam a linha delas, portão NEGATIVA",
  );

  // (6) mutantes do texto
  const mutantes = [
    [
      "35a com o md5 do corpo novo trocado",
      A,
      trocar(SQL_A, `'${H34}'`, `'${"0".repeat(32)}'`),
      DEPOIS,
      "positivo",
    ],
    [
      "35b com o md5 do vigente trocado",
      B,
      trocar(SQL_B, `'${H14}'`, `'${"0".repeat(32)}'`),
      ANTES,
      "positivo",
    ],
    [
      "35a com o marcador sempre 'sim'",
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
      "35a com o EXECUTE de anon sempre 'nao'",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN false THEN 'sim'",
      ),
      em(DEPOIS, (c) => c.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`)),
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
    "MUTANTES do texto das consultas: md5 do corpo novo trocado (35a), md5 do vigente trocado (35b), marcador sempre 'sim' e EXECUTE de anon sempre 'nao' — todos pegos (o mutante 'PUBLIC ignorado' é EQUIVALENTE: um GRANT a PUBLIC também abre anon, que a consulta mede; por isso não entra)",
  );

  // (7) rol fechado: resposta parcial ou rol de outra consulta nunca é POSITIVA
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 35b julgadas pelo rol da 35a",
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
  console.log(`\nlucro-so-com-custo-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-35", erro?.stack ? erro.stack : String(erro)),
);
