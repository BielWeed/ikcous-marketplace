"use strict";

/**
 * Prova VIVA das consultas do PORTAO DA RELEASE para o lote 38 (a lojista renomeia e apaga categoria sem deixar
 * produto orfao) -- a migration 20261237000000 --, num Postgres EFEMERO local, nada de rede, nada de loja:
 *   38a-conferir-gestao-de-categorias-aplicado.sql              (DEPOIS do apply: 8 linhas)
 *   38b-antes-gestao-de-categorias-funcoes-ausentes.sql         (ANTES do apply: 6 linhas)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que cada consulta
 * DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o run da consulta contra
 * o ref de cada loja diz). O COMPORTAMENTO e' de tests/banco/categorias-gestao-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a arvore ja tem a
 * migration, cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que termina em ROLLBACK: o
 * DEPOIS e' a migration aplicada (idempotente) e o ANTES e' o DEPOIS seguido do rollback-manual. As consultas rodam
 * nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  HASH       o md5 literal da 38a e' o do corpo que o ARQUIVO da migration carrega em cada uma das tres portas, e o
 *             que o banco mede e' o mesmo.
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_38A e ROL_DA_38B),
 *             sem repetir nem faltar, em todos os estados.
 *  ESTADOS    depois: 38a POSITIVA e 38b reprova SO as linhas das portas e das auxiliares; antes: 38b POSITIVA e 38a
 *             reprova SO as seis linhas das portas e das auxiliares; aplicar DE NOVO, ida e volta e o arquivo em
 *             CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais em cada corpo, atributo trocado, EXECUTE aberto ou fechado demais, auxiliar
 *             aberta ou ausente, gatilho ausente, coluna ou funcao de que a migration depende fora do lugar, porta ou
 *             auxiliar ja existindo) reprova EXATAMENTE a linha certa; toda mutacao com guarda.
 *  PAPEL      as consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user), a ACL real e
 * o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/categorias-gestao-portao-viva.cjs
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

const A = "38a-conferir-gestao-de-categorias-aplicado";
const B = "38b-antes-gestao-de-categorias-funcoes-ausentes";
const ARQ =
  "20261237000000_a_lojista_renomeia_e_apaga_categoria_sem_deixar_produto_orfao.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const lerMig = (nome) =>
  fs.readFileSync(path.join(MIGRATIONS, nome), "utf8").replace(/\r\n/g, "\n");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B) };
const ROL = { [A]: CONF.ROL_DA_38A, [B]: CONF.ROL_DA_38B };
const MIG = lerMig(ARQ);
const RB = lerMig(`rollback-manual-${ARQ}`);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<fn>(` do arquivo. */
function corpoDe(sql, fn) {
  const marca = `CREATE OR REPLACE FUNCTION public.${fn}(`;
  assert.equal(sql.split(marca).length - 1, 1, `${fn}: definicao repetida`);
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const H = {
  renomear: md5(corpoDe(MIG, "renomear_categoria")),
  apagar: md5(corpoDe(MIG, "apagar_categoria_vazia")),
  listar: md5(corpoDe(MIG, "categorias_com_uso")),
};

const PORTAS = {
  renomear: "public.renomear_categoria(uuid,text)",
  apagar: "public.apagar_categoria_vazia(uuid)",
  listar: "public.categorias_com_uso()",
};
const AUXILIARES = [
  "public.categoria__chave(text)",
  "public.categoria__slug(text)",
  "public.categoria__url_codifica(text)",
  "public.categoria__url_decodifica(text)",
  "public.categoria__partes_do_link(text)",
  "public.categoria__nome_do_link(text)",
  "public.categoria__mesma(text,text,boolean)",
  "public.categoria__usos(uuid)",
];

// ---- as linhas dos dois rols, pelo texto exato
const [
  A_CONTROLE,
  A_RENOMEAR,
  A_APAGAR,
  A_LISTAR,
  A_ATRIB,
  A_ACL,
  A_AUX,
  A_TRG,
] = CONF.ROL_DA_38A;
const [B_CONTROLE, B_PORTAS, B_AUX, B_COLUNAS, B_FUNCOES, B_TRG] =
  CONF.ROL_DA_38B;

const PAPEL_RO = `portao35_ro_${process.pid}`;
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

// DEPOIS: a migration (idempotente).
const depois = async (c) => {
  await c.query(MIG);
};
// ANTES: parte do DEPOIS (qualquer que seja o estado da arvore) e desfaz.
const antes = async (c) => {
  await depois(c);
  await c.query(RB);
};

const reprovadas = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();
const linhaDe = (linhas, item) => {
  const l = linhas.find((x) => x.item === item);
  assert.ok(l, `a consulta nao tem a linha ${item}`);
  return l;
};

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

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova(
  "HASH: o md5 literal da 38a e' o do corpo que o arquivo carrega, e o banco mede o mesmo",
  async () => {
    assert.equal(H.renomear, "01a0d0acddb57f9ca88f7131336357c9");
    assert.equal(H.apagar, "942449150bb5e6fadfa7cf003f3fa49e");
    assert.equal(H.listar, "9e92ace839e626ff293e79b407e5768f");
    for (const h of Object.values(H))
      assert.ok(SQL[A].includes(`'${h}'`), `38a: md5 ${h}`);
    assert.equal(
      new Set(Object.values(H)).size,
      3,
      "os tres corpos tem hashes diferentes",
    );
    for (const h of Object.values(H))
      assert.ok(!SQL[B].includes(h), "a 38b nao cita corpo novo");
    for (const [chave, assinatura] of Object.entries(PORTAS)) {
      const r = await C.query(
        "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [assinatura],
      );
      assert.equal(
        r.rows[0]?.h,
        H[chave],
        `${chave}: o clone nao esta com o corpo da migration`,
      );
    }
  },
);

prova(
  "ROL: as 8 linhas da 38a e as 6 da 38b sao exatamente o rol, em todos os estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 8);
    assert.equal(ROL[B].length, 6);
  },
);

