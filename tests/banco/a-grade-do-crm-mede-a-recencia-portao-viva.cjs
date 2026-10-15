"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 33 (a grade do CRM mede a recencia do mesmo
 * instante da lista) -- a migration 20261232000000 (crm_visao) --, num Postgres EFEMERO local, nada de rede,
 * nada de loja:
 *   33a-conferir-grade-do-crm-aplicado.sql           (DEPOIS do apply: 5 linhas)
 *   33b-antes-grade-do-crm-corpo-vigente.sql         (ANTES do apply: 4 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que cada
 * consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o run da
 * consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de tests/banco/a-grade-do-crm-mede-a-recencia-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Cada estado e' montado
 * DENTRO de uma transacao (como o dono da conexao) que termina em ROLLBACK, a partir de uma BASE FIXA: o corpo da
 * 20261227000000 (o rollback-manual da 32 desfaz a sucessora quando ela ja esta, e a 27 e' aplicada quando o corpo
 * e' o da 99). O DEPOIS e' a base + a migration; o ANTES e' o DEPOIS seguido do rollback-manual; o SEM A 27 e' o
 * corpo da 20261199000000 (a loja que ainda espera a decisao do dono). As consultas rodam nela como um papel de
 * LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_33A e ROL_DA_33B),
 *             sem repetir nem faltar, em todos os estados (inclusive com a funcao ausente).
 *  ESTADOS    depois: 33a POSITIVA e 33b reprova SO o md5 e o marcador; antes: 33b POSITIVA e 33a reprova SO o md5
 *             e o marcador; sem a 27 (corpo da 99): 33b reprova SO o md5 (a ordem errada aparece) e 33a o md5 e o
 *             marcador; aplicar DE NOVO, ida e volta e os arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais no corpo, corpo de antes, corpo sem a ancora, volatilidade, SECURITY
 *             INVOKER, search_path, EXECUTE por papel e PUBLIC, funcao ausente) reprova EXATAMENTE as linhas
 *             certas; toda mutacao com guarda. A 33b NAO mede a ACL.
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (33a) ou o do arquivo do
 *             rollback-manual (33b) carrega.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user), a
 * ACL real e o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-grade-do-crm-mede-a-recencia-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas e as migrations), nunca de entrada
 * de rede; as chaves de objeto vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "33a-conferir-grade-do-crm-aplicado";
const B = "33b-antes-grade-do-crm-corpo-vigente";
const ARQ27 = "20261227000000_o_crm_compara_o_que_e_comparavel.sql";
const ARQ32 =
  "20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const lerMig = (nome) =>
  fs.readFileSync(path.join(MIGRATIONS, nome), "utf8").replace(/\r\n/g, "\n");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_33A, [B]: CONF.ROL_DA_33B };
