"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 21 (o e-mail da loja tem teto e o
 * codigo do convidado nao se queima) -- a migration 20261217000000 --, num Postgres EFEMERO local,
 * nada de rede, nada de loja:
 *   21a-conferir-teto-de-email-aplicado.sql        (DEPOIS do apply: 14 linhas)
 *   21b-antes-teto-de-email-corpos-vigentes.sql    (ANTES do apply: 8 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso
 * so o run da consulta contra o ref de cada loja diz). O COMPORTAMENTO das funcoes e' de
 * tests/banco/teto-de-email-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada: a 20261217
 * aplicada = o DEPOIS). Cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que
 * termina em ROLLBACK; as consultas rodam nela como um papel de LEITURA nao superusuario, com
 * `SET LOCAL ROLE` e a transacao ja somente leitura. O ANTES e' o DEPOIS com o rollback-manual da
 * migration executado na transacao.
 *
 * CASOS:
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_21A e
 *             ROL_DA_21B), sem repetir nem faltar, em qualquer estado.
 *  ESTADOS    depois: 21a POSITIVA e 21b reprova SO os 3 corpos trocados; antes (rollback): 21b POSITIVA
 *             e 21a reprova SO os 3 corpos trocados (a tabela, as funcoes de apoio e a v2 ficam);
 *             aplicar DE NOVO, ida e volta e os arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (EXECUTE aberto ou fechado por papel, RLS desligada, privilegio de tabela,
 *             corpo diferente, funcao ausente, coluna renomeada) reprova EXATAMENTE as linhas previstas;
 *             toda mutacao com guarda.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITES DECLARADOS: (1) o Postgres e' o 17 LOCAL; o papel de leitura real da loja
 * (supabase_read_only_user) e a ACL real das lojas NAO foram medidos aqui. (2) Nao ha mutantes do TEXTO
 * do .sql: a prova cobre o comportamento da consulta em cada estado.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/teto-de-email-portao-viva.cjs
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

const A = "21a-conferir-teto-de-email-aplicado";
const B = "21b-antes-teto-de-email-corpos-vigentes";
const ARQ =
  "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_21A, [B]: CONF.ROL_DA_21B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

// As linhas de corpo das 3 funcoes que o lote TROCA, em cada consulta.
const CORPOS_TROCADOS_21A = [
  "generate_order_otp_v2: corpo e o da 20261217000000 (sha256)",
  "get_orders_by_otp_v1: corpo e o da 20261217000000 (sha256)",
  "reivindicar_email_de_confirmacao: corpo e o da 20261217000000 (sha256)",
].sort();
const CORPOS_TROCADOS_21B = [
  "generate_order_otp_v2: corpo e o da 20260820000000 (sha256)",
  "get_orders_by_otp_v1: corpo e o da 20261181000000 (sha256)",
  "reivindicar_email_de_confirmacao: corpo e o da 20260821000000 (sha256)",
].sort();
const LINHA_CONTADORES =
  "email_da_loja_contadores: RLS ligada e nada para anon/authenticated";
const LINHA_COLUNAS =
  "pedidos, codigos e contas: colunas que os corpos novos leem";

const PAPEL_RO = `portao21_ro_${process.pid}`;
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
  "ROL: as 14 linhas da 21a e as 8 da 21b sao exatamente o rol, nos dois estados",
  async () => {
    const depois = await noEstado(null, [A, B]);
    confereRol(A, depois[A]);
    confereRol(B, depois[B]);
    const antes = await noEstado((c) => c.query(ROLLBACK), [A, B]);
    confereRol(A, antes[A]);
    confereRol(B, antes[B]);
    assert.equal(ROL[A].length, 14);
    assert.equal(ROL[B].length, 8);
  },
);