prova(
  "DEPOIS (a migration): 38a POSITIVA; 38b reprova SO as portas e as auxiliares",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "38a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [B_PORTAS, B_AUX].sort());
    assert.equal(linhaDe(s[A], A_RENOMEAR).vivo, H.renomear);
    assert.equal(linhaDe(s[A], A_APAGAR).vivo, H.apagar);
    assert.equal(linhaDe(s[A], A_LISTAR).vivo, H.listar);
    assert.equal(
      linhaDe(s[A], A_ACL).vivo,
      "PUBLIC=nao anon=nao authenticated=sim service_role=sim",
    );
    assert.equal(linhaDe(s[A], A_AUX).vivo, "8 existem, 0 abertas");
    assert.equal(
      linhaDe(s[B], B_PORTAS).vivo,
      "apagar_categoria_vazia, categorias_com_uso, renomear_categoria",
    );
  },
);

prova(
  "ANTES (o rollback-manual): 38b POSITIVA; 38a reprova SO as seis linhas das portas e das auxiliares",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "38b toda ok no antes");
    assert.deepEqual(
      reprovadas(s[A]),
      [A_RENOMEAR, A_APAGAR, A_LISTAR, A_ATRIB, A_ACL, A_AUX].sort(),
    );
    for (const item of [A_RENOMEAR, A_APAGAR, A_LISTAR, A_ATRIB, A_ACL])
      assert.equal(linhaDe(s[A], item).vivo, "AUSENTE", item);
    assert.equal(linhaDe(s[A], A_AUX).vivo, "0 existem");
    assert.equal(linhaDe(s[B], B_PORTAS).vivo, "nenhuma");
    assert.equal(linhaDe(s[B], B_AUX).vivo, "nenhuma");
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
  assert.deepEqual(reprovadas(dobro[B]), [B_PORTAS, B_AUX].sort());
  const idaEVolta = await noEstado(
    async (c) => {
      await antes(c);
      await depois(c);
    },
    [A],
  );
  assert.deepEqual(reprovadas(idaEVolta[A]), []);
  // o arquivo em CRLF (Windows): o md5 ignora o \r, o veredito e' o mesmo
  const crlf = await noEstado(
    async (c) => {
      await antes(c);
      await c.query(emCRLF(MIG));
    },
    [A],
  );
  assert.deepEqual(reprovadas(crlf[A]), []);
  const crlfAntes = await noEstado(
    async (c) => {
      await depois(c);
      await c.query(emCRLF(RB));
    },
    [B],
  );
  assert.deepEqual(reprovadas(crlfAntes[B]), []);
});

