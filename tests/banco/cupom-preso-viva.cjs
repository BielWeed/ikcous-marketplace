"use strict";

/**
 * PROVA VIVA do "cupom preso" (issues #210 e #116; pedido do dono de
 * 09/10/2026) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 * O defeito: o pedido que o cliente cancela (ou que expira) continua segurando
 * a vaga do cupom até a varredura devolver_cupons_de_pedidos_mortos() (que
 * roda a cada 15 min) achar o pedido, e a tela só dizia "Cupom atingiu o
 * limite de uso." sem explicar que a vaga era dele nem quando voltava.
 *
 * MIGRATION 20261205000000 (esta prova, até o bloco "M1"): duas funções NOVAS,
 * nenhuma existente é redefinida.
 *   - cupom__vaga_volta_em(...): auxiliar com PARÂMETROS SIMPLES (nunca a linha
 *     da tabela: o PostgREST a exporia como coluna calculada) que diz QUANDO a
 *     varredura devolve a vaga de um pedido; espelha exatamente a varredura
 *     20260970.
 *   - vaga_do_cupom_presa(p_code): só LEITURA; diz ao cliente se a vaga está
 *     presa num pedido cancelado DELE e em quantos minutos volta.
 *
 * O que se prova aqui:
 *   (0) fixtures.
 *   (1) catálogo e ACL: a RPC só para authenticated (anon, service_role e PUBLIC
 *       não), SECURITY DEFINER com search_path fixo; o auxiliar não é de
 *       ninguém.
 *   (2) TABELA DE CASOS, pedidos criados pelos caminhos REAIS (v23, v24,
 *       cancelamento do cliente, da borda e do admin, confirmar_pagamento,
 *       expirar_pedidos_vencidos, envio, retorno): o auxiliar diz "volta antes
 *       de agora" SE E SOMENTE SE a varredura devolve o pedido; a RPC diz
 *       "presa" SE E SOMENTE SE a varredura VAI devolver um dia; e os minutos
 *       batem. A vaga volta de verdade: a validação do cupom recusa antes e
 *       aceita depois.
 *   (3) só o DONO: outro usuário, outro código, cupom inativo, sem sessão e convidado
 *       recebem a MESMA resposta byte a byte (a RPC não vira sonda de código); anon, sem EXECUTE.
 *   (4) vários pedidos: vale o que volta primeiro.
 *   (5) MIGRATION: reaplicar é idempotente; pré-voo recusa SEM gravar, com o
 *       NOME do que falta ou diverge (inclusive 1 byte a mais no corpo da
 *       varredura); pós-voo; rollback derruba só as duas funções, recusa corpo
 *       de outra migration e varredura diferente da 20260970.
 *   (6) MUTANTES: cada guarda tirada deixa a prova certa VERMELHA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cupom-preso-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome fixo
 * (constantes abaixo), nunca entrada de rede nem de terceiro. */

const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME_M1 = "20261205000000_o_cupom_preso_diz_quando_a_vaga_volta.sql";

// Leitura SOB DEMANDA: com a migration ainda ausente a prova falha por
// asserção de comportamento (função inexistente), não por ENOENT no carregar.
const ler = (nome) => fs.readFileSync(path.join(PASTA, nome), "utf8");
const lerM1 = () => ler(NOME_M1);
const lerRollbackM1 = () => ler(`rollback-manual-${NOME_M1}`);

const FN_AUX =
  "public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamp with time zone, boolean, timestamp with time zone, text, integer)";
const FN_RPC = "public.vaga_do_cupom_presa(text)";
const FN_VARREDURA = "public.devolver_cupons_de_pedidos_mortos()";

const U_COMPRADOR = "c5000000-0000-4000-8000-000000000001";
const U_OUTRO = "c5000000-0000-4000-8000-000000000002";
const U_ADMIN = "c5000000-0000-4000-8000-000000000003";
const P_PRODUTO = "c5aaaaaa-0000-4000-8000-000000000001";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM_POR_NOME = {
  anon: { papel: "anon", uid: "", jwt: "" },
  comprador: {
    papel: "authenticated",
    uid: U_COMPRADOR,
    jwt: claims(U_COMPRADOR, null),
  },
  outro: { papel: "authenticated", uid: U_OUTRO, jwt: claims(U_OUTRO, null) },
  admin: {
    papel: "authenticated",
    uid: U_ADMIN,
    jwt: claims(U_ADMIN, "admin"),
  },
  // Papel authenticated, mas SEM uid na sessão (auth.uid() NULL).
  semSessao: { papel: "authenticated", uid: "", jwt: "" },
  service: { papel: "service_role", uid: "", jwt: "" },
};
// Map em vez de indexação dinâmica (security/detect-object-injection).
const QUEM = new Map(Object.entries(QUEM_POR_NOME));

// ---------------------------------------------------------------- utilitários

