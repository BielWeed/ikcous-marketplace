"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 29 (a reemissao do reembolso consulta o
 * Mercado Pago antes de pagar de novo) -- a migration 20261226000000 --, num Postgres EFEMERO local, nada de rede,
 * nada de loja:
 *   29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes.sql      (DEPOIS do apply: 9 linhas)
 *   29b-antes-reemissao-do-reembolso-base-conhecida.sql              (ANTES do apply: 5 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso
 * so o run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de
 * tests/banco/reemissao-do-reembolso-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a
 * arvore pode ou nao ja ter a 20261225 e a 20261226, cada estado e' montado DENTRO de uma transacao (como o dono da
 * conexao) que termina em ROLLBACK: o DEPOIS e' a 24 e a 25 aplicadas (idempotentes) e o ANTES e' a 24 aplicada e o
 * rollback-manual da 25 (funcoes e tabela novas apagadas, idempotente). As consultas rodam nela como um papel de
 * LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_29A e
 *             ROL_DA_29B), sem repetir nem faltar, nos dois estados.
 *  ESTADOS    depois: 29a POSITIVA e 29b reprova SO a linha dos objetos novos; antes (rollback): 29b POSITIVA
 *             e 29a reprova tudo menos o controle; aplicar DE NOVO, ida e volta e os arquivos em CRLF: o
 *             mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais em cada corpo, STABLE, SECURITY INVOKER, search_path, EXECUTE por papel e
 *             PUBLIC, tabela com policy/grant/sem RLS, funcao ou tabela ausente, objeto novo ja presente na 29b)
 *             reprova EXATAMENTE as linhas certas; toda mutacao com guarda. A 29b NAO mede a ACL.
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (29a) ou o das migrations
 *             anteriores (29b) carrega.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user),
 * a ACL real e o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/reemissao-do-reembolso-portao-viva.cjs
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
const {
  desfazerReembolsoEmDuvidaNaTransacao,
} = require("./reembolso-em-duvida-posterior.cjs");

/**
 * Abre a transacao no cliente principal e, se a SUCESSORA 20261241000000 (o reembolso em duvida prende o saldo)
 * estiver no ar, desfaz ela primeiro: ela reescreve corpos desta migration, e o pre-voo daqui (e do rollback daqui)
 * recusa o corpo dela. Assim cada caso mede ESTA migration isolada, como antes da sucessora existir.
 */
async function comecarSem1241() {
  await C.query("BEGIN");
  await desfazerReembolsoEmDuvidaNaTransacao(C);
}

const REPO = path.resolve(__dirname, "..", "..");
const CONSULTAS = path.join(REPO, "scripts", "publicacao", "consultas");
const MIGRATIONS = path.join(REPO, "supabase", "migrations");
// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do proprio teste
const CONF = require(
  path.join(REPO, "scripts", "publicacao", "conferir-banco.cjs"),
);

const A = "29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes";
const B = "29b-antes-reemissao-do-reembolso-base-conhecida";
const ARQ24 =
  "20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql";
const ARQ =
  "20261226000000_a_reemissao_do_reembolso_consulta_o_mercado_pago_antes_de_pagar_de_novo.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_29A, [B]: CONF.ROL_DA_29B };
