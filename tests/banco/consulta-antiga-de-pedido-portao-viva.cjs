"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 23 (a consulta antiga de pedido por
 * codigo fecha para o visitante) -- a migration 20261220000000 --, num Postgres EFEMERO local, nada de
 * rede, nada de loja:
 *   23a-conferir-consulta-antiga-de-pedido-fechada.sql   (DEPOIS do apply: 5 linhas)
 *   23b-antes-consulta-antiga-de-pedido-aberta.sql       (ANTES do apply: 5 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso
 * so o run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de
 * tests/banco/consulta-antiga-de-pedido-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a
 * arvore pode ou nao ja ter a 20261220, cada estado e' montado DENTRO de uma transacao (como o dono da
 * conexao) que termina em ROLLBACK: o DEPOIS e' a migration aplicada na transacao (idempotente) e o
 * ANTES e' o rollback-manual dela (um GRANT, idempotente). As consultas rodam nela como um papel de
 * LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_23A e
 *             ROL_DA_23B), sem repetir nem faltar, nos dois estados.
 *  ESTADOS    depois: 23a POSITIVA e 23b reprova SO a linha de EXECUTE da v1; antes (rollback): 23b
 *             POSITIVA e 23a reprova SO a linha de EXECUTE da v1; aplicar DE NOVO, ida e volta e os
 *             arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (EXECUTE aberto ou fechado por papel, PUBLIC, corpo diferente, funcao
 *             ausente) reprova EXATAMENTE as linhas previstas; toda mutacao com guarda.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user) e a ACL real das lojas NAO foram medidos aqui. (2) Nao ha mutantes do TEXTO
 * do .sql: a prova cobre o comportamento da consulta em cada estado.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/consulta-antiga-de-pedido-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas e as migrations), nunca de entrada
 * de rede; as chaves de objeto vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  desfazerRastreioDoConvidadoNaTransacao,
  CORPO_1342,
} = require("./rastreio-do-convidado-posterior.cjs");

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "23a-conferir-consulta-antiga-de-pedido-fechada";
const B = "23b-antes-consulta-antiga-de-pedido-aberta";
const ARQ =
  "20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_23A, [B]: CONF.ROL_DA_23B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const V1 = "public.get_orders_by_otp_v1(text,text)";
const V2 = "public.get_orders_by_otp_v2(text,text,text,text)";
const L_V1_EXEC_A =
  "get_orders_by_otp_v1: EXECUTE fechado para anon e authenticated";
const L_V1_EXEC_B =
  "get_orders_by_otp_v1: EXECUTE aberto para anon e authenticated";
const L_V1_CORPO = "get_orders_by_otp_v1: corpo e o da 20261217000000 (md5)";
const L_V2_EXEC =
  "get_orders_by_otp_v2: EXECUTE aberto para anon e authenticated";
const L_V2_CORPO = "get_orders_by_otp_v2: corpo e o da 20261217000000 (md5)";

const PAPEL_RO = `portao23_ro_${process.pid}`;
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

// O ANTES e o DEPOIS da 20261220 sao de um banco que ainda nao tem a 20261341 nem a 20261342 (posteriores, aplicadas
// depois): a v2 la e' a da 20261217, que e' o que as duas consultas medem. O estado COM as sucessoras no ar (a 23a as
// aceita; a 23b, que e' o ANTES, nao) tem prova propria mais abaixo (`comSucessoras`).
const depois = async (c) => {
  await desfazerRastreioDoConvidadoNaTransacao(c);
  await c.query(MIGRATION);
};
const antes = async (c) => {
  await c.query(ROLLBACK);
  await desfazerRastreioDoConvidadoNaTransacao(c);
};
const comSucessoras = async (c) => {
  await c.query(MIGRATION);
  // guarda: a v2 viva e' mesmo a da 20261342 (sem isso a prova mediria a 1217 e passaria por engano)
  const h = (
    await c.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [V2],
    )
  ).rows[0].h;
  assert.equal(h, CORPO_1342, "a arvore nao tem a 20261342 no ar");
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
  "ROL: as 5 linhas da 23a e as 5 da 23b sao exatamente o rol, nos dois estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 5);
    assert.equal(ROL[B].length, 5);
  },
);

