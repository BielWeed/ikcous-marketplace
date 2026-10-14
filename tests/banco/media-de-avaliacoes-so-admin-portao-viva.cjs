"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 25 (a media de avaliacoes so responde ao
 * administrador) -- a migration 20261222000000 --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   25a-conferir-media-de-avaliacoes-so-admin.sql      (DEPOIS do apply: 5 linhas)
 *   25b-antes-media-de-avaliacoes-sem-guarda.sql       (ANTES do apply: 4 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso
 * so o run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de
 * tests/banco/media-de-avaliacoes-so-admin-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a
 * arvore pode ou nao ja ter a 20261222, cada estado e' montado DENTRO de uma transacao (como o dono da
 * conexao) que termina em ROLLBACK: o DEPOIS e' a migration aplicada na transacao (idempotente) e o
 * ANTES e' o rollback-manual dela (CREATE OR REPLACE com o corpo antigo, idempotente). As consultas
 * rodam nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente
 * leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_25A e
 *             ROL_DA_25B), sem repetir nem faltar, nos dois estados.
 *  ESTADOS    depois: 25a POSITIVA e 25b reprova SO as duas linhas do corpo (md5 e guarda); antes
 *             (rollback): 25b POSITIVA e 25a reprova SO as duas linhas do corpo; aplicar DE NOVO, ida e
 *             volta e os arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais no corpo, guarda depois da primeira leitura, STABLE, SECURITY
 *             INVOKER, search_path, EXECUTE por papel e PUBLIC, funcao ausente) reprova EXATAMENTE as linhas
 *             certas; toda mutacao com guarda. A 25b NAO mede a ACL: ACL aberta ou sem authenticated nao a
 *             reprova (a ACL e' da 24a).
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (25a) ou o da baseline
 *             (25b) carrega, e o que o banco mede e' o mesmo.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user),
 * a ACL real e o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/media-de-avaliacoes-so-admin-portao-viva.cjs
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

const A = "25a-conferir-media-de-avaliacoes-so-admin";
const B = "25b-antes-media-de-avaliacoes-sem-guarda";
const ARQ =
  "20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_25A, [B]: CONF.ROL_DA_25B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const BASELINE = fs.readFileSync(
  path.join(MIGRATIONS, "20260806000000_baseline_do_schema_vivo.sql"),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const corpoDe = (sql, de = 0) => {
  const i = sql.indexOf("AS $$", de) + 5;
  return sql.slice(i, sql.indexOf("$$;", i));
};
const CORPO_NOVO = corpoDe(MIGRATION);
const CORPO_ANTIGO = corpoDe(
  BASELINE,
  BASELINE.indexOf("CREATE FUNCTION public.get_reviews_metrics("),
);
const H_NOVO = md5(CORPO_NOVO);
const H_ANTIGO = md5(CORPO_ANTIGO);

const FN = "public.get_reviews_metrics(text,integer)";
const L_MD5_A =
  "get_reviews_metrics: corpo e o da 20261222000000, com a guarda de admin (md5)";
const L_GUARDA_A =
  "get_reviews_metrics: o corpo exige is_admin() antes de ler as avaliacoes";
const L_ATRIB_A =
  "get_reviews_metrics: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public)";
const L_ACL_A =
  "get_reviews_metrics: EXECUTE fechado para anon (authenticated e service_role sim)";
const L_MD5_B =
  "get_reviews_metrics: corpo e o da baseline, sem a guarda de admin (md5)";
const L_GUARDA_B = "get_reviews_metrics: o corpo ainda NAO exige is_admin()";
const L_ATRIB_B = L_ATRIB_A;

const PAPEL_RO = `portao25_ro_${process.pid}`;
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
  "HASH: o md5 literal de cada consulta e' o do corpo que o arquivo carrega",
  async () => {
    assert.equal(H_ANTIGO, "f7fb638c20dce1ae26509f4ffc563120");
    assert.ok(SQL[A].includes(`'${H_NOVO}'`), "25a: md5 do corpo da migration");
    assert.ok(
      SQL[B].includes(`'${H_ANTIGO}'`),
      "25b: md5 do corpo da baseline",
    );
    assert.ok(!SQL[A].includes(H_ANTIGO) && !SQL[B].includes(H_NOVO));
    assert.equal(md5(corpoDe(ROLLBACK)), H_ANTIGO);
    assert.ok(
      MIGRATION.includes(`'${H_NOVO}'`) && MIGRATION.includes(`'${H_ANTIGO}'`),
    );
  },
);

prova(
  "ROL: as 5 linhas da 25a e as 4 da 25b sao exatamente o rol, nos dois estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 5);
    assert.equal(ROL[B].length, 4);
  },
);

prova(
  "DEPOIS (migration aplicada): 25a POSITIVA; 25b reprova SO as duas linhas do corpo (md5 e guarda)",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "25a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [L_MD5_B, L_GUARDA_B].sort());
    assert.equal(s[A].find((l) => l.item === L_MD5_A).vivo, H_NOVO);
    assert.equal(s[A].find((l) => l.item === L_GUARDA_A).vivo, "sim");
    assert.equal(
      s[A].find((l) => l.item === L_ACL_A).vivo,
      "PUBLIC=nao anon=nao authenticated=sim service_role=sim",
    );
  },
);