const MIGRATION24 = fs.readFileSync(path.join(MIGRATIONS, ARQ24), "utf8");
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");
/** O corpo entre `AS $tag$` e `$tag$;` (o dolar-quote com nome de cada funcao da migration). */
const corpoDaTag = (sql, tag) => {
  const a = sql.indexOf(`AS $${tag}$`) + `AS $${tag}$`.length;
  return sql.slice(a, sql.indexOf(`$${tag}$;`, a));
};
/** O corpo de uma funcao `AS $$ ... $$;` de uma migration antiga, pelo inicio do CREATE. */
const corpoSemTag = (arquivo, inicio) => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, arquivo), "utf8");
  const i = sql.indexOf(inicio);
  assert.ok(i >= 0, `${arquivo}: ${inicio}`);
  const a = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(a, sql.indexOf("$$;", a));
};
const H_DIAG = md5(corpoDaTag(MIGRATION, "registrar_diagnostico"));
const H_REEM = md5(corpoDaTag(MIGRATION, "reemitir"));
const H_FORA = md5(corpoDaTag(MIGRATION, "por_fora"));
const H_CONCLUIR = md5(
  corpoSemTag(
    "2026110000100_concluir_estorno.sql",
    "CREATE OR REPLACE FUNCTION public.concluir_estorno(",
  ),
);
const H_SALDO = md5(
  corpoSemTag(
    "20261198000000_cancelar_pedido_anula_a_cobranca.sql",
    "CREATE OR REPLACE FUNCTION public.pedido__saldo_a_estornar",
  ),
);
const H_AVISAR = md5(corpoDaTag(MIGRATION24, "avisar_reembolso"));

const FN_DIAG =
  "public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)";
const FN_REEM = "public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)";
const FN_FORA = "public.admin_devolucao_reembolso_por_fora(uuid,uuid)";
const FN_CONCLUIR = "public.concluir_estorno(uuid,text,text,text)";
const FN_SALDO = "public.pedido__saldo_a_estornar(uuid)";
const FN_AVISAR =
  "public.devolucao__avisar_reembolso(uuid,text,text,text,text)";
const TABELA = "public.order_refund_diagnostico";

const L = ROL[A];
const [
  ,
  L_MD5_DIAG,
  L_MD5_REEM,
  L_MD5_FORA,
  L_ATRIB,
  L_ACL_SERV,
  L_ACL_FORA,
  L_TABELA,
  L_DECISAO,
] = L;
const LB = ROL[B];
const [, L_NOVOS, L_MD5_CONCLUIR, L_MD5_SALDO, L_MD5_AVISAR] = LB;

const PAPEL_RO = `portao29_ro_${process.pid}`;
let C;

/** Monta o estado dentro de uma transacao, roda as consultas como o papel de leitura e desfaz tudo. */
async function noEstado(montar, consultas, { comoDono = false } = {}) {
  await comecarSem1241();
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

const depois = async (c) => {
  await c.query(MIGRATION24);
  await c.query(MIGRATION);
};
const antes = async (c) => {
  await c.query(MIGRATION24);
  await c.query(MIGRATION);
  await c.query(ROLLBACK);
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
    assert.equal(new Set([H_DIAG, H_REEM, H_FORA]).size, 3);
    for (const h of [H_DIAG, H_REEM, H_FORA]) {
      assert.ok(SQL[A].includes(`'${h}'`), `29a: md5 ${h}`);
      assert.ok(!SQL[B].includes(h), `29b nao cita ${h}`);
      assert.ok(MIGRATION.includes(`'${h}'`), `a migration declara ${h}`);
      assert.ok(ROLLBACK.includes(`'${h}'`), `o rollback declara ${h}`);
    }
    for (const h of [H_CONCLUIR, H_SALDO, H_AVISAR]) {
      assert.ok(SQL[B].includes(`'${h}'`), `29b: md5 ${h}`);
      assert.ok(!SQL[A].includes(h), `29a nao cita ${h}`);
      assert.ok(MIGRATION.includes(`'${h}'`), `o pre-voo declara ${h}`);
    }
    assert.equal(H_AVISAR, "769267b826e4629b91da056c28b393da");
    assert.equal(H_SALDO, "9579d2b56b57cf948659936a928dd7dc");
  },
);

prova(
  "ROL: as 9 linhas da 29a e as 5 da 29b sao exatamente o rol, nos dois estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 9);
    assert.equal(ROL[B].length, 5);
  },
);

