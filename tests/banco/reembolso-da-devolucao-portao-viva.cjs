"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 28 (o reembolso da devolucao so e' "liberado"
 * quando o dinheiro sai) -- a migration 20261225000000 --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro.sql        (DEPOIS do apply: 8 linhas)
 *   28b-antes-reembolso-da-devolucao-avisa-liberado-na-conclusao.sql        (ANTES do apply: 5 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso
 * so o run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de
 * tests/banco/reembolso-da-devolucao-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a
 * arvore pode ou nao ja ter a 20261225, cada estado e' montado DENTRO de uma transacao (como o dono da
 * conexao) que termina em ROLLBACK: o DEPOIS e' a migration aplicada na transacao (idempotente) e o
 * ANTES e' o rollback-manual dela (corpo antigo de volta, funcoes e gatilho novos apagados, idempotente).
 * As consultas rodam nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao
 * ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_28A e
 *             ROL_DA_28B), sem repetir nem faltar, nos dois estados.
 *  ESTADOS    depois: 28a POSITIVA e 28b reprova SO as 3 linhas do corpo, do estado real e dos objetos
 *             novos; antes (rollback): 28b POSITIVA e 28a reprova tudo menos o controle; aplicar DE NOVO,
 *             ida e volta e os arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais em cada corpo, corpo antigo, STABLE, SECURITY INVOKER, search_path,
 *             EXECUTE por papel e PUBLIC, gatilho desligado, sem WHEN ou ausente, funcao ausente) reprova
 *             EXATAMENTE as linhas certas; toda mutacao com guarda. A 28b NAO mede a ACL.
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (28a) ou o da 20261175000000
 *             (28b) carrega, e o que o banco mede e' o mesmo.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user),
 * a ACL real e o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/reembolso-da-devolucao-portao-viva.cjs
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

const A = "28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro";
const B = "28b-antes-reembolso-da-devolucao-avisa-liberado-na-conclusao";
const ARQ =
  "20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_28A, [B]: CONF.ROL_DA_28B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const M175 = fs.readFileSync(
  path.join(MIGRATIONS, "20261175000000_a_devolucao_nasce_no_pedido.sql"),
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
const CORPO_AVISA_NOVO = corpoDaTag(MIGRATION, "avisa_o_cliente");
const CORPO_AVISAR = corpoDaTag(MIGRATION, "avisar_reembolso");
const CORPO_LIBERADO = corpoDaTag(MIGRATION, "avisa_liberado");
const CORPO_AVISA_ANTIGO = (() => {
  const i = M175.indexOf(
    "CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente()",
  );
  const a = M175.indexOf("AS $$", i) + "AS $$".length;
  return M175.slice(a, M175.indexOf("$$;", a));
})();
const H_AVISA_NOVO = md5(CORPO_AVISA_NOVO);
const H_AVISAR = md5(CORPO_AVISAR);
const H_LIBERADO = md5(CORPO_LIBERADO);
const H_AVISA_ANTIGO = md5(CORPO_AVISA_ANTIGO);

const FN_AVISA = "public.devolucao_avisa_o_cliente()";
const FN_AVISAR =
  "public.devolucao__avisar_reembolso(uuid,text,text,text,text)";
const FN_LIBERADO = "public.devolucao_avisa_reembolso_liberado()";
const TRG = "tr_order_refunds_avisa_reembolso_liberado";

const L_MD5_AVISA_A = ROL[A][1];
const L_ESTADO_A = ROL[A][2];
const L_MD5_AVISAR_A = ROL[A][3];
const L_MD5_LIBERADO_A = ROL[A][4];
const L_ATRIB_A = ROL[A][5];
const L_ACL_A = ROL[A][6];
const L_GATILHO_A = ROL[A][7];
const L_MD5_AVISA_B = ROL[B][1];
const L_ESTADO_B = ROL[B][2];
const L_ATRIB_B = ROL[B][3];
const L_NOVOS_B = ROL[B][4];

