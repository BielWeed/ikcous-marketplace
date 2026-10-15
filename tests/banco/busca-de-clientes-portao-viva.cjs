"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 32 (a busca de clientes) -- as migrations
 * 20261230000000 (get_admin_customers_paged: acha pelo numero do WhatsApp) e 20261231000000 (crm_clientes: ignora
 * acento) --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   32a-conferir-busca-de-clientes-aplicado.sql           (DEPOIS do apply: 9 linhas)
 *   32b-antes-busca-de-clientes-corpos-vigentes.sql       (ANTES do apply: 7 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essas migrations novas. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o
 * run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de tests/banco/busca-de-clientes-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a arvore
 * ja tem as duas migrations, cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que
 * termina em ROLLBACK: o DEPOIS e' as duas migrations aplicadas (idempotentes) e o ANTES e' o DEPOIS seguido
 * dos dois rollbacks-manuais (a ordem de desfazer). As consultas rodam nela como um papel de LEITURA nao
 * superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_32A e ROL_DA_32B),
 *             sem repetir nem faltar, em todos os estados.
 *  ESTADOS    depois: 32a POSITIVA e 32b reprova SO as linhas de corpo e marcador das duas funcoes; antes:
 *             32b POSITIVA e 32a reprova SO as linhas de corpo e marcador das duas; so a 30 aplicada ou so a
 *             31 aplicada: cada consulta reprova SO as linhas da funcao que esta no estado errado; aplicar
 *             DE NOVO, ida e volta e os arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito, em CADA funcao (1 byte a mais no corpo, corpo de antes, corpo sem a regra,
 *             volatilidade, SECURITY INVOKER, search_path, EXECUTE por papel e PUBLIC, funcao ausente) reprova
 *             EXATAMENTE as linhas certas; toda mutacao com guarda. A 32b NAO mede a ACL.
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (32a) ou o do arquivo da
 *             rollback-manual (32b) carrega, e o que o banco mede e' o mesmo.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user), a
 * ACL real e o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/busca-de-clientes-portao-viva.cjs
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

const A = "32a-conferir-busca-de-clientes-aplicado";
const B = "32b-antes-busca-de-clientes-corpos-vigentes";
const ARQ30 =
  "20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql";
const ARQ31 = "20261231000000_a_busca_do_crm_ignora_acento.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const lerMig = (nome) =>
  fs.readFileSync(path.join(MIGRATIONS, nome), "utf8").replace(/\r\n/g, "\n");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_32A, [B]: CONF.ROL_DA_32B };
const MIG30 = lerMig(ARQ30);
const MIG31 = lerMig(ARQ31);
const RB30 = lerMig(`rollback-manual-${ARQ30}`);
const RB31 = lerMig(`rollback-manual-${ARQ31}`);
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
  cliNovo: corpoDe(MIG30, "get_admin_customers_paged"),
  cliVigente: corpoDe(RB30, "get_admin_customers_paged"),
  crmNovo: corpoDe(MIG31, "crm_clientes"),
  crmVigente: corpoDe(RB31, "crm_clientes"),
};
const H = {
  cliNovo: md5(CORPO.cliNovo),
  cliVigente: md5(CORPO.cliVigente),
  crmNovo: md5(CORPO.crmNovo),
  crmVigente: md5(CORPO.crmVigente),
};

const CLI = "public.get_admin_customers_paged(text,text,text,integer,integer)";
const CRM = "public.crm_clientes(text,text,integer,integer)";

// ---- as linhas dos dois rols, pelo texto exato
const A_CLI_MD5 =
  "get_admin_customers_paged: corpo e o da 20261230000000, com a busca por digitos do WhatsApp (md5)";
const A_CLI_MARC =
  "get_admin_customers_paged: o corpo traz os digitos do termo e o corte do 55";
const A_CLI_ATRIB =
  "get_admin_customers_paged: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, extensions)";
const A_CLI_ACL =
  "get_admin_customers_paged: EXECUTE fechado para anon (authenticated e service_role sim)";
const A_CRM_MD5 =
  "crm_clientes: corpo e o da 20261231000000, com nome e e-mail sem acento (md5)";
const A_CRM_MARC = "crm_clientes: o corpo ignora o acento do nome";
const A_CRM_ATRIB =
  "crm_clientes: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)";
const A_CRM_ACL =
  "crm_clientes: EXECUTE fechado para anon (authenticated e service_role sim)";
