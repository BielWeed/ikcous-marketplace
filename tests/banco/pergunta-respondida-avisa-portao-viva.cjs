"use strict";

/**
 * Prova VIVA do PORTÃO do lote 20261240000000 (a cliente é avisada quando a loja responde a pergunta dela:
 * `answer_question_atomic`, as DUAS sobrecargas): as consultas
 * 41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado (DEPOIS, 10 linhas) e
 * 41b-antes-pergunta-respondida-corpos-vigentes (ANTES, 8 linhas), executadas num Postgres EFÊMERO
 * como papel de LEITURA (BYPASSRLS + pg_read_all_data, transação somente leitura) e levadas até o
 * veredito (`conferir-banco.cjs`) e ao portão (`evidenciaDaProva`, de publicar-release.mjs).
 *
 * O QUE SE PROVA:
 *   (1) DEPOIS (a migration no ar): a 41a é POSITIVA com o rol EXATO de ROL_DA_41A, rol=ok; a 41b NEGATIVA
 *       reprovando EXATAMENTE as quatro linhas dos corpos e dos marcadores (as duas sobrecargas).
 *   (2) ANTES (o rollback-manual aplicado, os corpos das 20261065 e 20261064): a 41b é POSITIVA com o rol EXATO de
 *       ROL_DA_41B; a 41a NEGATIVA reprovando EXATAMENTE as quatro linhas dos corpos e dos marcadores.
 *   (3) SÓ UMA DAS DUAS sobrecargas voltou ao corpo de antes (a de 3 argumentos): a 41a reprova SÓ o corpo e o
 *       marcador dela, a 41b reprova SÓ o corpo e o marcador da OUTRA — nenhuma das duas consultas dá POSITIVA
 *       numa loja pela metade, nos dois sentidos.
 *   (4) UM NEGATIVO POR LINHA da 41a, em CADA sobrecarga (cada defeito reprova a SUA linha e leva o portão a
 *       NEGATIVA): sobrecarga extra, corpo com 1 byte a mais, corpo que volta a citar o log de push, atributo
 *       trocado (SECURITY INVOKER), EXECUTE aberto a PUBLIC, a anon, e fechado a authenticated, função
 *       AUSENTE. A linha de controle não tem negativo local (o catálogo é legível por todo papel): LIMITE declarado.
 *   (5) A 41b: sobrecarga extra, corpo com 1 byte a mais, corpo que já grava no sino, atributo trocado e função
 *       ausente reprovam a linha delas, em cada sobrecarga.
 *   (6) MUTANTES do texto das consultas (o md5 do corpo novo trocado na 41a, o do vigente na 41b, o marcador sempre
 *       "sim", o EXECUTE de anon sempre "nao", a contagem de sobrecargas, a sobrecarga de 3 argumentos medindo a
 *       de 2): cada um deixa um positivo reprovar ou um negativo passar.
 *   (7) rol FECHADO: as duas consultas devolvem SÓ as linhas do rol, ok booleano, ok=false primeiro; resposta
 *       parcial ou o rol da outra consulta nunca é POSITIVA.
 *
 * Nada sai da máquina e nenhuma loja é tocada. A prova diz que as consultas DECIDEM certo, não em que estado a
 * IKCOUS ou a Savy estão (isso só o run da consulta contra o ref).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/pergunta-respondida-avisa-portao-viva.cjs
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
const A = "41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado";
const B = "41b-antes-pergunta-respondida-corpos-vigentes";
const SQL_A = fs.readFileSync(path.join(CONSULTAS, `${A}.sql`), "utf8");
const SQL_B = fs.readFileSync(path.join(CONSULTAS, `${B}.sql`), "utf8");
const CONF = require("../../scripts/publicacao/conferir-banco.cjs");
const ROL = { [A]: CONF.ROL_DA_41A, [B]: CONF.ROL_DA_41B };

const NOME_40 =
  "20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql";
const ler = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), "utf8");
const MIGRACAO = ler(NOME_40);
const RB = ler(`rollback-manual-${NOME_40}`);
const F2 = "public.answer_question_atomic(uuid,text)";
const F3 = "public.answer_question_atomic(uuid,text,uuid)";
const FUNCOES = [F2, F3];

const REF = "gnjsrucsmjkajijrakzr";
const SHA40 = "e".repeat(40);
const SUF = `${process.pid.toString(36)}${Date.now().toString(36).slice(-5)}`;
const RO = `p41_ro_${SUF}`;

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

// --- os hashes: lidos do PRÉ-VOO da migration (vigente, desta) de cada sobrecarga --------------------------
function hashesDe(assinatura) {
  const marca = `('${assinatura}',`;
  const ini = MIGRACAO.indexOf(marca);
  assert.ok(ini >= 0, `preflight sem a tupla de ${assinatura}`);
  const hs = MIGRACAO.slice(ini + marca.length, ini + marca.length + 120).match(
    /[0-9a-f]{32}/g,
  );
  assert.ok(
    hs && hs.length >= 2,
    `preflight sem o par de hashes de ${assinatura}`,
  );
  return { vigente: hs[0], desta: hs[1] };
}
const H = {
  [F2]: hashesDe("public.answer_question_atomic(uuid,text)"),
  [F3]: hashesDe("public.answer_question_atomic(uuid,text,uuid)"),
};

// --- as montagens -----------------------------------------------------------
const hashVivo = async (c, fn) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [fn],
    )
  ).rows[0]?.h ?? null;
const defVivo = async (c, fn) =>
  (await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn]))
    .rows[0].d;
const DEPOIS = async (c) => {
  // a árvore inteira: a 20261240 no ar (os dois corpos desta migration)
  for (const fn of FUNCOES)
    assert.equal(
      await hashVivo(c, fn),
      H[fn].desta,
      `o clone tem de estar com a 20261240000000 no ar (${fn})`,
    );
};
const ANTES = async (c) => {
  await DEPOIS(c);
  await c.query(RB);
  for (const fn of FUNCOES)
    assert.equal(
      await hashVivo(c, fn),
      H[fn].vigente,
      `o rollback não voltou ao corpo de antes (${fn})`,
    );
};
// só a sobrecarga de 3 argumentos volta ao corpo de antes (o CREATE dela é o 2º do rollback)
const SO_A_DE_TRES_VOLTOU = async (c) => {
  await DEPOIS(c);
  const marca = "CREATE OR REPLACE FUNCTION public.answer_question_atomic(";
  const partes = RB.split(marca).slice(1);
  assert.equal(partes.length, 2, "o rollback tem os dois CREATE");
  const tres = partes.find((p) =>
    p.startsWith("p_question_id uuid, p_answer text, p_admin_id uuid)"),
  );
  assert.ok(tres, "o rollback não tem o CREATE da sobrecarga de 3 argumentos");
  // sem a conferência final do rollback (ela exige as DUAS de volta ao corpo de antes): só o CREATE da de 3 argumentos
  await c.query(marca + tres.split("\n-- CONFERÊNCIA FINAL")[0]);
  assert.equal(await hashVivo(c, F2), H[F2].desta);
  assert.equal(await hashVivo(c, F3), H[F3].vigente);
};
const sobrecarga = async (c) => {
  await c.query(
    "CREATE FUNCTION public.answer_question_atomic(p_isca_41 text) RETURNS void LANGUAGE sql AS $$ SELECT $$",
  );
  const r = await c.query(
    "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'answer_question_atomic' AND pronamespace = 'public'::regnamespace",
  );
  assert.equal(r.rows[0].n, 3);
};
/** Troca `de` por `para` no corpo VIVO de `fn` (pg_get_functiondef + CREATE OR REPLACE) e confere que o hash mudou. */
const mexerNoCorpo = (fn, de, para) => async (c) => {
  const antes = await hashVivo(c, fn);
  const def = await defVivo(c, fn);
  assert.ok(def.includes(de), `o trecho a trocar não existe em ${fn}: ${de}`);
  await c.query(def.replace(de, () => para));
  assert.notEqual(await hashVivo(c, fn), antes, `o corpo de ${fn} não mudou`);
};
const corpoMaisUmByte = (fn) =>
  mexerNoCorpo(fn, "-- SECURITY CHECK", "-- SECURITY  CHECK");