/** Roda `sql` COMO `quem` dentro da transação aberta; um erro não aborta a transação. */
async function como(c, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await c.query("SAVEPOINT sp_como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_como");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Uma transação que SEMPRE desfaz (ou commita, se pedido). */
async function emTx(c, corpo, { commit = false } = {}) {
  await c.query("BEGIN");
  try {
    const r = await corpo();
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

async function tentarSql(c, sql) {
  await c.query("SAVEPOINT sp_sql");
  try {
    await c.query(sql);
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_sql");
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: false, message: e.message };
  }
}

/** Obriga o resultado de `como` a ter dado certo (asserção, nunca exceção solta). */
function exigirOk(r, rotulo) {
  assert.ok(r.ok, `${rotulo}: ${r.message}`);
  return r.rows;
}

const vagaPresa = async (c, quem, codigo) =>
  exigirOk(
    await como(c, quem, "SELECT public.vaga_do_cupom_presa($1) AS r", [codigo]),
    `vaga_do_cupom_presa(${quem}, ${codigo})`,
  )[0].r;

const varrer = async (c) =>
  Number((await c.query(`SELECT ${FN_VARREDURA} AS n`)).rows[0].n);

/** O que o auxiliar diz de UM pedido, chamado com as colunas dele. */
async function veredictoDoAuxiliar(c, id) {
  return (
    await c.query(
      `SELECT v < now() AS volta_antes_de_agora, v = 'infinity'::timestamptz AS nunca
         FROM (SELECT public.cupom__vaga_volta_em(
                 o.coupon_id, o.status, o.payment_status, o.coupon_usage_returned,
                 o.expires_at, o.cancelled_after_shipping, o.returned_to_seller_at,
                 o.gateway_payment_id, o.tentativas_de_pagamento) AS v
                 FROM public.marketplace_orders o WHERE o.id = $1) t`,
      [id],
    )
  ).rows[0];
}

const pedido = async (c, id) =>
  (await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [id]))
    .rows[0];

const usos = async (c, cupomId) =>
  Number(
    (
      await c.query("SELECT usage_count FROM public.coupons WHERE id = $1", [
        cupomId,
      ])
    ).rows[0].usage_count,
  );

const validar = async (c, codigo) =>
  (
    await c.query(
      "SELECT public.validate_coupon_secure_v2($1, 100::numeric) AS r",
      [codigo],
    )
  ).rows[0].r;

// ----------------------------------------------------- cenários (caminhos REAIS)

/** Cupom novo de R$ 10, limite de uso 1 (por padrão), vaga livre. */
async function novoCupom(c, limite = 1) {
  const codigo = `PRESO${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const id = (
    await c.query(
      `INSERT INTO public.coupons (code, type, value, active, usage_count, usage_limit)
       VALUES ($1, 'fixed', 10, true, 0, $2) RETURNING id`,
      [codigo, limite],
    )
  ).rows[0].id;
  return { id, codigo };
}

/** Pedido criado pelo caminho de produção (v23 = "na entrega", v24 = PIX). */
async function criarPedido(c, rpc, quem, cupomCodigo) {
  const metodo = rpc === "create_marketplace_order_v24" ? "pix" : "cash";
  const r = await como(
    c,
    quem,
    `SELECT public.${rpc}($1::jsonb, $2::numeric, 0::numeric, $3::text, NULL::uuid, $4::text,
       'Comprador', '5539000000000', NULL::text, $5::jsonb, '38500-000', 'local-delivery', $6::uuid) AS id`,
    [
      JSON.stringify([
        { product_id: P_PRODUTO, variant_id: null, quantity: 1 },
      ]),
      cupomCodigo ? 90 : 100,
      metodo,
      cupomCodigo,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      crypto.randomUUID(),
    ],
  );
  return exigirOk(r, `${rpc} como ${quem}`)[0].id;
}

const cancelarComo = async (c, quem, id) =>
  exigirOk(
    await como(
      c,
      quem,
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled') AS r",
      [id],
    ),
    `cancelar como ${quem}`,
  );

/** O que cada tipo de pedido tem de ser DEPOIS de montado (a pré-condição do caso). */
const ESTADO_ESPERADO = new Map([
  ["v23-cancelado", ["cancelled", null, 0, false, false, false, true, false]],
  [
    "v24-cancelado",
    ["cancelled", "aguardando", 0, false, false, false, true, true],
  ],
  [
    "v24-recusa-antes",
    ["cancelled", "aguardando", 1, false, false, false, true, true],
  ],
  [
    "v24-com-qr",
    ["cancelled", "aguardando", 0, true, false, false, true, true],
  ],
  [
    "v24-pago-apos-expirar",
    ["cancelled", "pago_apos_expirar", 0, true, false, false, true, true],
  ],
  [
    "v24-pago-cancelado",
    ["cancelled", "pago", 0, true, false, false, true, true],
  ],
  [
    "v24-expirado",
    ["cancelled", "expirado", 0, false, false, false, true, true],
  ],
  [
    "v24-pendente",
    ["pending", "aguardando", 0, false, false, false, true, true],
  ],
  [
    "v23-enviado-cancelado",
    ["cancelled", null, 0, false, true, false, true, false],
  ],
  [
    "v23-enviado-retornado",
    ["cancelled", null, 0, false, true, true, true, false],
  ],
  ["v23-sem-cupom", ["cancelled", null, 0, false, false, false, false, false]],
]);

function projetar(p) {
  return [
    p.status,
    p.payment_status,
    p.tentativas_de_pagamento,
    p.gateway_payment_id !== null,
    p.cancelled_after_shipping,
    p.returned_to_seller_at !== null,
    p.coupon_id !== null,
    p.expires_at !== null,
  ];
}

/**
 * Monta UM pedido do tipo `kind` pelos caminhos reais e põe o relógio por
 * UPDATE de expires_at (`offsetSec` = quantos segundos ATRÁS o PIX venceu;
 * null deixa como está — o pedido "na entrega" nasce sem expires_at).
 */
async function montar(c, { kind, offsetSec = null, cupom = null }) {
  const cup = cupom || (await novoCupom(c));
  const v23 = kind.startsWith("v23");
  const rpc = v23
    ? "create_marketplace_order_v23"
    : "create_marketplace_order_v24";
  const codigo = kind === "v23-sem-cupom" ? null : cup.codigo;
  const id = await criarPedido(c, rpc, "comprador", codigo);

  switch (kind) {
    case "v23-cancelado":
    case "v24-cancelado":
    case "v23-sem-cupom":
      await cancelarComo(c, "comprador", id);
      break;
    case "v24-recusa-antes": {
      // Cartão recusado antes de existir cobrança: só conta a tentativa.
      const lib = await c.query(
        "SELECT public.liberar_cobranca_do_pedido($1::uuid, NULL) AS ok",
        [id],
      );
      assert.equal(
        lib.rows[0].ok,
        true,
        "liberar_cobranca_do_pedido não contou",
      );
      await cancelarComo(c, "comprador", id);
      break;
    }
    case "v24-com-qr":
      // criar-pagamento grava o id da cobrança; o cancelamento com cobrança
      // aberta só passa pela edge (p_pela_edge), que anula no MP antes.
      await c.query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-QR-1' WHERE id = $1",
        [id],
      );
      await c.query(
        "SELECT public.pedido__mudar_status($1::uuid, 'cancelled', NULL, $2::uuid, false, true)",
        [id, U_COMPRADOR],
      );
      break;
    case "v24-pago-apos-expirar": {
      await cancelarComo(c, "comprador", id);
      await c.query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-TARDIO-1' WHERE id = $1",
        [id],
      );
      const conf = await c.query(
        "SELECT public.confirmar_pagamento($1::uuid, 'MP-TARDIO-1', 'pago') AS r",
        [id],
      );
      assert.equal(conf.rows[0].r, "pago_apos_expirar");
      break;
    }
    case "v24-pago-cancelado": {
      await c.query(
        "UPDATE public.marketplace_orders SET gateway_payment_id = 'MP-PAGO-1' WHERE id = $1",
        [id],
      );
      const conf = await c.query(
        "SELECT public.confirmar_pagamento($1::uuid, 'MP-PAGO-1', 'pago') AS r",
        [id],
      );
      assert.equal(conf.rows[0].r, "pago");
      await cancelarComo(c, "admin", id);
      break;
    }
    case "v24-expirado": {
      await c.query(
        "UPDATE public.marketplace_orders SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [id],
      );
      const n = await c.query("SELECT public.expirar_pedidos_vencidos() AS n");
      assert.equal(Number(n.rows[0].n), 1, "expirar_pedidos_vencidos");
      break;
    }
    case "v24-pendente":
      break;
    case "v23-enviado-cancelado":
    case "v23-enviado-retornado":
      exigirOk(
        await como(
          c,
          "admin",
          "SELECT public.update_order_status_atomic($1::uuid, 'shipping') AS r",
          [id],
        ),
        "admin envia o pedido",
      );
      await cancelarComo(c, "comprador", id);
      if (kind === "v23-enviado-retornado") {
        exigirOk(
          await como(
            c,
            "admin",
            "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
            [id],
          ),
          "admin confirma o retorno do produto",
        );
      }
      break;
    default:
      throw new Error(`tipo de pedido desconhecido: ${kind}`);
  }

  if (offsetSec !== null) {
    await c.query(
      "UPDATE public.marketplace_orders SET expires_at = now() - make_interval(secs => $2) WHERE id = $1",
      [id, offsetSec],
    );
  }
  const p = await pedido(c, id);
  const esperado = ESTADO_ESPERADO.get(kind);
  // a pré-condição do caso: o pedido É o que o tipo diz (senão o caso mente)
  assert.deepEqual(
    projetar(p).slice(0, 7),
    esperado.slice(0, 7),
    `pré-condição do tipo ${kind}`,
  );
  assert.equal(p.coupon_usage_returned, false);
  if (offsetSec === null) {
    assert.equal(
      p.expires_at !== null,
      esperado[7],
      `${kind}: expires_at nasce ${esperado[7] ? "preenchido" : "vazio"}`,
    );
  }
  return { id, cupom: cup, codigo };
}

// ------------------------------------------------------------ a tabela de casos

const MIN = 60;
/**
 * `devolve`: a varredura devolve AGORA. `presa`: a varredura VAI devolver um dia
 * (a RPC diz "presa"). `minutos`: o que a RPC promete (espera até a hora + 15
 * min do ciclo do agendamento), com os números POR EXTENSO.
 * Valem para o corpo da 20260970 (espera de 24 h depois de expires_at).
 */
const CASOS_M1 = [
  {
    nome: "na entrega (v23, sem expires_at) cancelado: volta no próximo ciclo",
    kind: "v23-cancelado",
    offsetSec: null,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "PIX cancelado, venceu há 24 h 01 min: volta",
    kind: "v24-cancelado",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "PIX cancelado, venceu há 23 h 59 min: falta 1 min",
    kind: "v24-cancelado",
    offsetSec: 1439 * MIN,
    devolve: false,
    presa: true,
    minutos: 16,
  },
  {
    nome: "PIX cancelado, venceu há 23 h: faltam 60 min",
    kind: "v24-cancelado",
    offsetSec: 1380 * MIN,
    devolve: false,
    presa: true,
    minutos: 75,
  },
  {
    nome: "PIX cancelado, venceu há 50 min: faltam 1390 min",
    kind: "v24-cancelado",
    offsetSec: 50 * MIN,
    devolve: false,
    presa: true,
    minutos: 1405,
  },
  {
    nome: "faltam 90 s: arredonda PARA CIMA (2 min, não 1)",
    kind: "v24-cancelado",
    offsetSec: 1440 * MIN - 90,
    devolve: false,
    presa: true,
    minutos: 17,
  },
  {
    nome: "PIX expirado pela varredura, venceu há 10 min",
    kind: "v24-expirado",
    offsetSec: 10 * MIN,
    devolve: false,
    presa: true,
    minutos: 1445,
  },
  {
    nome: "cartão recusado antes da cobrança (1 tentativa), 24 h 01 min: volta",
    kind: "v24-recusa-antes",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "cartão recusado antes da cobrança, 23 h: espera",
    kind: "v24-recusa-antes",
    offsetSec: 1380 * MIN,
    devolve: false,
    presa: true,
    minutos: 75,
  },
  {
    nome: "com QR/cobrança gravada, 24 h 01 min: volta",
    kind: "v24-com-qr",
    offsetSec: 1441 * MIN,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "com QR/cobrança gravada, 50 min: espera",
    kind: "v24-com-qr",
    offsetSec: 50 * MIN,
    devolve: false,
    presa: true,
    minutos: 1405,
  },
  {
    nome: "pago depois de expirar: NUNCA",
    kind: "v24-pago-apos-expirar",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "pago e depois cancelado pelo lojista: NUNCA",
    kind: "v24-pago-cancelado",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "pedido ainda pendente (não cancelado): não é vaga presa",
    kind: "v24-pendente",
    offsetSec: 1441 * MIN,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "cancelado DEPOIS do envio, produto não voltou: NUNCA (ainda)",
    kind: "v23-enviado-cancelado",
    offsetSec: null,
    devolve: false,
    presa: false,
    minutos: null,
  },
  {
    nome: "cancelado depois do envio e o lojista registrou o retorno: volta",
    kind: "v23-enviado-retornado",
    offsetSec: null,
    devolve: true,
    presa: true,
    minutos: 15,
  },
  {
    nome: "pedido sem cupom: nada a devolver",
    kind: "v23-sem-cupom",
    offsetSec: null,
    devolve: false,
    presa: false,
    minutos: null,
  },
];

/**
 * Cada caso, num estado novo (a transação desfaz). A ORDEM importa: a RPC e o
 * auxiliar LEEM antes de a varredura escrever; depois a varredura decide, e o
 * auxiliar tem de concordar com ela.
 */
async function rodarTabela(c, casos) {
  for (const cs of casos) {
    await emTx(c, async () => {
      const { id, cupom, codigo } = await montar(c, cs);
      const ro = `${cs.nome} [${cs.kind}]`;
      const temCupom = cs.kind !== "v23-sem-cupom";

      // a vaga está segurada: a validação recusa com a frase de sempre
      if (temCupom) {
        const v0 = await validar(c, codigo);
        assert.equal(v0.is_valid, false, `${ro}: vaga devia estar segurada`);
        assert.equal(v0.error_message, "Cupom atingiu o limite de uso.", ro);
      }

      // (a) a RPC do dono
      const r = await vagaPresa(c, "comprador", codigo);
      assert.equal(r.presa, cs.presa, `${ro}: presa`);
      assert.equal(r.volta_em_minutos, cs.minutos, `${ro}: minutos`);

      // (b) o auxiliar concorda com a varredura SE E SOMENTE SE
      const aux = await veredictoDoAuxiliar(c, id);
      assert.equal(
        aux.volta_antes_de_agora,
        cs.devolve,
        `${ro}: auxiliar diz volta_antes_de_agora=${aux.volta_antes_de_agora}`,
      );
      assert.equal(
        aux.nunca,
        !cs.presa,
        `${ro}: auxiliar diz nunca=${aux.nunca}`,
      );

      // (c) a varredura de verdade
      await varrer(c);
      const depois = await pedido(c, id);
      assert.equal(
        depois.coupon_usage_returned,
        cs.devolve,
        `${ro}: a varredura ${cs.devolve ? "devia devolver" : "NAO devia devolver"}`,
      );
      if (temCupom) {
        assert.equal(
          await usos(c, cupom.id),
          cs.devolve ? 0 : 1,
          `${ro}: usage_count`,
        );
        const v1 = await validar(c, codigo);
        assert.equal(
          v1.is_valid,
          cs.devolve,
          `${ro}: a vaga voltou de verdade?`,
        );
      }

      if (cs.devolve) {
        // devolvido: some da RPC, o auxiliar passa a dizer NUNCA, e a segunda
        // varredura não devolve de novo
        const r2 = await vagaPresa(c, "comprador", codigo);
        assert.deepEqual(
          r2,
          { presa: false, volta_em_minutos: null },
          `${ro}: depois de devolver`,
        );
        const aux2 = await veredictoDoAuxiliar(c, id);
        assert.equal(
          aux2.volta_antes_de_agora,
          false,
          `${ro}: devolvido, auxiliar ainda diz volta`,
        );
        assert.equal(
          aux2.nunca,
          true,
          `${ro}: devolvido, auxiliar nao diz nunca`,
        );
        await varrer(c);
        assert.equal(
          await usos(c, cupom.id),
          0,
          `${ro}: a 2a varredura devolveu em dobro`,
        );
      }
    });
  }
}

// ---------------------------------------------------------------- as provas

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova("(0) fixtures", async (c) => {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of [U_COMPRADOR, U_OUTRO, U_ADMIN]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@cupompreso.teste', '{}'::jsonb)`,
      [id],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Comprador Preso', 'customer'), ($2, 'Outro Preso', 'customer'), ($3, 'Admin Preso', 'admin')`,
    [U_COMPRADOR, U_OUTRO, U_ADMIN],
  );
  await c.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage, enable_coupons)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national', true)
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage,
           enable_coupons = EXCLUDED.enable_coupons`,
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
     VALUES ($1, 'Produto cupom preso', 100, 100000, true, 40, false)`,
    [P_PRODUTO],
  );
});