const B_CLI_MD5 =
  "get_admin_customers_paged: corpo e o da 20261199000000, sem a busca por digitos (md5)";
const B_CLI_MARC =
  "get_admin_customers_paged: o corpo ainda NAO calcula os digitos do termo";
const B_CLI_ATRIB = A_CLI_ATRIB;
const B_CRM_MD5 =
  "crm_clientes: corpo e o da 20261199000000, sem o acento ignorado (md5)";
const B_CRM_MARC = "crm_clientes: o corpo ainda NAO ignora o acento do nome";
const B_CRM_ATRIB = A_CRM_ATRIB;

const PAPEL_RO = `portao32_ro_${process.pid}`;
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

// DEPOIS: as duas migrations (cada uma aceita o corpo vigente ou o seu).
const depois = async (c) => {
  await c.query(MIG30);
  await c.query(MIG31);
};
// ANTES: parte do DEPOIS (qualquer que seja o estado da arvore) e desfaz na ORDEM de desfazer (a 31, depois a 30).
const antes = async (c) => {
  await depois(c);
  await c.query(RB31);
  await c.query(RB30);
};
// SO UMA aplicada
const so30 = async (c) => {
  await antes(c);
  await c.query(MIG30);
};
const so31 = async (c) => {
  await antes(c);
  await c.query(MIG31);
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
    assert.equal(H.cliVigente, "3c4a0fc4ca6f5d1c9a017a38bff2ec49");
    assert.equal(H.cliNovo, "d6c092c3e0d8069891af795147d65e9e");
    assert.equal(H.crmVigente, "d5823a661555bcee3813ab32aeee9117");
    assert.equal(H.crmNovo, "9c4268178a50729b5f7b256b77882585");
    assert.ok(SQL[A].includes(`'${H.cliNovo}'`), "32a: md5 da tela Clientes");
    assert.ok(SQL[A].includes(`'${H.crmNovo}'`), "32a: md5 do CRM");
    assert.ok(
      SQL[B].includes(`'${H.cliVigente}'`),
      "32b: md5 vigente da tela Clientes",
    );
    assert.ok(SQL[B].includes(`'${H.crmVigente}'`), "32b: md5 vigente do CRM");
    for (const velho of [H.cliVigente, H.crmVigente])
      assert.ok(!SQL[A].includes(velho), "32a nao cita corpo de antes");
    for (const novo of [H.cliNovo, H.crmNovo])
      assert.ok(!SQL[B].includes(novo), "32b nao cita corpo novo");
    assert.ok(
      MIG30.includes(`'${H.cliNovo}'`) && MIG30.includes(`'${H.cliVigente}'`),
    );
    assert.ok(
      MIG31.includes(`'${H.crmNovo}'`) && MIG31.includes(`'${H.crmVigente}'`),
    );
  },
);

prova(
  "ROL: as 9 linhas da 32a e as 7 da 32b sao exatamente o rol, em todos os estados",
  async () => {
    for (const montar of [depois, antes, so30, so31]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 9);
    assert.equal(ROL[B].length, 7);
  },
);

prova(
  "DEPOIS (as duas migrations): 32a POSITIVA; 32b reprova SO as linhas de corpo e marcador das duas funcoes",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "32a toda ok no depois");
    assert.deepEqual(
      reprovadas(s[B]),
      [B_CLI_MD5, B_CLI_MARC, B_CRM_MD5, B_CRM_MARC].sort(),
    );
    assert.equal(s[A].find((l) => l.item === A_CLI_MD5).vivo, H.cliNovo);
    assert.equal(s[A].find((l) => l.item === A_CRM_MD5).vivo, H.crmNovo);
    assert.equal(s[A].find((l) => l.item === A_CLI_MARC).vivo, "sim");
    assert.equal(s[A].find((l) => l.item === A_CRM_MARC).vivo, "sim");
    for (const it of [A_CLI_ACL, A_CRM_ACL])
      assert.equal(
        s[A].find((l) => l.item === it).vivo,
        "PUBLIC=nao anon=nao authenticated=sim service_role=sim",
      );
  },
);