const corpoMaisUmByteDepois = (fn) =>
  mexerNoCorpo(fn, "-- 1. Upsert Answer", "-- 1.  Upsert Answer");
const corpoQueCitaOLog = (fn) =>
  mexerNoCorpo(
    fn,
    "-- 1. Upsert Answer",
    "-- push_notifications_log\n    -- 1. Upsert Answer",
  );
const corpoQueGravaNoSino = (fn) =>
  mexerNoCorpo(
    fn,
    "-- 1. Upsert Answer",
    "-- notificacoes\n    -- 1. Upsert Answer",
  );
const atributoTrocado = (fn) => (c) =>
  c.query(`ALTER FUNCTION ${fn} SECURITY INVOKER`);
const ausente = (fn) => (c) => c.query(`DROP FUNCTION ${fn}`);
const em =
  (...passos) =>
  async (c) => {
    for (const p of passos) await p(c);
  };

function trocar(sql, de, para) {
  assert.ok(sql.includes(de), `o trecho a mutar não existe: ${de}`);
  return sql.replace(de, () => para);
}

const curto = (fn) => (fn === F2 ? "(uuid,text)" : "(uuid,text,uuid)");
/** A linha do rol cujo item começa com `answer_question_atomic<assinatura>: <trecho>`. */
const linhaDe = (consulta, fn, trecho) => {
  const achadas = ROL[consulta].filter((i) =>
    i.startsWith(`answer_question_atomic${curto(fn)}: ${trecho}`),
  );
  assert.equal(achadas.length, 1, `${consulta}: linha "${fn} ${trecho}"`);
  return achadas[0];
};
const SOBRECARGAS = (consulta) => {
  const achadas = ROL[consulta].filter(
    (i) => i === "answer_question_atomic: sobrecargas",
  );
  assert.equal(achadas.length, 1);
  return achadas[0];
};
/** As quatro linhas (ou três na 41b) que uma sobrecarga ocupa: tudo que começa com o nome dela. */
const linhasDa = (consulta, fn) =>
  ROL[consulta].filter((i) =>
    i.startsWith(`answer_question_atomic${curto(fn)}: `),
  );