prova(
  "DEPOIS (migration aplicada): 29a POSITIVA; 29b reprova SO a linha dos objetos novos",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "29a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [L_NOVOS]);
    const vivo = (item) => s[A].find((l) => l.item === item).vivo;
    assert.equal(vivo(L_MD5_DIAG), H_DIAG);
    assert.equal(vivo(L_MD5_REEM), H_REEM);
    assert.equal(vivo(L_MD5_FORA), H_FORA);
    assert.equal(
      vivo(L_ACL_SERV),
      "PUBLIC=nao anon=nao authenticated=nao service_role=sim",
    );
    assert.equal(vivo(L_ACL_FORA), "PUBLIC=nao anon=nao authenticated=sim");
    assert.equal(
      vivo(L_TABELA),
      "rls=sim politicas=0 anon=nao authenticated=nao",
    );
    assert.equal(vivo(L_DECISAO), "sim");
  },
);

prova(
  "ANTES (rollback-manual): 29b POSITIVA; 29a reprova tudo menos o controle",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "29b toda ok no antes");
    assert.deepEqual(
      reprovadas(s[A]),
      ROL[A].filter((i) => i !== ROL[A][0]).sort(),
    );
    assert.equal(s[B].find((l) => l.item === L_NOVOS).vivo, "ausentes");
    assert.equal(s[B].find((l) => l.item === L_MD5_CONCLUIR).vivo, H_CONCLUIR);
    assert.equal(s[B].find((l) => l.item === L_MD5_SALDO).vivo, H_SALDO);
    assert.equal(s[B].find((l) => l.item === L_MD5_AVISAR).vivo, H_AVISAR);
  },
);

prova("IDEMPOTENCIA, IDA E VOLTA e CRLF: o mesmo veredito", async () => {
  const dobro = await noEstado(
    async (c) => {
      await c.query(MIGRATION24);
      await c.query(MIGRATION);
      await c.query(MIGRATION);
    },
    [A, B],
  );
  assert.deepEqual(reprovadas(dobro[A]), []);
  assert.deepEqual(reprovadas(dobro[B]), [L_NOVOS]);
  const idaEVolta = await noEstado(
    async (c) => {
      await antes(c);
      await c.query(MIGRATION);
    },
    [A],
  );
  assert.deepEqual(reprovadas(idaEVolta[A]), []);
  const crlf = await noEstado(
    async (c) => {
      await c.query(MIGRATION24);
      await c.query(emCRLF(MIGRATION));
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlf[A]), [], "o md5 ignora o CR");
  const crlfAntes = await noEstado(
    async (c) => {
      await depois(c);
      await c.query(emCRLF(ROLLBACK));
    },
    [B],
  );
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
  const dois = await noEstado(
    async (c) => {
      await antes(c);
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
      // `mutar` pode ser um texto SQL ou uma funcao que o monta a partir do banco ja montado
      const sql = typeof mutar === "function" ? await mutar(c) : mutar;
      await c.query(sql);
      await guarda(guardaSql);
    },
    [consulta],
  );
  assert.deepEqual(
    reprovadas(s[consulta]),
    [...esperadas].sort(),
    typeof mutar === "function" ? guardaSql : mutar,
  );
}

const exec = (fn, papel) =>
  `SELECT has_function_privilege('${papel}', '${fn}'::regprocedure, 'EXECUTE') AS aplicou`;
const naoExec = (fn, papel) =>
  `SELECT NOT has_function_privilege('${papel}', '${fn}'::regprocedure, 'EXECUTE') AS aplicou`;
const execPublic = (fn) =>
  `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = '${fn}'::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS aplicou`;
const ausente = (fn) => `SELECT to_regprocedure('${fn}') IS NULL AS aplicou`;
/** A funcao inteira recriada com UM byte a mais no fim do corpo (o md5 muda, o resto nao). */
const umByteA = (fn) => async (c) => {
  const r = await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
    fn,
  ]);
  const def = r.rows[0].d;
  assert.ok(
    /\$function\$\s*$/.test(def),
    "o fim da definicao nao e' o esperado",
  );
  return def.replace(/\$function\$\s*$/, " $function$");
};
const ultimoCaractere = (fn, c) =>
  `SELECT right(prosrc, 1) = '${c}' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${fn}')`;

