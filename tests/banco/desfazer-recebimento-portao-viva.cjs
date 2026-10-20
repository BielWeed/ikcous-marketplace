"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261243000000 (desfazer o recebimento recusa pedido com devolução viva): as consultas
 * 46a-conferir-desfazer-recebimento-aplicado (DEPOIS, 6 linhas) e 46b-antes-desfazer-recebimento-base-vigente (ANTES,
 * 6 linhas), executadas num Postgres EFÊMERO como papel de LEITURA (BYPASSRLS + pg_read_all_data, transação somente
 * leitura) e levadas até o veredito (`conferir-banco.cjs`) e ao portão (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 46a é POSITIVA com o rol EXATO de ROL_DA_46A, rol=ok; a 46b NEGATIVA reprovando
 *       EXATAMENTE a linha do corpo (o vigente da 97 deixou de estar no ar).
 *   (2) ANTES (o rollback-manual aplicado): a 46b é POSITIVA com o rol EXATO de ROL_DA_46B; a 46a NEGATIVA reprovando
 *       EXATAMENTE as três linhas que dependem do corpo (md5 e os dois marcadores).
 *   (3) UM NEGATIVO POR LINHA da 46a: corpo +1 byte, atributo trocado, sobrecarga, EXECUTE aberto a PUBLIC/anon e fechado
 *       a authenticated/service_role, a frase da recusa trocada, o critério da devolução viva trocado, a trava do pedido
 *       fora do lugar, função AUSENTE.
 *   (4) A 46b: sobrecarga, corpo +1 byte, atributo trocado, EXECUTE aberto ou fechado, função ausente, is_admin_atual()
 *       ausente, coluna ausente.
 *   (5) MUTANTES do texto das consultas: cada um deixa um positivo reprovar ou um negativo passar.
 *   (6) A 8e (lote 92-202) segue POSITIVA com a migration no ar e desfeita; corpo estranho reprova SÓ a linha da função.
 *   (7) rol FECHADO: resposta parcial ou o rol de outra consulta nunca é POSITIVA.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a
 * IKCOUS ou a Savy estão (isso só o run da consulta contra o ref).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/desfazer-recebimento-portao-viva.cjs
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
const A = "46a-conferir-desfazer-recebimento-aplicado";
const B = "46b-antes-desfazer-recebimento-base-vigente";
const SQL_A = fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8");
const SQL_B = fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const E8 = "8e-conferir-92-a-202-aplicado";
const SQL_E8 = fs.readFileSync(path.join(CONSULTAS, `${E8}.sql`), "utf8");
const ROL = {
  [A]: CONF.ROL_DA_46A,
  [B]: CONF.ROL_DA_46B,
  [E8]: CONF.ROL_DA_8E,
};

const NOME = "20261243000000_desfazer_recebimento_recusa_com_devolucao.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const RB = ler(`rollback-manual-${NOME}`);
const FN = "public.registrar_pagamento_recebido(uuid,boolean)";
const HASH_NOVO = "88270bb1e228c90be73acca03a3cee4e";
const HASH_VIGENTE = "6584d62da7815a913b1e0cb86c108b0f";

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p46_ro_${SUF}`;

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
        nome === A ? SQL_A : nome === B ? SQL_B : nome === E8 ? SQL_E8 : nome;
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
  ).rows[0]?.h;
const DEPOIS = async (c) => {
  // O clone sai das migrations aplicadas do zero: a 20261243 está no ar.
  assert.equal(
    await hashVivo(c),
    HASH_NOVO,
    "o clone tem de estar com a 20261243000000 no ar",
  );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB);
  assert.equal(
    await hashVivo(c),
    HASH_VIGENTE,
    "o rollback devolve o corpo da 20261197000000",
  );
};
const em =
  (...passos) =>
  async (c) => {
    for (const p of passos) await p(c);
  };
const sql = (texto) => (c) => c.query(texto);
const defDe = async (c) =>
  (await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [FN]))
    .rows[0].d;
/** Reescreve a função com UMA troca de texto (a definição inteira, com os atributos de sempre). */
const trocaNoCorpo = (de, para) => async (c) => {
  const def = await defDe(c);
  assert.ok(def.includes(de), `o trecho ${de} não existe na função`);
  await c.query(def.replace(de, () => para));
};
const maisUmByte = (de) => trocaNoCorpo(de, `${de} `);

function trocar(texto, de, para) {
  assert.ok(texto.includes(de), `o trecho a mutar não existe: ${de}`);
  return texto.replace(de, () => para);
}

async function provar() {
  const L = (trecho) => {
    const achadas = ROL[A].filter((i) => i.includes(trecho));
    assert.equal(
      achadas.length,
      1,
      `a linha "${trecho}" tem de ser única no rol da 46a (achei ${achadas.length})`,
    );
    return achadas[0];
  };
  const LB = (trecho) => {
    const achadas = ROL[B].filter((i) => i.includes(trecho));
    assert.equal(
      achadas.length,
      1,
      `a linha "${trecho}" tem de ser única no rol da 46b (achei ${achadas.length})`,
    );
    return achadas[0];
  };
  const A_CORPO = L("corpo e o da 20261243000000");
  const A_ATRIBUTOS = L("atributos de sempre");
  const A_EXEC = L("EXECUTE so de authenticated");
  const A_FRASE = L("a frase da recusa");
  const A_ORDEM = L("depois da trava do pedido");
  const B_CORPO = LB("corpo e o vigente da 20261197000000");
  const B_ATRIBUTOS = LB("atributos de sempre");
  const B_EXEC = LB("EXECUTE so de authenticated");
  const B_ADMIN = LB("is_admin() e is_admin_atual() existem");
  const B_COLUNAS = LB("14 colunas");

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "46a depois", s[A]);
    await exigirReprovadas(B, "46b depois", s[B], [B_CORPO]);
  }
  ok(
    "DEPOIS (a 20261243 no ar): 46a POSITIVA (6 linhas, rol=ok, portão POSITIVA); 46b NEGATIVA só na linha do corpo (o vigente da 97 não está mais no ar)",
  );

  // (2) ANTES
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "46b antes", s[B]);
    await exigirReprovadas(A, "46a antes", s[A], [A_CORPO, A_FRASE, A_ORDEM]);
  }
  ok(
    "ANTES (rollback-manual aplicado): 46b POSITIVA; 46a NEGATIVA só nas 3 linhas que dependem do corpo (md5, a frase e o critério, a ordem da trava); atributos e EXECUTE seguem verdadeiros",
  );

  // (3) um negativo por linha da 46a
  const negativosA = [
    [
      "corpo com 1 byte a mais (num comentário)",
      maisUmByte("-- Papel ATUAL (auth.users E profiles)"),
      [A_CORPO],
    ],
    [
      "SECURITY INVOKER",
      sql(`ALTER FUNCTION ${FN} SECURITY INVOKER`),
      [A_ATRIBUTOS],
    ],
    [
      "search_path aberto",
      sql(`ALTER FUNCTION ${FN} RESET search_path`),
      [A_ATRIBUTOS],
    ],
    [
      "volatilidade trocada (STABLE)",
      sql(`ALTER FUNCTION ${FN} STABLE`),
      [A_ATRIBUTOS],
    ],
    [
      "sobrecarga",
      sql(
        "CREATE FUNCTION public.registrar_pagamento_recebido(p_isca_46 text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$",
      ),
      [A_ATRIBUTOS],
    ],
    [
      "EXECUTE aberto a PUBLIC",
      sql(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
      [A_EXEC],
    ],
    [
      "EXECUTE aberto a anon",
      sql(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
      [A_EXEC],
    ],
    [
      "EXECUTE fechado a authenticated",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
      [A_EXEC],
    ],
    [
      "EXECUTE fechado a service_role",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`),
      [A_EXEC],
    ],
    [
      "a frase da recusa trocada",
      trocaNoCorpo("permite desfazer.'", "permite refazer.'"),
      [A_CORPO, A_FRASE],
    ],
    [
      "o critério da devolução viva trocado (libera a concluída)",
      trocaNoCorpo(
        "'cancelada', 'reprovada')",
        "'cancelada', 'reprovada', 'concluida')",
      ),
      [A_CORPO, A_FRASE],
    ],
    [
      "sem a trava do pedido (FOR UPDATE)",
      trocaNoCorpo("FOR UPDATE;", ";"),
      [A_CORPO, A_ORDEM],
    ],
    [
      "função AUSENTE",
      sql(`DROP FUNCTION ${FN}`),
      [A_CORPO, A_ATRIBUTOS, A_EXEC, A_FRASE, A_ORDEM],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosA) {
    const s = await noEstado(em(DEPOIS, defeito), [A]);
    await exigirReprovadas(A, `46a com ${rotulo}`, s[A], esperadas);
  }
  ok(
    `46a: ${negativosA.length} negativos (corpo +1 byte, atributos de três jeitos, sobrecarga, EXECUTE aberto a PUBLIC e anon e fechado a authenticated e service_role, a frase trocada, o critério trocado, sem a trava do pedido, função AUSENTE) — cada defeito reprova a SUA linha e leva o portão a NEGATIVA (a linha de controle não tem negativo local: o catálogo é legível por todo papel)`,
  );

  // (4) a 46b
  const negativosB = [
    [
      "corpo com 1 byte a mais (num comentário)",
      maisUmByte("-- Papel ATUAL (auth.users E profiles)"),
      [B_CORPO],
    ],
    [
      "SECURITY INVOKER",
      sql(`ALTER FUNCTION ${FN} SECURITY INVOKER`),
      [B_ATRIBUTOS],
    ],
    [
      "sobrecarga",
      sql(
        "CREATE FUNCTION public.registrar_pagamento_recebido(p_isca_46 text) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$",
      ),
      [B_ATRIBUTOS],
    ],
    [
      "EXECUTE aberto a PUBLIC",
      sql(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
      [B_EXEC],
    ],
    [
      "EXECUTE aberto a anon",
      sql(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
      [B_EXEC],
    ],
    [
      "EXECUTE fechado a authenticated",
      sql(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`),
      [B_EXEC],
    ],
    [
      "função AUSENTE",
      sql(`DROP FUNCTION ${FN}`),
      [B_CORPO, B_ATRIBUTOS, B_EXEC],
    ],
    [
      "is_admin_atual() ausente",
      sql(
        "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_isca_46",
      ),
      [B_ADMIN],
    ],
    [
      "devolucoes.status renomeada (coluna ausente)",
      sql(
        "ALTER TABLE public.devolucoes RENAME COLUMN status TO status_isca_46",
      ),
      [B_COLUNAS],
    ],
  ];
  for (const [rotulo, defeito, esperadas] of negativosB) {
    const s = await noEstado(em(ANTES, defeito), [B]);
    await exigirReprovadas(B, `46b com ${rotulo}`, s[B], esperadas);
  }
  ok(
    `46b: ${negativosB.length} negativos (corpo +1 byte, atributo, sobrecarga, EXECUTE aberto a PUBLIC e anon e fechado, função ausente, is_admin_atual() ausente, coluna ausente) reprovam a linha delas e levam o portão a NEGATIVA`,
  );

  // (5) mutantes do texto
  const mutantes = [
    [
      "46a com o md5 do corpo trocado",
      A,
      trocar(SQL_A, `'${HASH_NOVO}'`, `'${"0".repeat(32)}'`),
      DEPOIS,
      "positivo",
    ],
    [
      "46b com o md5 vigente trocado",
      B,
      trocar(SQL_B, `'${HASH_VIGENTE}'`, `'${"0".repeat(32)}'`),
      ANTES,
      "positivo",
    ],
    [
      "46a cega ao EXECUTE de authenticated",
      A,
      trocar(
        SQL_A,
        "ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS auth_exec",
        "ELSE true END AS auth_exec",
      ),
      em(DEPOIS, sql(`REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`)),
      "negativo",
    ],
    [
      "46b cega ao EXECUTE de anon",
      B,
      trocar(
        SQL_B,
        "THEN false ELSE has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_exec",
        "THEN false ELSE false END AS anon_exec",
      ),
      em(ANTES, sql(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`)),
      "negativo",
    ],
    [
      "46a sem olhar o critério da devolução viva",
      A,
      trocar(
        SQL_A,
        "AND position('d.status NOT IN (''recusada'', ''cancelada'', ''reprovada'')' IN f.prosrc) > 0",
        "",
      ),
      em(
        DEPOIS,
        trocaNoCorpo(
          "'cancelada', 'reprovada')",
          "'cancelada', 'reprovada', 'concluida')",
        ),
      ),
      "negativo",
    ],
    [
      "46a sem olhar a ordem da trava",
      A,
      trocar(
        SQL_A,
        "AND position('FOR UPDATE;' IN f.prosrc) < position('FROM public.devolucoes d' IN f.prosrc)",
        "",
      ),
      em(
        DEPOIS,
        // A trava de verdade sai do lugar e um `FOR UPDATE;` de comentário aparece DEPOIS da checagem.
        trocaNoCorpo("FOR UPDATE;", ";"),
        trocaNoCorpo(
          "SET payment_status = NULL,",
          "-- FOR UPDATE;\n                   SET payment_status = NULL,",
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
    `MUTANTES do texto das consultas (${mutantes.length}): md5 do corpo e md5 vigente trocados, EXECUTE de authenticated (46a) e de anon (46b) cegos, critério da devolução viva e ordem da trava não olhados — todos pegos`,
  );

  // (6) a 8e (lote 92-202) segue POSITIVA depois do apply e com a migration desfeita.
  {
    const linhaE8 = (rows) => {
      const l = rows.filter(
        (r) => r.item === "corpo final registrar_pagamento_recebido",
      );
      assert.equal(
        l.length,
        1,
        'a 8e tem de ter UMA linha "corpo final registrar_pagamento_recebido"',
      );
      return l[0];
    };
    let s = await noEstado(DEPOIS, [E8]);
    await exigirPositiva(E8, "8e com a 43 no ar", s[E8]);
    assert.equal(
      linhaE8(s[E8]).vivo,
      HASH_VIGENTE,
      "o `vivo` mostra o corpo da 97 (o esperado), aceito o da 43",
    );
    s = await noEstado(ANTES, [E8]);
    await exigirPositiva(E8, "8e com a 43 desfeita", s[E8]);
    s = await noEstado(
      em(DEPOIS, maisUmByte("-- Papel ATUAL (auth.users E profiles)")),
      [E8],
    );
    await exigirReprovadas(E8, "8e com o corpo estranho", s[E8], [
      "corpo final registrar_pagamento_recebido",
    ]);
  }
  ok(
    "8e segue POSITIVA com a 43 no ar (aceita o corpo novo como SUCESSOR) e com ela desfeita; corpo estranho de registrar_pagamento_recebido reprova SÓ a linha da função",
  );

  // (7) rol fechado
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 46b julgadas pelo rol da 46a",
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
  console.log(`\ndesfazer-recebimento-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-46", erro?.stack ? erro.stack : String(erro)),
);