// ---- os negativos: cada defeito reprova EXATAMENTE as linhas certas
const quote = (s) => `'${s.replace(/'/g, "''")}'`;
/** Recria a funcao com UM byte a mais no corpo (um comentario antes do ultimo END), mantendo os atributos. */
const corpoComByteAMais = (assinatura) =>
  `DO $mut$ DECLARE v text; BEGIN
     SELECT pg_get_functiondef(to_regprocedure(${quote(assinatura)})) INTO v;
     IF position(E'\\nEND;\\n$function$' IN v) = 0 THEN RAISE EXCEPTION 'mutacao nao aplica'; END IF;
     EXECUTE replace(v, E'\\nEND;\\n$function$', E'\\n-- a mais\\nEND;\\n$function$');
   END $mut$`;
const guardaCorpo = (assinatura) =>
  `SELECT (prosrc LIKE '%-- a mais%') AS aplicou FROM pg_proc WHERE oid = to_regprocedure(${quote(assinatura)})`;
const guardaSql = (consulta) => `SELECT (${consulta}) AS aplicou`;

/** Roda a consulta no estado mutado e confere as linhas reprovadas. */
async function negativo(consulta, { estado, mutar, guarda }, esperadas) {
  const s = await noEstado(
    async (c) => {
      await estado(c);
      await c.query(mutar);
      if (guarda) {
        const r = await c.query(guarda);
        assert.equal(
          r.rows[0].aplicou,
          true,
          `a mutacao nao aplicou: ${mutar.slice(0, 80)}`,
        );
      }
    },
    [consulta],
  );
  confereRol(consulta, s[consulta]);
  assert.deepEqual(
    reprovadas(s[consulta]),
    [...esperadas].sort(),
    `${consulta}: ${mutar.slice(0, 90)}`,
  );
}

prova(
  "CONTROLE: sem mutacao a 38a passa no depois e a 38b no antes",
  async () => {
    await negativo(A, { estado: depois, mutar: "SELECT 1" }, []);
    await negativo(B, { estado: antes, mutar: "SELECT 1" }, []);
  },
);