prova("(1) catálogo e ACL das duas funções novas", async (c) => {
  const r = await c.query(
    `SELECT (p.oid = to_regprocedure(CASE p.proname WHEN 'cupom__vaga_volta_em' THEN 'public.cupom__vaga_volta_em(uuid, text, text, boolean, timestamptz, boolean, timestamptz, text, integer)' ELSE 'public.vaga_do_cupom_presa(text)' END)) AS exata, p.prosecdef, p.proconfig::text AS config,
            p.provolatile, p.prorettype::regtype::text AS ret,
            EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
            has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
            obj_description(p.oid, 'pg_proc') IS NOT NULL AS comentada
       FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('cupom__vaga_volta_em', 'vaga_do_cupom_presa')
      ORDER BY p.proname`,
  );
  assert.equal(
    r.rowCount,
    2,
    "as duas funções não existem (uma versão de cada)",
  );
  const [aux, rpc] = r.rows;

  assert.equal(aux.exata, true, "assinatura do auxiliar");
  assert.equal(aux.ret, "timestamp with time zone");
  assert.equal(aux.provolatile, "s", "o auxiliar é STABLE (usa now())");
  assert.equal(aux.config, "{search_path=public}");
  assert.equal(aux.prosecdef, false, "o auxiliar não é SECURITY DEFINER");
  assert.deepEqual(
    [aux.publico, aux.anon, aux.auth, aux.service],
    [false, false, false, false],
    "ninguém executa o auxiliar (só o dono e as funções SECURITY DEFINER dele)",
  );

  assert.equal(rpc.exata, true, "assinatura da RPC");
  assert.equal(rpc.ret, "jsonb");
  assert.equal(rpc.prosecdef, true);
  assert.equal(rpc.config, "{search_path=public}");
  assert.equal(rpc.publico, false, "PUBLIC com EXECUTE");
  assert.equal(rpc.anon, false, "anon com EXECUTE");
  assert.equal(rpc.auth, true, "authenticated sem EXECUTE");
  assert.equal(rpc.service, false, "service_role com EXECUTE");
  assert.equal(aux.comentada && rpc.comentada, true, "as duas têm COMMENT");

  // a varredura continua fechada para os papéis de aplicação
  const v = await c.query(
    `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`,
    [FN_VARREDURA],
  );
  assert.deepEqual(v.rows[0], { anon: false, auth: false });

  await emTx(c, async () => {
    for (const quem of ["anon", "service"]) {
      const a = await como(
        c,
        quem,
        "SELECT public.vaga_do_cupom_presa('X') AS r",
      );
      assert.equal(a.ok, false, `${quem} executou a RPC`);
      assert.equal(a.code, "42501", `${quem}: ${a.message}`);
    }
    for (const quem of ["anon", "comprador", "service", "admin"]) {
      const a = await como(
        c,
        quem,
        `SELECT ${FN_AUX.replace(/\(.*\)$/, "")}(NULL::uuid, NULL::text, NULL::text, NULL::boolean, NULL::timestamptz, NULL::boolean, NULL::timestamptz, NULL::text, NULL::integer) AS r`,
      );
      assert.equal(a.ok, false, `${quem} executou o auxiliar`);
      assert.equal(a.code, "42501", `${quem}: ${a.message}`);
    }
  });
});