prova(
  "ANTES (os dois rollbacks-manuais): 32b POSITIVA; 32a reprova SO as linhas de corpo e marcador das duas funcoes",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "32b toda ok no antes");
    assert.deepEqual(
      reprovadas(s[A]),
      [A_CLI_MD5, A_CLI_MARC, A_CRM_MD5, A_CRM_MARC].sort(),
    );
    assert.equal(s[B].find((l) => l.item === B_CLI_MD5).vivo, H.cliVigente);
    assert.equal(s[B].find((l) => l.item === B_CRM_MD5).vivo, H.crmVigente);
    assert.equal(s[B].find((l) => l.item === B_CLI_MARC).vivo, "nao");
    assert.equal(s[B].find((l) => l.item === B_CRM_MARC).vivo, "nao");
  },
);

prova(
  "SO UMA aplicada: cada consulta reprova SO as linhas da funcao que esta no estado errado (a loja cai nas duas consultas: PARAR e medir)",
  async () => {
    const s30 = await noEstado(so30, [A, B]);
    // so a 30: a tela Clientes esta nova, o CRM esta antigo
    assert.deepEqual(reprovadas(s30[A]), [A_CRM_MD5, A_CRM_MARC].sort());
    assert.deepEqual(reprovadas(s30[B]), [B_CLI_MD5, B_CLI_MARC].sort());
    const s31 = await noEstado(so31, [A, B]);
    assert.deepEqual(reprovadas(s31[A]), [A_CLI_MD5, A_CLI_MARC].sort());
    assert.deepEqual(reprovadas(s31[B]), [B_CRM_MD5, B_CRM_MARC].sort());
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
  assert.deepEqual(
    reprovadas(dobro[B]),
    [B_CLI_MD5, B_CLI_MARC, B_CRM_MD5, B_CRM_MARC].sort(),
  );
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
      await antes(c);
      await c.query(emCRLF(MIG30));
      await c.query(emCRLF(MIG31));
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlf[A]), [], "o md5 ignora o CR");
  const crlfAntes = await noEstado(
    async (c) => {
      await depois(c);
      await c.query(emCRLF(RB31));
      await c.query(emCRLF(RB30));
    },
    [B],
  );
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
});

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [depois, antes, so30, so31]) {
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
  cli: {
    sig: CLI,
    cria: (corpo, attrs) =>
      `CREATE OR REPLACE FUNCTION public.get_admin_customers_paged(p_search text DEFAULT ''::text, p_sort_field text DEFAULT 'created_at'::text, p_sort_direction text DEFAULT 'desc'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10)
         RETURNS jsonb LANGUAGE plpgsql ${attrs}
       AS $x$${corpo}$x$`,
    attrs:
      "VOLATILE SECURITY DEFINER SET search_path TO 'public', 'extensions'",
    // o atributo que a funcao NAO tem: a volatilidade e o search_path de cada uma
    outraVolatilidade: "STABLE",
    outroSearchPath: "public",
    novo: CORPO.cliNovo,
    vigente: CORPO.cliVigente,
    A: {
      md5: A_CLI_MD5,
      marc: A_CLI_MARC,
      atrib: A_CLI_ATRIB,
      acl: A_CLI_ACL,
    },
    B: { md5: B_CLI_MD5, marc: B_CLI_MARC, atrib: B_CLI_ATRIB },
  },
  crm: {
    sig: CRM,
    cria: (corpo, attrs) =>
      `CREATE OR REPLACE FUNCTION public.crm_clientes(p_segmento text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
         RETURNS jsonb LANGUAGE plpgsql ${attrs}
       AS $x$${corpo}$x$`,
    attrs: "STABLE SECURITY DEFINER SET search_path TO 'public'",
    outraVolatilidade: "VOLATILE",
    outroSearchPath: "public, extensions",
    novo: CORPO.crmNovo,
    vigente: CORPO.crmVigente,
    A: {
      md5: A_CRM_MD5,
      marc: A_CRM_MARC,
      atrib: A_CRM_ATRIB,
      acl: A_CRM_ACL,
    },
    B: { md5: B_CRM_MD5, marc: B_CRM_MARC, atrib: B_CRM_ATRIB },
  },
};
const doProc = (sig, cond) =>
  `SELECT ${cond} AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${sig}')`;
const exec = (sig, papel) =>
  `SELECT has_function_privilege('${papel}', '${sig}'::regprocedure, 'EXECUTE') AS aplicou`;
const semExec = (sig, papel) =>
  `SELECT NOT has_function_privilege('${papel}', '${sig}'::regprocedure, 'EXECUTE') AS aplicou`;
const execPublic = (sig) =>
  `SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${sig}'::regprocedure AND a.grantee = 0) AS aplicou`;
