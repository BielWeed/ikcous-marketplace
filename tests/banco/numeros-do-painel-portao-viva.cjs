"use strict";

/**
 * Prova VIVA das duas consultas do PORTAO DA RELEASE para o lote 30 (os numeros do painel) -- as migrations
 * 20261227000000 (crm_visao) e 20261228000000 (painel_inicio) --, num Postgres EFEMERO local, nada de rede,
 * nada de loja:
 *   30a-conferir-numeros-do-painel-aplicado.sql           (DEPOIS do apply: 9 linhas)
 *   30b-antes-numeros-do-painel-corpos-vigentes.sql       (ANTES do apply: 7 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essas migrations novas. Esta prova diz que
 * cada consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o
 * run da consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de tests/banco/numeros-do-painel-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a arvore
 * pode ou nao ja ter as duas migrations, cada estado e' montado DENTRO de uma transacao (como o dono da
 * conexao) que termina em ROLLBACK: o DEPOIS e' as duas migrations aplicadas (idempotentes) e o ANTES e' o
 * DEPOIS seguido dos dois rollbacks-manuais (o da 28 e depois o da 27, a ordem de desfazer). As consultas
 * rodam nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_30A e ROL_DA_30B),
 *             sem repetir nem faltar, em todos os estados.
 *  ESTADOS    depois: 30a POSITIVA e 30b reprova SO as linhas de corpo e marcador das duas funcoes; antes:
 *             30b POSITIVA e 30a reprova SO as linhas de corpo e marcador das duas; so a 27 aplicada ou so a
 *             28 aplicada: cada consulta reprova SO as linhas da funcao que esta no estado errado; aplicar
 *             DE NOVO, ida e volta e os arquivos em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito, em CADA funcao (1 byte a mais no corpo, corpo sem o corte, volatilidade,
 *             SECURITY INVOKER, search_path, EXECUTE por papel e PUBLIC, funcao ausente) reprova EXATAMENTE as
 *             linhas certas; toda mutacao com guarda. A 30b NAO mede a ACL.
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (30a) ou o do arquivo da
 *             rollback-manual (30b) carrega, e o que o banco mede e' o mesmo.
 *  PAPEL      as duas consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user), a
 * ACL real e o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/numeros-do-painel-portao-viva.cjs
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

const A = "30a-conferir-numeros-do-painel-aplicado";
const B = "30b-antes-numeros-do-painel-corpos-vigentes";
const ARQ27 = "20261227000000_o_crm_compara_o_que_e_comparavel.sql";
const ARQ28 = "20261228000000_o_inicio_compara_ate_a_mesma_hora.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const lerMig = (nome) =>
  fs.readFileSync(path.join(MIGRATIONS, nome), "utf8").replace(/\r\n/g, "\n");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_30A, [B]: CONF.ROL_DA_30B };
const MIG27 = lerMig(ARQ27);
const MIG28 = lerMig(ARQ28);
const RB27 = lerMig(`rollback-manual-${ARQ27}`);
const RB28 = lerMig(`rollback-manual-${ARQ28}`);
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
  crmNovo: corpoDe(MIG27, "crm_visao"),
  crmVigente: corpoDe(RB27, "crm_visao"),
  paiNovo: corpoDe(MIG28, "painel_inicio"),
  paiVigente: corpoDe(RB28, "painel_inicio"),
};
const H = {
  crmNovo: md5(CORPO.crmNovo),
  crmVigente: md5(CORPO.crmVigente),
  paiNovo: md5(CORPO.paiNovo),
  paiVigente: md5(CORPO.paiVigente),
};

const CRM = "public.crm_visao(date,date)";
const PAI = "public.painel_inicio()";

// ---- as linhas dos dois rols, pelo texto exato
const A_CRM_MD5 =
  "crm_visao: corpo e o da 20261227000000, com a taxa da turma e o corte na mesma hora (md5)";
const A_CRM_MARC =
  "crm_visao: o corpo traz a turma de vendas e o corte na mesma hora";
const A_CRM_ATRIB =
  "crm_visao: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)";
const A_CRM_ACL =
  "crm_visao: EXECUTE fechado para anon (authenticated e service_role sim)";
const A_PAI_MD5 =
  "painel_inicio: corpo e o da 20261228000000, com a semana passada cortada na mesma hora (md5)";
const A_PAI_MARC = "painel_inicio: o corpo traz o corte na mesma hora";
const A_PAI_ATRIB =
  "painel_inicio: atributos de sempre (SECURITY DEFINER, STABLE, search_path=public)";
const A_PAI_ACL =
  "painel_inicio: EXECUTE fechado para anon (authenticated e service_role sim)";
const B_CRM_MD5 =
  "crm_visao: corpo e o da 20261199000000, sem o corte na mesma hora (md5)";
const B_CRM_MARC =
  "crm_visao: o corpo ainda NAO corta o anterior na mesma hora";
const B_CRM_ATRIB = A_CRM_ATRIB;
const B_PAI_MD5 =
  "painel_inicio: corpo e o da 20261212000000, sem o corte na mesma hora (md5)";
const B_PAI_MARC =
  "painel_inicio: o corpo ainda NAO corta a semana passada na mesma hora";
const B_PAI_ATRIB = A_PAI_ATRIB;

const PAPEL_RO = `portao30_ro_${process.pid}`;
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

// DEPOIS: as duas migrations (cada uma aceita o corpo vigente ou o seu, entao a ordem de aplicar e' a da 27 e da 28).
const depois = async (c) => {
  await c.query(MIG27);
  await c.query(MIG28);
};
// ANTES: parte do DEPOIS (qualquer que seja o estado da arvore) e desfaz na ORDEM de desfazer (a 28, depois a 27).
const antes = async (c) => {
  await depois(c);
  await c.query(RB28);
  await c.query(RB27);
};
// SO UMA aplicada
const so27 = async (c) => {
  await antes(c);
  await c.query(MIG27);
};
const so28 = async (c) => {
  await antes(c);
  await c.query(MIG28);
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
    assert.equal(H.crmVigente, "7f6ec1bc0fa9f40591c0b577201b7c36");
    assert.equal(H.crmNovo, "c33073503fccc6caa5f1085265501eae");
    assert.equal(H.paiVigente, "f11d22d076c59ab54d1beb280954dd15");
    assert.equal(H.paiNovo, "ad5620273997ba9266f240f272bf399b");
    assert.ok(SQL[A].includes(`'${H.crmNovo}'`), "30a: md5 do crm_visao novo");
    assert.ok(SQL[A].includes(`'${H.paiNovo}'`), "30a: md5 do painel novo");
    assert.ok(
      SQL[B].includes(`'${H.crmVigente}'`),
      "30b: md5 do crm_visao vigente",
    );
    assert.ok(
      SQL[B].includes(`'${H.paiVigente}'`),
      "30b: md5 do painel vigente",
    );
    for (const velho of [H.crmVigente, H.paiVigente])
      assert.ok(!SQL[A].includes(velho), "30a nao cita corpo de antes");
    for (const novo of [H.crmNovo, H.paiNovo])
      assert.ok(!SQL[B].includes(novo), "30b nao cita corpo novo");
    assert.ok(
      MIG27.includes(`'${H.crmNovo}'`) && MIG27.includes(`'${H.crmVigente}'`),
    );
    assert.ok(
      MIG28.includes(`'${H.paiNovo}'`) && MIG28.includes(`'${H.paiVigente}'`),
    );
  },
);

prova(
  "ROL: as 9 linhas da 30a e as 7 da 30b sao exatamente o rol, em todos os estados",
  async () => {
    for (const montar of [depois, antes, so27, so28]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 9);
    assert.equal(ROL[B].length, 7);
  },
);

prova(
  "DEPOIS (as duas migrations): 30a POSITIVA; 30b reprova SO as linhas de corpo e marcador das duas funcoes",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "30a toda ok no depois");
    assert.deepEqual(
      reprovadas(s[B]),
      [B_CRM_MD5, B_CRM_MARC, B_PAI_MD5, B_PAI_MARC].sort(),
    );
    assert.equal(s[A].find((l) => l.item === A_CRM_MD5).vivo, H.crmNovo);
    assert.equal(s[A].find((l) => l.item === A_PAI_MD5).vivo, H.paiNovo);
    assert.equal(s[A].find((l) => l.item === A_CRM_MARC).vivo, "sim");
    assert.equal(s[A].find((l) => l.item === A_PAI_MARC).vivo, "sim");
    for (const it of [A_CRM_ACL, A_PAI_ACL])
      assert.equal(
        s[A].find((l) => l.item === it).vivo,
        "PUBLIC=nao anon=nao authenticated=sim service_role=sim",
      );
  },
);

prova(
  "ANTES (os dois rollbacks-manuais): 30b POSITIVA; 30a reprova SO as linhas de corpo e marcador das duas funcoes",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "30b toda ok no antes");
    assert.deepEqual(
      reprovadas(s[A]),
      [A_CRM_MD5, A_CRM_MARC, A_PAI_MD5, A_PAI_MARC].sort(),
    );
    assert.equal(s[B].find((l) => l.item === B_CRM_MD5).vivo, H.crmVigente);
    assert.equal(s[B].find((l) => l.item === B_PAI_MD5).vivo, H.paiVigente);
    assert.equal(s[B].find((l) => l.item === B_CRM_MARC).vivo, "nao");
    assert.equal(s[B].find((l) => l.item === B_PAI_MARC).vivo, "nao");
  },
);

prova(
  "SO UMA aplicada: cada consulta reprova SO as linhas da funcao que esta no estado errado (a loja cai nas duas consultas: PARAR e medir)",
  async () => {
    const s27 = await noEstado(so27, [A, B]);
    // so a 27: o crm_visao esta novo, o painel_inicio esta antigo
    assert.deepEqual(reprovadas(s27[A]), [A_PAI_MD5, A_PAI_MARC].sort());
    assert.deepEqual(reprovadas(s27[B]), [B_CRM_MD5, B_CRM_MARC].sort());
    const s28 = await noEstado(so28, [A, B]);
    assert.deepEqual(reprovadas(s28[A]), [A_CRM_MD5, A_CRM_MARC].sort());
    assert.deepEqual(reprovadas(s28[B]), [B_PAI_MD5, B_PAI_MARC].sort());
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
    [B_CRM_MD5, B_CRM_MARC, B_PAI_MD5, B_PAI_MARC].sort(),
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
      await c.query(emCRLF(MIG27));
      await c.query(emCRLF(MIG28));
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlf[A]), [], "o md5 ignora o CR");
  const crlfAntes = await noEstado(
    async (c) => {
      await depois(c);
      await c.query(emCRLF(RB28));
      await c.query(emCRLF(RB27));
    },
    [B],
  );
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
});

prova(
  "PAPEL: o dono da conexao e o papel minimo de leitura veem o MESMO resultado",
  async () => {
    for (const montar of [depois, antes, so27, so28]) {
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
  crm: {
    sig: CRM,
    cria: (corpo, attrs) =>
      `CREATE OR REPLACE FUNCTION public.crm_visao(p_inicio date, p_fim date)
         RETURNS jsonb LANGUAGE plpgsql ${attrs}
       AS $x$${corpo}$x$`,
    novo: CORPO.crmNovo,
    vigente: CORPO.crmVigente,
    A: { md5: A_CRM_MD5, marc: A_CRM_MARC, atrib: A_CRM_ATRIB, acl: A_CRM_ACL },
    B: { md5: B_CRM_MD5, marc: B_CRM_MARC, atrib: B_CRM_ATRIB },
  },
  pai: {
    sig: PAI,
    cria: (corpo, attrs) =>
      `CREATE OR REPLACE FUNCTION public.painel_inicio()
         RETURNS jsonb LANGUAGE plpgsql ${attrs}
       AS $x$${corpo}$x$`,
    novo: CORPO.paiNovo,
    vigente: CORPO.paiVigente,
    A: { md5: A_PAI_MD5, marc: A_PAI_MARC, atrib: A_PAI_ATRIB, acl: A_PAI_ACL },
    B: { md5: B_PAI_MD5, marc: B_PAI_MARC, atrib: B_PAI_ATRIB },
  },
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

/** Os casos da 30a de UMA funcao: cada defeito reprova EXATAMENTE as linhas dela. */
function casosDaA(f) {
  const { sig } = f;
  // o mesmo corpo novo sem o texto do corte (so o marcador cai, alem do md5)
  const semCorte = f.novo.replaceAll("::time <= v_hora", "::time <= v_horx");
  const casos = [
    [
      f.cria(`${f.novo} `, ATRIBUTOS),
      doProc(sig, "right(prosrc, 1) = ' '"),
      [f.A.md5],
    ],
    [
      f.cria(f.vigente, ATRIBUTOS),
      doProc(sig, "position('::time <= v_hora' IN prosrc) = 0"),
      [f.A.md5, f.A.marc],
    ],
    [
      f.cria(semCorte, ATRIBUTOS),
      doProc(sig, "position('::time <= v_hora' IN prosrc) = 0"),
      [f.A.md5, f.A.marc],
    ],
    [
      `ALTER FUNCTION ${sig} VOLATILE`,
      doProc(sig, "provolatile = 'v'"),
      [f.A.atrib],
    ],
    [
      `ALTER FUNCTION ${sig} SECURITY INVOKER`,
      doProc(sig, "NOT prosecdef"),
      [f.A.atrib],
    ],
    [
      `ALTER FUNCTION ${sig} SET search_path TO public, extensions`,
      doProc(
        sig,
        "proconfig = ARRAY['search_path=public, extensions']::text[]",
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
  return casos;
}

prova(
  "NEGATIVO 30a (crm_visao): 1 byte a mais, corpo de antes, sem o corte, VOLATILE, SECURITY INVOKER, search_path, ACL por papel e PUBLIC e funcao ausente reprovam SO as linhas certas",
  async () => {
    for (const [mutar, guardaSql, esperadas] of casosDaA(FUNCOES.crm))
      await negativo(A, { mutar, guardaSql }, esperadas);
  },
);

prova(
  "NEGATIVO 30a (painel_inicio): os mesmos defeitos reprovam SO as linhas do painel_inicio",
  async () => {
    for (const [mutar, guardaSql, esperadas] of casosDaA(FUNCOES.pai))
      await negativo(A, { mutar, guardaSql }, esperadas);
  },
);

prova(
  "NEGATIVO 30a (marcador da turma): o crm_visao novo sem a CTE `turma` reprova o md5 e o marcador",
  async () => {
    const f = FUNCOES.crm;
    const semTurma = f.novo.replaceAll("turma", "turmx");
    assert.notEqual(semTurma, f.novo);
    await negativo(
      A,
      {
        mutar: f.cria(semTurma, ATRIBUTOS),
        guardaSql: doProc(f.sig, "position('turma AS (' IN prosrc) = 0"),
      },
      [f.A.md5, f.A.marc],
    );
  },
);

/** Os casos da 30b de UMA funcao (a 30b NAO mede a ACL). */
function casosDaB(f) {
  const { sig } = f;
  return [
    [
      f.cria(`${f.vigente} `, ATRIBUTOS),
      doProc(sig, "right(prosrc, 1) = ' '"),
      [f.B.md5],
    ],
    [
      f.cria(f.novo, ATRIBUTOS),
      doProc(sig, "position('::time <= v_hora' IN prosrc) > 0"),
      [f.B.md5, f.B.marc],
    ],
    [
      `ALTER FUNCTION ${sig} VOLATILE`,
      doProc(sig, "provolatile = 'v'"),
      [f.B.atrib],
    ],
    [
      `ALTER FUNCTION ${sig} SECURITY INVOKER`,
      doProc(sig, "NOT prosecdef"),
      [f.B.atrib],
    ],
    [`DROP FUNCTION ${sig}`, ausente(sig), [f.B.md5, f.B.marc, f.B.atrib]],
    // a 30b nao mede a ACL: estes nao a reprovam
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
  "NEGATIVO 30b: corpo de antes com 1 byte a mais, corpo novo, VOLATILE, SECURITY INVOKER e funcao ausente reprovam SO as linhas certas, em CADA funcao; ACL aberta ou sem authenticated NAO reprova",
  async () => {
    // controle: sem mutacao a 30b passa
    await negativo(
      B,
      { estado: antes, mutar: "SELECT 1", guardaSql: "SELECT true AS aplicou" },
      [],
    );
    for (const f of [FUNCOES.crm, FUNCOES.pai])
      for (const [mutar, guardaSql, esperadas] of casosDaB(f))
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
      `${falhas.length} de ${PROVAS.length} provas do portao 30 falharam.`,
    );
  }
  console.log(
    `\n[numeros-do-painel-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