async function tabelaM1(c) {
  await rodarTabela(c, CASOS_M1);
}
prova(
  "(2) tabela de casos: o auxiliar e a RPC concordam com a varredura 20260970, pedidos pelos caminhos reais",
  tabelaM1,
);

async function soODono(c) {
  const NADA = '{"presa":false,"volta_em_minutos":null}';
  // A RPC não pode virar sonda: cada "não" tem de ser BYTE A BYTE o mesmo.
  const bruto = async (quem, codigo) =>
    JSON.stringify(await vagaPresa(c, quem, codigo));
  await emTx(c, async () => {
    const { codigo, cupom, id } = await montar(c, {
      kind: "v24-cancelado",
      offsetSec: 1380 * MIN,
    });
    // o dono: presa, 60 + 15 min
    assert.equal(
      await bruto("comprador", codigo),
      '{"presa":true,"volta_em_minutos":75}',
    );
    // minúsculas casam (a validação compara em UPPER)
    assert.equal(
      await bruto("comprador", codigo.toLowerCase()),
      '{"presa":true,"volta_em_minutos":75}',
    );
    // OUTRO usuário e o ADMIN (que não é o dono do pedido): nada, nem que o pedido existe
    for (const quem of ["outro", "admin"]) {
      assert.equal(
        await bruto(quem, codigo),
        NADA,
        `${quem} viu o pedido do comprador`,
      );
    }
    // outro código, código inexistente, vazio, NULL: a MESMA resposta que o
    // código do pedido de outro usuário (quem de fora não distingue "o código
    // existe" de "não existe")
    const outroCupom = await novoCupom(c);
    for (const alvo of [codigo, outroCupom.codigo, "NAOEXISTE", "", null]) {
      assert.equal(await bruto("outro", alvo), NADA, `outro / ${alvo}`);
    }
    assert.equal(await bruto("comprador", outroCupom.codigo), NADA);
    assert.equal(await bruto("comprador", "NAOEXISTE"), NADA);
    assert.equal(await bruto("comprador", ""), NADA);
    assert.equal(await bruto("comprador", null), NADA);
    // SEM SESSÃO (authenticated com auth.uid() NULL): a mesma resposta, sem
    // erro de texto diferente, nem para o código do pedido que existe
    for (const alvo of [codigo, "NAOEXISTE", null]) {
      assert.equal(
        await bruto("semSessao", alvo),
        NADA,
        `sem sessão / ${alvo}`,
      );
    }
    // anon: sem EXECUTE, o MESMO erro (texto e código) para código que existe e
    // para o que não existe
    const negados = [];
    for (const alvo of [codigo, "NAOEXISTE"]) {
      const a = await como(
        c,
        "anon",
        "SELECT public.vaga_do_cupom_presa($1) AS r",
        [alvo],
      );
      assert.equal(a.ok, false);
      negados.push(`${a.code}|${a.message}`);
    }
    assert.equal(
      negados[0].replace(/.*\|/, ""),
      negados[1].replace(/.*\|/, ""),
    );
    assert.equal(negados[0].split("|")[0], "42501");
    // pedido de CONVIDADO (user_id NULL) fica de fora, para o dono e para quem
    // chama sem sessão (NULL = NULL nunca casa)
    await c.query(
      "UPDATE public.marketplace_orders SET user_id = NULL WHERE id = $1",
      [id],
    );
    assert.equal(await bruto("comprador", codigo), NADA, "pedido de convidado");
    assert.equal(
      await bruto("semSessao", codigo),
      NADA,
      "convidado vs sem sessão",
    );
    await c.query(
      "UPDATE public.marketplace_orders SET user_id = $2 WHERE id = $1",
      [id, U_COMPRADOR],
    );
    assert.equal(
      await bruto("comprador", codigo),
      '{"presa":true,"volta_em_minutos":75}',
    );
    // cupom desativado: não é o caso da frase de limite, e a resposta é a mesma
    await c.query("UPDATE public.coupons SET active = false WHERE id = $1", [
      cupom.id,
    ]);
    assert.equal(await bruto("comprador", codigo), NADA, "cupom inativo");
  });
}
prova(
  '(3) só o dono vê a vaga presa; todo "não" é a mesma resposta (a RPC não vira sonda de código)',
  soODono,
);