const PAPEL_RO = `portao28_ro_${process.pid}`;
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
    assert.equal(H_AVISA_ANTIGO, "0bf0bf168c1c0db817220329c47b64ef");
    assert.equal(
      new Set([H_AVISA_NOVO, H_AVISAR, H_LIBERADO, H_AVISA_ANTIGO]).size,
      4,
    );
    for (const h of [H_AVISA_NOVO, H_AVISAR, H_LIBERADO]) {
      assert.ok(SQL[A].includes(`'${h}'`), `28a: md5 ${h}`);
      assert.ok(!SQL[B].includes(h), `28b nao cita ${h}`);
    }
    assert.ok(
      SQL[B].includes(`'${H_AVISA_ANTIGO}'`),
      "28b: md5 do corpo da 20261175000000",
    );
    assert.ok(!SQL[A].includes(H_AVISA_ANTIGO));
    assert.equal(md5(corpoDaTag(ROLLBACK, "rollback_avisa")), H_AVISA_ANTIGO);
    for (const h of [H_AVISA_NOVO, H_AVISAR, H_LIBERADO, H_AVISA_ANTIGO])
      assert.ok(MIGRATION.includes(`'${h}'`) || ROLLBACK.includes(`'${h}'`), h);
  },
);

prova(
  "ROL: as 8 linhas da 28a e as 5 da 28b sao exatamente o rol, nos dois estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 8);
    assert.equal(ROL[B].length, 5);
  },
);

prova(
  "DEPOIS (migration aplicada): 28a POSITIVA; 28b reprova SO o corpo, o estado real e os objetos novos",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "28a toda ok no depois");
    assert.deepEqual(
      reprovadas(s[B]),
      [L_MD5_AVISA_B, L_ESTADO_B, L_NOVOS_B].sort(),
    );
    const vivo = (item) => s[A].find((l) => l.item === item).vivo;
    assert.equal(vivo(L_MD5_AVISA_A), H_AVISA_NOVO);
    assert.equal(vivo(L_MD5_AVISAR_A), H_AVISAR);
    assert.equal(vivo(L_MD5_LIBERADO_A), H_LIBERADO);
    assert.equal(vivo(L_ESTADO_A), "sim");
    assert.equal(vivo(L_GATILHO_A), "ligado");
    assert.equal(
      vivo(L_ACL_A),
      "PUBLIC=nao anon=nao authenticated=nao auxiliar_service_role=nao",
    );
  },
);

prova(
  "ANTES (rollback-manual): 28b POSITIVA; 28a reprova tudo menos o controle",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "28b toda ok no antes");
    assert.deepEqual(
      reprovadas(s[A]),
      ROL[A].filter((i) => i !== ROL[A][0]).sort(),
    );
    assert.equal(
      s[B].find((l) => l.item === L_MD5_AVISA_B).vivo,
      H_AVISA_ANTIGO,
    );
    assert.equal(s[B].find((l) => l.item === L_ESTADO_B).vivo, "nao");
    assert.equal(s[B].find((l) => l.item === L_NOVOS_B).vivo, "ausentes");
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
  assert.deepEqual(
    reprovadas(dobro[B]),
    [L_MD5_AVISA_B, L_ESTADO_B, L_NOVOS_B].sort(),
  );
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

const exec = (fn, papel) =>
  `SELECT has_function_privilege('${papel}', '${fn}'::regprocedure, 'EXECUTE') AS aplicou`;
const execPublic = (fn) =>
  `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${fn}'::regprocedure AND a.grantee = 0) AS aplicou`;
const ausente = (fn) => `SELECT to_regprocedure('${fn}') IS NULL AS aplicou`;
const ultimoCaractere = (fn, c) =>
  `SELECT right(prosrc, 1) = '${c}' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${fn}')`;
const ATRIBUTOS = "SECURITY DEFINER SET search_path = public";