prova(
  "NEGATIVO 29a: 1 byte a mais em cada corpo, STABLE, SECURITY INVOKER, search_path, EXECUTE por papel e PUBLIC, tabela com policy/grant/sem RLS, funcao ou tabela ausente reprovam SO as linhas certas",
  async () => {
    const casos = [
      [umByteA(FN_DIAG), ultimoCaractere(FN_DIAG, " "), [L_MD5_DIAG]],
      [umByteA(FN_REEM), ultimoCaractere(FN_REEM, " "), [L_MD5_REEM]],
      [umByteA(FN_FORA), ultimoCaractere(FN_FORA, " "), [L_MD5_FORA]],
      [
        `ALTER FUNCTION ${FN_FORA} STABLE`,
        `SELECT provolatile = 's' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_FORA}')`,
        [L_ATRIB],
      ],
      [
        `ALTER FUNCTION ${FN_DIAG} SECURITY INVOKER`,
        `SELECT NOT prosecdef AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_DIAG}')`,
        [L_ATRIB],
      ],
      [
        `ALTER FUNCTION ${FN_REEM} SET search_path TO public, extensions`,
        `SELECT proconfig = ARRAY['search_path=public, extensions']::text[] AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_REEM}')`,
        [L_ATRIB],
      ],
      // as duas de servidor
      [
        `GRANT EXECUTE ON FUNCTION ${FN_REEM} TO anon`,
        exec(FN_REEM, "anon"),
        [L_ACL_SERV],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_REEM} TO authenticated`,
        exec(FN_REEM, "authenticated"),
        [L_ACL_SERV],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_DIAG} TO authenticated`,
        exec(FN_DIAG, "authenticated"),
        [L_ACL_SERV],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_DIAG} TO PUBLIC`,
        execPublic(FN_DIAG),
        [L_ACL_SERV],
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${FN_REEM} FROM service_role`,
        naoExec(FN_REEM, "service_role"),
        [L_ACL_SERV],
      ],
      // a do lojista
      [
        `GRANT EXECUTE ON FUNCTION ${FN_FORA} TO anon`,
        exec(FN_FORA, "anon"),
        [L_ACL_FORA],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_FORA} TO PUBLIC`,
        execPublic(FN_FORA),
        [L_ACL_FORA],
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${FN_FORA} FROM authenticated`,
        naoExec(FN_FORA, "authenticated"),
        [L_ACL_FORA],
      ],
      // a tabela
      [
        `CREATE POLICY p28 ON ${TABELA} FOR SELECT TO authenticated USING (true)`,
        `SELECT count(*) = 1 AS aplicou FROM pg_policy WHERE polrelid = '${TABELA}'::regclass`,
        [L_TABELA],
      ],
      [
        `GRANT SELECT ON ${TABELA} TO authenticated`,
        `SELECT has_table_privilege('authenticated', '${TABELA}', 'SELECT') AS aplicou`,
        [L_TABELA],
      ],
      [
        `GRANT INSERT ON ${TABELA} TO anon`,
        `SELECT has_table_privilege('anon', '${TABELA}', 'INSERT') AS aplicou`,
        [L_TABELA],
      ],
      [
        `ALTER TABLE ${TABELA} DISABLE ROW LEVEL SECURITY`,
        `SELECT NOT relrowsecurity AS aplicou FROM pg_class WHERE oid = '${TABELA}'::regclass`,
        [L_TABELA],
      ],
      [
        `DROP TABLE ${TABELA} CASCADE`,
        `SELECT to_regclass('${TABELA}') IS NULL AS aplicou`,
        [L_TABELA],
      ],
      // o corpo da reemissao perde o que a leitura humana procura
      [
        async (c) => {
          const d = (
            await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
              FN_REEM,
            ])
          ).rows[0].d;
          return d.split("nao_achou").join("nada_achado");
        },
        `SELECT position('nao_achou' IN prosrc) = 0 AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_REEM}')`,
        [L_MD5_REEM, L_DECISAO],
      ],
      // ausencias
      [
        `DROP FUNCTION ${FN_REEM}`,
        ausente(FN_REEM),
        [L_MD5_REEM, L_ATRIB, L_ACL_SERV, L_DECISAO],
      ],
      [
        `DROP FUNCTION ${FN_FORA}`,
        ausente(FN_FORA),
        [L_MD5_FORA, L_ATRIB, L_ACL_FORA],
      ],
      [
        `DROP FUNCTION ${FN_DIAG}`,
        ausente(FN_DIAG),
        [L_MD5_DIAG, L_ATRIB, L_ACL_SERV],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(A, { mutar, guardaSql }, esperadas);
  },
);