async function variosPedidos(c) {
  await emTx(c, async () => {
    // Mesmo cupom (limite 3), três pedidos do comprador: um volta em 40 min,
    // um em 1340, e um que NUNCA volta (pago depois de expirar). Vale o primeiro.
    const cupom = await novoCupom(c, 3);
    const devagar = await montar(c, {
      kind: "v24-cancelado",
      offsetSec: 100 * MIN,
      cupom,
    });
    const rapido = await montar(c, {
      kind: "v24-cancelado",
      offsetSec: 1400 * MIN,
      cupom,
    });
    await montar(c, {
      kind: "v24-pago-apos-expirar",
      offsetSec: 1441 * MIN,
      cupom,
    });
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      { presa: true, volta_em_minutos: 55 },
      "vale o pedido que volta primeiro (40 min + 15)",
    );
    // pedido de OUTRO usuário no mesmo cupom, mais rápido ainda: não conta
    // (montar cria como comprador; o usuário do pedido é trocado só para a leitura)
    await c.query(
      "UPDATE public.marketplace_orders SET user_id = $2 WHERE id = $1",
      [rapido.id, U_OUTRO],
    );
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      { presa: true, volta_em_minutos: 1355 },
      "o pedido do outro usuário não conta (1340 + 15)",
    );
    assert.deepEqual(await vagaPresa(c, "outro", cupom.codigo), {
      presa: true,
      volta_em_minutos: 55,
    });
    // a varredura devolve o do outro usuário e o dono do primeiro fica com o dele
    await c.query(
      "UPDATE public.marketplace_orders SET expires_at = now() - interval '25 hours' WHERE id = $1",
      [devagar.id],
    );
    await varrer(c);
    assert.deepEqual(
      await vagaPresa(c, "comprador", cupom.codigo),
      { presa: false, volta_em_minutos: null },
      "tudo devolvido ou nunca: nada preso",
    );
  });
}
prova(
  "(4) vários pedidos: vale o que volta primeiro, só os do dono",
  variosPedidos,
);

// ------------------------------------------------------------------ migration

async function impressao(c, fora) {
  return (
    await c.query(
      `SELECT count(*)::int AS n,
              md5(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid))
                  || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(obj_description(p.oid, 'pg_proc'), ''),
                  E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname <> ALL ($1::text[])`,
      [fora],
    )
  ).rows[0];
}
const SO_AS_DUAS = ["cupom__vaga_volta_em", "vaga_do_cupom_presa"];

async function defs(c) {
  const r = await c.query(
    `SELECT p.oid::regprocedure::text AS f, pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl,
            obj_description(p.oid, 'pg_proc') AS comentario, p.prosecdef, p.proconfig::text AS cfg,
            encode(sha256(convert_to(p.prosrc, 'UTF8')), 'hex') AS sha
       FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('cupom__vaga_volta_em', 'vaga_do_cupom_presa')
      ORDER BY p.proname`,
  );
  return r.rows;
}

const existeFuncao = async (c, assinatura) =>
  (await c.query("SELECT to_regprocedure($1) AS f", [assinatura])).rows[0].f !==
  null;

const derrubarAsDuas = async (c) => {
  await c.query(`DROP FUNCTION IF EXISTS ${FN_RPC}`);
  await c.query(`DROP FUNCTION IF EXISTS ${FN_AUX}`);
};

async function reaplicarIdempotente(c, sqlM1 = lerM1()) {
  const antes = await defs(c);
  assert.equal(antes.length, 2);
  await emTx(c, async () => {
    await c.query(sqlM1);
    await c.query(sqlM1);
    assert.deepEqual(await defs(c), antes);
  });
  assert.deepEqual(await defs(c), antes);
}
prova(
  "(5a) reaplicar a migration é idempotente (mesmo corpo, mesma ACL, mesmo comentário)",
  (c) => reaplicarIdempotente(c),
);

