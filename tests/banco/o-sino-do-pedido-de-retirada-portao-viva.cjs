"use strict";

/**
 * Prova VIVA das consultas do PORTAO DA RELEASE para o lote 34 (o sino do pedido de retirada fala de retirada) --
 * a migration 20261233000000 (notifica_cliente_de_mudanca_de_status) --, num Postgres EFEMERO local, nada de
 * rede, nada de loja:
 *   34a-conferir-sino-da-retirada-aplicado.sql        (DEPOIS do apply: 7 linhas)
 *   34b-antes-sino-da-retirada-corpo-vigente.sql      (ANTES do apply: 6 linhas)
 *   34m-medir-sino-da-retirada.sql                    (medicao de ROL ABERTO: nao e portao)
 * Elas sao a "prova de objetos" do lote em scripts/frota/canais-de-backend.json: sem elas o portao
 * (scripts/frota/publicar-release.mjs) bloqueia a release com essa migration nova. Esta prova diz que cada
 * consulta DECIDE certo -- nao que a IKCOUS ou a Savy estao no estado de antes ou de depois (isso so o run da
 * consulta contra o ref de cada loja diz). O COMPORTAMENTO e' de tests/banco/o-sino-do-pedido-de-retirada-viva.cjs.
 *
 * COMO RODA: o banco e' o clone que o rodar-isolado.cjs entrega (a arvore inteira migrada). Como a arvore ja tem a
 * migration, cada estado e' montado DENTRO de uma transacao (como o dono da conexao) que termina em ROLLBACK: o
 * DEPOIS e' a migration aplicada (idempotente) e o ANTES e' o DEPOIS seguido do rollback-manual. As consultas
 * rodam nela como um papel de LEITURA nao superusuario, com `SET LOCAL ROLE` e a transacao ja somente leitura.
 *
 *  HASH       o md5 literal de cada .sql e' o do corpo que o ARQUIVO da migration (34a) ou o do rollback-manual
 *             (34b) carrega, e o que o banco mede e' o mesmo.
 *  ROL        as linhas de cada consulta sao EXATAMENTE o rol de conferir-banco.cjs (ROL_DA_34A e ROL_DA_34B),
 *             sem repetir nem faltar, em todos os estados.
 *  ESTADOS    depois: 34a POSITIVA e 34b reprova SO o corpo e o marcador; antes: 34b POSITIVA e 34a reprova SO o
 *             corpo e o marcador da retirada; aplicar DE NOVO, ida e volta e o arquivo em CRLF: o mesmo veredito.
 *  NEGATIVOS  cada defeito (1 byte a mais no corpo, corpo de antes, corpo sem o texto da entrega, volatilidade,
 *             SECURITY INVOKER, search_path, trigger ausente ou em todas as colunas, PUBLIC sem EXECUTE, funcao
 *             ausente) reprova EXATAMENTE as linhas certas; toda mutacao com guarda.
 *  MEDICAO    a 34m devolve tipo/objeto/detalhe, sem coluna `ok`, so contagens, com os pedidos de retirada, os de
 *             conta, as duas marcas fora de acordo e os avisos antigos contados certo.
 *  PAPEL      as consultas dao o MESMO resultado para o dono da conexao e para o papel minimo.
 *  PORTAO     o veredito do conferir-banco.cjs sobre as linhas reais: rol=ok e ok_false certo.
 *
 * LIMITE DECLARADO: o Postgres e' o 17 LOCAL; o papel de leitura real da loja (supabase_read_only_user), a ACL
 * real e o corpo vivo das lojas NAO foram medidos aqui.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs
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

const A = "34a-conferir-sino-da-retirada-aplicado";
const B = "34b-antes-sino-da-retirada-corpo-vigente";
const M = "34m-medir-sino-da-retirada";
const ARQ = "20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql";
const lerConsulta = (nome) =>
  fs.readFileSync(path.join(CONSULTAS, `${nome}.sql`), "utf8");
const lerMig = (nome) =>
  fs.readFileSync(path.join(MIGRATIONS, nome), "utf8").replace(/\r\n/g, "\n");
const SQL = { [A]: lerConsulta(A), [B]: lerConsulta(B), [M]: lerConsulta(M) };
const ROL = { [A]: CONF.ROL_DA_34A, [B]: CONF.ROL_DA_34B };
const MIG = lerMig(ARQ);
const RB = lerMig(`rollback-manual-${ARQ}`);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<fn>(` do arquivo. */
function corpoDe(sql) {
  const marca =
    "CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status(";
  assert.equal(sql.split(marca).length - 1, 1, "mais de uma definicao");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const H = { novo: md5(corpoDe(MIG)), vigente: md5(corpoDe(RB)) };

const FN = "public.notifica_cliente_de_mudanca_de_status()";
const TRG = "tr_pedido_avisa_o_cliente";

// ---- as linhas dos dois rols, pelo texto exato
const FN_ = "notifica_cliente_de_mudanca_de_status";
const A_MD5 = `${FN_}: corpo e o da 20261233000000, com o texto da retirada (md5)`;
const A_RETIRADA = `${FN_}: o corpo traz o texto da retirada`;
const A_ENTREGA = `${FN_}: o corpo ainda traz o texto da entrega`;
const A_ATRIB = `${FN_}: atributos de sempre (SECURITY DEFINER, VOLATILE, search_path=public, trigger)`;
const A_TRG =
  "tr_pedido_avisa_o_cliente: segue ligada a funcao (AFTER UPDATE OF status, por linha)";
const A_ACL = `${FN_}: EXECUTE como hoje (aberto por heranca do PUBLIC)`;
const B_MD5 = `${FN_}: corpo e o da 20261026000000, sem o texto da retirada (md5)`;
const B_RETIRADA = `${FN_}: o corpo ainda NAO traz o texto da retirada`;
const B_ATRIB = A_ATRIB;
const B_TRG =
  "tr_pedido_avisa_o_cliente: ligada a funcao (AFTER UPDATE OF status, por linha)";
const B_ACL = A_ACL;

const PAPEL_RO = `portao34_ro_${process.pid}`;
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

// DEPOIS: a migration (aceita o corpo vigente ou o seu).
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
  "HASH: o md5 literal de cada consulta e' o do corpo que o arquivo carrega",
  async () => {
    assert.equal(H.vigente, "7ace411aa5e184677d21d3b15ae94bf2");
    assert.equal(H.novo, "fc8fd54a2fa1533f0d926744aab8ff58");
    assert.ok(SQL[A].includes(`'${H.novo}'`), "34a: md5 novo");
    assert.ok(SQL[B].includes(`'${H.vigente}'`), "34b: md5 vigente");
    assert.ok(!SQL[A].includes(H.vigente), "34a nao cita corpo de antes");
    assert.ok(!SQL[B].includes(H.novo), "34b nao cita corpo novo");
    assert.ok(MIG.includes(`'${H.novo}'`) && MIG.includes(`'${H.vigente}'`));
    // e o que o banco mede e' o mesmo
    const r = await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    );
    assert.equal(
      r.rows[0].h,
      H.novo,
      "o clone nao esta com o corpo da migration",
    );
  },
);

