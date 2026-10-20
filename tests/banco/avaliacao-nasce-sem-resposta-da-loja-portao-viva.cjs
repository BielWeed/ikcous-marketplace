"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 27 (a avaliacao nasce sem a resposta da loja) -- a
 * migration 20261224000000 --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   27a-conferir-avaliacao-nasce-sem-resposta-da-loja.sql   (DEPOIS do apply: 6 linhas)
 *   27b-antes-avaliacao-aceita-resposta-forjada.sql         (ANTES do apply: 6 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que cada consulta
 * DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o run da consulta contra o
 * ref de cada loja diz). O COMPORTAMENTO e' de tests/banco/avaliacao-nasce-sem-resposta-da-loja-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a arvore pode ou nao
 * ja ter a 20261224, cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que termina em ROLLBACK:
 * o DEPOIS e' a migration aplicada na transacao (idempotente) e o ANTES e' o rollback-manual dela (idempotente). As
 * consultas rodam nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_27A e ROL_DA_27B), sem
 *             repetir nem faltar, nos dois estados.
 *  ESTADOS    depois: 27a POSITIVA e 27b reprova SO as duas linhas "ainda NAO existe" (funcao e gatilho); antes
 *             (rollback): 27b POSITIVA e 27a reprova SO as cinco linhas do objeto; aplicar DE NOVO, ida e volta e
 *             os arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais, sem limpar uma coluna, sem a excecao do administrador, STABLE, SECURITY
 *             INVOKER, search_path, EXECUTE por papel e PUBLIC, gatilho desligado/AFTER/em outra tabela/com WHEN/
 *             ausente, objeto ausente; na 27b: funcao ou gatilho ja existentes, coluna, rls_admin_atual e gatilho
 *             irmao fora do lugar) reprova EXATAMENTE as linhas certas; toda mutacao com guarda.
 *  HASH       o md5 literal da 27a e' o do corpo que o ARQUIVO da migration carrega.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user), a ACL real e o
 * corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/avaliacao-nasce-sem-resposta-da-loja-portao-viva.cjs
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

const A = "27a-conferir-avaliacao-nasce-sem-resposta-da-loja";
const B = "27b-antes-avaliacao-aceita-resposta-forjada";
const ARQ = "20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_27A, [B]: CONF.ROL_DA_27B };
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const CORPO = corpoDe(MIGRATION);
const H = md5(CORPO);

const FN = "public.avaliacao_nasce_sem_a_resposta_da_loja()";
const GATILHO = "tr_avaliacao_nasce_sem_a_resposta_da_loja";

// as linhas do rol, por posicao (o rol de conferir-banco.cjs e' a fonte)
const [_A_CONTROLE, A_MD5, A_LIMPEZA, A_ATRIB, A_ACL, A_GATILHO] = ROL[A];
const [_B_CONTROLE, B_FUNCAO, B_GATILHO, B_COLUNAS, B_RLS, B_IRMAO] = ROL[B];
assert.match(A_MD5, /corpo e o da 20261224000000/);
assert.match(A_LIMPEZA, /limpa as quatro colunas/);
assert.match(A_ATRIB, /atributos de sempre/);
assert.match(A_ACL, /EXECUTE fechado/);
assert.match(A_GATILHO, /BEFORE INSERT por linha/);
assert.match(B_FUNCAO, /a funcao ainda NAO existe/);
assert.match(B_GATILHO, /o gatilho ainda NAO existe/);
assert.match(B_COLUNAS, /as quatro colunas/);
assert.match(B_RLS, /rls_admin_atual/);
assert.match(B_IRMAO, /gatilho irmao/);

const PAPEL_RO = `portao27_ro_${process.pid}`;
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
  "HASH: o md5 literal da 27a e' o do corpo que o arquivo da migration carrega (e o mesmo do pre-voo e do rollback)",
  async () => {
    assert.ok(SQL[A].includes(`'${H}'`), "27a: md5 do corpo da migration");
    assert.ok(!SQL[B].includes(H), "27b nao cita o corpo novo");
    assert.equal(MIGRATION.split(H).length - 1, 2);
    assert.equal(ROLLBACK.split(H).length - 1, 1);
  },
);

prova(
  "ROL: as 6 linhas da 27a e as 6 da 27b sao exatamente o rol, nos dois estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 6);
    assert.equal(ROL[B].length, 6);
  },
);

prova(
  "DEPOIS (migration aplicada): 27a POSITIVA; 27b reprova SO as duas linhas 'ainda NAO existe' (funcao e gatilho)",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "27a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [B_FUNCAO, B_GATILHO].sort());
    assert.equal(s[A].find((l) => l.item === A_MD5).vivo, H);
    assert.equal(s[A].find((l) => l.item === A_LIMPEZA).vivo, "sim");
    assert.equal(
      s[A].find((l) => l.item === A_ACL).vivo,
      "PUBLIC=nao anon=nao authenticated=nao service_role=nao",
    );
    assert.equal(
      s[A].find((l) => l.item === A_GATILHO).vivo,
      "public.reviews BEFORE INSERT por linha ligado",
    );
    assert.equal(s[B].find((l) => l.item === B_FUNCAO).vivo, "EXISTE");
    assert.equal(s[B].find((l) => l.item === B_GATILHO).vivo, "EXISTE");
  },
);