/** O corpo vivo da varredura com 1 byte a mais (um espaço no fim). */
async function varreduraComUmByteAMais(c) {
  const live = (
    await c.query(
      "SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN_VARREDURA],
    )
  ).rows[0].prosrc;
  assert.ok(!live.includes("$x$"));
  await c.query(
    `CREATE OR REPLACE FUNCTION ${FN_VARREDURA} RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $x$${live} $x$`,
  );
}

async function preVoo(c, sqlM1 = lerM1()) {
  const quebras = [
    [
      "varredura com 1 byte a mais",
      varreduraComUmByteAMais,
      /PREFLIGHT_20261205.*corpo vivo de devolver_cupons_de_pedidos_mortos/,
    ],
    [
      "duas versões da varredura",
      (cc) =>
        cc.query(
          "CREATE FUNCTION public.devolver_cupons_de_pedidos_mortos(p_x integer) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$",
        ),
      /PREFLIGHT_20261205.*exatamente uma/,
    ],
    [
      "devolver_uso_cupom ausente",
      (cc) =>
        cc.query(
          "ALTER FUNCTION public.devolver_uso_cupom(uuid) RENAME TO devolver_uso_cupom_x",
        ),
      /PREFLIGHT_20261205: falta a funcao public\.devolver_uso_cupom/,
    ],
    [
      "tabela coupons ausente",
      (cc) => cc.query("ALTER TABLE public.coupons RENAME TO coupons_x"),
      /PREFLIGHT_20261205: falta a tabela public\.coupons/,
    ],
    [
      "coluna tentativas_de_pagamento ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN tentativas_de_pagamento TO tdp",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.tentativas_de_pagamento/,
    ],
    [
      "coluna coupon_usage_returned ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN coupon_usage_returned TO cur",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.coupon_usage_returned/,
    ],
    [
      "coluna cancelled_after_shipping ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN cancelled_after_shipping TO cas",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.cancelled_after_shipping/,
    ],
    [
      "coluna returned_to_seller_at ausente",
      (cc) =>
        cc.query(
          "ALTER TABLE public.marketplace_orders RENAME COLUMN returned_to_seller_at TO rsa",
        ),
      /PREFLIGHT_20261205: falta a coluna public\.marketplace_orders\.returned_to_seller_at/,
    ],
    [
      "coluna coupons.code ausente",
      (cc) =>
        cc.query("ALTER TABLE public.coupons RENAME COLUMN code TO codigo_x"),
      /PREFLIGHT_20261205: falta a coluna public\.coupons\.code/,
    ],
  ];
  for (const [rotulo, quebra, esperado] of quebras) {
    await emTx(c, async () => {
      await derrubarAsDuas(c);
      await quebra(c);
      const antes = await impressao(c, SO_AS_DUAS);
      const r = await tentarSql(c, sqlM1);
      assert.equal(r.ok, false, `${rotulo}: a migration passou`);
      assert.match(r.message, esperado, rotulo);
      assert.equal(
        await existeFuncao(c, FN_AUX),
        false,
        `${rotulo}: criou o auxiliar apesar do pré-voo`,
      );
      assert.equal(
        await existeFuncao(c, FN_RPC),
        false,
        `${rotulo}: criou a RPC apesar do pré-voo`,
      );
      assert.deepEqual(
        await impressao(c, SO_AS_DUAS),
        antes,
        `${rotulo}: gravou algo`,
      );
    });
  }
  // Funções com o mesmo nome e OUTRO corpo: não sobrescreve (e não grava nada).
  const alheias = [
    [
      "auxiliar",
      `CREATE OR REPLACE FUNCTION ${FN_AUX.replace(/\(.*\)$/, "")}(p_coupon_id uuid, p_status text, p_payment_status text, p_coupon_usage_returned boolean, p_expires_at timestamptz, p_cancelled_after_shipping boolean, p_returned_to_seller_at timestamptz, p_gateway_payment_id text, p_tentativas integer) RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$ SELECT now() $$`,
      /PREFLIGHT_20261205.*cupom__vaga_volta_em ja existe com outro corpo/,
    ],
    [
      "RPC",
      "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(p_code text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{}'::jsonb $$",
      /PREFLIGHT_20261205.*vaga_do_cupom_presa ja existe com outro corpo/,
    ],
  ];
  for (const [rotulo, criar, esperado] of alheias) {
    await emTx(c, async () => {
      await derrubarAsDuas(c);
      await c.query(criar);
      const antes = await defs(c);
      const r = await tentarSql(c, sqlM1);
      assert.equal(r.ok, false, `${rotulo} alheio: a migration passou`);
      assert.match(r.message, esperado, rotulo);
      assert.deepEqual(
        await defs(c),
        antes,
        `${rotulo} alheio: foi sobrescrito`,
      );
    });
  }
}
prova(
  "(5b) pré-voo recusa SEM gravar, com o nome do que falta ou diverge",
  (c) => preVoo(c),
);

async function posVoo(c, sqlM1 = lerM1()) {
  // Se a função criada NÃO sai com o corpo previsto (aqui: 1 byte alterado no
  // auxiliar, o que o pré-voo não enxerga porque a função ainda não existe), a
  // migration inteira recusa e NADA fica.
  const marca = "ELSE p_expires_at + interval '24 hours'";
  cortarUma(sqlM1, marca, "pós-voo: corpo do auxiliar alterado");
  const alterada = sqlM1.replace(
    marca,
    () => `${marca} + interval '0 seconds'`,
  );
  await emTx(c, async () => {
    await derrubarAsDuas(c);
    const antes = await impressao(c, SO_AS_DUAS);
    const r = await tentarSql(c, alterada);
    assert.equal(r.ok, false, "a migration com o auxiliar alterado concluiu");
    assert.match(r.message, /POSVOO_20261205/);
    assert.equal(
      await existeFuncao(c, FN_AUX),
      false,
      "o auxiliar alterado ficou",
    );
    assert.equal(await existeFuncao(c, FN_RPC), false, "a RPC ficou");
    assert.deepEqual(await impressao(c, SO_AS_DUAS), antes);
  });
}
prova(
  "(5c) pós-voo: função que sai com outro corpo derruba a migration inteira",
  (c) => posVoo(c),
);