prova(
  "NEGATIVO 29b: corpo das tres funcoes chamadas com 1 byte a mais ou ausente, objeto novo ja presente reprovam SO as linhas certas; ACL aberta NAO reprova (a 29b nao mede a ACL)",
  async () => {
    const casos = [
      [
        umByteA(FN_CONCLUIR),
        ultimoCaractere(FN_CONCLUIR, " "),
        [L_MD5_CONCLUIR],
      ],
      [umByteA(FN_SALDO), ultimoCaractere(FN_SALDO, " "), [L_MD5_SALDO]],
      [umByteA(FN_AVISAR), ultimoCaractere(FN_AVISAR, " "), [L_MD5_AVISAR]],
      [`DROP FUNCTION ${FN_CONCLUIR}`, ausente(FN_CONCLUIR), [L_MD5_CONCLUIR]],
      [`DROP FUNCTION ${FN_SALDO}`, ausente(FN_SALDO), [L_MD5_SALDO]],
      [`DROP FUNCTION ${FN_AVISAR}`, ausente(FN_AVISAR), [L_MD5_AVISAR]],
      // objeto novo ja presente (a loja que ja tem a migration reprova aqui de proposito)
      [
        `CREATE TABLE ${TABELA} (refund_id uuid)`,
        `SELECT to_regclass('${TABELA}') IS NOT NULL AS aplicou`,
        [L_NOVOS],
      ],
      [
        `CREATE FUNCTION public.registrar_diagnostico_do_estorno(p_refund_id uuid, p_mp_codigo text DEFAULT NULL, p_post_incerto boolean DEFAULT false, p_transitorio boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$`,
        `SELECT to_regprocedure('${FN_DIAG}') IS NOT NULL AS aplicou`,
        [L_NOVOS],
      ],
      [
        `CREATE FUNCTION public.admin_devolucao_reembolso_por_fora(p_devolucao_id uuid, p_refund_esperado uuid) RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$`,
        `SELECT to_regprocedure('${FN_FORA}') IS NOT NULL AS aplicou`,
        [L_NOVOS],
      ],
      // a 29b nao mede a ACL: estes nao a reprovam
      [
        `GRANT EXECUTE ON FUNCTION ${FN_CONCLUIR} TO anon`,
        exec(FN_CONCLUIR, "anon"),
        [],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_SALDO} TO PUBLIC`,
        execPublic(FN_SALDO),
        [],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(B, { estado: antes, mutar, guardaSql }, esperadas);
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0/1 e 8/0)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const veredito = (consulta, linhas) =>
      CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
    const d = await noEstado(depois, [A, B]);
    assert.match(
      veredito(A, d[A]),
      / linhas=9 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=5 ok_false=1 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=9 ok_false=8 ok_nao_booleano=0 rol=ok$/,
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
      `${falhas.length} de ${PROVAS.length} provas do portao 28 falharam.`,
    );
  }
  console.log(
    `\n[reemissao-do-reembolso-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