const recriarAvisa = (corpo) =>
  `CREATE OR REPLACE FUNCTION public.devolucao_avisa_o_cliente() RETURNS trigger LANGUAGE plpgsql ${ATRIBUTOS} AS $x$${corpo}$x$`;
const recriarAvisar = (corpo) =>
  `CREATE OR REPLACE FUNCTION public.devolucao__avisar_reembolso(p_devolucao_id uuid, p_evento text, p_tipo text, p_titulo text, p_mensagem text)
     RETURNS boolean LANGUAGE plpgsql ${ATRIBUTOS} AS $x$${corpo}$x$`;
const recriarLiberado = (corpo) =>
  `CREATE OR REPLACE FUNCTION public.devolucao_avisa_reembolso_liberado() RETURNS trigger LANGUAGE plpgsql ${ATRIBUTOS} AS $x$${corpo}$x$`;
const estadoDoGatilho = (cond) =>
  `SELECT ${cond} AS aplicou FROM pg_trigger WHERE tgrelid = 'public.order_refunds'::regclass AND tgname = '${TRG}'`;

prova(
  "NEGATIVO 28a: 1 byte a mais em cada corpo, corpo antigo, STABLE, SECURITY INVOKER, search_path, ACL por papel e PUBLIC, gatilho desligado/sem WHEN/ausente e funcao ausente reprovam SO as linhas certas",
  async () => {
    const casos = [
      [
        recriarAvisa(`${CORPO_AVISA_NOVO} `),
        ultimoCaractere(FN_AVISA, " "),
        [L_MD5_AVISA_A],
      ],
      [
        recriarAvisar(`${CORPO_AVISAR} `),
        ultimoCaractere(FN_AVISAR, " "),
        [L_MD5_AVISAR_A],
      ],
      [
        recriarLiberado(`${CORPO_LIBERADO} `),
        ultimoCaractere(FN_LIBERADO, " "),
        [L_MD5_LIBERADO_A],
      ],
      [
        recriarAvisa(CORPO_AVISA_ANTIGO),
        `SELECT position('SELECT r.status INTO v_estado' IN prosrc) = 0 AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_AVISA}')`,
        [L_MD5_AVISA_A, L_ESTADO_A],
      ],
      [
        `ALTER FUNCTION ${FN_AVISAR} STABLE`,
        `SELECT provolatile = 's' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_AVISAR}')`,
        [L_ATRIB_A],
      ],
      [
        `ALTER FUNCTION ${FN_AVISA} SECURITY INVOKER`,
        `SELECT NOT prosecdef AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_AVISA}')`,
        [L_ATRIB_A],
      ],
      [
        `ALTER FUNCTION ${FN_LIBERADO} SET search_path TO public, extensions`,
        `SELECT proconfig = ARRAY['search_path=public, extensions']::text[] AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_LIBERADO}')`,
        [L_ATRIB_A],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_AVISAR} TO anon`,
        exec(FN_AVISAR, "anon"),
        [L_ACL_A],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_AVISAR} TO authenticated`,
        exec(FN_AVISAR, "authenticated"),
        [L_ACL_A],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_AVISAR} TO PUBLIC`,
        execPublic(FN_AVISAR),
        [L_ACL_A],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_AVISAR} TO service_role`,
        exec(FN_AVISAR, "service_role"),
        [L_ACL_A],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_LIBERADO} TO authenticated`,
        exec(FN_LIBERADO, "authenticated"),
        [L_ACL_A],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_AVISA} TO anon`,
        exec(FN_AVISA, "anon"),
        [L_ACL_A],
      ],
      [
        `ALTER TABLE public.order_refunds DISABLE TRIGGER ${TRG}`,
        estadoDoGatilho("tgenabled = 'D'"),
        [L_GATILHO_A],
      ],
      [
        `DROP TRIGGER ${TRG} ON public.order_refunds; CREATE TRIGGER ${TRG} AFTER UPDATE OF status ON public.order_refunds FOR EACH ROW EXECUTE FUNCTION public.devolucao_avisa_reembolso_liberado()`,
        estadoDoGatilho("pg_get_triggerdef(oid) NOT LIKE '%WHEN%'"),
        [L_GATILHO_A],
      ],
      [
        `DROP TRIGGER ${TRG} ON public.order_refunds`,
        `SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${TRG}') AS aplicou`,
        [L_GATILHO_A],
      ],
      [
        `DROP FUNCTION ${FN_AVISAR}`,
        ausente(FN_AVISAR),
        [L_MD5_AVISAR_A, L_ATRIB_A, L_ACL_A],
      ],
      [
        `DROP FUNCTION ${FN_LIBERADO} CASCADE`,
        ausente(FN_LIBERADO),
        [L_MD5_LIBERADO_A, L_ATRIB_A, L_ACL_A, L_GATILHO_A],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(A, { mutar, guardaSql }, esperadas);
  },
);