async function rollbackLimpo(c, sqlM1 = lerM1(), sqlRb = lerRollbackM1()) {
  await emTx(c, async () => {
    const id = (
      await montar(c, { kind: "v24-cancelado", offsetSec: 1380 * MIN })
    ).id;
    const pedidoAntes = await pedido(c, id);
    const def0 = await defs(c);
    const f0 = await impressao(c, SO_AS_DUAS);
    const varreduraAntes = (
      await c.query(
        "SELECT prosrc, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)",
        [FN_VARREDURA],
      )
    ).rows[0];

    await c.query(sqlRb);
    assert.equal(
      await existeFuncao(c, FN_AUX),
      false,
      "o auxiliar continua depois do rollback",
    );
    assert.equal(
      await existeFuncao(c, FN_RPC),
      false,
      "a RPC continua depois do rollback",
    );
    assert.deepEqual(
      await impressao(c, SO_AS_DUAS),
      f0,
      "o rollback mexeu em outra função",
    );
    assert.deepEqual(
      (
        await c.query(
          "SELECT prosrc, proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)",
          [FN_VARREDURA],
        )
      ).rows[0],
      varreduraAntes,
      "o rollback mexeu na varredura",
    );
    assert.deepEqual(
      await pedido(c, id),
      pedidoAntes,
      "o rollback mexeu num pedido",
    );
    assert.equal(
      await varrer(c),
      0,
      "a varredura segue como antes (23 h: ainda não)",
    );

    // idempotente
    await c.query(sqlRb);
    assert.equal(await existeFuncao(c, FN_RPC), false);

    // aplicar -> desfazer -> aplicar volta ao estado idêntico
    await c.query(sqlM1);
    assert.deepEqual(
      await defs(c),
      def0,
      "reaplicar não voltou ao estado idêntico",
    );
    assert.deepEqual(await impressao(c, SO_AS_DUAS), f0);
  });
}
prova(
  "(5d) rollback: derruba só as duas funções, sem tocar a varredura nem pedidos; idempotente; aplicar-desfazer-aplicar idêntico",
  (c) => rollbackLimpo(c),
);

async function rollbackRecusa(c, sqlRb = lerRollbackM1()) {
  const casos = [
    [
      "auxiliar de OUTRA migration",
      (cc) =>
        cc.query(
          `CREATE OR REPLACE FUNCTION ${FN_AUX.replace(/\(.*\)$/, "")}(p_coupon_id uuid, p_status text, p_payment_status text, p_coupon_usage_returned boolean, p_expires_at timestamptz, p_cancelled_after_shipping boolean, p_returned_to_seller_at timestamptz, p_gateway_payment_id text, p_tentativas integer) RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$ SELECT now() $$`,
        ),
      /corpo vivo de cupom__vaga_volta_em .* nao e o da 20261205000000/,
      FN_AUX,
    ],
    [
      "RPC de OUTRA migration",
      (cc) =>
        cc.query(
          "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(p_code text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{\"posterior\":true}'::jsonb $$",
        ),
      /corpo vivo de vaga_do_cupom_presa .* nao e o da 20261205000000/,
      FN_RPC,
    ],
    [
      "varredura diferente da 20260970 (uma migration posterior a usa)",
      varreduraComUmByteAMais,
      /varredura .* nao e a da 20260970000000/,
      FN_AUX,
    ],
  ];
  for (const [rotulo, preparar, esperado, deveFicar] of casos) {
    await emTx(c, async () => {
      await preparar(c);
      const antes = await defs(c);
      const r = await tentarSql(c, sqlRb);
      assert.equal(r.ok, false, `${rotulo}: o rollback passou`);
      assert.match(r.message, esperado, rotulo);
      assert.ok(
        await existeFuncao(c, deveFicar),
        `${rotulo}: derrubou mesmo assim`,
      );
      assert.deepEqual(
        await defs(c),
        antes,
        `${rotulo}: o rollback gravou algo`,
      );
    });
  }
}
prova(
  "(5e) rollback recusa corpo de OUTRA migration e varredura diferente da 20260970",
  (c) => rollbackRecusa(c),
);

// ------------------------------------------------------------------- mutantes

function bloco(sql, cabecalho) {
  const ini = sql.indexOf(cabecalho);
  assert.ok(ini >= 0, `bloco não achado: ${cabecalho}`);
  const abre = sql.indexOf("AS $function$", ini);
  const fim = sql.indexOf("$function$;", abre) + "$function$;".length;
  assert.ok(abre > ini && fim > abre);
  return sql.slice(ini, fim);
}

function cortarUma(texto, buscar, rotulo) {
  assert.equal(
    texto.split(buscar).length - 1,
    1,
    `mutante "${rotulo}": o trecho a trocar tem de aparecer UMA vez`,
  );
}

async function sobreviveu(c, rotulo, proveCom, restaurar) {
  let morreuCom = null;
  try {
    for (const p of proveCom) {
      try {
        await p();
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        await c.query("RESET ROLE").catch(() => {});
        if (e instanceof assert.AssertionError || e.code === "ERR_ASSERTION") {
          morreuCom = e.message.split("\n")[0].slice(0, 110);
          break;
        }
        throw e;
      }
    }
  } finally {
    await restaurar();
  }
  assert.notEqual(morreuCom, null, `MUTANTE SOBREVIVEU: ${rotulo}`);
  console.log(`      mutante morto: ${rotulo}  <-  ${morreuCom}`);
}

/** Troca um pedaço do bloco de uma função, recria no banco e exige que alguma prova falhe. */
async function mutarFuncao(c, rotulo, blocoOriginal, buscar, trocar, proveCom) {
  cortarUma(blocoOriginal, buscar, rotulo);
  const mutada = blocoOriginal.replace(buscar, () => trocar);
  assert.notEqual(mutada, blocoOriginal);
  await c.query(mutada);
  await sobreviveu(
    c,
    rotulo,
    proveCom.map((p) => () => p(c)),
    () => c.query(blocoOriginal),
  );
}

/** Troca um pedaço de um ARQUIVO (migration ou rollback) e exige que a prova, rodada com o texto mutado, falhe. */
async function mutarTexto(c, rotulo, texto, buscar, trocar, proveCom) {
  cortarUma(texto, buscar, rotulo);
  const mutado = texto.replace(buscar, () => trocar);
  assert.notEqual(mutado, texto);
  await sobreviveu(
    c,
    rotulo,
    proveCom.map((p) => () => p(c, mutado)),
    async () => {},
  );
}