prova(
  "ANTES (rollback-manual): 25b POSITIVA; 25a reprova SO as duas linhas do corpo (md5 e guarda)",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "25b toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [L_MD5_A, L_GUARDA_A].sort());
    assert.equal(s[B].find((l) => l.item === L_MD5_B).vivo, H_ANTIGO);
    assert.equal(s[B].find((l) => l.item === L_GUARDA_B).vivo, "nao");
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
  assert.deepEqual(reprovadas(dobro[B]), [L_MD5_B, L_GUARDA_B].sort());
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
  assert.deepEqual(reprovadas(crlf[A]), [], "o md5 ignora o CR");
  const crlfAntes = await noEstado(
    async (c) => {
      await c.query(emCRLF(ROLLBACK));
    },
    [B],
  );
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
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

const exec = (papel) =>
  `SELECT has_function_privilege('${papel}', '${FN}'::regprocedure, 'EXECUTE') AS aplicou`;
const semExec = (papel) =>
  `SELECT NOT has_function_privilege('${papel}', '${FN}'::regprocedure, 'EXECUTE') AS aplicou`;
const execPublic = `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${FN}'::regprocedure AND a.grantee = 0) AS aplicou`;
const ausente = `SELECT to_regprocedure('${FN}') IS NULL AS aplicou`;

/** Recria a funcao com `corpo` (mesmos atributos) e a rotulagem pedida. */
const recriar = (
  corpo,
  atributos = "SECURITY DEFINER SET search_path TO 'public'",
) =>
  `CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
     RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
     LANGUAGE plpgsql ${atributos}
   AS $x$${corpo}$x$`;
const GUARDA_TEXTO = CORPO_NOVO.slice(
  CORPO_NOVO.indexOf("  -- Só o administrador"),
  CORPO_NOVO.indexOf("  END IF;\n\n") + "  END IF;\n\n".length,
);
// a mesma guarda, mas DEPOIS das leituras de perfis e produtos, perto do RETURN QUERY
const CORPO_GUARDA_TARDE = CORPO_ANTIGO.replace(
  "  RETURN QUERY",
  `${GUARDA_TEXTO}  RETURN QUERY`,
);

prova(
  "NEGATIVO 25a: corpo com 1 byte a mais, guarda tardia, sem guarda, STABLE, SECURITY INVOKER, search_path, ACL por papel e PUBLIC e funcao ausente reprovam SO as linhas certas",
  async () => {
    assert.notEqual(CORPO_GUARDA_TARDE, CORPO_ANTIGO);
    const casos = [
      [
        recriar(`${CORPO_NOVO} `),
        `SELECT right(prosrc, 1) = ' ' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_MD5_A],
      ],
      [
        recriar(CORPO_GUARDA_TARDE),
        `SELECT position('IF NOT public.is_admin() THEN' IN prosrc) > position('IF p_search IS NOT NULL' IN prosrc) AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_MD5_A, L_GUARDA_A],
      ],
      [
        recriar(CORPO_ANTIGO),
        `SELECT position('is_admin' IN prosrc) = 0 AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_MD5_A, L_GUARDA_A],
      ],
      [
        `ALTER FUNCTION ${FN} STABLE`,
        `SELECT provolatile = 's' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_ATRIB_A],
      ],
      [
        `ALTER FUNCTION ${FN} SECURITY INVOKER`,
        `SELECT NOT prosecdef AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_ATRIB_A],
      ],
      [
        `ALTER FUNCTION ${FN} SET search_path TO public, extensions`,
        `SELECT proconfig = ARRAY['search_path=public, extensions']::text[] AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_ATRIB_A],
      ],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO anon`, exec("anon"), [L_ACL_A]],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`, execPublic, [L_ACL_A]],
      [
        `REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`,
        semExec("authenticated"),
        [L_ACL_A],
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${FN} FROM service_role`,
        semExec("service_role"),
        [L_ACL_A],
      ],
      [
        `DROP FUNCTION ${FN}`,
        ausente,
        [L_MD5_A, L_GUARDA_A, L_ATRIB_A, L_ACL_A],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(A, { mutar, guardaSql }, esperadas);
  },
);

prova(
  "NEGATIVO 25b: corpo novo, corpo antigo com 1 byte a mais, STABLE, SECURITY INVOKER e funcao ausente reprovam SO as linhas certas; ACL aberta ou sem authenticated NAO reprova (a ACL e' da 24a)",
  async () => {
    const casos = [
      [
        "SELECT 1",
        "SELECT true AS aplicou",
        [],
        "controle: sem mutacao a 25b passa",
      ],
      [
        recriar(`${CORPO_ANTIGO} `),
        `SELECT right(prosrc, 1) = ' ' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_MD5_B],
      ],
      [
        recriar(CORPO_NOVO),
        `SELECT position('is_admin' IN prosrc) > 0 AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_MD5_B, L_GUARDA_B],
      ],
      [
        `ALTER FUNCTION ${FN} STABLE`,
        `SELECT provolatile = 's' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_ATRIB_B],
      ],
      [
        `ALTER FUNCTION ${FN} SECURITY INVOKER`,
        `SELECT NOT prosecdef AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`,
        [L_ATRIB_B],
      ],
      [`DROP FUNCTION ${FN}`, ausente, [L_MD5_B, L_GUARDA_B, L_ATRIB_B]],
      // a 25b nao mede a ACL: estes nao a reprovam
      [`GRANT EXECUTE ON FUNCTION ${FN} TO anon`, exec("anon"), []],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`, execPublic, []],
      [
        `REVOKE EXECUTE ON FUNCTION ${FN} FROM authenticated`,
        semExec("authenticated"),
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
      `${falhas.length} de ${PROVAS.length} provas do portao 25 falharam.`,
    );
  }
  console.log(
    `\n[media-de-avaliacoes-so-admin-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