prova(
  "NEGATIVO 28b: corpo novo, corpo antigo com 1 byte a mais, STABLE, SECURITY INVOKER, funcao ausente, objeto novo ja presente reprovam SO as linhas certas; ACL aberta NAO reprova (a 28b nao mede a ACL)",
  async () => {
    const casos = [
      [
        recriarAvisa(`${CORPO_AVISA_ANTIGO} `),
        ultimoCaractere(FN_AVISA, " "),
        [L_MD5_AVISA_B],
      ],
      [
        recriarAvisa(CORPO_AVISA_NOVO),
        `SELECT position('SELECT r.status INTO v_estado' IN prosrc) > 0 AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_AVISA}')`,
        [L_MD5_AVISA_B, L_ESTADO_B],
      ],
      [
        `ALTER FUNCTION ${FN_AVISA} STABLE`,
        `SELECT provolatile = 's' AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_AVISA}')`,
        [L_ATRIB_B],
      ],
      [
        `ALTER FUNCTION ${FN_AVISA} SECURITY INVOKER`,
        `SELECT NOT prosecdef AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN_AVISA}')`,
        [L_ATRIB_B],
      ],
      [
        `DROP FUNCTION ${FN_AVISA} CASCADE`,
        ausente(FN_AVISA),
        [L_MD5_AVISA_B, L_ESTADO_B, L_ATRIB_B],
      ],
      [
        recriarAvisar(CORPO_AVISAR),
        `SELECT to_regprocedure('${FN_AVISAR}') IS NOT NULL AS aplicou`,
        [L_NOVOS_B],
      ],
      [
        `${recriarLiberado(CORPO_LIBERADO)}`,
        `SELECT to_regprocedure('${FN_LIBERADO}') IS NOT NULL AS aplicou`,
        [L_NOVOS_B],
      ],
      [
        `${recriarLiberado(CORPO_LIBERADO)}; CREATE TRIGGER ${TRG} AFTER UPDATE OF status ON public.order_refunds FOR EACH ROW EXECUTE FUNCTION public.devolucao_avisa_reembolso_liberado()`,
        `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${TRG}') AS aplicou`,
        [L_NOVOS_B],
      ],
      // a 28b nao mede a ACL: estes nao a reprovam
      [
        `GRANT EXECUTE ON FUNCTION ${FN_AVISA} TO anon`,
        exec(FN_AVISA, "anon"),
        [],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN_AVISA} TO PUBLIC`,
        execPublic(FN_AVISA),
        [],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(B, { estado: antes, mutar, guardaSql }, esperadas);
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0/3 e 7/0)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const veredito = (consulta, linhas) =>
      CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
    const d = await noEstado(depois, [A, B]);
    assert.match(
      veredito(A, d[A]),
      / linhas=8 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=5 ok_false=3 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=8 ok_false=7 ok_nao_booleano=0 rol=ok$/,
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
      `${falhas.length} de ${PROVAS.length} provas do portao 27 falharam.`,
    );
  }
  console.log(
    `\n[reembolso-da-devolucao-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