prova("NEGATIVO 38a: cada defeito reprova SO as linhas certas", async () => {
  const temAcl = (assinatura, papel) =>
    `has_function_privilege(${quote(papel)}, to_regprocedure(${quote(assinatura)}), 'EXECUTE')`;
  const casos = [
    // 1 byte a mais em cada corpo: SO o md5 daquela porta (os atributos e a ACL ficam)
    [
      corpoComByteAMais(PORTAS.renomear),
      guardaCorpo(PORTAS.renomear),
      [A_RENOMEAR],
    ],
    [corpoComByteAMais(PORTAS.apagar), guardaCorpo(PORTAS.apagar), [A_APAGAR]],
    [corpoComByteAMais(PORTAS.listar), guardaCorpo(PORTAS.listar), [A_LISTAR]],
    // atributos
    [
      `ALTER FUNCTION ${PORTAS.listar} VOLATILE`,
      guardaSql(
        `(SELECT provolatile FROM pg_proc WHERE oid = to_regprocedure(${quote(PORTAS.listar)})) = 'v'`,
      ),
      [A_ATRIB],
    ],
    [
      `ALTER FUNCTION ${PORTAS.renomear} STABLE`,
      guardaSql(
        `(SELECT provolatile FROM pg_proc WHERE oid = to_regprocedure(${quote(PORTAS.renomear)})) = 's'`,
      ),
      [A_ATRIB],
    ],
    [
      `ALTER FUNCTION ${PORTAS.apagar} SECURITY INVOKER`,
      guardaSql(
        `NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(${quote(PORTAS.apagar)}))`,
      ),
      [A_ATRIB],
    ],
    [
      `ALTER FUNCTION ${PORTAS.apagar} SET search_path = public, pg_temp`,
      guardaSql(
        `(SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure(${quote(PORTAS.apagar)})) = ARRAY['search_path=public, pg_temp']::text[]`,
      ),
      [A_ATRIB],
    ],
    // EXECUTE aberto demais (PUBLIC, anon) ou fechado demais (authenticated, service_role)
    [
      `GRANT EXECUTE ON FUNCTION ${PORTAS.renomear} TO PUBLIC`,
      guardaSql(temAcl(PORTAS.renomear, "anon")),
      [A_ACL],
    ],
    [
      `GRANT EXECUTE ON FUNCTION ${PORTAS.listar} TO anon`,
      guardaSql(temAcl(PORTAS.listar, "anon")),
      [A_ACL],
    ],
    [
      `REVOKE EXECUTE ON FUNCTION ${PORTAS.apagar} FROM authenticated`,
      guardaSql(`NOT ${temAcl(PORTAS.apagar, "authenticated")}`),
      [A_ACL],
    ],
    [
      `REVOKE EXECUTE ON FUNCTION ${PORTAS.renomear} FROM service_role`,
      guardaSql(`NOT ${temAcl(PORTAS.renomear, "service_role")}`),
      [A_ACL],
    ],
    // auxiliar aberta (anon, authenticated, service_role, PUBLIC) ou ausente
    [
      `GRANT EXECUTE ON FUNCTION ${AUXILIARES[0]} TO anon`,
      guardaSql(temAcl(AUXILIARES[0], "anon")),
      [A_AUX],
    ],
    [
      `GRANT EXECUTE ON FUNCTION ${AUXILIARES[7]} TO authenticated`,
      guardaSql(temAcl(AUXILIARES[7], "authenticated")),
      [A_AUX],
    ],
    [
      `GRANT EXECUTE ON FUNCTION ${AUXILIARES[3]} TO service_role`,
      guardaSql(temAcl(AUXILIARES[3], "service_role")),
      [A_AUX],
    ],
    [
      `GRANT EXECUTE ON FUNCTION ${AUXILIARES[5]} TO PUBLIC`,
      guardaSql(temAcl(AUXILIARES[5], "anon")),
      [A_AUX],
    ],
    [
      `DROP FUNCTION ${AUXILIARES[6]}`,
      guardaSql(`to_regprocedure(${quote(AUXILIARES[6])}) IS NULL`),
      [A_AUX],
    ],
    // a contagem e' pela ASSINATURA (nome + tipos), nao pelo nome: uma sobrecarga no lugar da auxiliar de verdade
    // (mesmo nome, outro tipo de argumento) NAO faz a auxiliar existir; antes a contagem por nome dava "8 existem"
    [
      `DROP FUNCTION ${AUXILIARES[1]};
       CREATE FUNCTION public.categoria__slug(text, integer) RETURNS text LANGUAGE sql AS $f$ SELECT 'x'::text $f$;
       REVOKE ALL ON FUNCTION public.categoria__slug(text, integer) FROM PUBLIC, anon, authenticated, service_role`,
      guardaSql(
        `to_regprocedure(${quote(AUXILIARES[1])}) IS NULL AND to_regprocedure('public.categoria__slug(text,integer)') IS NOT NULL`,
      ),
      [A_AUX],
    ],
    // e uma sobrecarga A MAIS, com as oito de verdade no lugar, nao entra na conta (a lista de portas permitidas
    // do L8 e' quem pega funcao aberta que nao deveria existir)
    [
      `CREATE FUNCTION public.categoria__chave(text, integer) RETURNS text LANGUAGE sql AS $f$ SELECT 'x'::text $f$;
       REVOKE ALL ON FUNCTION public.categoria__chave(text, integer) FROM PUBLIC, anon, authenticated, service_role`,
      guardaSql(
        `to_regprocedure('public.categoria__chave(text,integer)') IS NOT NULL`,
      ),
      [],
    ],
    // o gatilho que avisa a vitrine do produto trocado
    [
      "DROP TRIGGER set_ultima_atualizacao ON public.produtos",
      "SELECT true AS aplicou",
      [A_TRG],
    ],
    [
      "ALTER TABLE public.produtos DISABLE TRIGGER set_ultima_atualizacao",
      "SELECT true AS aplicou",
      [A_TRG],
    ],
  ];
  for (const [mutar, guarda, esperadas] of casos)
    await negativo(A, { estado: depois, mutar, guarda }, esperadas);
  // porta ausente: a linha dela vira AUSENTE (e os atributos e a ACL, que dependem das tres, tambem)
  for (const [fn, corpoDaPorta] of [
    [PORTAS.renomear, A_RENOMEAR],
    [PORTAS.apagar, A_APAGAR],
    [PORTAS.listar, A_LISTAR],
  ]) {
    const s = await noEstado(
      async (c) => {
        await depois(c);
        await c.query(`DROP FUNCTION ${fn}`);
      },
      [A],
    );
    confereRol(A, s[A]);
    assert.deepEqual(
      reprovadas(s[A]),
      [corpoDaPorta, A_ATRIB, A_ACL].sort(),
      `sem ${fn}`,
    );
    assert.equal(linhaDe(s[A], corpoDaPorta).vivo, "AUSENTE");
  }
});