const MIG27 = lerMig(ARQ27);
const RB27 = lerMig(`rollback-manual-${ARQ27}`);
const MIG32 = lerMig(ARQ32);
const RB32 = lerMig(`rollback-manual-${ARQ32}`);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<fn>(` do arquivo. */
function corpoDe(sql, fn) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `${fn}: sem CREATE OR REPLACE FUNCTION`);
  assert.equal(
    sql.split(`CREATE OR REPLACE FUNCTION public.${fn}(`).length - 1,
    1,
    `${fn}: mais de uma definicao no arquivo`,
  );
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  assert.ok(m, `${fn}: sem abertura de dollar-quote`);
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}

const CORPO = {
  c99: corpoDe(RB27, "crm_visao"), // o corpo de ANTES da 27 (o da 20261199000000)
  c27: corpoDe(MIG27, "crm_visao"), // o corpo vigente deste lote (o da 20261227000000)
  c32: corpoDe(MIG32, "crm_visao"), // o corpo novo deste lote
};
const H = {
  c99: md5(CORPO.c99),
  c27: md5(CORPO.c27),
  c32: md5(CORPO.c32),
};
const MARCADOR =
  "LEAST(((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'), now())";

const CRM = "public.crm_visao(date,date)";

// ---- as linhas dos dois rols, pelo texto exato
const A_MD5 =
  "crm_visao: corpo e o da 20261232000000, com a ancora de agora (md5)";
const A_MARC =
  "crm_visao: o corpo mede o periodo ate agora (LEAST da meia-noite de amanha com now())";
const A_ATRIB =
  "crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)";
const A_ACL =
  "crm_visao: EXECUTE fechado para anon (authenticated e service_role sim)";
const B_MD5 =
  "crm_visao: corpo e o da 20261227000000, sem a ancora de agora (md5)";
const B_MARC = "crm_visao: o corpo ainda NAO mede o periodo ate agora";
const B_ATRIB = A_ATRIB;

const PAPEL_RO = `portao33_ro_${process.pid}`;
let C;

/** Monta o estado dentro de uma transacao, roda as consultas como o papel de leitura e desfaz tudo. */
async function noEstado(montar, consultas, { comoDono = false } = {}) {
  await C.query("BEGIN");
  try {
    if (montar) await montar(C);
    if (!comoDono) {
      await C.query(`SET LOCAL ROLE ${PAPEL_RO}`);
      await C.query("SET LOCAL transaction_read_only = on");
      assert.equal(
        (await C.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
    }
    const saidas = {};
    for (const nome of consultas) {
      const r = await C.query(SQL[nome]);
      assert.deepEqual(
        r.fields.map((x) => x.name),
        ["item", "esperado", "vivo", "ok"],
        "colunas item/esperado/vivo/ok",
      );
      saidas[nome] = r.rows;
    }
    return saidas;
  } finally {
    await C.query("ROLLBACK");
  }
}

const hashVivo = async (c) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.crm_visao(date,date)')",
    )
  ).rows[0]?.h;

// BASE: o corpo da 20261227000000, qualquer que seja o estado da arvore (a arvore pode ter a 32 por cima da 27, ou
// ainda o corpo da 99 se a 27 nao entrou). O rollback-manual da 32 aceita o corpo da 27 ou o da 32.
const base27 = async (c) => {
  const h = await hashVivo(c);
  if (h === H.c32) await c.query(RB32);
  if ((await hashVivo(c)) === H.c99) await c.query(MIG27);
  assert.equal(await hashVivo(c), H.c27, "a base nao ficou no corpo da 27");
};
// DEPOIS: a base + a migration (idempotente: aceita o corpo da 27 e o seu proprio).
const depois = async (c) => {
  await base27(c);
  await c.query(MIG32);
};
// ANTES: o DEPOIS desfeito pelo rollback-manual (o corpo da 27 de volta).
const antes = async (c) => {
  await depois(c);
  await c.query(RB32);
};
// SEM A 27: a loja que ainda espera a decisao do dono (corpo da 99); a 32 nao pode ter sido aplicada.
const sem27 = async (c) => {
  await antes(c);
  await c.query(RB27);
  assert.equal(await hashVivo(c), H.c99, "sem a 27 nao ficou no corpo da 99");
};

const reprovadas = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();

/** O rol da consulta: as linhas sao exatamente o contrato, cada uma UMA vez. */
function confereRol(nome, linhas) {
  assert.deepEqual(
    linhas.map((l) => l.item).sort(),
    [...ROL[nome]].sort(),
    `${nome}: as linhas nao sao exatamente o rol`,
  );
  assert.equal(new Set(linhas.map((l) => l.item)).size, linhas.length);
  for (const l of linhas)
    assert.equal(
      typeof l.ok,
      "boolean",
      `${nome}: ok nao booleano em ${l.item}`,
    );
}

/** Guarda: a mutacao tem de ter aplicado; sem ela um mutante que nao faz nada vira falso verde. */
async function guarda(sql) {
  const r = await C.query(sql);
  assert.equal(r.rows[0].aplicou, true, `a mutacao nao aplicou: ${sql}`);
}

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova(
  "HASH: o md5 literal de cada consulta e' o do corpo que o arquivo carrega",
  async () => {
    assert.equal(H.c99, "7f6ec1bc0fa9f40591c0b577201b7c36");
    assert.equal(H.c27, "c33073503fccc6caa5f1085265501eae");
    assert.equal(H.c32, "0dfda3ea5129c6f8aabfcf0052fd2936");
    assert.ok(SQL[A].includes(`'${H.c32}'`), "33a: md5 do corpo novo");
    assert.ok(SQL[B].includes(`'${H.c27}'`), "33b: md5 do corpo vigente");
    assert.ok(!SQL[A].includes(H.c27), "33a nao cita o corpo de antes");
    assert.ok(!SQL[B].includes(H.c32), "33b nao cita o corpo novo");
    assert.ok(
      MIG32.includes(`'${H.c27}', '${H.c32}'`) &&
        RB32.includes(`'${H.c27}', '${H.c32}'`),
      "a migration e o rollback citam (vigente = o da 27, desta = o da 32)",
    );
    // o rollback devolve o corpo da 27 byte a byte
    assert.equal(md5(corpoDe(RB32, "crm_visao")), H.c27);
    assert.equal(corpoDe(RB32, "crm_visao"), CORPO.c27);
    // o marcador e' do corpo novo, nao do vigente
    assert.ok(CORPO.c32.includes(MARCADOR));
    assert.ok(!CORPO.c27.includes(MARCADOR));
    assert.ok(!CORPO.c99.includes(MARCADOR));
  },
);

prova(
  "ROL: as 5 linhas da 33a e as 4 da 33b sao exatamente o rol, em todos os estados (inclusive funcao ausente)",
  async () => {
    for (const montar of [
      depois,
      antes,
      sem27,
      async (c) => {
        await depois(c);
        await c.query(`DROP FUNCTION ${CRM}`);
      },
    ]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 5);
    assert.equal(ROL[B].length, 4);
  },
);

prova(
  "DEPOIS (a migration): 33a POSITIVA; 33b reprova SO as linhas de corpo e marcador",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "33a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [B_MD5, B_MARC].sort());
    assert.equal(s[A].find((l) => l.item === A_MD5).vivo, H.c32);
    assert.equal(s[A].find((l) => l.item === A_MARC).vivo, "sim");
    assert.equal(
      s[A].find((l) => l.item === A_ACL).vivo,
      "PUBLIC=nao anon=nao authenticated=sim service_role=sim",
    );
    assert.equal(s[B].find((l) => l.item === B_MD5).vivo, H.c32);
  },
);

prova(
  "ANTES (o rollback-manual): 33b POSITIVA; 33a reprova SO as linhas de corpo e marcador",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "33b toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [A_MD5, A_MARC].sort());
    assert.equal(s[B].find((l) => l.item === B_MD5).vivo, H.c27);
    assert.equal(s[B].find((l) => l.item === B_MARC).vivo, "nao");
  },
);

prova(
  "SEM A 27 (corpo da 20261199000000, a loja que espera a decisao do dono): a 33b reprova o md5 (a ordem errada aparece) e a 33a o md5 e o marcador; e o pre-voo da migration RECUSA sem escrever",
  async () => {
    const s = await noEstado(sem27, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [B_MD5], "33b reprova so o md5");
    assert.equal(s[B].find((l) => l.item === B_MD5).vivo, H.c99);
    assert.deepEqual(reprovadas(s[A]), [A_MD5, A_MARC].sort());
    await C.query("BEGIN");
    try {
      await sem27(C);
      await C.query("SAVEPOINT s");
      await assert.rejects(
        () => C.query(MIG32),
        /B1_BASELINE_DIVERGENT: o corpo vivo de public\.crm_visao\(date,date\) ainda é o da 20261199000000/,
      );
      await C.query("ROLLBACK TO SAVEPOINT s");
      assert.equal(await hashVivo(C), H.c99, "o pre-voo recusou sem escrever");
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

prova(
  "CORPO ESTRANHO por cima da 32: a 33a reprova SO o md5 e mostra o md5 DELE; a 33b tambem reprova o md5",
  async () => {
    const s = await noEstado(
      async (c) => {
        await depois(c);
        await c.query(FUNCOES.cria(`${CORPO.c32} `, ATRIBUTOS));
        await guarda(doProc(CRM, "right(prosrc, 1) = ' '"));
      },
      [A, B],
    );
    assert.deepEqual(reprovadas(s[A]), [A_MD5]);
    assert.equal(s[A].find((l) => l.item === A_MD5).vivo, md5(`${CORPO.c32} `));
    assert.deepEqual(reprovadas(s[B]), [B_MD5, B_MARC].sort());
  },
);

prova("IDEMPOTENCIA, IDA E VOLTA e CRLF: o mesmo veredito", async () => {
  const dobro = await noEstado(
    async (c) => {
      await depois(c);
      await depois(c);
    },
    [A, B],
  );
  assert.deepEqual(reprovadas(dobro[A]), []);
  assert.deepEqual(reprovadas(dobro[B]), [B_MD5, B_MARC].sort());
  const idaEVolta = await noEstado(
    async (c) => {
      await antes(c);
      await depois(c);
    },
    [A],
  );
  assert.deepEqual(reprovadas(idaEVolta[A]), []);
  const crlf = await noEstado(
    async (c) => {
      await base27(c);
      await c.query(emCRLF(MIG32));
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlf[A]), [], "o md5 ignora o CR");
  const crlfAntes = await noEstado(
    async (c) => {
      await depois(c);
      await c.query(emCRLF(RB32));
    },
    [B],
  );
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
  // o rollback duas vezes deixa o mesmo estado
  const rbDobro = await noEstado(
    async (c) => {
      await antes(c);
      await c.query(RB32);
    },
    [B],
  );
  assert.deepEqual(reprovadas(rbDobro[B]), []);
});

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [depois, antes, sem27]) {
      const comoDono = await noEstado(montar, [A, B], { comoDono: true });
      const comoLeitura = await noEstado(montar, [A, B]);
      assert.deepEqual(comoLeitura[A], comoDono[A]);
      assert.deepEqual(comoLeitura[B], comoDono[B]);
    }
  },
);

/** Um negativo: a mutacao (com guarda) reprova EXATAMENTE `esperadas` na consulta. */
async function negativo(
  consulta,
  { estado = depois, mutar, guardaSql },
  esperadas,
) {
  const s = await noEstado(
    async (c) => {
      await estado(c);
      await c.query(mutar);
      await guarda(guardaSql);
    },
    [consulta],
  );
  assert.deepEqual(reprovadas(s[consulta]), [...esperadas].sort(), mutar);
}

const FUNCOES = {
  cria: (corpo, attrs) =>
    `CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)
         RETURNS jsonb LANGUAGE plpgsql ${attrs}
       AS $x$${corpo}$x$`,
};
const ATRIBUTOS = "STABLE SECURITY DEFINER SET search_path TO 'public'";
const doProc = (sig, cond) =>
  `SELECT ${cond} AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${sig}')`;
const exec = (sig, papel) =>
  `SELECT has_function_privilege('${papel}', '${sig}'::regprocedure, 'EXECUTE') AS aplicou`;
const semExec = (sig, papel) =>
  `SELECT NOT has_function_privilege('${papel}', '${sig}'::regprocedure, 'EXECUTE') AS aplicou`;
const execPublic = (sig) =>
  `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${sig}'::regprocedure AND a.grantee = 0) AS aplicou`;
const ausente = (sig) => `SELECT to_regprocedure('${sig}') IS NULL AS aplicou`;
const SEM_MARCADOR = `position('${MARCADOR.replace(/'/g, "''")}' IN prosrc) = 0`;
const COM_MARCADOR = `position('${MARCADOR.replace(/'/g, "''")}' IN prosrc) > 0`;

prova(
  "NEGATIVO 33a: 1 byte a mais, corpo de antes, corpo sem a ancora, VOLATILE, SECURITY INVOKER, search_path, ACL por papel e PUBLIC e funcao ausente reprovam SO as linhas certas",
  async () => {
    // controle: sem mutacao a 33a passa
    await negativo(
      A,
      { mutar: "SELECT 1", guardaSql: "SELECT true AS aplicou" },
      [],
    );
    const semAncora = CORPO.c32.replaceAll(
      MARCADOR,
      "((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')",
    );
    assert.notEqual(semAncora, CORPO.c32);
    const casos = [
      [
        FUNCOES.cria(`${CORPO.c32} `, ATRIBUTOS),
        doProc(CRM, "right(prosrc, 1) = ' '"),
        [A_MD5],
      ],
      [
        FUNCOES.cria(CORPO.c27, ATRIBUTOS),
        doProc(CRM, SEM_MARCADOR),
        [A_MD5, A_MARC],
      ],
      [
        FUNCOES.cria(CORPO.c99, ATRIBUTOS),
        doProc(CRM, SEM_MARCADOR),
        [A_MD5, A_MARC],
      ],
      [
        FUNCOES.cria(semAncora, ATRIBUTOS),
        doProc(CRM, SEM_MARCADOR),
        [A_MD5, A_MARC],
      ],
      [
        `ALTER FUNCTION ${CRM} VOLATILE`,
        doProc(CRM, "provolatile = 'v'"),
        [A_ATRIB],
      ],
      [
        `ALTER FUNCTION ${CRM} SECURITY INVOKER`,
        doProc(CRM, "NOT prosecdef"),
        [A_ATRIB],
      ],
      [
        `ALTER FUNCTION ${CRM} SET search_path TO public, extensions`,
        doProc(
          CRM,
          "proconfig = ARRAY['search_path=public, extensions']::text[]",
        ),
        [A_ATRIB],
      ],
      [`GRANT EXECUTE ON FUNCTION ${CRM} TO anon`, exec(CRM, "anon"), [A_ACL]],
      [`GRANT EXECUTE ON FUNCTION ${CRM} TO PUBLIC`, execPublic(CRM), [A_ACL]],
      [
        `REVOKE EXECUTE ON FUNCTION ${CRM} FROM authenticated`,
        semExec(CRM, "authenticated"),
        [A_ACL],
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${CRM} FROM service_role`,
        semExec(CRM, "service_role"),
        [A_ACL],
      ],
      [`DROP FUNCTION ${CRM}`, ausente(CRM), [A_MD5, A_MARC, A_ATRIB, A_ACL]],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(A, { mutar, guardaSql }, esperadas);
  },
);

prova(
  "NEGATIVO 33b: corpo de antes com 1 byte a mais, corpo novo, corpo da 99, VOLATILE, SECURITY INVOKER e funcao ausente reprovam SO as linhas certas; ACL aberta ou sem authenticated NAO reprova",
  async () => {
    // controle: sem mutacao a 33b passa
    await negativo(
      B,
      { estado: antes, mutar: "SELECT 1", guardaSql: "SELECT true AS aplicou" },
      [],
    );
    const casos = [
      [
        FUNCOES.cria(`${CORPO.c27} `, ATRIBUTOS),
        doProc(CRM, "right(prosrc, 1) = ' '"),
        [B_MD5],
      ],
      [
        FUNCOES.cria(CORPO.c32, ATRIBUTOS),
        doProc(CRM, COM_MARCADOR),
        [B_MD5, B_MARC],
      ],
      [FUNCOES.cria(CORPO.c99, ATRIBUTOS), doProc(CRM, SEM_MARCADOR), [B_MD5]],
      [
        `ALTER FUNCTION ${CRM} VOLATILE`,
        doProc(CRM, "provolatile = 'v'"),
        [B_ATRIB],
      ],
      [
        `ALTER FUNCTION ${CRM} SECURITY INVOKER`,
        doProc(CRM, "NOT prosecdef"),
        [B_ATRIB],
      ],
      [`DROP FUNCTION ${CRM}`, ausente(CRM), [B_MD5, B_MARC, B_ATRIB]],
      // a 33b nao mede a ACL: estes nao a reprovam
      [`GRANT EXECUTE ON FUNCTION ${CRM} TO anon`, exec(CRM, "anon"), []],
      [`GRANT EXECUTE ON FUNCTION ${CRM} TO PUBLIC`, execPublic(CRM), []],
      [
        `REVOKE EXECUTE ON FUNCTION ${CRM} FROM authenticated`,
        semExec(CRM, "authenticated"),
        [],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(B, { estado: antes, mutar, guardaSql }, esperadas);
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 2)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const veredito = (consulta, linhas) =>
      CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
    const d = await noEstado(depois, [A, B]);
    assert.match(
      veredito(A, d[A]),
      / linhas=5 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=4 ok_false=2 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=5 ok_false=2 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, a[B]),
      / linhas=4 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    // sem a 27 a 33b NAO e positiva: a loja na ordem errada nunca passa
    const z = await noEstado(sem27, [A, B]);
    assert.match(
      veredito(B, z[B]),
      / linhas=4 ok_false=1 ok_nao_booleano=0 rol=ok$/,
    );
    // Uma linha a menos nao e' o rol: o portao nunca a le como positiva.
    assert.match(veredito(A, d[A].slice(1)), / rol=invalido$/);
    assert.match(veredito(B, a[B].slice(1)), / rol=invalido$/);
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  C.on("error", () => {});
  await C.connect();
  const falhas = [];
  try {
    await C.query(`CREATE ROLE ${PAPEL_RO} NOLOGIN NOSUPERUSER BYPASSRLS`);
    await C.query(`GRANT pg_read_all_data TO ${PAPEL_RO}`);
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${e.message.split("\n").join("\n    ")}`,
        );
      }
    }
  } finally {
    await C.query(`DROP OWNED BY ${PAPEL_RO}`).catch(() => {});
    await C.query(`DROP ROLE IF EXISTS ${PAPEL_RO}`).catch(() => {});
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas do portao 33 falharam.`,
    );
  }
  console.log(
    `\n[a-grade-do-crm-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