async function provar() {
  // os hashes de antes e de depois das duas sobrecargas são os do pré-voo, e distintos
  for (const fn of FUNCOES) {
    assert.notEqual(H[fn].vigente, H[fn].desta);
    assert.ok(
      SQL_A.includes(`'${H[fn].desta}'`),
      `41a sem o md5 novo de ${fn}`,
    );
    assert.ok(!SQL_A.includes(`'${H[fn].vigente}'`));
    assert.ok(
      SQL_B.includes(`'${H[fn].vigente}'`),
      `41b sem o md5vigente de ${fn}`,
    );
    assert.ok(!SQL_B.includes(`'${H[fn].desta}'`));
  }
  const CORPO = (consulta, fn) => linhaDe(consulta, fn, "corpo e o da");
  const MARCA_A = (fn) => linhaDe(A, fn, "o corpo avisa no sino");
  const MARCA_B = (fn) => linhaDe(B, fn, "o corpo ainda NAO grava no sino");
  const ATRIB = (consulta, fn) => linhaDe(consulta, fn, "atributos de sempre");
  const EXEC = (fn) => linhaDe(A, fn, "EXECUTE fechado");
  assert.match(CORPO(A, F2), /20261240000000/);
  assert.match(CORPO(A, F3), /20261240000000/);
  assert.match(CORPO(B, F2), /20261065000000/);
  assert.match(CORPO(B, F3), /20261064000000/);

  // (1) DEPOIS
  {
    const s = await noEstado(DEPOIS);
    await exigirPositiva(A, "41a depois", s[A]);
    await exigirReprovadas(B, "41b depois", s[B], [
      CORPO(B, F2),
      MARCA_B(F2),
      CORPO(B, F3),
      MARCA_B(F3),
    ]);
  }
  ok(
    "DEPOIS (a 20261240 no ar): 41a POSITIVA (rol exato, rol=ok, portão POSITIVA); 41b NEGATIVA só nos corpos e nos marcadores das duas sobrecargas",
  );

  // (2) ANTES
  {
    const s = await noEstado(ANTES);
    await exigirPositiva(B, "41b antes", s[B]);
    await exigirReprovadas(A, "41a antes", s[A], [
      CORPO(A, F2),
      MARCA_A(F2),
      CORPO(A, F3),
      MARCA_A(F3),
    ]);
  }
  ok(
    "ANTES (os corpos das 20261065 e 20261064): 41b POSITIVA; 41a NEGATIVA só nos corpos e nos marcadores das duas sobrecargas",
  );

  // (3) uma loja pela metade, nos dois sentidos
  {
    const s = await noEstado(SO_A_DE_TRES_VOLTOU);
    await exigirReprovadas(A, "41a com só a de 3 args de volta", s[A], [
      CORPO(A, F3),
      MARCA_A(F3),
    ]);
    await exigirReprovadas(B, "41b com só a de 3 args de volta", s[B], [
      CORPO(B, F2),
      MARCA_B(F2),
    ]);
  }
  ok(
    "loja pela metade (só a sobrecarga de 3 args voltou ao corpo de antes): 41a reprova SÓ o corpo e o marcador dela, 41b reprova SÓ os da OUTRA — nenhuma das duas dá POSITIVA",
  );

  // (4) um negativo por linha da 41a, em cada sobrecarga
  for (const fn of FUNCOES) {
    const negativos = [
      ["corpo com 1 byte a mais", corpoMaisUmByteDepois(fn), [CORPO(A, fn)]],
      [
        "corpo que volta a citar o log de push",
        corpoQueCitaOLog(fn),
        [CORPO(A, fn), MARCA_A(fn)],
      ],
      [
        "atributo trocado (SECURITY INVOKER)",
        atributoTrocado(fn),
        [ATRIB(A, fn)],
      ],
      [
        "EXECUTE aberto a PUBLIC",
        (c) => c.query(`GRANT EXECUTE ON FUNCTION ${fn} TO PUBLIC`),
        [EXEC(fn)],
      ],
      [
        "EXECUTE aberto a anon",
        (c) => c.query(`GRANT EXECUTE ON FUNCTION ${fn} TO anon`),
        [EXEC(fn)],
      ],
      [
        "EXECUTE fechado a authenticated",
        (c) => c.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM authenticated`),
        [EXEC(fn)],
      ],
      ["função AUSENTE", ausente(fn), [SOBRECARGAS(A), ...linhasDa(A, fn)]],
    ];
    for (const [rotulo, defeito, esperadas] of negativos) {
      const s = await noEstado(em(DEPOIS, defeito), [A]);
      await exigirReprovadas(
        A,
        `41a ${curto(fn)} com ${rotulo}`,
        s[A],
        esperadas,
      );
    }
  }
  {
    const s = await noEstado(em(DEPOIS, sobrecarga), [A]);
    await exigirReprovadas(A, "41a com uma terceira sobrecarga", s[A], [
      SOBRECARGAS(A),
    ]);
  }
  ok(
    "41a: um negativo por linha em CADA sobrecarga (corpo +1 byte, corpo que cita o log de push, atributo, EXECUTE de PUBLIC/anon/authenticated, função ausente) e a terceira sobrecarga — cada defeito reprova a SUA linha e leva o portão a NEGATIVA (a linha de controle não tem negativo local)",
  );

  // (5) 41b
  for (const fn of FUNCOES) {
    const negativos = [
      ["corpo com 1 byte a mais", corpoMaisUmByte(fn), [CORPO(B, fn)]],
      [
        "corpo que já grava no sino",
        corpoQueGravaNoSino(fn),
        [CORPO(B, fn), MARCA_B(fn)],
      ],
      [
        "atributo trocado (SECURITY INVOKER)",
        atributoTrocado(fn),
        [ATRIB(B, fn)],
      ],
      ["função AUSENTE", ausente(fn), [SOBRECARGAS(B), ...linhasDa(B, fn)]],
    ];
    for (const [rotulo, defeito, esperadas] of negativos) {
      const s = await noEstado(em(ANTES, defeito), [B]);
      await exigirReprovadas(
        B,
        `41b ${curto(fn)} com ${rotulo}`,
        s[B],
        esperadas,
      );
    }
  }
  {
    const s = await noEstado(em(ANTES, sobrecarga), [B]);
    await exigirReprovadas(B, "41b com uma terceira sobrecarga", s[B], [
      SOBRECARGAS(B),
    ]);
  }
  ok(
    "41b: corpo +1 byte, corpo que já grava no sino, atributo e função ausente reprovam a linha delas em CADA sobrecarga, e a terceira sobrecarga reprova a contagem — portão NEGATIVA",
  );

  // (6) mutantes do texto
  const zeros = "0".repeat(32);
  const mutantes = [
    [
      "41a com o md5 do corpo novo (2 args) trocado",
      A,
      trocar(SQL_A, `'${H[F2].desta}'`, `'${zeros}'`),
      DEPOIS,
      "positivo",
    ],
    [
      "41a com o md5 do corpo novo (3 args) trocado",
      A,
      trocar(SQL_A, `'${H[F3].desta}'`, `'${zeros}'`),
      DEPOIS,
      "positivo",
    ],
    [
      "41b com o md5 do vigente (2 args) trocado",
      B,
      trocar(SQL_B, `'${H[F2].vigente}'`, `'${zeros}'`),
      ANTES,
      "positivo",
    ],
    [
      "41b com o md5 do vigente (3 args) trocado",
      B,
      trocar(SQL_B, `'${H[F3].vigente}'`, `'${zeros}'`),
      ANTES,
      "positivo",
    ],
    [
      "41a contando as sobrecargas de outro nome",
      A,
      trocar(
        SQL_A,
        "q.proname = 'answer_question_atomic'",
        "q.proname = 'outro_nome'",
      ),
      DEPOIS,
      "positivo",
    ],
    [
      "41b com a sobrecarga de 3 args medindo a de 2",
      B,
      trocar(
        SQL_B,
        "('tres', 'public.answer_question_atomic(uuid,text,uuid)')",
        "('tres', 'public.answer_question_atomic(uuid,text)')",
      ),
      ANTES,
      "positivo",
    ],
    [
      "41a com o marcador sempre 'sim'",
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
      "41b com o marcador sempre 'nao'",
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
      "41a com o EXECUTE de anon sempre 'nao'",
      A,
      trocar(
        SQL_A,
        "WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'sim'",
        "WHEN false THEN 'sim'",
      ),
      em(DEPOIS, (c) => c.query(`GRANT EXECUTE ON FUNCTION ${F3} TO anon`)),
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
    "MUTANTES do texto das consultas: md5 novo (2 e 3 args) trocado na 41a, md5 vigente (2 e 3 args) trocado na 41b, contagem das sobrecargas, 3 args medindo 2 args, marcador sempre 'sim' (41a) ou sempre 'nao' (41b) e EXECUTE de anon sempre 'nao' — todos pegos (o mutante 'PUBLIC ignorado' é EQUIVALENTE: um GRANT a PUBLIC também abre anon, que a consulta mede; por isso não entra)",
  );

  // (7) rol fechado: resposta parcial ou rol de outra consulta nunca é POSITIVA
  {
    const s = await noEstado(DEPOIS);
    const parcial = s[A].filter((r) => r.ok === true).slice(0, -1);
    assert.ok(veredito(A, parcial).includes("rol=invalido"));
    assert.notEqual(await estadoNoPortao(A, parcial), "POSITIVA");
    assert.ok(
      veredito(A, s[B]).includes("rol=invalido"),
      "linhas da 41b julgadas pelo rol da 41a",
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
  // A prova e da 240: o clone volta antes da sucessora 1360, sem afrouxar preflight algum.
  await C.query("BEGIN");
  await require("./ex-admin-demais-tabelas-posterior.cjs").desfazerExAdminNaTransacao(C);
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
  console.log(`\npergunta-respondida-avisa-portao-viva: ${resultados} ok`);
}

main().catch((erro) =>
  falhar("PORTAO-41", erro?.stack ? erro.stack : String(erro)),
);