prova(
  "ROL: as 7 linhas da 34a e as 6 da 34b sao exatamente o rol, em todos os estados",
  async () => {
    for (const montar of [depois, antes]) {
      const s = await noEstado(montar, [A, B]);
      confereRol(A, s[A]);
      confereRol(B, s[B]);
    }
    assert.equal(ROL[A].length, 7);
    assert.equal(ROL[B].length, 6);
  },
);

prova(
  "DEPOIS (a migration): 34a POSITIVA; 34b reprova SO o corpo e o marcador",
  async () => {
    const s = await noEstado(depois, [A, B]);
    assert.deepEqual(reprovadas(s[A]), [], "34a toda ok no depois");
    assert.deepEqual(reprovadas(s[B]), [B_MD5, B_RETIRADA].sort());
    assert.equal(s[A].find((l) => l.item === A_MD5).vivo, H.novo);
    assert.equal(s[A].find((l) => l.item === A_RETIRADA).vivo, "sim");
    assert.equal(s[A].find((l) => l.item === A_ENTREGA).vivo, "sim");
    assert.equal(
      s[A].find((l) => l.item === A_ACL).vivo,
      "PUBLIC=sim anon=sim authenticated=sim service_role=sim",
    );
  },
);

prova(
  "ANTES (o rollback-manual): 34b POSITIVA; 34a reprova SO o corpo e o marcador da retirada",
  async () => {
    const s = await noEstado(antes, [A, B]);
    assert.deepEqual(reprovadas(s[B]), [], "34b toda ok no antes");
    assert.deepEqual(reprovadas(s[A]), [A_MD5, A_RETIRADA].sort());
    assert.equal(s[B].find((l) => l.item === B_MD5).vivo, H.vigente);
    assert.equal(s[B].find((l) => l.item === B_RETIRADA).vivo, "nao");
    assert.equal(
      s[A].find((l) => l.item === A_ENTREGA).vivo,
      "sim",
      "o corpo antigo ja tinha a entrega",
    );
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
  assert.deepEqual(reprovadas(dobro[B]), [B_MD5, B_RETIRADA].sort());
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
const doProc = (condicao) =>
  `SELECT (${condicao}) AS aplicou FROM pg_proc WHERE oid = to_regprocedure('${FN}')`;
const trocaCorpo = (de, para) =>
  `DO $mut$ DECLARE v text; BEGIN
     SELECT prosrc INTO v FROM pg_proc WHERE oid = to_regprocedure('${FN}');
     IF position(${quote(de)} IN v) = 0 THEN RAISE EXCEPTION 'mutacao nao aplica'; END IF;
     EXECUTE format('CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L', replace(v, ${quote(de)}, ${quote(para)}));
   END $mut$`;
function quote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Roda a consulta no estado mutado e confere as linhas reprovadas. */
async function negativo(consulta, { estado, mutar, guardaSql }, esperadas) {
  const s = await noEstado(
    async (c) => {
      await estado(c);
      await c.query(mutar);
      if (guardaSql) {
        const r = await c.query(guardaSql);
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
  "CONTROLE: sem mutacao a 34a passa no depois e a 34b no antes",
  async () => {
    await negativo(A, { estado: depois, mutar: "SELECT 1" }, []);
    await negativo(B, { estado: antes, mutar: "SELECT 1" }, []);
  },
);

prova("NEGATIVO 34a: cada defeito reprova SO as linhas certas", async () => {
  const casos = [
    // 1 byte a mais no corpo: so o md5 (os marcadores seguem 'sim')
    [
      trocaCorpo("RETURN NEW;\nEND;", "RETURN NEW;\n-- a mais\nEND;"),
      doProc("prosrc LIKE '%-- a mais%'"),
      [A_MD5],
    ],
    // corpo sem o texto da entrega: md5 e marcador da entrega
    [
      trocaCorpo("Pedido a caminho", "Pedido a caminhx"),
      doProc("prosrc NOT LIKE '%Pedido a caminho%'"),
      [A_MD5, A_ENTREGA],
    ],
    // corpo sem o texto da retirada: md5 e marcador da retirada
    [
      trocaCorpo("Pedido pronto para retirar", "Pedido pronto para retirax"),
      doProc("prosrc NOT LIKE '%Pedido pronto para retirar%'"),
      [A_MD5, A_RETIRADA],
    ],
    [
      trocaCorpo("'Pedido retirado'", "'Pedido retirax'"),
      doProc("prosrc NOT LIKE '%Pedido retirado%'"),
      [A_MD5, A_RETIRADA],
    ],
    [
      trocaCorpo("'store-pickup'", "'store-pickux'"),
      doProc("prosrc NOT LIKE '%store-pickup%'"),
      [A_MD5, A_RETIRADA],
    ],
    // atributos
    [`ALTER FUNCTION ${FN} STABLE`, doProc("provolatile = 's'"), [A_ATRIB]],
    [
      `ALTER FUNCTION ${FN} SECURITY INVOKER`,
      doProc("NOT prosecdef"),
      [A_ATRIB],
    ],
    [
      `ALTER FUNCTION ${FN} SET search_path = public, pg_temp`,
      doProc("proconfig = ARRAY['search_path=public, pg_temp']::text[]"),
      [A_ATRIB],
    ],
    // a trigger fora do lugar
    [
      `DROP TRIGGER ${TRG} ON public.marketplace_orders`,
      "SELECT true AS aplicou",
      [A_TRG],
    ],
    [
      `DROP TRIGGER ${TRG} ON public.marketplace_orders; CREATE TRIGGER ${TRG} AFTER UPDATE ON public.marketplace_orders FOR EACH ROW EXECUTE FUNCTION ${FN}`,
      "SELECT true AS aplicou",
      [A_TRG],
    ],
    // PUBLIC sem EXECUTE
    [
      `REVOKE EXECUTE ON FUNCTION ${FN} FROM PUBLIC`,
      doProc(
        "NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) g WHERE g.grantee = 0)",
      ),
      [A_ACL],
    ],
  ];
  for (const [mutar, guardaSql, esperadas] of casos)
    await negativo(A, { estado: depois, mutar, guardaSql }, esperadas);
  // funcao ausente: tudo vira AUSENTE (menos o controle)
  const ausente = await noEstado(
    async (c) => {
      await depois(c);
      await c.query(`DROP TRIGGER ${TRG} ON public.marketplace_orders`);
      await c.query(`DROP FUNCTION ${FN}`);
    },
    [A, B],
  );
  confereRol(A, ausente[A]);
  confereRol(B, ausente[B]);
  assert.deepEqual(
    reprovadas(ausente[A]),
    ROL[A].filter((i) => i !== ROL[A][0]).sort(),
  );
  assert.deepEqual(
    reprovadas(ausente[B]),
    ROL[B].filter((i) => i !== ROL[B][0]).sort(),
  );
  for (const l of ausente[A].filter((x) => x.item !== ROL[A][0]))
    assert.equal(l.vivo, "AUSENTE");
});

prova(
  "NEGATIVO 34b: corpo de antes com 1 byte a mais, corpo novo, atributos, trigger e PUBLIC reprovam SO as linhas certas",
  async () => {
    const casos = [
      [
        trocaCorpo("RETURN NEW;\nEND;", "RETURN NEW;\n-- a mais\nEND;"),
        doProc("prosrc LIKE '%-- a mais%'"),
        [B_MD5],
      ],
      [`ALTER FUNCTION ${FN} STABLE`, doProc("provolatile = 's'"), [B_ATRIB]],
      [
        `ALTER FUNCTION ${FN} SECURITY INVOKER`,
        doProc("NOT prosecdef"),
        [B_ATRIB],
      ],
      [
        `ALTER FUNCTION ${FN} SET search_path = public, pg_temp`,
        doProc("proconfig = ARRAY['search_path=public, pg_temp']::text[]"),
        [B_ATRIB],
      ],
      [
        `DROP TRIGGER ${TRG} ON public.marketplace_orders`,
        "SELECT true AS aplicou",
        [B_TRG],
      ],
      [
        `REVOKE EXECUTE ON FUNCTION ${FN} FROM PUBLIC`,
        doProc(
          "NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) g WHERE g.grantee = 0)",
        ),
        [B_ACL],
      ],
    ];
    for (const [mutar, guardaSql, esperadas] of casos)
      await negativo(B, { estado: antes, mutar, guardaSql }, esperadas);
    // o corpo antigo com um dos textos da retirada acrescentado reprova o marcador (e o md5)
    await negativo(
      B,
      {
        estado: antes,
        mutar: trocaCorpo(
          "'Pedido cancelado'",
          "'Pedido cancelado' || ' store-pickup'",
        ),
        guardaSql: doProc("prosrc LIKE '%store-pickup%'"),
      },
      [B_MD5, B_RETIRADA],
    );
  },
);

prova(
  "MEDICAO 34m: so contagens, sem coluna ok, e os numeros batem com os pedidos montados",
  async () => {
    await C.query("BEGIN");
    try {
      const u = "e2e20000-0000-4000-8000-000000000001";
      // a base pode ja ter pedidos de outras provas: a medicao e' conferida por DIFERENCA
      const medir = async () => {
        const r = await C.query(SQL[M]);
        assert.deepEqual(
          r.fields.map((x) => x.name),
          ["tipo", "objeto", "detalhe"],
          "rol aberto: sem coluna ok",
        );
        assert.equal(r.rows.length, 9);
        return r;
      };
      const total = (r, objeto) => {
        const d = r.rows.find((l) => l.objeto === objeto);
        assert.ok(d, `a medicao nao tem a linha ${objeto}`);
        const m = /^total=(\d+)$/.exec(d.detalhe);
        assert.ok(m, `detalhe sem total: ${d.detalhe}`);
        return Number(m[1]);
      };
      const antesDe = await medir();
      await C.query(
        "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'm34@portao.teste', '{}'::jsonb)",
        [u],
      );
      const pedido = async (usuario, dados, status) =>
        (
          await C.query(
            `INSERT INTO public.marketplace_orders (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method)
           VALUES ($1, 'M34', $2::jsonb, 10, 10, $3, 'online', 'online') RETURNING id`,
            [usuario, JSON.stringify(dados), status],
          )
        ).rows[0].id;
      const a = await pedido(
        u,
        { shipping_option_id: "store-pickup", pickup_address: "Rua L" },
        "shipping",
      );
      await pedido(
        u,
        { shipping_option_id: "store-pickup", pickup_address: "Rua L" },
        "delivered",
      );
      await pedido(
        null,
        { shipping_option_id: "store-pickup", pickup_address: "Rua L" },
        "pending",
      );
      await pedido(u, { shipping_option_id: "store-pickup" }, "pending"); // id sem endereco
      await pedido(u, { pickup_address: "Rua L" }, "pending"); // endereco sem id
      await pedido(u, { shipping_option_id: "local-delivery" }, "shipping");
      await C.query(
        `INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados) VALUES
         ($1, 'info', 'Pedido a caminho', 'x', jsonb_build_object('order_id', $2::text)),
         ($1, 'success', 'Pedido entregue', 'x', jsonb_build_object('order_id', $2::text)),
         ($1, 'info', 'Pedido pronto para retirar', 'x', jsonb_build_object('order_id', $2::text))`,
        [u, a],
      );
      const r = await medir();
      const por = Object.fromEntries(r.rows.map((l) => [l.objeto, l.detalhe]));
      assert.match(
        por["quem leu"],
        /^superusuario=true\|bypassrls=true\|rls_vale_em_marketplace_orders=false$/,
      );
      for (const [objeto, delta, porque] of [
        ["pedidos", 6, "seis pedidos montados"],
        [
          "pedidos de retirada (id store-pickup)",
          4,
          "quatro com o id da retirada",
        ],
        [
          "pedidos de retirada com conta (recebem sino)",
          3,
          "o convidado nao recebe sino",
        ],
        [
          "pedidos de retirada hoje em shipping (pronto para retirar)",
          1,
          "um em shipping",
        ],
        [
          "pedidos de retirada hoje em delivered (retirado)",
          1,
          "um em delivered",
        ],
        [
          "id store-pickup SEM o endereco da loja (esperado 0)",
          1,
          "um com o id e sem o endereco",
        ],
        [
          "endereco da loja SEM o id store-pickup (esperado 0)",
          1,
          "um com o endereco e sem o id",
        ],
        [
          "avisos do sino de pedido de retirada com o texto da entrega (ficam como estao)",
          2,
          "so 'a caminho' e 'entregue' contam; o 'pronto para retirar' novo nao",
        ],
      ])
        assert.equal(
          total(r, objeto) - total(antesDe, objeto),
          delta,
          `${objeto}: ${porque}`,
        );
      for (const l of r.rows)
        assert.doesNotMatch(
          l.detalhe,
          /@|Rua L|[0-9a-f]{8}-[0-9a-f]{4}-/,
          "so agregado, nenhum dado pessoal",
        );
    } finally {
      await C.query("ROLLBACK");
    }
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
  "PORTAO: o veredito do conferir-banco.cjs sobre as linhas reais (rol=ok; ok_false 0 e 2)",
  async () => {
    const ref = "abcdefghijklmnopqrst";
    const sha = "0".repeat(40);
    const veredito = (consulta, linhas) =>
      CONF.veredictoDaConsulta({ consulta, ref, sha, linhas });
    const d = await noEstado(depois, [A, B]);
    assert.match(
      veredito(A, d[A]),
      / linhas=7 ok_false=0 ok_nao_booleano=0 rol=ok$/,
    );
    assert.match(
      veredito(B, d[B]),
      / linhas=6 ok_false=2 ok_nao_booleano=0 rol=ok$/,
    );
    const a = await noEstado(antes, [A, B]);
    assert.match(
      veredito(A, a[A]),
      / linhas=7 ok_false=2 ok_nao_booleano=0 rol=ok$/,
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
      `${falhas.length} de ${PROVAS.length} provas do portao 34 falharam.`,
    );
  }
  console.log(
    `\n[o-sino-do-pedido-de-retirada-portao] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