prova(
  "ANTES (rollback-manual): 27b POSITIVA; 27a reprova SO as cinco linhas do objeto (md5, limpeza, atributos, EXECUTE, gatilho)",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "27b toda ok no antes");
    assert.deepEqual(
      reprovadas(s[A]),
      [A_MD5, A_LIMPEZA, A_ATRIB, A_ACL, A_GATILHO].sort(),
    );
    for (const item of [A_MD5, A_LIMPEZA, A_ATRIB, A_ACL, A_GATILHO])
      assert.equal(s[A].find((l) => l.item === item).vivo, "AUSENTE", item);
    assert.equal(
      s[B].find((l) => l.item === B_COLUNAS).vivo,
      "created_at:timestamptz helpful:int4 merchant_reply:text merchant_reply_at:timestamptz",
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
  assert.deepEqual(reprovadas(dobro[B]), [B_FUNCAO, B_GATILHO].sort());
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
const execPublic = `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = '${FN}'::regprocedure AND a.grantee = 0) AS aplicou`;
const gatilhoSql = (cond) =>
  `SELECT ${cond} AS aplicou FROM pg_trigger WHERE tgname = '${GATILHO}'`;
const semGatilho = `SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${GATILHO}') AS aplicou`;
const funcaoSql = (cond) =>
  `SELECT ${cond} AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`;

/** Recria a funcao com `corpo` (mesmos atributos) e a rotulagem pedida. */
const recriar = (
  corpo,
  atributos = "SECURITY DEFINER SET search_path TO 'public'",
) =>
  `CREATE OR REPLACE FUNCTION ${FN.replace("()", "")}()
     RETURNS trigger
     LANGUAGE plpgsql ${atributos}
   AS $x$${corpo}$x$`;
const NL = "\n";

prova(
  "NEGATIVO 27a: corpo com 1 byte a mais, sem limpar uma coluna, sem a excecao do administrador, STABLE, SECURITY INVOKER, search_path, EXECUTE por papel e PUBLIC, gatilho (desligado, AFTER, em outra tabela, com WHEN, ausente) e objetos ausentes reprovam SO as linhas certas",
  async () => {
    const semLinha = (l) => CORPO.replace(l + NL, "");
    assert.notEqual(semLinha("        NEW.helpful := 0;"), CORPO);
    const casos = [
      [recriar(`${CORPO} `), funcaoSql("right(prosrc, 1) = ' '"), [A_MD5]],
      [
        recriar(semLinha("        NEW.helpful := 0;")),
        funcaoSql("position('NEW.helpful := 0;' IN prosrc) = 0"),
        [A_MD5, A_LIMPEZA],
      ],
      [
        recriar(semLinha("        NEW.merchant_reply := NULL;")),
        funcaoSql("position('NEW.merchant_reply := NULL;' IN prosrc) = 0"),
        [A_MD5, A_LIMPEZA],
      ],
      [
        recriar(
          CORPO.replace(
            `${NL}       AND NOT public.rls_admin_atual() THEN`,
            " THEN",
          ),
        ),
        funcaoSql(
          "position('AND NOT public.rls_admin_atual() THEN' IN prosrc) = 0",
        ),
        [A_MD5, A_LIMPEZA],
      ],
      [
        // sem a excecao da sessao direta: o rotulo da linha "limpeza" promete essa guarda
        recriar(CORPO.replace("<> 'none'", "<> 'zzzz'")),
        funcaoSql("position('<> ''none''' IN prosrc) = 0"),
        [A_MD5, A_LIMPEZA],
      ],
      [
        `ALTER FUNCTION ${FN} STABLE`,
        funcaoSql("provolatile = 's'"),
        [A_ATRIB],
      ],
      [
        `ALTER FUNCTION ${FN} SECURITY INVOKER`,
        funcaoSql("NOT prosecdef"),
        [A_ATRIB],
      ],
      [
        `ALTER FUNCTION ${FN} SET search_path TO public, extensions`,
        funcaoSql(
          "proconfig = ARRAY['search_path=public, extensions']::text[]",
        ),
        [A_ATRIB],
      ],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO anon`, exec("anon"), [A_ACL]],
      [
        `GRANT EXECUTE ON FUNCTION ${FN} TO authenticated`,
        exec("authenticated"),
        [A_ACL],
      ],
      [
        `GRANT EXECUTE ON FUNCTION ${FN} TO service_role`,
        exec("service_role"),
        [A_ACL],
      ],
      [`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`, execPublic, [A_ACL]],
      [
        `ALTER TABLE public.reviews DISABLE TRIGGER ${GATILHO}`,
        gatilhoSql("tgenabled = 'D'"),
        [A_GATILHO],
      ],
      [
        `DROP TRIGGER ${GATILHO} ON public.reviews; CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        gatilhoSql("tgtype = 5"),
        [A_GATILHO],
      ],
      [
        `DROP TRIGGER ${GATILHO} ON public.reviews; CREATE TRIGGER ${GATILHO} BEFORE INSERT OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        gatilhoSql("tgtype = 23"),
        [A_GATILHO],
      ],
      [
        `DROP TRIGGER ${GATILHO} ON public.reviews; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.reviews FOR EACH ROW WHEN (NEW.helpful > 0) EXECUTE FUNCTION ${FN}`,
        gatilhoSql("tgqual IS NOT NULL"),
        [A_GATILHO],
      ],
      [
        `DROP TRIGGER ${GATILHO} ON public.reviews; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        gatilhoSql("tgrelid = 'public.questions'::regclass"),
        [A_GATILHO],
      ],
      [`DROP TRIGGER ${GATILHO} ON public.reviews`, semGatilho, [A_GATILHO]],
      [
        `DROP FUNCTION ${FN} CASCADE`,
        `SELECT to_regprocedure('${FN}') IS NULL AS aplicou`,
        [A_MD5, A_LIMPEZA, A_ATRIB, A_ACL, A_GATILHO],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(A, { mutar, guardaSql }, esperadas);
  },
);

const DUMMY =
  "CREATE FUNCTION public.t_dummy_27() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$";

prova(
  "NEGATIVO 27b: funcao ou gatilho ja existentes, coluna fora do lugar, rls_admin_atual ausente e gatilho irmao ausente reprovam SO as linhas certas",
  async () => {
    const casos = [
      [
        "SELECT 1",
        "SELECT true AS aplicou",
        [],
        "controle: sem mutacao a 27b passa",
      ],
      [
        `CREATE FUNCTION ${FN.replace("()", "")}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
        funcaoSql("true"),
        [B_FUNCAO],
      ],
      [
        // so uma sobrecarga (assinatura diferente) tambem conta: a consulta olha o NOME
        "CREATE FUNCTION public.avaliacao_nasce_sem_a_resposta_da_loja(x int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'avaliacao_nasce_sem_a_resposta_da_loja') AS aplicou",
        [B_FUNCAO],
      ],
      [
        `${DUMMY}; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.t_dummy_27()`,
        `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${GATILHO}') AS aplicou`,
        [B_GATILHO],
      ],
      [
        // o gatilho de mesmo nome em OUTRA tabela tambem conta
        `${DUMMY}; CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION public.t_dummy_27()`,
        `SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '${GATILHO}') AS aplicou`,
        [B_GATILHO],
      ],
      [
        "ALTER TABLE public.reviews RENAME COLUMN helpful TO helpful_x",
        "SELECT to_regclass('public.reviews') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'helpful' AND NOT attisdropped) AS aplicou",
        [B_COLUNAS],
      ],
      [
        "ALTER TABLE public.reviews RENAME COLUMN merchant_reply_at TO merchant_reply_at_x",
        "SELECT NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'merchant_reply_at' AND NOT attisdropped) AS aplicou",
        [B_COLUNAS],
      ],
      [
        "ALTER FUNCTION public.rls_admin_atual() RENAME TO rls_admin_atual_x",
        "SELECT to_regprocedure('public.rls_admin_atual()') IS NULL AS aplicou",
        [B_RLS],
      ],
      [
        "DROP TRIGGER tr_avaliacao_nasce_verificada ON public.reviews",
        "SELECT NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_avaliacao_nasce_verificada') AS aplicou",
        [B_IRMAO],
      ],
      [
        // o gatilho irmao fora do desenho (BEFORE em vez de AFTER) nao e' o selo pela compra
        "DROP TRIGGER tr_avaliacao_nasce_verificada ON public.reviews; CREATE TRIGGER tr_avaliacao_nasce_verificada BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.marca_avaliacao_nasce_verificada()",
        "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_avaliacao_nasce_verificada' AND tgtype = 7) AS aplicou",
        [B_IRMAO],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(B, { estado: antes, mutar, guardaSql }, esperadas);
    // aplicar a migration inteira (depois do rollback) reprova as DUAS linhas de ausencia, e so elas
    const s = await noEstado(
      async (c) => {
        await c.query(ROLLBACK);
        await c.query(MIGRATION);
      },
      [B],
    );
    assert.deepEqual(reprovadas(s[B]), [B_FUNCAO, B_GATILHO].sort());
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 2 depois, 5 e 0 antes)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const veredito = (consulta, linhas) =>
      CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
    const d = await noEstado(depois, [A, B]);
    assert.match(
      veredito(A, d[A]),
      / linhas=6 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=6 ok_false=2 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=6 ok_false=5 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, a[B]),
      / linhas=6 ok_false=0 ok_nao_booleano=0 rol=ok$/,
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
    `\n[avaliacao-nasce-sem-resposta-da-loja-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
