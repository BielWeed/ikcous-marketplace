"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 24 (a media de avaliacoes e o voto
 * "util" fecham para o visitante) -- a migration 20261221000000 --, num Postgres EFEMERO local, nada de
 * rede, nada de loja:
 *   24a-conferir-avaliacoes-fechadas-ao-visitante.sql   (DEPOIS do apply: 3 linhas)
 *   24b-antes-avaliacoes-abertas-ao-visitante.sql       (ANTES do apply: 3 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso
 * so o run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de
 * tests/banco/avaliacoes-fechadas-ao-visitante-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a
 * arvore pode ou nao ja ter a 20261221, cada estado e' montado DENTRO de uma transacao (como o dono da
 * conexao) que termina em ROLLBACK: o DEPOIS e' a migration aplicada na transacao (idempotente) e o
 * ANTES e' o rollback-manual dela (um GRANT, idempotente). As consultas rodam nela como um papel de
 * LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_24A e
 *             ROL_DA_24B), sem repetir nem faltar, nos dois estados.
 *  ESTADOS    depois: 24a POSITIVA e 24b reprova SO as duas linhas de EXECUTE; antes (rollback): 24b
 *             POSITIVA e 24a reprova SO as duas linhas de EXECUTE; aplicar DE NOVO, ida e volta e os
 *             arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (EXECUTE aberto ou fechado por papel, PUBLIC, funcao ausente) reprova
 *             EXATAMENTE a linha da funcao; toda mutacao com guarda.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user)
 * e a ACL real das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/avaliacoes-fechadas-ao-visitante-portao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (a pasta de consultas e as migrations), nunca de entrada
 * de rede; as chaves de objeto vem de constantes e mapas fechados deste arquivo. */

const assert = require("node:assert/strict");
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

const A = "24a-conferir-avaliacoes-fechadas-ao-visitante";
const B = "24b-antes-avaliacoes-abertas-ao-visitante";
const ARQ =
  "20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_24A, [B]: CONF.ROL_DA_24B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const METRICAS = "public.get_reviews_metrics(text,integer)";
const VOTO = "public.increment_helpful(uuid)";
const L_METRICAS_A =
  "get_reviews_metrics: EXECUTE fechado para anon (authenticated e service_role sim)";
const L_VOTO_A =
  "increment_helpful: EXECUTE fechado para anon (authenticated e service_role sim)";
const L_METRICAS_B =
  "get_reviews_metrics: EXECUTE aberto para anon e authenticated";
const L_VOTO_B = "increment_helpful: EXECUTE aberto para anon e authenticated";

const PAPEL_RO = `portao24_ro_${process.pid}`;
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

const depois = (c) => c.query(MIGRATION);
const antes = (c) => c.query(ROLLBACK);

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
  "ROL: as 3 linhas da 24a e as 3 da 24b sao exatamente o rol, nos dois estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 3);
    assert.equal(ROL[B].length, 3);
  },
);

prova(
  "DEPOIS (migration aplicada): 24a POSITIVA; 24b reprova SO as duas linhas de EXECUTE",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "24a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [L_METRICAS_B, L_VOTO_B].sort());
    const m = s[A].find((l) => l.item === L_METRICAS_A);
    assert.equal(
      m.vivo,
      "PUBLIC=nao anon=nao authenticated=sim service_role=sim",
    );
  },
);

prova(
  "ANTES (rollback-manual): 24b POSITIVA; 24a reprova SO as duas linhas de EXECUTE",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "24b toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [L_METRICAS_A, L_VOTO_A].sort());
    const m = s[B].find((l) => l.item === L_METRICAS_B);
    assert.equal(
      m.vivo,
      "PUBLIC=nao anon=sim authenticated=sim service_role=sim",
    );
  },
);

prova("IDEMPOTENCIA, IDA E VOLTA e CRLF: o mesmo veredito", async () => {
  const dobro = await noEstado(
    async (c) => {
      await c.query(MIGRATION);
      await c.query(MIGRATION);
    },
    [A, B],
  );
  assert.deepEqual(reprovadas(dobro[A]), []);
  assert.deepEqual(reprovadas(dobro[B]), [L_METRICAS_B, L_VOTO_B].sort());
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
const ausente = (assinatura) =>
  `SELECT to_regprocedure('${assinatura}') IS NULL AS aplicou`;

const FUNCOES = [
  [METRICAS, L_METRICAS_A, L_METRICAS_B],
  [VOTO, L_VOTO_A, L_VOTO_B],
];

prova(
  "NEGATIVO 24a: a funcao aberta de novo ao anon ou a PUBLIC, sem authenticated ou sem service_role, ou ausente, reprova SO a linha dela",
  async () => {
    for (const [fn, linhaA] of FUNCOES) {
      for (const [mutar, guardaSql] of [
        [`GRANT EXECUTE ON FUNCTION ${fn} TO anon`, exec(fn, "anon")],
        [`GRANT EXECUTE ON FUNCTION ${fn} TO PUBLIC`, execPublic(fn)],
        [
          `REVOKE EXECUTE ON FUNCTION ${fn} FROM authenticated`,
          semExec(fn, "authenticated"),
        ],
        [
          `REVOKE EXECUTE ON FUNCTION ${fn} FROM service_role`,
          semExec(fn, "service_role"),
        ],
        [`DROP FUNCTION ${fn}`, ausente(fn)],
      ])
        await negativo(A, { mutar, guardaSql }, [linhaA]);
    }
  },
);

prova(
  "NEGATIVO 24b: a funcao fechada so para um papel, aberta a PUBLIC, sem service_role ou ausente reprova SO a linha dela",
  async () => {
    for (const [fn, , linhaB] of FUNCOES) {
      for (const [mutar, guardaSql] of [
        [`REVOKE EXECUTE ON FUNCTION ${fn} FROM anon`, semExec(fn, "anon")],
        [
          `REVOKE EXECUTE ON FUNCTION ${fn} FROM authenticated`,
          semExec(fn, "authenticated"),
        ],
        [
          `REVOKE EXECUTE ON FUNCTION ${fn} FROM service_role`,
          semExec(fn, "service_role"),
        ],
        [`GRANT EXECUTE ON FUNCTION ${fn} TO PUBLIC`, execPublic(fn)],
        [`DROP FUNCTION ${fn}`, ausente(fn)],
      ])
        await negativo(B, { estado: antes, mutar, guardaSql }, [linhaB]);
    }
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
      / linhas=3 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=3 ok_false=2 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=3 ok_false=2 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, a[B]),
      / linhas=3 ok_false=0 ok_nao_booleano=0 rol=ok$/,
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
      `${falhas.length} de ${PROVAS.length} provas do portao 24 falharam.`,
    );
  }
  console.log(
    `\n[avaliacoes-fechadas-ao-visitante-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