const ausente = (sig) => `SELECT to_regprocedure('${sig}') IS NULL AS aplicou`;
const volatil = (v) => (v === "VOLATILE" ? "v" : "s");

/** Os casos da 32a de UMA funcao: cada defeito reprova EXATAMENTE as linhas dela. */
function casosDaA(f, semMarcador, guardaSemMarcador) {
  const { sig } = f;
  return [
    // 1 byte a mais: so o md5 cai (o marcador continua 'sim')
    [
      f.cria(`${f.novo} `, f.attrs),
      doProc(sig, "right(prosrc, 1) = ' '"),
      [f.A.md5],
    ],
    // o corpo de ANTES: md5 e marcador
    [f.cria(f.vigente, f.attrs), guardaSemMarcador(sig), [f.A.md5, f.A.marc]],
    // o corpo novo sem o texto que o marcador procura: md5 e marcador
    [f.cria(semMarcador, f.attrs), guardaSemMarcador(sig), [f.A.md5, f.A.marc]],
    [
      `ALTER FUNCTION ${sig} ${f.outraVolatilidade}`,
      doProc(sig, `provolatile = '${volatil(f.outraVolatilidade)}'`),
      [f.A.atrib],
    ],
    [
      `ALTER FUNCTION ${sig} SECURITY INVOKER`,
      doProc(sig, "NOT prosecdef"),
      [f.A.atrib],
    ],
    [
      `ALTER FUNCTION ${sig} SET search_path TO ${f.outroSearchPath}`,
      doProc(
        sig,
        `proconfig = ARRAY['search_path=${f.outroSearchPath}']::text[]`,
      ),
      [f.A.atrib],
    ],
    [`GRANT EXECUTE ON FUNCTION ${sig} TO anon`, exec(sig, "anon"), [f.A.acl]],
    [`GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`, execPublic(sig), [f.A.acl]],
    [
      `REVOKE EXECUTE ON FUNCTION ${sig} FROM authenticated`,
      semExec(sig, "authenticated"),
      [f.A.acl],
    ],
    [
      `REVOKE EXECUTE ON FUNCTION ${sig} FROM service_role`,
      semExec(sig, "service_role"),
      [f.A.acl],
    ],
    [
      `DROP FUNCTION ${sig}`,
      ausente(sig),
      [f.A.md5, f.A.marc, f.A.atrib, f.A.acl],
    ],
  ];
}

// o texto que o marcador de cada funcao procura (32a.sql); cada "sem" troca UM caractere, sem desbalancear nada
const SEM_DIGITOS = CORPO.cliNovo.replaceAll(
  "v_search_digitos",
  "v_search_digitx",
);
const SEM_CORTE_DO_55 = CORPO.cliNovo.replaceAll("IN (12, 13)", "IN (12, 14)");
const SEM_UNACCENT_NO_NOME = CORPO.crmNovo.replaceAll(
  "public.f_unaccent(COALESCE(nome_exibido",
  "public.f_unaccenx(COALESCE(nome_exibido",
);
const SEM_UNACCENT_NO_EMAIL = CORPO.crmNovo.replaceAll(
  "public.f_unaccent(COALESCE(email",
  "public.f_unaccenx(COALESCE(email",
);
for (const [novo, mutante] of [
  [CORPO.cliNovo, SEM_DIGITOS],
  [CORPO.cliNovo, SEM_CORTE_DO_55],
  [CORPO.crmNovo, SEM_UNACCENT_NO_NOME],
  [CORPO.crmNovo, SEM_UNACCENT_NO_EMAIL],
])
  assert.notEqual(mutante, novo, "o mutante do texto nao mudou nada");

prova(
  "NEGATIVO 32a (get_admin_customers_paged): 1 byte a mais, corpo de antes, sem os digitos, sem o corte do 55, volatilidade, SECURITY INVOKER, search_path, ACL por papel e PUBLIC e funcao ausente reprovam SO as linhas certas",
  async () => {
    const f = FUNCOES.cli;
    const sem = (sig) =>
      doProc(sig, "position('v_search_digitos' IN prosrc) = 0");
    for (const [mutar, guardaSql, esperadas] of casosDaA(f, SEM_DIGITOS, sem))
      await negativo(A, { mutar, guardaSql }, esperadas);
    // o corte do 55 sozinho: o marcador exige OS DOIS textos
    await negativo(
      A,
      {
        mutar: f.cria(SEM_CORTE_DO_55, f.attrs),
        guardaSql: doProc(f.sig, "position('IN (12, 13)' IN prosrc) = 0"),
      },
      [f.A.md5, f.A.marc],
    );
  },
);