prova(
  "DEPOIS (a arvore): 21a POSITIVA; 21b reprova SO os 3 corpos trocados",
  async () => {
    const s = await noEstado(null, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "21a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), CORPOS_TROCADOS_21B);
  },
);

prova(
  "ANTES (rollback na transacao): 21b POSITIVA; 21a reprova SO os 3 corpos trocados",
  async () => {
    const s = await noEstado((c) => c.query(ROLLBACK), [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "21b toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), CORPOS_TROCADOS_21A);
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
  assert.deepEqual(reprovadas(dobro[B]), CORPOS_TROCADOS_21B);
  const idaEVolta = await noEstado(
    async (c) => {
      await c.query(ROLLBACK);
      await c.query(MIGRATION);
    },
    [A],
  );
  assert.deepEqual(reprovadas(idaEVolta[A]), []);
  // Os arquivos gravados em CRLF (um checkout no Windows): o corpo vivo leva \r, a consulta aceita.
  const crlf = await noEstado(
    async (c) => {
      await c.query(emCRLF(ROLLBACK));
      await guarda(
        "SELECT position(chr(13) in prosrc) > 0 AS aplicou FROM pg_proc WHERE oid = 'public.generate_order_otp_v2(text,text,text)'::regprocedure",
      );
    },
    [A, B],
  );
  assert.deepEqual(reprovadas(crlf[B]), []);
  const crlfDepois = await noEstado(
    async (c) => {
      await c.query(ROLLBACK);
      await c.query(emCRLF(MIGRATION));
      await guarda(
        "SELECT position(chr(13) in prosrc) > 0 AS aplicou FROM pg_proc WHERE oid = 'public.get_orders_by_otp_v2(text,text,text,text)'::regprocedure",
      );
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlfDepois[A]), []);
});

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [null, (c) => c.query(ROLLBACK)]) {
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
  { antes = false, mutar, guardaSql },
  esperadas,
) {
  const s = await noEstado(
    async (c) => {
      if (antes) await c.query(ROLLBACK);
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

prova(
  "NEGATIVO 21a: EXECUTE aberto ou fechado errado reprova SO a linha da funcao",
  async () => {
    const R = "public.reservar_vaga_de_email(text,integer)";
    const K = "public.chave_do_destinatario(text)";
    const G = "public.generate_order_otp_v2(text,text,text)";
    const V = "public.reivindicar_email_de_confirmacao(uuid)";
    const V1 = "public.get_orders_by_otp_v1(text,text)";
    const V2 = "public.get_orders_by_otp_v2(text,text,text,text)";
    await negativo(
      A,
      {
        mutar: `GRANT EXECUTE ON FUNCTION ${R} TO anon`,
        guardaSql: exec(R, "anon"),
      },
      ["reservar_vaga_de_email: EXECUTE"],
    );
    await negativo(
      A,
      {
        mutar: `GRANT EXECUTE ON FUNCTION ${K} TO authenticated`,
        guardaSql: exec(K, "authenticated"),
      },
      ["chave_do_destinatario: EXECUTE"],
    );
    await negativo(
      A,
      {
        mutar: `GRANT EXECUTE ON FUNCTION ${G} TO PUBLIC`,
        guardaSql: execPublic(G),
      },
      ["generate_order_otp_v2: EXECUTE"],
    );
    await negativo(
      A,
      {
        mutar: `REVOKE EXECUTE ON FUNCTION ${V} FROM service_role`,
        guardaSql: semExec(V, "service_role"),
      },
      ["reivindicar_email_de_confirmacao: EXECUTE"],
    );
    await negativo(
      A,
      {
        mutar: `REVOKE EXECUTE ON FUNCTION ${V2} FROM anon`,
        guardaSql: semExec(V2, "anon"),
      },
      ["get_orders_by_otp_v2: EXECUTE"],
    );
    await negativo(
      A,
      {
        mutar: `GRANT EXECUTE ON FUNCTION ${V1} TO PUBLIC`,
        guardaSql: execPublic(V1),
      },
      ["get_orders_by_otp_v1: EXECUTE"],
    );
  },
);

prova(
  "NEGATIVO 21a: a tabela de contadores sem RLS ou com privilegio para o visitante reprova SO a linha dela",
  async () => {
    const T = "public.email_da_loja_contadores";
    await negativo(
      A,
      {
        mutar: `ALTER TABLE ${T} DISABLE ROW LEVEL SECURITY`,
        guardaSql: `SELECT NOT relrowsecurity AS aplicou FROM pg_class WHERE oid = '${T}'::regclass`,
      },
      [LINHA_CONTADORES],
    );
    await negativo(
      A,
      {
        mutar: `GRANT SELECT ON ${T} TO authenticated`,
        guardaSql: `SELECT has_table_privilege('authenticated', '${T}', 'SELECT') AS aplicou`,
      },
      [LINHA_CONTADORES],
    );
    await negativo(
      A,
      {
        mutar: `GRANT INSERT ON ${T} TO anon`,
        guardaSql: `SELECT has_table_privilege('anon', '${T}', 'INSERT') AS aplicou`,
      },
      [LINHA_CONTADORES],
    );
  },
);

prova(
  "NEGATIVO 21a: corpo diferente reprova SO o corpo; funcao ausente reprova corpo e EXECUTE",
  async () => {
    const R = "public.reservar_vaga_de_email(text,integer)";
    await negativo(
      A,
      {
        mutar: `DO $m$ BEGIN EXECUTE replace(pg_get_functiondef('${R}'::regprocedure), 'AS $function$', 'AS $function$-- outro corpo' || chr(10)); END $m$`,
        guardaSql: `SELECT prosrc LIKE '-- outro corpo%' AS aplicou FROM pg_proc WHERE oid = '${R}'::regprocedure`,
      },
      ["reservar_vaga_de_email: corpo e o da 20261217000000 (sha256)"],
    );
    await negativo(
      A,
      {
        mutar: "DROP FUNCTION public.chave_do_destinatario(text)",
        guardaSql:
          "SELECT to_regprocedure('public.chave_do_destinatario(text)') IS NULL AS aplicou",
      },
      [
        "chave_do_destinatario: EXECUTE",
        "chave_do_destinatario: corpo e o da 20261217000000 (sha256)",
      ],
    );
  },
);

prova(
  "NEGATIVO 21b: EXECUTE fora do de sempre, corpo diferente e coluna renomeada reprovam SO a sua linha",
  async () => {
    const G = "public.generate_order_otp_v2(text,text,text)";
    const V1 = "public.get_orders_by_otp_v1(text,text)";
    await negativo(
      B,
      {
        antes: true,
        mutar: `GRANT EXECUTE ON FUNCTION ${G} TO anon`,
        guardaSql: exec(G, "anon"),
      },
      ["generate_order_otp_v2: EXECUTE"],
    );
    await negativo(
      B,
      {
        antes: true,
        mutar: `REVOKE EXECUTE ON FUNCTION ${V1} FROM authenticated`,
        guardaSql: semExec(V1, "authenticated"),
      },
      ["get_orders_by_otp_v1: EXECUTE"],
    );
    await negativo(
      B,
      {
        antes: true,
        mutar: `DO $m$ BEGIN EXECUTE replace(pg_get_functiondef('${V1}'::regprocedure), 'AS $function$', 'AS $function$-- outro corpo' || chr(10)); END $m$`,
        guardaSql: `SELECT prosrc LIKE '-- outro corpo%' AS aplicou FROM pg_proc WHERE oid = '${V1}'::regprocedure`,
      },
      ["get_orders_by_otp_v1: corpo e o da 20261181000000 (sha256)"],
    );
    await negativo(
      B,
      {
        antes: true,
        mutar:
          "ALTER TABLE public.otp_verifications RENAME COLUMN attempts TO tentativas_prova",
        guardaSql:
          "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.otp_verifications'::regclass AND attname = 'tentativas_prova') AS aplicou",
      },
      [LINHA_COLUNAS],
    );
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 3)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const depois = await noEstado(null, [A, B]);
    const vA = CONF.veredictoDaConsulta({
      consulta: A,
      ref,
      sha,
      linhas: depois[A],
    });
    const vB = CONF.veredictoDaConsulta({
      consulta: B,
      ref,
      sha,
      linhas: depois[B],
    });
    assert.match(vA, / linhas=14 ok_false=0 ok_nao_booleano=0 rol=ok$/);
    assert.match(vB, / linhas=8 ok_false=3 ok_nao_booleano=0 rol=ok$/);
    const antes = await noEstado((c) => c.query(ROLLBACK), [A, B]);
    assert.match(
      CONF.veredictoDaConsulta({ consulta: A, ref, sha, linhas: antes[A] }),
      / linhas=14 ok_false=3 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      CONF.veredictoDaConsulta({ consulta: B, ref, sha, linhas: antes[B] }),
      / linhas=8 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    // Uma linha a menos nao e' o rol: o portao nunca a le como positiva.
    assert.match(
      CONF.veredictoDaConsulta({
        consulta: A,
        ref,
        sha,
        linhas: depois[A].slice(1),
      }),
      / rol=invalido$/,
    );
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
      `${falhas.length} de ${PROVAS.length} provas do portao 21 falharam.`,
    );
  }
  console.log(
    `\n[teto-de-email-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