prova(
  "DEPOIS (migration aplicada): 23a POSITIVA; 23b reprova SO a linha de EXECUTE da v1",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "23a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [L_V1_EXEC_B]);
    const v1 = s[A].find((l) => l.item === L_V1_EXEC_A);
    assert.equal(
      v1.vivo,
      "PUBLIC=nao anon=nao authenticated=nao service_role=sim",
    );
  },
);

prova(
  "ANTES (rollback-manual): 23b POSITIVA; 23a reprova SO a linha de EXECUTE da v1",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "23b toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [L_V1_EXEC_A]);
    const v1 = s[B].find((l) => l.item === L_V1_EXEC_B);
    assert.equal(
      v1.vivo,
      "PUBLIC=nao anon=sim authenticated=sim service_role=sim",
    );
  },
);

prova(
  "COM AS SUCESSORAS (20261341 e 20261342 no ar sobre a 20261220): a 23a segue POSITIVA e a 23b (que e' o ANTES) reprova a v1 e o corpo da v2",
  async () => {
    const s = await noEstado(comSucessoras, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "23a toda ok com as sucessoras");
    assert.deepEqual(
      reprovadas(s[B]),
      [L_V1_EXEC_B, L_V2_CORPO].sort(),
      "23b reprova v1 aberta e o corpo da v2",
    );
    // O `vivo` da 23a mostra o estado de verdade na linha do corpo da v2: o md5 da 20261217 (aceito como sucessora).
    const v2 = s[A].find((l) => l.item === L_V2_CORPO);
    assert.equal(v2.vivo, v2.esperado);
  },
);