prova(
  "NEGATIVO 32a (crm_clientes): os mesmos defeitos reprovam SO as linhas do crm_clientes; so o e-mail sem f_unaccent reprova so o md5",
  async () => {
    const f = FUNCOES.crm;
    const sem = (sig) =>
      doProc(
        sig,
        "position('public.f_unaccent(COALESCE(nome_exibido' IN prosrc) = 0",
      );
    for (const [mutar, guardaSql, esperadas] of casosDaA(
      f,
      SEM_UNACCENT_NO_NOME,
      sem,
    ))
      await negativo(A, { mutar, guardaSql }, esperadas);
    // o marcador olha so o nome (leitura humana); a protecao do e-mail e' do md5 -- LIMITE declarado na 32a
    await negativo(
      A,
      {
        mutar: f.cria(SEM_UNACCENT_NO_EMAIL, f.attrs),
        guardaSql: doProc(
          f.sig,
          "position('public.f_unaccent(COALESCE(email' IN prosrc) = 0",
        ),
      },
      [f.A.md5],
    );
  },
);

/** Os casos da 32b de UMA funcao (a 32b NAO mede a ACL). */
function casosDaB(f, guardaComMarcador) {
  const { sig } = f;
  return [
    [
      f.cria(`${f.vigente} `, f.attrs),
      doProc(sig, "right(prosrc, 1) = ' '"),
      [f.B.md5],
    ],
    // o corpo NOVO: md5 e marcador
    [f.cria(f.novo, f.attrs), guardaComMarcador(sig), [f.B.md5, f.B.marc]],
    [
      `ALTER FUNCTION ${sig} ${f.outraVolatilidade}`,
      doProc(sig, `provolatile = '${volatil(f.outraVolatilidade)}'`),
      [f.B.atrib],
    ],
    [
      `ALTER FUNCTION ${sig} SECURITY INVOKER`,
      doProc(sig, "NOT prosecdef"),
      [f.B.atrib],
    ],
    [
      `ALTER FUNCTION ${sig} SET search_path TO ${f.outroSearchPath}`,
      doProc(
        sig,
        `proconfig = ARRAY['search_path=${f.outroSearchPath}']::text[]`,
      ),
      [f.B.atrib],
    ],
    [`DROP FUNCTION ${sig}`, ausente(sig), [f.B.md5, f.B.marc, f.B.atrib]],
    // a 32b nao mede a ACL: estes nao a reprovam
    [`GRANT EXECUTE ON FUNCTION ${sig} TO anon`, exec(sig, "anon"), []],
    [`GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`, execPublic(sig), []],
    [
      `REVOKE EXECUTE ON FUNCTION ${sig} FROM authenticated`,
      semExec(sig, "authenticated"),
      [],
    ],
  ];
}

prova(
  "NEGATIVO 32b: corpo de antes com 1 byte a mais, corpo novo, volatilidade, SECURITY INVOKER, search_path e funcao ausente reprovam SO as linhas certas, em CADA funcao; ACL aberta ou sem authenticated NAO reprova",
  async () => {
    // controle: sem mutacao a 32b passa
    await negativo(
      B,
      { estado: antes, mutar: "SELECT 1", guardaSql: "SELECT true AS aplicou" },
      [],
    );
    const comDigitos = (sig) =>
      doProc(sig, "position('v_search_digitos' IN prosrc) > 0");
    const comUnaccent = (sig) =>
      doProc(
        sig,
        "position('public.f_unaccent(COALESCE(nome_exibido' IN prosrc) > 0",
      );
    for (const [f, guardaComMarcador] of [
      [FUNCOES.cli, comDigitos],
      [FUNCOES.crm, comUnaccent],
    ])
      for (const [mutar, guardaSql, esperadas] of casosDaB(
        f,
        guardaComMarcador,
      ))
        await negativo(B, { estado: antes, mutar, guardaSql }, esperadas);
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 4)",
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
      / linhas=7 ok_false=4 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=9 ok_false=4 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, a[B]),
      / linhas=7 ok_false=0 ok_nao_booleano=0 rol=ok$/,
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
      `${falhas.length} de ${PROVAS.length} provas do portao 32 falharam.`,
    );
  }
  console.log(
    `\n[busca-de-clientes-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