prova(
  "NEGATIVO 38b: porta ou auxiliar ja existindo, coluna, funcao ou gatilho fora do lugar reprovam SO a linha certa",
  async () => {
    const casos = [
      // uma das tres portas ja existe (qualquer corpo)
      [
        "CREATE FUNCTION public.categorias_com_uso() RETURNS jsonb LANGUAGE sql AS $f$ SELECT '[]'::jsonb $f$",
        guardaSql("to_regprocedure('public.categorias_com_uso()') IS NOT NULL"),
        [B_PORTAS],
      ],
      [
        "CREATE FUNCTION public.renomear_categoria(uuid, text, integer) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$",
        guardaSql(
          "to_regprocedure('public.renomear_categoria(uuid,text,integer)') IS NOT NULL",
        ),
        [B_PORTAS],
      ],
      // uma auxiliar ja existe, de qualquer assinatura
      [
        "CREATE FUNCTION public.categoria__chave(text, integer) RETURNS text LANGUAGE sql AS $f$ SELECT 'x'::text $f$",
        guardaSql(
          "to_regprocedure('public.categoria__chave(text,integer)') IS NOT NULL",
        ),
        [B_AUX],
      ],
      [
        "CREATE FUNCTION public.categoria__outra() RETURNS text LANGUAGE sql AS $f$ SELECT 'x'::text $f$",
        guardaSql("to_regprocedure('public.categoria__outra()') IS NOT NULL"),
        [B_AUX],
      ],
      // coluna de que a migration depende, fora do lugar
      [
        "ALTER TABLE public.banners RENAME COLUMN link TO link_x",
        guardaSql(
          "NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.banners'::regclass AND attname = 'link' AND NOT attisdropped)",
        ),
        [B_COLUNAS],
      ],
      [
        "ALTER TABLE public.politica_devolucao RENAME COLUMN categorias_sem_troca TO categorias_sem_troca_x",
        guardaSql(
          "NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.politica_devolucao'::regclass AND attname = 'categorias_sem_troca' AND NOT attisdropped)",
        ),
        [B_COLUNAS],
      ],
      [
        "ALTER TABLE public.categorias RENAME COLUMN ativo TO ativo_x",
        guardaSql(
          "NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.categorias'::regclass AND attname = 'ativo' AND NOT attisdropped)",
        ),
        [B_COLUNAS],
      ],
      // funcao de papel ou de acento fora do lugar
      [
        "ALTER FUNCTION public.f_unaccent(text) RENAME TO f_unaccent_x",
        guardaSql("to_regprocedure('public.f_unaccent(text)') IS NULL"),
        [B_FUNCOES],
      ],
      [
        "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_x",
        guardaSql("to_regprocedure('public.is_admin_atual()') IS NULL"),
        [B_FUNCOES],
      ],
      // o gatilho do produto
      [
        "DROP TRIGGER set_ultima_atualizacao ON public.produtos",
        "SELECT true AS aplicou",
        [B_TRG],
      ],
      [
        "ALTER TABLE public.produtos DISABLE TRIGGER set_ultima_atualizacao",
        "SELECT true AS aplicou",
        [B_TRG],
      ],
    ];
    for (const [mutar, guarda, esperadas] of casos)
      await negativo(B, { estado: antes, mutar, guarda }, esperadas);
    assert.equal(ROL[B][0], B_CONTROLE);
    assert.equal(ROL[A][0], A_CONTROLE);
  },
);

prova(
  "PAPEL: o dono da conexao e o papel minimo veem o MESMO resultado",
  async () => {
    for (const montar of [depois, antes]) {
      const ro = await noEstado(montar, [A, B]);
      const dono = await noEstado(montar, [A, B], { comoDono: true });
      assert.deepEqual(dono, ro);
    }
  },
);

prova(
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 2 no depois, 6 e 0 no antes)",
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
      / linhas=6 ok_false=2 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=8 ok_false=6 ok_nao_booleano=0 rol=ok$/,
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
      `${falhas.length} de ${PROVAS.length} provas do portao 38 falharam.`,
    );
  }
  console.log(
    `\n[categorias-gestao-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