prova("IDEMPOTENCIA, IDA E VOLTA e CRLF: o mesmo veredito", async () => {
  const dobro = await noEstado(
    async (c) => {
      await desfazerRastreioDoConvidadoNaTransacao(c);
      await c.query(MIGRATION);
      await c.query(MIGRATION);
    },
    [A, B],
  );
  assert.deepEqual(reprovadas(dobro[A]), []);
  assert.deepEqual(reprovadas(dobro[B]), [L_V1_EXEC_B]);
  const idaEVolta = await noEstado(
    async (c) => {
      await c.query(ROLLBACK);
      await c.query(MIGRATION);
    },
    [A],
  );
  assert.deepEqual(reprovadas(idaEVolta[A]), []);
  const crlf = await noEstado(
    async (c) => {
      await c.query(emCRLF(ROLLBACK));
      await c.query(emCRLF(MIGRATION));
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlf[A]), []);
  const dois = await noEstado(
    async (c) => {
      await c.query(ROLLBACK);
      await c.query(ROLLBACK);
      await desfazerRastreioDoConvidadoNaTransacao(c);
    },
    [B],
  );
  assert.deepEqual(reprovadas(dois[B]), []);
});

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [depois, antes]) {
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

const exec = (assinatura, papel) =>
  `SELECT has_function_privilege('${papel}', '${assinatura}'::regprocedure, 'EXECUTE') AS aplicou`;
const semExec = (assinatura, papel) =>
  `SELECT NOT has_function_privilege('${papel}', '${assinatura}'::regprocedure, 'EXECUTE') AS aplicou`;
const execPublic = (assinatura) =>
  `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${assinatura}'::regprocedure AND a.grantee = 0) AS aplicou`;
const corpoOutro = (assinatura) =>
  `DO $m$ BEGIN EXECUTE replace(pg_get_functiondef('${assinatura}'::regprocedure), 'AS $function$', 'AS $function$-- outro corpo' || chr(10)); END $m$`;
const guardaCorpo = (assinatura) =>
  `SELECT prosrc LIKE '-- outro corpo%' AS aplicou FROM pg_proc WHERE oid = '${assinatura}'::regprocedure`;
const ausente = (assinatura) =>
  `SELECT to_regprocedure('${assinatura}') IS NULL AS aplicou`;

prova(
  "NEGATIVO 23a: a v1 aberta de novo (por papel ou por PUBLIC), ou sem a service_role, reprova SO a linha de EXECUTE da v1",
  async () => {
    for (const [mutar, guardaSql] of [
      [`GRANT EXECUTE ON FUNCTION ${V1} TO anon`, exec(V1, "anon")],
      [
        `GRANT EXECUTE ON FUNCTION ${V1} TO authenticated`,
        exec(V1, "authenticated"),
      ],
      [`GRANT EXECUTE ON FUNCTION ${V1} TO PUBLIC`, execPublic(V1)],
      [
        `REVOKE EXECUTE ON FUNCTION ${V1} FROM service_role`,
        semExec(V1, "service_role"),
      ],
    ])
      await negativo(A, { mutar, guardaSql }, [L_V1_EXEC_A]);
  },
);

prova(
  "NEGATIVO 23a: a v2 fechada para um papel, aberta a PUBLIC ou sem service_role reprova SO a linha de EXECUTE da v2",
  async () => {
    for (const [mutar, guardaSql] of [
      [`REVOKE EXECUTE ON FUNCTION ${V2} FROM anon`, semExec(V2, "anon")],
      [
        `REVOKE EXECUTE ON FUNCTION ${V2} FROM authenticated`,
        semExec(V2, "authenticated"),
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${V2} FROM service_role`,
        semExec(V2, "service_role"),
      ],
      [`GRANT EXECUTE ON FUNCTION ${V2} TO PUBLIC`, execPublic(V2)],
    ])
      await negativo(A, { mutar, guardaSql }, [L_V2_EXEC]);
  },
);

prova(
  "NEGATIVO 23a: corpo diferente reprova SO o corpo; funcao ausente reprova corpo e EXECUTE",
  async () => {
    await negativo(A, { mutar: corpoOutro(V1), guardaSql: guardaCorpo(V1) }, [
      L_V1_CORPO,
    ]);
    await negativo(A, { mutar: corpoOutro(V2), guardaSql: guardaCorpo(V2) }, [
      L_V2_CORPO,
    ]);
    await negativo(
      A,
      { mutar: `DROP FUNCTION ${V1}`, guardaSql: ausente(V1) },
      [L_V1_CORPO, L_V1_EXEC_A],
    );
    await negativo(
      A,
      { mutar: `DROP FUNCTION ${V2}`, guardaSql: ausente(V2) },
      [L_V2_CORPO, L_V2_EXEC],
    );
  },
);

prova(
  "NEGATIVO 23b: v1 fechada so para um papel ou sem service_role, v2 fechada, corpo diferente e funcao ausente reprovam SO a sua linha",
  async () => {
    for (const [mutar, guardaSql] of [
      [
        `REVOKE EXECUTE ON FUNCTION ${V1} FROM authenticated`,
        semExec(V1, "authenticated"),
      ],
      [`REVOKE EXECUTE ON FUNCTION ${V1} FROM anon`, semExec(V1, "anon")],
      [
        `REVOKE EXECUTE ON FUNCTION ${V1} FROM service_role`,
        semExec(V1, "service_role"),
      ],
      [`GRANT EXECUTE ON FUNCTION ${V1} TO PUBLIC`, execPublic(V1)],
    ])
      await negativo(B, { estado: antes, mutar, guardaSql }, [L_V1_EXEC_B]);
    await negativo(
      B,
      {
        estado: antes,
        mutar: `REVOKE EXECUTE ON FUNCTION ${V2} FROM anon`,
        guardaSql: semExec(V2, "anon"),
      },
      [L_V2_EXEC],
    );
    await negativo(
      B,
      { estado: antes, mutar: corpoOutro(V1), guardaSql: guardaCorpo(V1) },
      [L_V1_CORPO],
    );
    // loja SEM o lote 21 (a v2 nao existe): a 23b reprova a v2 e a migration nao devia entrar
    await negativo(
      B,
      { estado: antes, mutar: `DROP FUNCTION ${V2}`, guardaSql: ausente(V2) },
      [L_V2_CORPO, L_V2_EXEC],
    );
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 1)",
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
      / linhas=5 ok_false=1 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=5 ok_false=1 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, a[B]),
      / linhas=5 ok_false=0 ok_nao_booleano=0 rol=ok$/,
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
      `${falhas.length} de ${PROVAS.length} provas do portao 23 falharam.`,
    );
  }
  console.log(
    `\n[consulta-antiga-de-pedido-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