prova(
  "(6) mutantes: tirar cada guarda deixa a prova certa vermelha",
  async (c) => {
    const sqlM1 = lerM1();
    const sqlRb = lerRollbackM1();
    const aux = bloco(
      sqlM1,
      "CREATE OR REPLACE FUNCTION public.cupom__vaga_volta_em(",
    );
    const rpc = bloco(
      sqlM1,
      "CREATE OR REPLACE FUNCTION public.vaga_do_cupom_presa(",
    );
    const antes = await defs(c);

    // ---- o auxiliar: cada WHEN é uma guarda
    const L = (condicao) =>
      `        WHEN ${condicao} THEN 'infinity'::timestamptz\n`;
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do cupom",
      aux,
      L("p_coupon_id IS NULL"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do status cancelado",
      aux,
      L("p_status IS DISTINCT FROM 'cancelled'"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda de pagamento (pago e pago_apos_expirar voltam)",
      aux,
      L("p_payment_status IN ('pago', 'pago_apos_expirar')"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar deixa pago_apos_expirar fora da guarda",
      aux,
      "('pago', 'pago_apos_expirar')",
      "('pago')",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do já devolvido (devolve em dobro)",
      aux,
      L("p_coupon_usage_returned IS DISTINCT FROM false"),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem a guarda do cancelado depois do envio",
      aux,
      L(
        "(p_cancelled_after_shipping = false OR p_returned_to_seller_at IS NOT NULL) IS NOT TRUE",
      ),
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar sem tratar expires_at vazio (pedido na entrega nunca volta)",
      aux,
      "        WHEN p_expires_at IS NULL THEN '-infinity'::timestamptz\n",
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar com espera de 23 h",
      aux,
      "ELSE p_expires_at + interval '24 hours'",
      "ELSE p_expires_at + interval '23 hours'",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "auxiliar com espera de 25 h",
      aux,
      "ELSE p_expires_at + interval '24 hours'",
      "ELSE p_expires_at + interval '25 hours'",
      [tabelaM1],
    );

    // ---- a RPC
    await mutarFuncao(
      c,
      "RPC sem filtrar o dono do pedido",
      rpc,
      "     WHERE o.user_id = (SELECT auth.uid())\n       AND o.coupon_id IN (",
      "     WHERE o.coupon_id IN (",
      [soODono, variosPedidos],
    );
    await mutarFuncao(
      c,
      "RPC sem filtrar o código do cupom",
      rpc,
      `o.coupon_id IN (
           SELECT c.id FROM public.coupons c
            WHERE UPPER(c.code) = UPPER(p_code) AND c.active = true)`,
      "o.coupon_id IS NOT NULL",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC sem exigir cupom ativo",
      rpc,
      " AND c.active = true)",
      ")",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC compara o código sem UPPER",
      rpc,
      "UPPER(c.code) = UPPER(p_code)",
      "c.code = p_code",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC deixa NULL casar com NULL (convidado e chamada sem sessão)",
      rpc,
      "o.user_id = (SELECT auth.uid())",
      "o.user_id IS NOT DISTINCT FROM (SELECT auth.uid())",
      [soODono],
    );
    await mutarFuncao(
      c,
      "RPC sem o GREATEST (pedido na entrega: -infinito)",
      rpc,
      "    v_volta := GREATEST(v_volta, now());\n",
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "RPC sem recusar o infinito (só pedidos que nunca voltam)",
      rpc,
      " OR v_volta = 'infinity'::timestamptz",
      "",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "RPC sem os 15 min do ciclo",
      rpc,
      "/ 60.0)::integer + 15;",
      "/ 60.0)::integer;",
      [tabelaM1],
    );
    await mutarFuncao(
      c,
      "RPC arredonda para baixo",
      rpc,
      "ceil(extract(epoch",
      "floor(extract(epoch",
      [tabelaM1],
    );

    // ---- o pré-voo e o pós-voo
    const quebra = (msg) => [`RAISE EXCEPTION '${msg}`, `RAISE NOTICE '${msg}`];
    for (const [rotulo, msg] of [
      [
        "pré-voo sem conferir o corpo da varredura",
        "PREFLIGHT_20261205: corpo vivo de devolver_cupons_de_pedidos_mortos",
      ],
      [
        "pré-voo sem exigir UMA versão da varredura",
        "PREFLIGHT_20261205: esperava exatamente uma",
      ],
      ["pré-voo sem as dependências", "PREFLIGHT_20261205: falta a funcao"],
      ["pré-voo sem as tabelas", "PREFLIGHT_20261205: falta a tabela"],
      ["pré-voo sem as colunas", "PREFLIGHT_20261205: falta a coluna"],
      [
        "pré-voo sobrescreve o auxiliar alheio",
        "PREFLIGHT_20261205: public.cupom__vaga_volta_em ja existe com outro corpo",
      ],
      [
        "pré-voo sobrescreve a RPC alheia",
        "PREFLIGHT_20261205: public.vaga_do_cupom_presa ja existe com outro corpo",
      ],
    ]) {
      const [a, b] = quebra(msg);
      await mutarTexto(c, rotulo, sqlM1, a, b, [preVoo]);
    }
    {
      const [a, b] = quebra("POSVOO_20261205");
      await mutarTexto(
        c,
        "pós-voo sem recusar função com outro corpo",
        sqlM1,
        a,
        b,
        [posVoo],
      );
    }

    // ---- o rollback
    for (const [rotulo, msg] of [
      [
        "rollback derruba o auxiliar de outra migration",
        "corpo vivo de cupom__vaga_volta_em",
      ],
      [
        "rollback derruba a RPC de outra migration",
        "corpo vivo de vaga_do_cupom_presa",
      ],
      [
        "rollback derruba por baixo de uma varredura que usa o auxiliar",
        "a varredura devolver_cupons_de_pedidos_mortos",
      ],
    ]) {
      const [a, b] = quebra(msg);
      await mutarTexto(c, rotulo, sqlRb, a, b, [rollbackRecusa]);
    }

    assert.deepEqual(await defs(c), antes, "as funções não foram restauradas");
  },
);

// -------------------------------------------------------------------- runner

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const resultados = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      const t0 = Date.now();
      try {
        await corpo(c);
        resultados.push({ nome, ok: true });
        console.log(`  ok   ${nome} (${Date.now() - t0} ms)`);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        await c.query("RESET ROLE").catch(() => {});
        resultados.push({ nome, ok: false, erro: e.stack || String(e) });
        console.log(`  FAIL ${nome}\n${e.stack || e}`);
      }
    }
  } finally {
    await c.end();
  }
  const falhas = resultados.filter((r) => !r.ok);
  const resumo = `${resultados.length - falhas.length}/${resultados.length} provas do cupom preso verdes.`;
  console.log(`\n[cupom-preso] ${resumo}`);
  anexarAoSummary(
    "Prova viva: cupom preso (20261205000000)",
    falhas.length
      ? `**${falhas.length} falha(s)**:\n\n${falhas.map((f) => `- ${f.nome}`).join("\n")}`
      : `**${resumo}**`,
  );
  if (falhas.length) process.exit(1);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
