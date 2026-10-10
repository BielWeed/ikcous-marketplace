"use strict";

/**
 * PROVA VIVA das duas RPCs que escrevem o PAGAMENTO do pedido, contra o
 * Postgres EFÊMERO com as migrations aplicadas do zero:
 *
 *   - public.confirmar_pagamento(uuid, text, text) — corpo vigente em
 *     20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql, ACL em
 *     20260810000000_confirmar_pagamento_guarda_status.sql. É o ÚNICO caminho
 *     que grava payment_status a partir do gateway (webhook e reconciliação).
 *   - public.registrar_pagamento_recebido(uuid, boolean) — o lojista registra
 *     que recebeu na mão (20261020000000_lojista_registra_pagamento_recebido).
 *
 * O estoque volta por public.devolver_estoque (corpo vigente em
 * 20261175000000, idempotente pelo fato `stock_returned_at`) e a expiração
 * por public.expirar_pedidos_vencidos (vigente em 20261186000000): as duas
 * rodam de VERDADE aqui, com produto e variante de fixture. Nenhuma asserção
 * olha texto de SQL — todas olham o que o banco GRAVOU (payment_status,
 * status, paid_at, estoque do produto e da variante, carimbo de devolução,
 * avisos ao cliente, histórico de recebimento).
 *
 *   (1)  PIX aguardando -> 'pago' (service_role): paid_at gravado, estoque
 *        intacto, 1 aviso; reenvio -> 'ja_pago' sem mexer em NADA.
 *   (2)  'divergente' (id nulo, pedido sem gateway, id diferente, vaga
 *        sentinela de cartão) e 'inexistente': nenhuma coluna muda.
 *   (3)  'recusado' devolve o estoque UMA vez (produto E variante); 2a
 *        entrega -> 'ignorado'.
 *   (4)  CONCORRÊNCIA, duas conexões reais: dois 'recusado' ao mesmo tempo —
 *        o segundo ESPERA o FOR UPDATE, ao liberar vê o pedido já recusado.
 *   (5)  expiração: PIX vencido expira e devolve uma vez; 'pago' depois ->
 *        'pago_apos_expirar' sem tocar no estoque; reenvios idempotentes.
 *        (5b) CONCORRÊNCIA: 'pago' esperando a varredura que segura a linha.
 *        (5c) CONCORRÊNCIA INVERSA: 'pago' segura a linha de um PIX vencido;
 *        a varredura (SKIP LOCKED) NÃO espera e devolve 0.
 *   (6)  cliente cancelou pelo app (update_order_status_atomic REAL): 'pago'
 *        -> 'pago_apos_expirar'; 'recusado' não credita de novo.
 *   (7)  'estornado': de aguardando devolve uma vez; de pago só marca.
 *   (8)  permissão: anon e authenticated (cliente E admin) são recusados;
 *        service_role executa.
 *   (9)  registrar_pagamento_recebido: gate de admin, recusas, idempotência,
 *        desfazer, histórico; pedido de ENTREGA e venda de BALCÃO (RPC real
 *        registrar_venda_presencial).
 *        (9e) o 'desfazer' também vale para pedido de entrega já 'delivered'.
 *        (9f) p_recebido NULL é recusado (22004) DEPOIS da autorização e sem
 *        gravar nada; (9g) a recusa NÃO espera o lock de quem grava (A3).
 *   (10) bordas de transição: 'pago'/'recusado'/'estornado' sobre pedido que
 *        o lojista já adiantou (processing/shipping/delivered/new); status
 *        de gateway desconhecido; 'pago' depois de 'recusado'; 'recusado'
 *        sobre payment_status NULL com cobrança gravada -> 'ignorado' (A1).
 *   (11) CONCORRÊNCIA: dois registrar_pagamento_recebido ao mesmo tempo
 *        gravam UMA linha de histórico.
 *   (12) preflight B1_BASELINE_DIVERGENT e rollback-manual da migration
 *        20261195000000 aplicados de verdade, dentro de BEGIN/ROLLBACK.
 *   (13) preflight do rollback-manual da 20261195000000: com a 20261197000000
 *        no ar, (e) o rollback RECUSA sem tocar em função, ACL nem config; os
 *        casos (a)-(d) rodam na 95 ISOLADA (97 desfeita só na transação) e a
 *        97 volta intacta no fim.
 *   (14) CONCORRÊNCIA da confirmação imediata (04/10/2026): dois
 *        'pago' ao mesmo tempo (a consulta do cliente na `criar-pagamento` e o
 *        webhook) — um recebe 'pago', o outro ESPERA o lock e recebe
 *        'ja_pago'; paid_at gravado uma vez, um aviso só ao cliente. É o
 *        fundamento de "efeito só para quem recebeu a transição".
 *
 * Linhas marcadas `ACHADO:` abaixo documentam comportamento ATUAL que merece
 * olhar do dono do produto — o teste afirma o que o banco FAZ hoje, para o
 * dia em que alguém mudar isso mudar de propósito.
 *
 * USO (como as outras provas vivas, num CLONE do banco migrado):
 *   node tests/banco/rodar-isolado.cjs tests/banco/pagamentos-rpc-viva.cjs
 */

const assert = require("node:assert");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");
const { SUCESSORAS_DA_99 } = require("./sucessoras-da-99.cjs");

const U_CLIENTE = "71111111-1111-1111-1111-111111111111";
const U_OUTRO = "71111111-1111-1111-1111-111111111112";
const U_ADMIN = "72222222-2222-2222-2222-222222222222";

const ESTOQUE_INICIAL = 10;
const VARIANTE_INICIAL = 7;
const PRECO = 25;

let sequencia = 0;
const uuid = (prefixo, n) =>
  `${prefixo}-0000-0000-0000-${String(n).padStart(12, "0")}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Sessão, papel e chamada
// ---------------------------------------------------------------------------

/** "Login" da prova: o auth.uid() emulado lê este GUC. '' = sem sessão. */
async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}

/**
 * Roda UMA consulta como o papel pedido (SET LOCAL ROLE dentro de BEGIN) e
 * devolve {ok, rows} ou {ok:false, erro}. Sempre fecha a transação: COMMIT
 * quando {commit:true} e deu certo, ROLLBACK no resto.
 */
async function comPapel(cliente, papel, sql, params, opcoes = {}) {
  await cliente.query("BEGIN");
  try {
    if (papel) await cliente.query(`SET LOCAL ROLE ${papel}`);
    const r = await cliente.query(sql, params);
    await cliente.query(opcoes.commit ? "COMMIT" : "ROLLBACK");
    return { ok: true, rows: r.rows };
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    return { ok: false, erro };
  }
}

async function confirmar(cliente, pedidoId, gateway, status) {
  const r = await comPapel(
    cliente,
    "service_role",
    "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text) AS r",
    [pedidoId, gateway, status],
    { commit: true },
  );
  if (!r.ok) throw r.erro;
  return r.rows[0].r;
}

async function expirar(cliente) {
  const r = await comPapel(
    cliente,
    "service_role",
    "SELECT public.expirar_pedidos_vencidos() AS n",
    [],
    { commit: true },
  );
  if (!r.ok) throw r.erro;
  return Number(r.rows[0].n);
}

async function registrar(cliente, papel, userId, pedidoId, recebido) {
  await logar(cliente, userId);
  return comPapel(
    cliente,
    papel,
    "SELECT public.registrar_pagamento_recebido($1::uuid, $2::boolean) AS r",
    [pedidoId, recebido],
    { commit: true },
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function criarUsuarios(cliente) {
  for (const [id, email, meta] of [
    [U_CLIENTE, "cliente@pagamentos.teste", "{}"],
    [U_OUTRO, "outro@pagamentos.teste", "{}"],
    [U_ADMIN, "admin@pagamentos.teste", '{"role":"admin"}'],
  ]) {
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, email, meta],
    );
  }
  // Admin de verdade tem o papel nas DUAS fontes: desde a 20261197000000,
  // registrar_pagamento_recebido exige profiles.role = 'admin' também.
  await cliente.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Pagamentos', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN],
  );
}

/**
 * Pedido de fixture com produto(s) PRÓPRIO(s): o estoque de cada item é
 * "depois da reserva" (ESTOQUE_INICIAL), então devolver = ESTOQUE_INICIAL+qtd.
 * itens: [{qtd, variante:boolean}]. gateway: undefined = id próprio; null =
 * sem cobrança gravada.
 */
async function novoPedido(cliente, o = {}) {
  sequencia += 1;
  const id = uuid("7ddddddd", sequencia);
  const itensSpec = o.itens || [{ qtd: 3 }];
  const paymentStatus =
    o.paymentStatus === undefined ? "aguardando" : o.paymentStatus;
  const gateway = o.gateway === undefined ? `ORD-PGTO-${sequencia}` : o.gateway;
  const minutosVencido = o.vencidoHaMin;
  const total = itensSpec.reduce((s, i) => s + i.qtd * PRECO, 0);

  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, gateway_payment_id, metodo_online, expires_at)
     VALUES ($1, $2, 'Cliente Pagamentos', '{}'::jsonb, $3, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $10::int IS NOT NULL THEN now() - make_interval(mins => $10::int)
                  WHEN $7::text = 'aguardando' THEN now() + interval '30 minutes'
                  ELSE NULL END)`,
    [
      id,
      o.userId === undefined ? U_CLIENTE : o.userId,
      total,
      o.status || "pending",
      o.canal || "online",
      o.paymentMethod === undefined ? "online" : o.paymentMethod,
      paymentStatus,
      gateway,
      o.metodoOnline === undefined
        ? paymentStatus === "aguardando"
          ? "pix"
          : null
        : o.metodoOnline,
      minutosVencido === undefined ? null : minutosVencido,
    ],
  );

  const itens = [];
  for (const spec of itensSpec) {
    sequencia += 1;
    const produtoId = uuid("7aaaaaaa", sequencia);
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Produto Pagamentos', 10.00, $2, $3, true, false)`,
      [produtoId, PRECO, ESTOQUE_INICIAL],
    );
    let varianteId = null;
    if (spec.variante) {
      varianteId = uuid("7bbbbbbb", sequencia);
      await cliente.query(
        `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
         VALUES ($1, $2, 'Tamanho', 'M', $3, true)`,
        [varianteId, produtoId, VARIANTE_INICIAL],
      );
    }
    await cliente.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 'Produto Pagamentos', $4, $5)`,
      [id, produtoId, varianteId, spec.qtd, PRECO],
    );
    itens.push({ produtoId, varianteId, qtd: spec.qtd });
  }
  return { id, gateway, itens };
}

/** Estoque de cada item: {produto, variante|null}. */
async function estoques(cliente, pedido) {
  const saida = [];
  for (const item of pedido.itens) {
    const p = await cliente.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [item.produtoId],
    );
    let variante = null;
    if (item.varianteId) {
      const v = await cliente.query(
        "SELECT stock_increment FROM public.product_variants WHERE id = $1",
        [item.varianteId],
      );
      variante = Number(v.rows[0].stock_increment);
    }
    saida.push({ produto: Number(p.rows[0].estoque), variante });
  }
  return saida;
}

/** Foto completa: a LINHA INTEIRA do pedido (to_jsonb) + o estoque. */
async function foto(cliente, pedido) {
  const r = await cliente.query(
    "SELECT to_jsonb(o) AS linha FROM public.marketplace_orders o WHERE o.id = $1",
    [pedido.id],
  );
  return { linha: r.rows[0].linha, estoques: await estoques(cliente, pedido) };
}

/** O estoque que devia estar depois de UMA devolução (ou nenhuma). */
function estoqueEsperado(pedido, devolvido) {
  return pedido.itens.map((i) => ({
    produto: i.varianteId
      ? ESTOQUE_INICIAL
      : ESTOQUE_INICIAL + (devolvido ? i.qtd : 0),
    variante: i.varianteId ? VARIANTE_INICIAL + (devolvido ? i.qtd : 0) : null,
  }));
}

/** Avisos de PAGAMENTO do pedido (o aviso de 'Pedido cancelado' é de outro gatilho). */
async function avisosDoPedido(cliente, pedidoId) {
  const r = await cliente.query(
    `SELECT titulo FROM public.notificacoes
      WHERE dados->>'order_id' = $1 AND titulo LIKE 'Pagamento%'
      ORDER BY created_at, id`,
    [pedidoId],
  );
  return r.rows.map((x) => x.titulo);
}

const AVISO_PAGO = "Pagamento confirmado";
const AVISO_TARDIO = "Pagamento recebido após o cancelamento";

async function historicoDoRecebimento(cliente, pedidoId) {
  const r = await cliente.query(
    `SELECT acao, payment_status_antes AS antes, payment_status_depois AS depois, created_by
       FROM public.marketplace_order_payment_history
      WHERE order_id = $1 ORDER BY created_at, id`,
    [pedidoId],
  );
  return r.rows;
}

function esperaDevolvido(f, pedido, devolvido, mensagem) {
  assert.deepEqual(f.estoques, estoqueEsperado(pedido, devolvido), mensagem);
  assert.equal(
    f.linha.stock_returned_at !== null,
    devolvido,
    `${mensagem}: carimbo stock_returned_at`,
  );
}

// ---------------------------------------------------------------------------
// Duas conexões reais (concorrência)
// ---------------------------------------------------------------------------

async function novaConexao(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  // Teto de segurança: uma prova que trava não pode pendurar o job inteiro.
  await c.query("SET statement_timeout = '30s'");
  return c;
}

async function esperarBloqueio(observador, pid, limiteMs = 10000) {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    const r = await observador.query(
      "SELECT wait_event_type, state FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0] && r.rows[0].wait_event_type === "Lock") return true;
    await sleep(40);
  }
  return false;
}

/**
 * A segura a linha (abre transação, roda `sqlA` como service_role, NÃO fecha);
 * B dispara `sqlB` e tem de FICAR ESPERANDO; só então A dá COMMIT. Devolve
 * {resultadoA, resultadoB, esperou}. Fecha tudo no finally.
 */
async function corrida(
  observador,
  url,
  { sqlA, paramsA, sqlB, paramsB, papelB, userB },
) {
  const A = await novaConexao(url);
  const B = await novaConexao(url);
  let aberta = false;
  try {
    const pidB = (await B.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    if (userB !== undefined) await logar(B, userB);

    await A.query("BEGIN");
    aberta = true;
    await A.query("SET LOCAL ROLE service_role");
    const resultadoA = (await A.query(sqlA, paramsA)).rows[0].r;

    await B.query("BEGIN");
    if (papelB) await B.query(`SET LOCAL ROLE ${papelB}`);
    let terminouB = false;
    const promessaB = B.query(sqlB, paramsB).then(
      (r) => {
        terminouB = true;
        return { ok: true, valor: r.rows[0].r };
      },
      (erro) => {
        terminouB = true;
        return { ok: false, erro };
      },
    );

    const esperou = await esperarBloqueio(observador, pidB);
    const terminouAntes = terminouB;

    await A.query("COMMIT");
    aberta = false;
    const resultadoB = await promessaB;
    await B.query(resultadoB.ok ? "COMMIT" : "ROLLBACK");
    return { resultadoA, resultadoB, esperou, terminouAntes };
  } finally {
    if (aberta) await A.query("ROLLBACK").catch(() => {});
    await A.end().catch(() => {});
    await B.end().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// As provas
// ---------------------------------------------------------------------------

const PROVAS = [];
let URL_BANCO = null;

PROVAS.push({
  nome: "(1) PIX aguardando -> 'pago': paid_at gravado, estoque intacto, 1 aviso; reenvio -> 'ja_pago' sem mexer em nada",
  corpo: async (c) => {
    await criarUsuarios(c);
    const p = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    const antes = await foto(c, p);
    assert.equal(antes.linha.payment_status, "aguardando");
    assert.equal(antes.linha.paid_at, null);

    assert.equal(await confirmar(c, p.id, p.gateway, "pago"), "pago");
    const depois = await foto(c, p);
    assert.equal(depois.linha.payment_status, "pago");
    assert.equal(depois.linha.status, "pending", "pago não adianta o pedido");
    assert.notEqual(depois.linha.paid_at, null);
    esperaDevolvido(depois, p, false, "pago não mexe no estoque");
    assert.deepEqual(await avisosDoPedido(c, p.id), [AVISO_PAGO]);

    // Reenvio do webhook: nada muda — nem paid_at, nem updated_at, nem aviso.
    assert.equal(await confirmar(c, p.id, p.gateway, "pago"), "ja_pago");
    assert.deepEqual(await foto(c, p), depois, "reenvio não reescreve a linha");
    assert.deepEqual(await avisosDoPedido(c, p.id), [AVISO_PAGO]);
  },
});

PROVAS.push({
  nome: "(2) 'divergente' (id nulo, sem gateway, id diferente, vaga sentinela) e 'inexistente': nenhuma coluna muda",
  corpo: async (c) => {
    const comGateway = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    const semGateway = await novoPedido(c, { gateway: null });
    const sentinela = await novoPedido(c, {
      gateway: "verificando:chave-de-prova",
      metodoOnline: null,
    });

    const casos = [
      ["p_payment_id NULL", comGateway, null],
      ["id diferente do gravado", comGateway, "ORD-DE-OUTRO-PEDIDO"],
      ["pedido sem gateway, id real chegando", semGateway, "ORD-QUALQUER"],
      ["pedido sem gateway e p_payment_id NULL", semGateway, null],
      [
        "vaga sentinela de cartão, id real chegando",
        sentinela,
        "ORD-REAL-DO-MP",
      ],
    ];
    for (const status of ["pago", "recusado", "estornado"]) {
      for (const [rotulo, pedido, gateway] of casos) {
        const antes = await foto(c, pedido);
        assert.equal(
          await confirmar(c, pedido.id, gateway, status),
          "divergente",
          `${status} / ${rotulo}`,
        );
        assert.deepEqual(
          await foto(c, pedido),
          antes,
          `${status} / ${rotulo}: nenhuma coluna nem estoque pode mudar`,
        );
      }
    }
    assert.deepEqual(await avisosDoPedido(c, comGateway.id), []);

    // Inexistente: nem a checagem de id vem antes (nada a comparar).
    const fantasma = uuid("7eeeeeee", 1);
    assert.equal(await confirmar(c, fantasma, "ORD-X", "pago"), "inexistente");
    assert.equal(await confirmar(c, fantasma, null, "recusado"), "inexistente");
  },
});

PROVAS.push({
  nome: "(3) 'recusado' de aguardando+pending devolve o estoque UMA vez (produto e variante) e cancela; 2a entrega -> 'ignorado'",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    esperaDevolvido(await foto(c, p), p, false, "ponto de partida");

    assert.equal(await confirmar(c, p.id, p.gateway, "recusado"), "recusado");
    const depois = await foto(c, p);
    assert.equal(depois.linha.payment_status, "recusado");
    assert.equal(depois.linha.status, "cancelled");
    assert.equal(depois.linha.paid_at, null);
    esperaDevolvido(depois, p, true, "recusado devolve a reserva uma vez");
    // Variante: o crédito vai para a VARIANTE, nunca para o produto pai.
    assert.equal(depois.estoques[1].produto, ESTOQUE_INICIAL);
    assert.equal(depois.estoques[1].variante, VARIANTE_INICIAL + 2);

    // Segunda entrega do mesmo 'recusado': não sobe de novo.
    assert.equal(await confirmar(c, p.id, p.gateway, "recusado"), "ignorado");
    assert.deepEqual(await foto(c, p), depois, "2a entrega não mexe em nada");
  },
});

PROVAS.push({
  nome: "(4) CONCORRÊNCIA: dois 'recusado' ao mesmo tempo — o 2o ESPERA o lock, ao liberar vê 'recusado' -> 'ignorado'; estoque soma UMA vez",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    const sql =
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, $3::text) AS r";
    const params = [p.id, p.gateway, "recusado"];

    const r = await corrida(c, URL_BANCO, {
      sqlA: sql,
      paramsA: params,
      sqlB: sql,
      paramsB: params,
      papelB: "service_role",
    });

    assert.equal(r.resultadoA, "recusado");
    assert.equal(
      r.esperou,
      true,
      "a conexão B tinha de estar ESPERANDO um lock enquanto A segurava a linha",
    );
    assert.equal(
      r.terminouAntes,
      false,
      "B não pode terminar antes do COMMIT de A",
    );
    assert.deepEqual(r.resultadoB, { ok: true, valor: "ignorado" });

    const depois = await foto(c, p);
    assert.equal(depois.linha.payment_status, "recusado");
    assert.equal(depois.linha.status, "cancelled");
    esperaDevolvido(depois, p, true, "o estoque somou uma vez só");
  },
});

PROVAS.push({
  nome: "(5) expiração: PIX vencido expira e devolve uma vez; 'pago' depois -> 'pago_apos_expirar' sem mexer no estoque; reenvios idempotentes",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      vencidoHaMin: 31,
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    assert.equal(await expirar(c), 1, "só o PIX vencido da prova expira");
    const expirado = await foto(c, p);
    assert.equal(expirado.linha.payment_status, "expirado");
    assert.equal(expirado.linha.status, "cancelled");
    esperaDevolvido(expirado, p, true, "a varredura devolveu uma vez");

    // O PIX é pago DEPOIS de expirar.
    assert.equal(
      await confirmar(c, p.id, p.gateway, "pago"),
      "pago_apos_expirar",
    );
    const pago = await foto(c, p);
    assert.equal(pago.linha.payment_status, "pago_apos_expirar");
    assert.equal(pago.linha.status, "cancelled", "o pedido segue cancelado");
    assert.notEqual(pago.linha.paid_at, null);
    esperaDevolvido(pago, p, true, "não consome nem devolve de novo");
    assert.deepEqual(await avisosDoPedido(c, p.id), [AVISO_TARDIO]);

    // Reenvio, recusa tardia e nova varredura: tudo inerte.
    assert.equal(await confirmar(c, p.id, p.gateway, "pago"), "ja_pago");
    assert.deepEqual(await foto(c, p), pago);
    assert.equal(await confirmar(c, p.id, p.gateway, "recusado"), "ignorado");
    assert.deepEqual(await foto(c, p), pago);
    assert.equal(await expirar(c), 0);
    assert.deepEqual(await foto(c, p), pago);
    assert.deepEqual(await avisosDoPedido(c, p.id), [AVISO_TARDIO]);
  },
});

PROVAS.push({
  nome: "(5b) CONCORRÊNCIA: 'pago' chega com a varredura segurando a linha — espera e vira 'pago_apos_expirar' (nunca 'pago' com pedido cancelado)",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      vencidoHaMin: 31,
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    const r = await corrida(c, URL_BANCO, {
      sqlA: "SELECT public.expirar_pedidos_vencidos() AS r",
      paramsA: [],
      sqlB: "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
      paramsB: [p.id, p.gateway],
      papelB: "service_role",
    });

    assert.equal(Number(r.resultadoA), 1);
    assert.equal(
      r.esperou,
      true,
      "B tinha de esperar a varredura soltar a linha",
    );
    assert.equal(r.terminouAntes, false);
    assert.deepEqual(r.resultadoB, { ok: true, valor: "pago_apos_expirar" });

    const depois = await foto(c, p);
    assert.equal(depois.linha.payment_status, "pago_apos_expirar");
    assert.equal(depois.linha.status, "cancelled");
    assert.notEqual(depois.linha.paid_at, null);
    esperaDevolvido(depois, p, true, "devolvido uma vez só, pela varredura");
  },
});

PROVAS.push({
  nome: "(5c) CONCORRÊNCIA INVERSA: 'pago' segura a linha de um PIX vencido — a varredura (SKIP LOCKED) NÃO espera, devolve 0 e o pedido fica 'pago' com estoque intacto",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      vencidoHaMin: 31,
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    const A = await novaConexao(URL_BANCO);
    const B = await novaConexao(URL_BANCO);
    let abertaA = false;
    let abertaB = false;
    try {
      // A: o webhook confirma o PIX (vencido, ainda 'aguardando') e NÃO fecha.
      await A.query("BEGIN");
      abertaA = true;
      await A.query("SET LOCAL ROLE service_role");
      const ra = (
        await A.query(
          "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r",
          [p.id, p.gateway],
        )
      ).rows[0].r;
      assert.equal(ra, "pago", "A: vencido mas ainda aguardando vira 'pago'");

      // B: a varredura chega com a linha travada. SKIP LOCKED => pula e termina.
      await B.query("BEGIN");
      abertaB = true;
      await B.query("SET LOCAL ROLE service_role");
      // Timer cancelável: um sleep() solto seguraria o processo ~8 s depois
      // de a varredura vencer a corrida (anotação da revisão Opus).
      let limiteDaCorrida;
      const resultadoB = await Promise.race([
        B.query("SELECT public.expirar_pedidos_vencidos() AS r").then((r) => ({
          n: Number(r.rows[0].r),
        })),
        new Promise((r) => {
          limiteDaCorrida = setTimeout(() => r("TRAVOU"), 8000);
        }),
      ]).finally(() => clearTimeout(limiteDaCorrida));
      assert.notEqual(
        resultadoB,
        "TRAVOU",
        "a varredura ficou ESPERANDO a linha de A: sem SKIP LOCKED ela trava (e depois sobrescreve)",
      );
      assert.deepEqual(
        resultadoB,
        { n: 0 },
        "a varredura pula a linha travada e devolve 0",
      );
      await B.query("COMMIT");
      abertaB = false;

      // Antes do COMMIT de A, quem olha de fora ainda vê o pedido intocado.
      const fora = await foto(c, p);
      assert.equal(fora.linha.payment_status, "aguardando");
      esperaDevolvido(fora, p, false, "a varredura não devolveu nada");

      await A.query("COMMIT");
      abertaA = false;
    } finally {
      if (abertaA) await A.query("ROLLBACK").catch(() => {});
      if (abertaB) await B.query("ROLLBACK").catch(() => {});
      await A.end().catch(() => {});
      await B.end().catch(() => {});
    }

    const depois = await foto(c, p);
    assert.equal(depois.linha.payment_status, "pago");
    assert.equal(depois.linha.status, "pending", "o pedido não foi cancelado");
    assert.notEqual(depois.linha.paid_at, null);
    esperaDevolvido(depois, p, false, "estoque intacto e sem carimbo");
    assert.deepEqual(await avisosDoPedido(c, p.id), [AVISO_PAGO]);

    // Uma varredura depois: o pedido já é 'pago', não é mais alvo.
    assert.equal(await expirar(c), 0);
    assert.deepEqual(await foto(c, p), depois, "a varredura seguinte não mexe");
  },
});

PROVAS.push({
  nome: "(6) cliente cancelou pelo app (cancelar_pedido_com_cobranca real, a porta da edge): 'pago' -> 'pago_apos_expirar'; 'recusado' não credita de novo; 'estornado' só marca",
  corpo: async (c) => {
    // 20261198000000: pedido aguardando com a cobrança na vaga só se cancela
    // pela edge (anula no MP antes) — `update_order_status_atomic` recusa
    // (prova em tests/banco/cancelar-pedido-viva.cjs). A porta que a edge
    // usa é esta RPC de service role, com o cliente como ator e CAS na vaga.
    const cancelarComoCliente = async (pedido) => {
      const r = await comPapel(
        c,
        "service_role",
        "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, $3::text, 'aguardando') AS r",
        [pedido.id, U_CLIENTE, pedido.gateway],
        { commit: true },
      );
      if (!r.ok) throw r.erro;
      assert.equal(r.rows[0].r.cancelado, true, "a porta da edge cancelou");
    };

    // O cancelamento do app devolve o estoque e NÃO escreve payment_status.
    const pago = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    await cancelarComoCliente(pago);
    const cancelado = await foto(c, pago);
    assert.equal(cancelado.linha.status, "cancelled");
    assert.equal(cancelado.linha.payment_status, "aguardando");
    esperaDevolvido(cancelado, pago, true, "o app já devolveu");

    assert.equal(
      await confirmar(c, pago.id, pago.gateway, "pago"),
      "pago_apos_expirar",
    );
    const depoisPago = await foto(c, pago);
    assert.equal(depoisPago.linha.payment_status, "pago_apos_expirar");
    assert.equal(depoisPago.linha.status, "cancelled");
    assert.notEqual(depoisPago.linha.paid_at, null);
    esperaDevolvido(
      depoisPago,
      pago,
      true,
      "pago não mexe no estoque já devolvido",
    );
    assert.deepEqual(await avisosDoPedido(c, pago.id), [AVISO_TARDIO]);

    // Dinheiro chegado depois do cancelamento e depois estornado: só marca.
    assert.equal(
      await confirmar(c, pago.id, pago.gateway, "estornado"),
      "estornado",
    );
    const estornado = await foto(c, pago);
    assert.equal(estornado.linha.payment_status, "estornado");
    esperaDevolvido(
      estornado,
      pago,
      true,
      "estorno de pedido já cancelado não credita",
    );

    // 'recusado' depois do cancelamento: marca, mas NÃO credita de novo.
    const recusado = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    await cancelarComoCliente(recusado);
    assert.equal(
      await confirmar(c, recusado.id, recusado.gateway, "recusado"),
      "recusado",
    );
    const depoisRecusado = await foto(c, recusado);
    assert.equal(depoisRecusado.linha.payment_status, "recusado");
    assert.equal(depoisRecusado.linha.status, "cancelled");
    esperaDevolvido(
      depoisRecusado,
      recusado,
      true,
      "recusado não credita o que o app já devolveu",
    );

    // 'estornado' direto de aguardando+cancelled (nunca pago): só marca.
    const estornoSemPago = await novoPedido(c, { itens: [{ qtd: 3 }] });
    await cancelarComoCliente(estornoSemPago);
    assert.equal(
      await confirmar(
        c,
        estornoSemPago.id,
        estornoSemPago.gateway,
        "estornado",
      ),
      "estornado",
    );
    esperaDevolvido(
      await foto(c, estornoSemPago),
      estornoSemPago,
      true,
      "estornado de aguardando+cancelled não credita de novo",
    );
  },
});

PROVAS.push({
  nome: "(7) 'estornado': de aguardando+pending devolve uma vez; de 'pago' só marca (estoque intacto); repetição -> 'ja_estornado'",
  corpo: async (c) => {
    // De aguardando: a reserva volta, o pedido morre.
    const a = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    assert.equal(await confirmar(c, a.id, a.gateway, "estornado"), "estornado");
    const fa = await foto(c, a);
    assert.equal(fa.linha.payment_status, "estornado");
    assert.equal(fa.linha.status, "cancelled");
    assert.notEqual(
      fa.linha.estorno_manual_registrado_em,
      null,
      "o gatilho carimba o estorno direto do gateway",
    );
    esperaDevolvido(
      fa,
      a,
      true,
      "estorno de aguardando devolve a reserva uma vez",
    );
    assert.equal(
      await confirmar(c, a.id, a.gateway, "estornado"),
      "ja_estornado",
    );
    assert.deepEqual(await foto(c, a), fa, "repetição não mexe em nada");

    // De pago: houve venda, a mercadoria pode ter saído — só marca.
    const b = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    assert.equal(await confirmar(c, b.id, b.gateway, "pago"), "pago");
    assert.equal(await confirmar(c, b.id, b.gateway, "estornado"), "estornado");
    const fb = await foto(c, b);
    assert.equal(fb.linha.payment_status, "estornado");
    assert.equal(
      fb.linha.status,
      "pending",
      "estorno de pago não cancela o pedido",
    );
    esperaDevolvido(fb, b, false, "estorno de pago NUNCA mexe em estoque");
    assert.equal(
      await confirmar(c, b.id, b.gateway, "estornado"),
      "ja_estornado",
    );
    assert.deepEqual(await foto(c, b), fb);
  },
});

PROVAS.push({
  nome: "(8) permissão real: anon e authenticated (cliente E admin) recebem permission denied em confirmar_pagamento; service_role executa",
  corpo: async (c) => {
    const p = await novoPedido(c, { itens: [{ qtd: 3 }] });
    const antes = await foto(c, p);
    const sql =
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r";

    for (const [rotulo, papel, userId] of [
      ["anon", "anon", ""],
      ["authenticated (cliente dono do pedido)", "authenticated", U_CLIENTE],
      ["authenticated (outro cliente)", "authenticated", U_OUTRO],
      ["authenticated (admin da loja)", "authenticated", U_ADMIN],
    ]) {
      await logar(c, userId);
      const r = await comPapel(c, papel, sql, [p.id, p.gateway], {
        commit: true,
      });
      assert.equal(r.ok, false, `${rotulo} não pode executar`);
      assert.match(
        r.erro.message,
        /permission denied for function confirmar_pagamento/,
        rotulo,
      );
      assert.deepEqual(await foto(c, p), antes, `${rotulo}: nada gravado`);
    }

    await logar(c, "");
    assert.equal(await confirmar(c, p.id, p.gateway, "pago"), "pago");
    assert.equal((await foto(c, p)).linha.payment_status, "pago");
  },
});

// -- (9) registrar_pagamento_recebido --------------------------------------

/** Fluxo completo de um pedido sem pagamento registrado (entrega ou balcão). */
async function fluxoDeRecebimento(c, pedido, rotulo) {
  const inicial = await foto(c, pedido);
  assert.equal(
    inicial.linha.payment_status,
    null,
    `${rotulo}: parte sem pagamento`,
  );
  const historicoInicial = await historicoDoRecebimento(c, pedido.id);
  assert.deepEqual(historicoInicial, [], `${rotulo}: sem histórico`);

  // anon: nem executa.
  let r = await registrar(c, "anon", "", pedido.id, true);
  assert.equal(r.ok, false);
  assert.match(r.erro.message, /permission denied/, `${rotulo}: anon`);

  // authenticated que NÃO é admin (nem o dono do pedido pode).
  for (const quem of [U_CLIENTE, U_OUTRO]) {
    r = await registrar(c, "authenticated", quem, pedido.id, true);
    assert.equal(r.ok, false);
    assert.match(r.erro.message, /Não autorizado/, `${rotulo}: não-admin`);
  }
  assert.deepEqual(
    await foto(c, pedido),
    inicial,
    `${rotulo}: recusas não gravam nada`,
  );
  assert.deepEqual(await historicoDoRecebimento(c, pedido.id), []);

  // admin: registra.
  r = await registrar(c, "authenticated", U_ADMIN, pedido.id, true);
  assert.equal(r.ok, true, r.erro?.message);
  assert.equal(r.rows[0].r.payment_status, "recebido_na_entrega");
  assert.equal(r.rows[0].r.ja_estava, false);
  const recebido = await foto(c, pedido);
  assert.equal(recebido.linha.payment_status, "recebido_na_entrega");
  assert.equal(recebido.linha.pagamento_recebido_por, U_ADMIN);
  assert.notEqual(recebido.linha.pagamento_recebido_em, null);
  assert.deepEqual(
    recebido.estoques,
    inicial.estoques,
    `${rotulo}: não mexe em estoque`,
  );
  assert.deepEqual(await historicoDoRecebimento(c, pedido.id), [
    {
      acao: "recebido",
      antes: null,
      depois: "recebido_na_entrega",
      created_by: U_ADMIN,
    },
  ]);

  // Repetição: nada novo.
  r = await registrar(c, "authenticated", U_ADMIN, pedido.id, true);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].r.ja_estava, true);
  assert.deepEqual(
    await foto(c, pedido),
    recebido,
    `${rotulo}: repetição não reescreve`,
  );
  assert.equal((await historicoDoRecebimento(c, pedido.id)).length, 1);

  // Desfazer: volta a NULL nas três colunas + linha 'desfeito'.
  r = await registrar(c, "authenticated", U_ADMIN, pedido.id, false);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].r.ja_estava, false);
  const desfeito = await foto(c, pedido);
  assert.equal(desfeito.linha.payment_status, null);
  assert.equal(desfeito.linha.pagamento_recebido_em, null);
  assert.equal(desfeito.linha.pagamento_recebido_por, null);
  assert.deepEqual((await historicoDoRecebimento(c, pedido.id)).slice(-1), [
    {
      acao: "desfeito",
      antes: "recebido_na_entrega",
      depois: null,
      created_by: U_ADMIN,
    },
  ]);
  assert.equal((await historicoDoRecebimento(c, pedido.id)).length, 2);

  // Desfazer de novo: ja_estava, sem linha nova.
  r = await registrar(c, "authenticated", U_ADMIN, pedido.id, false);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].r.ja_estava, true);
  assert.deepEqual(await foto(c, pedido), desfeito);
  assert.equal((await historicoDoRecebimento(c, pedido.id)).length, 2);
}

async function exigeRecusa(c, pedido, regex, rotulo) {
  const antes = await foto(c, pedido);
  const historicoAntes = await historicoDoRecebimento(c, pedido.id);
  for (const flag of [true, false]) {
    const r = await registrar(c, "authenticated", U_ADMIN, pedido.id, flag);
    assert.equal(
      r.ok,
      false,
      `${rotulo} (p_recebido=${flag}) tinha de ser recusado`,
    );
    assert.match(r.erro.message, regex, rotulo);
  }
  assert.deepEqual(await foto(c, pedido), antes, `${rotulo}: nada gravado`);
  assert.deepEqual(await historicoDoRecebimento(c, pedido.id), historicoAntes);
}

PROVAS.push({
  nome: "(9a) registrar_pagamento_recebido num pedido de ENTREGA (cash/pix/card/legado): gate de admin, registra, repete, desfaz, histórico",
  corpo: async (c) => {
    // payment_method de entrega vem de create_marketplace_order_v23 (cash,
    // pix, card — forma_de_pagamento_aceita, 20261174000000); 'na_entrega' é
    // o legado que a 20261162000000 cita. Todos nascem com payment_status NULL.
    for (const metodo of ["cash", "pix", "card", "na_entrega"]) {
      const p = await novoPedido(c, {
        paymentMethod: metodo,
        paymentStatus: null,
        gateway: null,
        metodoOnline: null,
        itens: [{ qtd: 2 }],
      });
      await fluxoDeRecebimento(c, p, `entrega/${metodo}`);
    }
  },
});

PROVAS.push({
  nome: "(9b) registrar_pagamento_recebido recusa: pedido online, cancelado, com pagamento já preenchido e inexistente — nada grava",
  corpo: async (c) => {
    const online = await novoPedido(c, {
      paymentMethod: "online",
      paymentStatus: "aguardando",
    });
    await exigeRecusa(c, online, /pelo site/, "pedido pago pelo site");

    const cancelado = await novoPedido(c, {
      paymentMethod: "cash",
      paymentStatus: null,
      status: "cancelled",
      gateway: null,
      metodoOnline: null,
    });
    await exigeRecusa(c, cancelado, /cancelado/, "pedido cancelado");

    // Dinheiro recebido e depois o pedido morreu: nem desfazer vale.
    const recebidoEcancelado = await novoPedido(c, {
      paymentMethod: "cash",
      paymentStatus: "recebido_na_entrega",
      status: "cancelled",
      gateway: null,
      metodoOnline: null,
    });
    await exigeRecusa(
      c,
      recebidoEcancelado,
      /cancelado/,
      "recebido + cancelado",
    );

    for (const preenchido of [
      "pago",
      "estornado",
      "recusado",
      "pago_apos_expirar",
    ]) {
      const p = await novoPedido(c, {
        paymentMethod: "cash",
        paymentStatus: preenchido,
        gateway: null,
        metodoOnline: null,
      });
      const antes = await foto(c, p);
      // marcar recebido por cima de outro pagamento: recusa.
      let r = await registrar(c, "authenticated", U_ADMIN, p.id, true);
      assert.equal(
        r.ok,
        false,
        `${preenchido}: marcar por cima tinha de ser recusado`,
      );
      assert.match(r.erro.message, /já tem pagamento registrado/, preenchido);
      // desfazer onde não há recebimento na entrega: ja_estava, sem mexer.
      r = await registrar(c, "authenticated", U_ADMIN, p.id, false);
      assert.equal(r.ok, true);
      assert.equal(
        r.rows[0].r.ja_estava,
        true,
        `${preenchido}: desfazer não desfaz pagamento alheio`,
      );
      assert.equal(r.rows[0].r.payment_status, preenchido);
      assert.deepEqual(await foto(c, p), antes, `${preenchido}: nada gravado`);
      assert.deepEqual(await historicoDoRecebimento(c, p.id), []);
    }

    const r = await registrar(
      c,
      "authenticated",
      U_ADMIN,
      uuid("7eeeeeee", 2),
      true,
    );
    assert.equal(r.ok, false);
    assert.match(r.erro.message, /não encontrado/);
  },
});

PROVAS.push({
  nome: "(9c) registrar_pagamento_recebido na venda de BALCÃO (registrar_venda_presencial real): repetição não duplica; medida do 'desfazer' e do NULL",
  corpo: async (c) => {
    sequencia += 1;
    const produtoId = uuid("7aaaaaaa", sequencia);
    await c.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Produto Balcao', 10.00, $2, $3, true, false)`,
      [produtoId, PRECO, ESTOQUE_INICIAL],
    );
    const vender = async () => {
      await logar(c, U_ADMIN);
      const r = await comPapel(
        c,
        "authenticated",
        "SELECT public.registrar_venda_presencial($1::jsonb, 'cash') AS r",
        [JSON.stringify([{ product_id: produtoId, quantity: 1 }])],
        { commit: true },
      );
      if (!r.ok) throw r.erro;
      return r.rows[0].r.order.id;
    };

    // A venda de balcão nasce RECEBIDA: delivered + recebido_na_entrega, com
    // 1 linha de histórico e o estoque já debitado pela própria RPC.
    const vendaId = await vender();
    const pedido = { id: vendaId, itens: [] };
    const nascida = await foto(c, pedido);
    assert.equal(nascida.linha.canal, "presencial");
    assert.equal(nascida.linha.status, "delivered");
    assert.equal(nascida.linha.payment_status, "recebido_na_entrega");
    assert.equal(nascida.linha.pagamento_recebido_por, U_ADMIN);
    assert.equal(
      Number(
        (
          await c.query("SELECT estoque FROM public.produtos WHERE id = $1", [
            produtoId,
          ])
        ).rows[0].estoque,
      ),
      ESTOQUE_INICIAL - 1,
      "a venda de balcão debitou o estoque",
    );
    assert.equal((await historicoDoRecebimento(c, vendaId)).length, 1);

    // anon e não-admin: recusados, nada muda.
    let r = await registrar(c, "anon", "", vendaId, false);
    assert.equal(r.ok, false);
    assert.match(r.erro.message, /permission denied/);
    r = await registrar(c, "authenticated", U_CLIENTE, vendaId, false);
    assert.equal(r.ok, false);
    assert.match(r.erro.message, /Não autorizado/);
    assert.deepEqual(await foto(c, pedido), nascida);

    // Repetição de 'recebido': ja_estava, nada novo.
    r = await registrar(c, "authenticated", U_ADMIN, vendaId, true);
    assert.equal(r.ok, true);
    assert.equal(r.rows[0].r.ja_estava, true);
    assert.deepEqual(await foto(c, pedido), nascida);
    assert.equal((await historicoDoRecebimento(c, vendaId)).length, 1);

    // DECISÃO DE PRODUTO A CONFIRMAR (ACHADO, não defeito): o "desfazer" é
    // recurso deliberado e deixa trilha ('desfeito' no histórico), mas a RPC
    // vale para QUALQUER pedido não-online já ENTREGUE — balcão e entrega
    // (ver (9e)) —: payment_status volta a NULL, o dinheiro some dos
    // relatórios que contam 'recebido_na_entrega' e o pedido segue delivered
    // sem pagamento. A tela também oferece o botão (podeRegistrarPagamento só
    // olha online/cancelado). Cabe ao dono do produto dizer se desfazer um
    // recebimento de pedido já entregue deve continuar livre. Afirmamos o
    // comportamento ATUAL, com trilha: 1 linha 'desfeito'.
    r = await registrar(c, "authenticated", U_ADMIN, vendaId, false);
    assert.equal(r.ok, true);
    const desfeita = await foto(c, pedido);
    assert.equal(desfeita.linha.status, "delivered");
    assert.equal(desfeita.linha.payment_status, null);
    assert.equal(desfeita.linha.pagamento_recebido_em, null);
    assert.equal(desfeita.linha.pagamento_recebido_por, null);
    assert.deepEqual((await historicoDoRecebimento(c, vendaId)).slice(-1), [
      {
        acao: "desfeito",
        antes: "recebido_na_entrega",
        depois: null,
        created_by: U_ADMIN,
      },
    ]);
    r = await registrar(c, "authenticated", U_ADMIN, vendaId, false);
    assert.equal(r.rows[0].r.ja_estava, true);
    assert.equal((await historicoDoRecebimento(c, vendaId)).length, 2);
  },
});

PROVAS.push({
  nome: "(9e) registrar_pagamento_recebido: o 'desfazer' também vale para pedido de ENTREGA já 'delivered' (decisão de produto a confirmar)",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      paymentMethod: "cash",
      paymentStatus: null,
      status: "delivered",
      gateway: null,
      metodoOnline: null,
    });
    let r = await registrar(c, "authenticated", U_ADMIN, p.id, true);
    assert.equal(r.ok, true, r.erro?.message);
    const recebido = await foto(c, p);
    assert.equal(recebido.linha.status, "delivered");
    assert.equal(recebido.linha.payment_status, "recebido_na_entrega");

    // ACHADO (ver o comentário em (9c)): entregue e recebido, o admin ainda
    // consegue desfazer — o pedido fica delivered com payment_status NULL.
    r = await registrar(c, "authenticated", U_ADMIN, p.id, false);
    assert.equal(r.ok, true, r.erro?.message);
    const desfeito = await foto(c, p);
    assert.equal(desfeito.linha.status, "delivered");
    assert.equal(desfeito.linha.payment_status, null);
    assert.equal(desfeito.linha.pagamento_recebido_em, null);
    assert.equal(desfeito.linha.pagamento_recebido_por, null);
    assert.deepEqual(await historicoDoRecebimento(c, p.id), [
      {
        acao: "recebido",
        antes: null,
        depois: "recebido_na_entrega",
        created_by: U_ADMIN,
      },
      {
        acao: "desfeito",
        antes: "recebido_na_entrega",
        depois: null,
        created_by: U_ADMIN,
      },
    ]);
  },
});

PROVAS.push({
  nome: "(9d) registrar_pagamento_recebido como service_role SEM sessão: contrato medido (is_admin() libera o papel; autor NULL)",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      paymentMethod: "cash",
      paymentStatus: null,
      gateway: null,
      metodoOnline: null,
    });
    // ACHADO: is_admin() devolve true para o papel service_role, e auth.uid()
    // é NULL sem JWT de usuário — então o registro passa, mas grava
    // pagamento_recebido_por = NULL e created_by = NULL: um recebimento SEM
    // autor. Hoje só a edge/cron com service role poderia chamar; nenhuma
    // chama esta RPC. Contrato medido, não corrigido.
    const r = await registrar(c, "service_role", "", p.id, true);
    assert.equal(r.ok, true, r.erro?.message);
    assert.equal(r.rows[0].r.payment_status, "recebido_na_entrega");
    const f = await foto(c, p);
    assert.equal(f.linha.payment_status, "recebido_na_entrega");
    assert.equal(f.linha.pagamento_recebido_por, null);
    assert.notEqual(f.linha.pagamento_recebido_em, null);
    assert.deepEqual(await historicoDoRecebimento(c, p.id), [
      {
        acao: "recebido",
        antes: null,
        depois: "recebido_na_entrega",
        created_by: null,
      },
    ]);
  },
});

PROVAS.push({
  nome: "(9f) registrar_pagamento_recebido com p_recebido NULL: 22004 DEPOIS da autorização, sem gravar nada (20261195000000)",
  corpo: async (c) => {
    const MENSAGEM =
      /Informe se o pagamento foi recebido \(true\) ou desfeito \(false\)\./;
    // A3 CORRIGIDO: NULL caía no ELSE de `IF p_recebido` e se comportava como
    // DESFAZER. Agora é recusado com null_value_not_allowed (22004) — depois
    // do is_admin() (quem não é admin continua vendo 'Não autorizado') e antes
    // de qualquer leitura com lock ou escrita.
    const entrega = () =>
      novoPedido(c, {
        paymentMethod: "cash",
        paymentStatus: null,
        gateway: null,
        metodoOnline: null,
      });

    // (a) entrega já recebida: o NULL NÃO pode desfazer o recebimento.
    const recebido = await entrega();
    let r = await registrar(c, "authenticated", U_ADMIN, recebido.id, true);
    assert.equal(r.ok, true, r.erro?.message);
    // (b) entrega sem pagamento registrado.
    const semPagamento = await entrega();
    // (c) pedido pago pelo site.
    const online = await novoPedido(c, {
      paymentMethod: "online",
      paymentStatus: "aguardando",
    });
    // (d) pedido cancelado.
    const cancelado = await novoPedido(c, {
      paymentMethod: "cash",
      paymentStatus: null,
      status: "cancelled",
      gateway: null,
      metodoOnline: null,
    });

    for (const [rotulo, pedido] of [
      ["entrega já recebida", recebido],
      ["entrega sem pagamento", semPagamento],
      ["pedido online", online],
      ["pedido cancelado", cancelado],
    ]) {
      const antes = await foto(c, pedido);
      const historicoAntes = await historicoDoRecebimento(c, pedido.id);
      r = await registrar(c, "authenticated", U_ADMIN, pedido.id, null);
      assert.equal(r.ok, false, `${rotulo}: NULL tinha de ser recusado`);
      assert.equal(r.erro.code, "22004", `${rotulo}: SQLSTATE`);
      assert.match(r.erro.message, MENSAGEM, rotulo);
      assert.deepEqual(
        await foto(c, pedido),
        antes,
        `${rotulo}: linha intacta`,
      );
      assert.deepEqual(
        await historicoDoRecebimento(c, pedido.id),
        historicoAntes,
        `${rotulo}: histórico intacto`,
      );
    }
    assert.equal(
      (await foto(c, recebido)).linha.payment_status,
      "recebido_na_entrega",
      "o recebimento sobreviveu ao NULL",
    );

    // A autorização vem ANTES: quem não é admin vê 'Não autorizado', nunca o
    // erro de NULL; anon nem executa.
    const antes = await foto(c, recebido);
    for (const quem of [U_CLIENTE, U_OUTRO]) {
      r = await registrar(c, "authenticated", quem, recebido.id, null);
      assert.equal(r.ok, false);
      assert.notEqual(
        r.erro.code,
        "22004",
        "não-admin não pode ver o erro do NULL",
      );
      assert.match(r.erro.message, /Não autorizado/);
    }
    r = await registrar(c, "anon", "", recebido.id, null);
    assert.equal(r.ok, false);
    assert.match(r.erro.message, /permission denied/);
    assert.deepEqual(await foto(c, recebido), antes);

    // service_role (is_admin() libera o papel): o NULL também é recusado.
    r = await registrar(c, "service_role", "", semPagamento.id, null);
    assert.equal(r.ok, false);
    assert.equal(r.erro.code, "22004");

    // Pedido inexistente + NULL: o NULL é recusado antes de procurar o pedido.
    r = await registrar(c, "authenticated", U_ADMIN, uuid("7eeeeeee", 3), null);
    assert.equal(r.ok, false);
    assert.equal(r.erro.code, "22004");

    // Entrada válida segue igual (a cobertura completa está em (9a)–(9e)).
    r = await registrar(c, "authenticated", U_ADMIN, recebido.id, false);
    assert.equal(r.ok, true, r.erro?.message);
    assert.equal(r.rows[0].r.payment_status, null);
  },
});

PROVAS.push({
  nome: "(9g) CONCORRÊNCIA: A segura a linha (registrar true, sem commit) e B chama com NULL — recusa IMEDIATA (22004), sem esperar o lock; 1 linha de histórico",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      paymentMethod: "cash",
      paymentStatus: null,
      gateway: null,
      metodoOnline: null,
    });
    const A = await novaConexao(URL_BANCO);
    const B = await novaConexao(URL_BANCO);
    let abertaA = false;
    try {
      await logar(A, U_ADMIN);
      await logar(B, U_ADMIN);
      await A.query("BEGIN");
      abertaA = true;
      await A.query("SET LOCAL ROLE authenticated");
      const ra = (
        await A.query(
          "SELECT public.registrar_pagamento_recebido($1::uuid, true) AS r",
          [p.id],
        )
      ).rows[0].r;
      assert.equal(ra.ja_estava, false);

      await B.query("BEGIN");
      await B.query("SET LOCAL ROLE authenticated");
      const rb = await Promise.race([
        B.query(
          "SELECT public.registrar_pagamento_recebido($1::uuid, NULL::boolean) AS r",
          [p.id],
        ).then(
          () => ({ ok: true }),
          (erro) => ({ ok: false, erro }),
        ),
        sleep(8000).then(() => "TRAVOU"),
      ]);
      assert.notEqual(
        rb,
        "TRAVOU",
        "B ficou ESPERANDO o lock de A: a recusa do NULL tem de vir ANTES do SELECT ... FOR UPDATE",
      );
      assert.equal(rb.ok, false);
      assert.equal(rb.erro.code, "22004");
      await B.query("ROLLBACK");

      await A.query("COMMIT");
      abertaA = false;
    } finally {
      if (abertaA) await A.query("ROLLBACK").catch(() => {});
      await B.query("ROLLBACK").catch(() => {});
      await A.end().catch(() => {});
      await B.end().catch(() => {});
    }
    const f = await foto(c, p);
    assert.equal(f.linha.payment_status, "recebido_na_entrega");
    assert.equal(f.linha.pagamento_recebido_por, U_ADMIN);
    assert.equal(
      (await historicoDoRecebimento(c, p.id)).length,
      1,
      "UMA linha de histórico (a do A)",
    );
  },
});

PROVAS.push({
  nome: "(10) bordas: pago/recusado/estornado sobre pedido já adiantado pelo lojista (processing/shipping/delivered/new); status de gateway desconhecido; 'pago' depois de 'recusado'",
  corpo: async (c) => {
    for (const statusDoPedido of [
      "processing",
      "shipping",
      "delivered",
      "new",
    ]) {
      // pago: vira 'pago', o pedido segue onde o lojista o deixou.
      const a = await novoPedido(c, {
        status: statusDoPedido,
        itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
      });
      assert.equal(
        await confirmar(c, a.id, a.gateway, "pago"),
        "pago",
        statusDoPedido,
      );
      const fa = await foto(c, a);
      assert.equal(fa.linha.payment_status, "pago");
      assert.equal(
        fa.linha.status,
        statusDoPedido,
        "pago não muda o status do pedido",
      );
      esperaDevolvido(fa, a, false, `pago/${statusDoPedido}`);

      // recusado: marca, MAS não cancela nem devolve venda que o lojista fechou.
      const b = await novoPedido(c, {
        status: statusDoPedido,
        itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
      });
      assert.equal(
        await confirmar(c, b.id, b.gateway, "recusado"),
        "recusado",
        statusDoPedido,
      );
      const fb = await foto(c, b);
      assert.equal(fb.linha.payment_status, "recusado");
      assert.equal(
        fb.linha.status,
        statusDoPedido,
        "recusado não cancela pedido adiantado",
      );
      esperaDevolvido(fb, b, false, `recusado/${statusDoPedido}`);

      // estornado: idem.
      const d = await novoPedido(c, {
        status: statusDoPedido,
        itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
      });
      assert.equal(
        await confirmar(c, d.id, d.gateway, "estornado"),
        "estornado",
        statusDoPedido,
      );
      const fd = await foto(c, d);
      assert.equal(fd.linha.payment_status, "estornado");
      assert.equal(
        fd.linha.status,
        statusDoPedido,
        "estornado não cancela pedido adiantado",
      );
      esperaDevolvido(fd, d, false, `estornado/${statusDoPedido}`);
    }

    // Status de gateway que a função não conhece: inerte (inclui NULL e os
    // 'pending'/'in_process' que o MP manda enquanto o pagamento não saiu).
    const g = await novoPedido(c, { itens: [{ qtd: 3 }] });
    const antes = await foto(c, g);
    for (const desconhecido of [
      "pending",
      "in_process",
      "approved",
      "",
      null,
    ]) {
      assert.equal(
        await confirmar(c, g.id, g.gateway, desconhecido),
        "ignorado",
        `status de gateway ${JSON.stringify(desconhecido)}`,
      );
      assert.deepEqual(await foto(c, g), antes);
    }

    // 'recusado' depois de 'pago' e 'pago' depois de 'recusado'/'estornado'
    // não ressuscitam nem desfazem nada.
    const h = await novoPedido(c, { itens: [{ qtd: 3 }] });
    assert.equal(await confirmar(c, h.id, h.gateway, "pago"), "pago");
    const pago = await foto(c, h);
    assert.equal(await confirmar(c, h.id, h.gateway, "recusado"), "ignorado");
    assert.deepEqual(await foto(c, h), pago, "recusado não desfaz pago");

    // ACHADO: o dinheiro que chega para um pedido já 'recusado' (ou
    // 'estornado') com o MESMO id de cobrança é descartado em silêncio
    // ('ignorado', sem aviso e sem 'pago_apos_expirar') e o pedido segue
    // cancelado. Hoje o MP não reabre um pagamento recusado, então não há
    // cenário conhecido — mas se algum dia houver, esse dinheiro não deixa
    // rastro nenhum no banco.
    const i = await novoPedido(c, { itens: [{ qtd: 3 }] });
    assert.equal(await confirmar(c, i.id, i.gateway, "recusado"), "recusado");
    const recusado = await foto(c, i);
    assert.equal(await confirmar(c, i.id, i.gateway, "pago"), "ignorado");
    assert.deepEqual(
      await foto(c, i),
      recusado,
      "pago depois de recusado: nada muda",
    );
    assert.deepEqual(await avisosDoPedido(c, i.id), []);

    // A1 CORRIGIDO (20261195000000): 'recusado' sobre payment_status NULL com
    // gateway_payment_id gravado e status 'pending' atravessava a guarda
    // `IF v_pedido.payment_status <> 'aguardando'` (NULL <> x é NULL) e
    // DEVOLVIA o estoque e CANCELAVA o pedido, enquanto o 'pago' do mesmo
    // pedido dava 'ignorado'. A guarda agora é `IS DISTINCT FROM
    // 'aguardando'`: NULL -> 'ignorado', linha inteira, estoque e carimbo
    // intactos. (Hoje não alcançável em produção: criar-pagamento só grava
    // cobrança em 'aguardando'.)
    const nuloRecusado = await novoPedido(c, {
      paymentStatus: null,
      metodoOnline: "pix",
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
    });
    const nuloAntes = await foto(c, nuloRecusado);
    assert.equal(nuloAntes.linha.payment_status, null);
    assert.equal(nuloAntes.linha.status, "pending");
    assert.notEqual(nuloAntes.linha.gateway_payment_id, null);
    assert.equal(
      await confirmar(c, nuloRecusado.id, nuloRecusado.gateway, "recusado"),
      "ignorado",
    );
    assert.deepEqual(
      await foto(c, nuloRecusado),
      nuloAntes,
      "NULL + recusado: nada muda (linha inteira)",
    );
    esperaDevolvido(
      await foto(c, nuloRecusado),
      nuloRecusado,
      false,
      "NULL + recusado não devolve estoque",
    );

    const nuloPago = await novoPedido(c, {
      paymentStatus: null,
      metodoOnline: "pix",
      itens: [{ qtd: 3 }],
    });
    const nuloPagoAntes = await foto(c, nuloPago);
    assert.equal(
      await confirmar(c, nuloPago.id, nuloPago.gateway, "pago"),
      "ignorado",
    );
    assert.deepEqual(
      await foto(c, nuloPago),
      nuloPagoAntes,
      "NULL + pago: nada muda",
    );
  },
});

PROVAS.push({
  nome: "(11) CONCORRÊNCIA: dois registrar_pagamento_recebido ao mesmo tempo gravam UMA linha de histórico (o 2o espera o lock e vê 'ja_estava')",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      paymentMethod: "cash",
      paymentStatus: null,
      gateway: null,
      metodoOnline: null,
    });
    // A e B como admin (o GUC de sessão é por conexão): A segura, B espera.
    const A = await novaConexao(URL_BANCO);
    const B = await novaConexao(URL_BANCO);
    let abertaA = false;
    try {
      await logar(A, U_ADMIN);
      await logar(B, U_ADMIN);
      const pidB = (await B.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      const sql =
        "SELECT public.registrar_pagamento_recebido($1::uuid, true) AS r";

      await A.query("BEGIN");
      abertaA = true;
      await A.query("SET LOCAL ROLE authenticated");
      const ra = (await A.query(sql, [p.id])).rows[0].r;
      assert.equal(ra.ja_estava, false);

      await B.query("BEGIN");
      await B.query("SET LOCAL ROLE authenticated");
      let terminouB = false;
      const promessaB = B.query(sql, [p.id]).then(
        (r) => {
          terminouB = true;
          return r.rows[0].r;
        },
        (erro) => {
          terminouB = true;
          throw erro;
        },
      );
      assert.equal(
        await esperarBloqueio(c, pidB),
        true,
        "B tinha de estar esperando o lock",
      );
      assert.equal(terminouB, false);
      await A.query("COMMIT");
      abertaA = false;
      const rb = await promessaB;
      await B.query("COMMIT");
      assert.equal(
        rb.ja_estava,
        true,
        "B vê o recebimento que A acabou de gravar",
      );

      const f = await foto(c, p);
      assert.equal(f.linha.payment_status, "recebido_na_entrega");
      assert.equal(
        (await historicoDoRecebimento(c, p.id)).length,
        1,
        "UMA linha de histórico",
      );
    } finally {
      if (abertaA) await A.query("ROLLBACK").catch(() => {});
      await B.query("ROLLBACK").catch(() => {});
      await A.end().catch(() => {});
      await B.end().catch(() => {});
    }
  },
});

// ---------------------------------------------------------------------------
// (12) preflight e rollback-manual da 20261195000000, aplicados de VERDADE
// ---------------------------------------------------------------------------

const NOME_1194 = "20261195000000_recusado_e_recebido_recusam_nulo.sql";
const NOME_901 = "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql";
const NOME_1020 = "20261020000000_lojista_registra_pagamento_recebido.sql";
// A 20261197000000 redefine registrar_pagamento_recebido DEPOIS da 95 (guarda
// do admin ATUAL) — ver a composição no começo da seção (12).
const NOME_1197 = "20261197000000_dinheiro_exige_admin_atual.sql";
// A 20261198000000 redefine admin_devolucao_reemitir_reembolso DEPOIS da 97
// (ordem global de travas); com ela no ar, o rollback-manual da 97 recusa
// (B1_BASELINE_DIVERGENT — correto: nunca restaurar por baixo de uma
// redefinição posterior). Para desfazer a 97 dentro da transação, desfaz-se
// antes a 98, na ordem inversa da aplicação (98 → 97).

// As migrations POSTERIORES à 97 que dependem de `is_admin_atual()` /
// `rls_admin_atual()` (20261202, 20261200, 20261199 e, se presente, 20261198)
// bloqueiam o rollback da 97 (o preflight dele recusa: apagar as funções
// deixaria o painel chamando função inexistente — o comportamento CERTO).
// Como estas seções medem a 95 ISOLADA, as posteriores são desfeitas primeiro,
// DENTRO da transação, na ordem inversa da aplicação; o ROLLBACK do fim
// devolve tudo. Cada uma só é desfeita se estiver no ar.
const POSTERIORES_A_97 = [
  // As sucessoras da 99 (20261212, 20261214 — redefinem corpos dela;
  // tests/banco/sucessoras-da-99.cjs), na ordem inversa da aplicação: com
  // qualquer uma no ar, o rollback da 99 abaixo recusa. "No ar" = o corpo vivo
  // é exatamente o que ela deixa.
  ...[...SUCESSORAS_DA_99].reverse().map(({ nome, noAr }) => ({ nome, noAr })),
  {
    nome: "20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql",
    noAr: `SELECT to_regprocedure('public.anular_venda_presencial(uuid,text)') IS NOT NULL AS sim`,
  },
  {
    nome: "20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql",
    noAr: `SELECT EXISTS (
       SELECT 1 FROM pg_policy
        WHERE polname = 'fin_lancamentos_admin_select_policy'
          AND polrelid = to_regclass('public.fin_lancamentos')
          AND pg_get_expr(polqual, polrelid) LIKE '%rls_admin_atual%') AS sim`,
  },
  {
    nome: "20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql",
    noAr: `SELECT prosrc LIKE '%is_admin_atual%' AS sim FROM pg_proc
            WHERE oid = to_regprocedure('public.admin_devolucao_decidir(uuid,boolean,text,timestamptz)')`,
  },
  {
    nome: "20261199000000_portas_do_painel_exigem_admin_atual.sql",
    noAr: `SELECT prosrc LIKE '%is_admin_atual%' AS sim FROM pg_proc
            WHERE oid = to_regprocedure('public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)')`,
  },
  {
    nome: "20261198000000_cancelar_pedido_anula_a_cobranca.sql",
    noAr: `SELECT to_regprocedure('public.cancelar_pedido_com_cobranca(uuid,uuid,text,text,text)') IS NOT NULL AS sim`,
  },
  // 20261208000000: o checkout mostra os cupons da cliente. As funcoes do painel
  // (admin_cupom_clientes, admin_cupom_definir_clientes) e a politica de cupom_clientes
  // usam is_admin_atual()/rls_admin_atual(): sem esta entrada o rollback da 97 recusa
  // (B1_BASELINE_DIVERGENT). No FIM da lista de proposito.
  {
    nome: "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql",
    noAr: `SELECT to_regprocedure('public.admin_cupom_clientes(uuid)') IS NOT NULL AS sim`,
  },
];

async function desfazerPosterioresNaTransacao(c) {
  for (const { nome, noAr } of POSTERIORES_A_97) {
    const caminho = path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      `rollback-manual-${nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
    if (!fs.existsSync(caminho)) continue;
    const r = await c.query(noAr);
    if (!r.rows[0] || r.rows[0].sim !== true) continue;
    await c.query(lerMigracao(`rollback-manual-${nome}`));
  }
}

async function a97EstaNoAr(c) {
  const r = await c.query(
    "SELECT to_regprocedure('public.is_admin_atual()') IS NOT NULL AS sim",
  );
  return r.rows[0].sim;
}

// Desfaz a 97 SÓ na transação aberta — antes, a 98. A 98 é AFIRMADA pelo
// hash do reemitir que ela deixa (nenhum "pula se não estiver no ar"): sem
// ela, a prova falha aqui.
async function desfazer97NaTransacao(c) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc
      WHERE oid = to_regprocedure('public.admin_devolucao_reemitir_reembolso(uuid,boolean)')`,
  );
  assert.equal(
    r.rows[0]?.h,
    "422cfaa8c53cefc1913b9e082442631d",
    "a 98 tem de estar no ar (pelo hash do reemitir que ela deixa)",
  );
  // Na ordem inversa da aplicação: 202, 200, 99 e 98 (os dependentes da 97;
  // com qualquer um no ar o rollback da 97 recusa), e só então a 97.
  await desfazerPosterioresNaTransacao(c);
  await c.query(lerMigracao(`rollback-manual-${NOME_1197}`));
}

function lerMigracao(nome) {
  const caminho = path.join(
    __dirname,
    "..",
    "..",
    "supabase",
    "migrations",
    nome,
  );
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `nome` é uma das constantes literais NOME_* deste arquivo (ou "rollback-manual-" + uma delas), nunca entrada de fora.
  return fs.readFileSync(caminho, "utf8").replace(/\r\n/g, "\n");
}

const md5 = (texto) => createHash("md5").update(texto).digest("hex");

function corpoConfirmarDe(sql) {
  return sql.match(
    /CREATE OR REPLACE FUNCTION public\.confirmar_pagamento\([\s\S]*?AS \$confirmar\$([\s\S]*?)\$confirmar\$;/,
  )[1];
}
function corpoRegistrarDe(sql) {
  return sql.match(
    /CREATE OR REPLACE FUNCTION public\.registrar_pagamento_recebido\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/,
  )[1];
}

async function hashesVivos(c) {
  const consulta = `SELECT md5(replace(prosrc, E'\\r', '')) AS h
       FROM pg_proc
      WHERE oid = to_regprocedure($1::text)`;
  const r1 = await c.query(consulta, [
    "public.confirmar_pagamento(uuid,text,text)",
  ]);
  const r2 = await c.query(consulta, [
    "public.registrar_pagamento_recebido(uuid,boolean)",
  ]);
  return { confirmar: r1.rows[0].h, registrar: r2.rows[0].h };
}

PROVAS.push({
  nome: "(12) a 20261195000000: o banco tem o corpo do ARQUIVO; reaplicar passa; corpo divergente de cada função recusa B1_BASELINE_DIVERGENT; o rollback-manual devolve o corpo e o comportamento ANTIGOS — tudo desfeito no ROLLBACK",
  corpo: async (c) => {
    const sqlMigracao = lerMigracao(NOME_1194);
    const sqlRollback = lerMigracao(`rollback-manual-${NOME_1194}`);
    const novos = {
      confirmar: md5(corpoConfirmarDe(sqlMigracao)),
      registrar: md5(corpoRegistrarDe(sqlMigracao)),
    };
    const antigos = {
      confirmar: md5(corpoConfirmarDe(lerMigracao(NOME_901))),
      registrar: md5(corpoRegistrarDe(lerMigracao(NOME_1020))),
    };
    assert.notEqual(novos.confirmar, antigos.confirmar);
    assert.notEqual(novos.registrar, antigos.registrar);

    // COMPOSIÇÃO com a 20261197000000 (guarda do admin ATUAL), que redefine
    // registrar_pagamento_recebido DEPOIS desta: com ela no ar, o corpo vivo
    // é o dela, e reaplicar a 95 por cima é recusado pelo preflight da 95 —
    // o comportamento CORRETO (a 95 nunca rebaixa a 97). Esta seção prova a
    // 95 ISOLADA: dentro da transação, o rollback-manual da 97 devolve o
    // estado "95 sem 97"; o ROLLBACK do fim devolve a 97 intacta (conferido
    // depois do finally).
    const com97 = await a97EstaNoAr(c);
    const vivoAntes = await hashesVivos(c);
    if (!com97) {
      // O que está vivo é o que o arquivo deixa (cadeia do zero OU upgrade).
      assert.deepEqual(vivoAntes, novos);
    } else {
      assert.equal(
        vivoAntes.confirmar,
        novos.confirmar,
        "a 97 não toca confirmar_pagamento",
      );
      assert.notEqual(
        vivoAntes.registrar,
        novos.registrar,
        "com a 97 no ar o corpo vivo é o dela",
      );
    }

    const idsDeFixture = [];
    await c.query("BEGIN");
    try {
      if (com97) {
        // Com a 97 no ar, reaplicar a 95 por cima RECUSA, sem gravar nada.
        await c.query("SAVEPOINT sobre_a_97");
        await assert.rejects(
          () => c.query(sqlMigracao),
          /B1_BASELINE_DIVERGENT: corpo vivo de registrar_pagamento_recebido/,
          "a 95 não pode rebaixar a 97",
        );
        await c.query("ROLLBACK TO SAVEPOINT sobre_a_97");
        assert.deepEqual(await hashesVivos(c), vivoAntes);
        // Daqui em diante: a 95 isolada (a 97 desfeita SÓ nesta transação).
        await desfazer97NaTransacao(c);
        assert.deepEqual(
          await hashesVivos(c),
          novos,
          "sem a 97, o corpo vivo é o da 95",
        );
      }

      // 1. Reaplicar o ARQUIVO sobre o corpo novo: passa e não muda nada.
      await c.query(sqlMigracao);
      assert.deepEqual(await hashesVivos(c), novos, "reaplicar é idempotente");

      // 2. Corpo DIVERGENTE de cada função: recusa B1_BASELINE_DIVERGENT, e o
      // corpo divergente continua vivo (o CREATE não avançou por cima dele).
      const divergentes = [
        [
          "confirmar_pagamento",
          (h) => h.confirmar,
          novos.confirmar,
          `CREATE OR REPLACE FUNCTION public.confirmar_pagamento(p_order_id uuid, p_payment_id text, p_status text)
           RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
           AS $d$ BEGIN RETURN 'divergente-de-prova'; END; $d$`,
          /B1_BASELINE_DIVERGENT: corpo vivo de confirmar_pagamento/,
        ],
        [
          "registrar_pagamento_recebido",
          (h) => h.registrar,
          novos.registrar,
          `CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(p_order_id uuid, p_recebido boolean)
           RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
           AS $d$ BEGIN RETURN '{}'::jsonb; END; $d$`,
          /B1_BASELINE_DIVERGENT: corpo vivo de registrar_pagamento_recebido/,
        ],
      ];
      for (const [rotulo, hashDe, novo, ddl, regex] of divergentes) {
        await c.query("SAVEPOINT limpo");
        await c.query(ddl);
        const divergente = hashDe(await hashesVivos(c));
        assert.notEqual(divergente, novo, rotulo);
        await c.query("SAVEPOINT antes_da_migracao");
        await assert.rejects(() => c.query(sqlMigracao), regex, rotulo);
        await c.query("ROLLBACK TO SAVEPOINT antes_da_migracao");
        assert.equal(
          hashDe(await hashesVivos(c)),
          divergente,
          `${rotulo}: o corpo divergente segue vivo (nada gravado)`,
        );
        await c.query("ROLLBACK TO SAVEPOINT limpo");
      }
      assert.deepEqual(await hashesVivos(c), novos);

      // 3. O rollback-manual devolve os corpos ANTIGOS, byte a byte...
      await c.query(sqlRollback);
      assert.deepEqual(
        await hashesVivos(c),
        antigos,
        "rollback = corpo vigente antigo",
      );

      // ... e o comportamento ANTIGO: NULL em 'recusado' devolve estoque e
      // cancela; NULL em registrar_pagamento_recebido desfaz o recebimento.
      const nulo = await novoPedido(c, {
        paymentStatus: null,
        metodoOnline: "pix",
        itens: [{ qtd: 3 }],
      });
      idsDeFixture.push(nulo.id);
      const rc = await c.query(
        "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'recusado') AS r",
        [nulo.id, nulo.gateway],
      );
      assert.equal(rc.rows[0].r, "recusado", "comportamento antigo (A1)");
      const depoisAntigo = await foto(c, nulo);
      assert.equal(depoisAntigo.linha.status, "cancelled");
      esperaDevolvido(
        depoisAntigo,
        nulo,
        true,
        "antigo: NULL + recusado devolvia",
      );

      const recebido = await novoPedido(c, {
        paymentMethod: "cash",
        paymentStatus: "recebido_na_entrega",
        gateway: null,
        metodoOnline: null,
      });
      idsDeFixture.push(recebido.id);
      await logar(c, U_ADMIN);
      const rr = await c.query(
        "SELECT public.registrar_pagamento_recebido($1::uuid, NULL::boolean) AS r",
        [recebido.id],
      );
      assert.equal(
        rr.rows[0].r.payment_status,
        null,
        "comportamento antigo (A3)",
      );

      // 4. E reaplicar a migration sobre os corpos ANTIGOS (o caminho de
      // upgrade) deixa os corpos novos.
      await c.query(sqlMigracao);
      assert.deepEqual(
        await hashesVivos(c),
        novos,
        "upgrade a partir do vigente antigo",
      );
    } finally {
      await c.query("ROLLBACK");
      await logar(c, "");
    }

    // Tudo desfeito: o corpo vivo de ANTES da seção de volta (o da 97, se
    // ela estava no ar) e as fixtures do teste não ficaram.
    assert.deepEqual(await hashesVivos(c), vivoAntes);
    assert.equal(await a97EstaNoAr(c), com97, "a 97 voltou intacta");
    const sobras = await c.query(
      "SELECT count(*)::int AS n FROM public.marketplace_orders WHERE id = ANY($1::uuid[])",
      [idsDeFixture],
    );
    assert.equal(sobras.rows[0].n, 0);
  },
});

PROVAS.push({
  nome: "(14) CONCORRÊNCIA da confirmação imediata: dois 'pago' simultâneos (consulta do cliente ∥ webhook) — um 'pago', o outro ESPERA o lock e vê 'ja_pago'; paid_at uma vez, UM aviso",
  corpo: async (c) => {
    const p = await novoPedido(c, {
      itens: [{ qtd: 3 }, { qtd: 2, variante: true }],
      metodoOnline: "credito",
    });
    const sql =
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago') AS r";
    const params = [p.id, p.gateway];

    const r = await corrida(c, URL_BANCO, {
      sqlA: sql,
      paramsA: params,
      sqlB: sql,
      paramsB: params,
      papelB: "service_role",
    });

    assert.equal(r.resultadoA, "pago");
    assert.equal(
      r.esperou,
      true,
      "B tinha de ESPERAR o FOR UPDATE de A — sem espera, os dois leriam 'aguardando'",
    );
    assert.equal(
      r.terminouAntes,
      false,
      "B não pode terminar antes do COMMIT de A",
    );
    assert.deepEqual(r.resultadoB, { ok: true, valor: "ja_pago" });

    const depois = await foto(c, p);
    assert.equal(depois.linha.payment_status, "pago");
    assert.notEqual(depois.linha.paid_at, null);
    esperaDevolvido(depois, p, false, "pago não mexe no estoque");
    assert.deepEqual(
      await avisosDoPedido(c, p.id),
      [AVISO_PAGO],
      "um aviso só ao cliente, não um por porta",
    );

    // A terceira porta (a reconciliação, ou a reentrega do webhook) não
    // reescreve nada: paid_at e updated_at ficam os da transição ÚNICA.
    assert.equal(await confirmar(c, p.id, p.gateway, "pago"), "ja_pago");
    assert.deepEqual(
      await foto(c, p),
      depois,
      "nenhuma coluna muda depois da transição",
    );
    assert.deepEqual(await avisosDoPedido(c, p.id), [AVISO_PAGO]);
  },
});

// ---------------------------------------------------------------------------
// (13) o PREFLIGHT do rollback-manual: não sobrescreve redefinição posterior
// ---------------------------------------------------------------------------

/**
 * Perfil das DUAS funções, na ordem (confirmar_pagamento, registrar_pagamento_
 * recebido): md5 normalizado (CRLF fora), md5 cru, ACL, SECURITY DEFINER e
 * search_path (proconfig).
 */
async function perfilDasFuncoes(c) {
  const r = await c.query(
    `SELECT p.proname,
            md5(replace(p.prosrc, E'\\r', '')) AS md5,
            md5(p.prosrc) AS md5_cru,
            p.proacl::text AS acl,
            p.prosecdef,
            p.proconfig::text AS config
       FROM pg_proc p
      WHERE p.oid = ANY (ARRAY[
              to_regprocedure('public.confirmar_pagamento(uuid,text,text)'),
              to_regprocedure('public.registrar_pagamento_recebido(uuid,boolean)')
            ])
      ORDER BY p.proname`,
  );
  assert.equal(r.rows.length, 2, "as duas funções existem");
  return r.rows;
}

/**
 * Divide um arquivo .sql em comandos (fim em `;` fora de comentário `--`,
 * de string '...' e de dollar-quote `$tag$...$tag$`). Serve para executar o
 * rollback COMANDO A COMANDO, como `psql -v ON_ERROR_STOP=1 -f` sem `-1`: aí
 * cada comando é a sua própria transação e o psql PARA no primeiro erro, e um
 * preflight que não seja o PRIMEIRO comando deixa o que veio antes dele gravado
 * quando recusa. Sem ON_ERROR_STOP o psql continua depois do erro e os CREATE
 * rodam mesmo assim — por isso o cabeçalho do rollback manda `-1` e
 * ON_ERROR_STOP=1 (revisão de 8565ee8c).
 */
function dividirEmComandos(sql) {
  const comandos = [];
  let inicio = 0;
  let i = 0;
  let temCodigo = false;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (sql.startsWith("--", i)) {
      const fim = sql.indexOf("\n", i);
      i = fim < 0 ? sql.length : fim + 1;
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql.charAt(i) === "'") {
          if (sql.charAt(i + 1) === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i += 1;
      }
      i += 1;
      temCodigo = true;
      continue;
    }
    if (ch === "$") {
      const m = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const fim = sql.indexOf(m[0], i + m[0].length);
        assert.ok(fim >= 0, "dollar-quote sem fechamento");
        i = fim + m[0].length;
        temCodigo = true;
        continue;
      }
    }
    if (ch === ";") {
      comandos.push(sql.slice(inicio, i + 1));
      inicio = i + 1;
      temCodigo = false;
      i += 1;
      continue;
    }
    if (!/\s/.test(ch)) temCodigo = true;
    i += 1;
  }
  if (temCodigo) comandos.push(sql.slice(inicio));
  return comandos;
}

/**
 * Roda `sql` comando a comando, cada um no seu SAVEPOINT, parando no 1º erro
 * (o modo `psql -v ON_ERROR_STOP=1 -f` sem `-1`). Devolve o erro, ou null.
 * Precisa de transação aberta.
 */
async function rodarComandoAComando(c, sql) {
  for (const comando of dividirEmComandos(sql)) {
    await c.query("SAVEPOINT comando");
    try {
      await c.query(comando);
      await c.query("RELEASE SAVEPOINT comando");
    } catch (erro) {
      await c.query("ROLLBACK TO SAVEPOINT comando");
      return erro;
    }
  }
  return null;
}

const resumoDoPerfil = (rows) =>
  rows
    .map(
      (x) =>
        `${x.proname}=${x.md5.slice(0, 8)} acl=${x.acl} secdef=${x.prosecdef} cfg=${x.config}`,
    )
    .join(" | ");

PROVAS.push({
  nome: "(13) o rollback-manual da 20261195000000 tem preflight: restaura os originais, é idempotente, e RECUSA (sem gravar nada em NENHUMA função) sobre redefinição posterior, aceitando CRLF",
  corpo: async (c) => {
    const sqlRollback = lerMigracao(`rollback-manual-${NOME_1194}`);
    const sqlMigracao = lerMigracao(NOME_1194);
    const novos = {
      confirmar: md5(corpoConfirmarDe(sqlMigracao)),
      registrar: md5(corpoRegistrarDe(sqlMigracao)),
    };
    const antigos = {
      confirmar: md5(corpoConfirmarDe(lerMigracao(NOME_901))),
      registrar: md5(corpoRegistrarDe(lerMigracao(NOME_1020))),
    };
    const hashesDe = (rows) => ({
      confirmar: rows[0].md5,
      registrar: rows[1].md5,
    });
    // Tudo que muda a assinatura de segurança das funções (ACL, SECURITY
    // DEFINER, search_path) tem de ficar igual em todos os passos.
    const seguranca = (rows) =>
      rows.map((x) => [x.proname, x.acl, x.prosecdef, x.config]);
    const passo = (rotulo, rows) =>
      console.log(`    [13 ${rotulo}] ${resumoDoPerfil(rows)}`);

    // O estado VIVO de antes da seção: pós-20261195, ou pós-20261197 quando a
    // 97 (guarda do admin ATUAL) está no ar — ela redefine SÓ
    // registrar_pagamento_recebido. É este perfil (hash, ACL, secdef, config)
    // que tem de estar de volta depois do ROLLBACK do fim.
    const com97 = await a97EstaNoAr(c);
    const vivoInicial = await perfilDasFuncoes(c);
    passo(
      com97 ? "estado vivo pós-20261197" : "estado pós-20261195",
      vivoInicial,
    );
    assert.equal(
      vivoInicial[0].md5,
      novos.confirmar,
      "confirmar_pagamento é o da 95 (a 97 não a toca)",
    );
    if (com97) {
      assert.notEqual(
        vivoInicial[1].md5,
        novos.registrar,
        "com a 97 no ar o corpo vivo de registrar_pagamento_recebido é o dela",
      );
    } else {
      assert.deepEqual(hashesDe(vivoInicial), novos);
    }

    // Fixture de uma redefinição POSTERIOR genérica: o corpo pós-20261195 com
    // UM comentário a mais — inócuo no comportamento, mas hash diferente. A
    // redefinição posterior REAL (a 97) é o caso (e), quando está no ar.
    const divergirComComentario = async (assinatura) => {
      const def = (
        await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
          assinatura,
        ])
      ).rows[0].d;
      const comComentario = def.replace(
        /\$function\$\s*$/,
        "-- fixture: redefinição posterior simulada\n$function$",
      );
      assert.notEqual(comComentario, def, "o comentário entrou no corpo");
      await c.query(comComentario);
    };

    await c.query("BEGIN");
    try {
      if (com97) {
        // (e) Redefinição posterior REAL: com a 97 no ar, o rollback da 95
        // RECUSA nomeando só registrar_pagamento_recebido, e NADA muda em
        // nenhuma das duas funções (hash, ACL, SECURITY DEFINER, config) —
        // nem de uma vez, nem comando a comando. "De uma vez" prova a recusa
        // e a mensagem (o que nada grava ali é a transação, como no psql -1);
        // quem prova que a guarda vem ANTES de qualquer CREATE é só o modo
        // comando a comando — não o remova achando que é redundante.
        await c.query("SAVEPOINT sobre_a_97");
        await assert.rejects(
          () => c.query(sqlRollback),
          (erro) => {
            assert.match(erro.message, /B1_BASELINE_DIVERGENT/);
            assert.match(
              erro.message,
              /registrar_pagamento_recebido \(hash [0-9a-f]{32}\)/,
            );
            assert.doesNotMatch(erro.message, /confirmar_pagamento \(hash/);
            return true;
          },
          "(e) o rollback da 95 não pode apagar a 97",
        );
        await c.query("ROLLBACK TO SAVEPOINT sobre_a_97");
        const depoisE = await perfilDasFuncoes(c);
        passo("e: 97 no ar, depois da recusa", depoisE);
        assert.deepEqual(depoisE, vivoInicial, "(e) NENHUMA função foi tocada");
        const recusouE = await rodarComandoAComando(c, sqlRollback);
        assert.ok(
          recusouE && /B1_BASELINE_DIVERGENT/.test(recusouE.message),
          "(e) comando a comando, o preflight recusa antes de qualquer CREATE",
        );
        assert.deepEqual(
          await perfilDasFuncoes(c),
          vivoInicial,
          "(e) comando a comando, nada gravado",
        );
        // Daqui em diante, a 95 ISOLADA: a 97 desfeita SÓ nesta transação (o
        // ROLLBACK do fim a devolve — conferido depois do finally).
        await desfazer97NaTransacao(c);
      }

      const posMigration = await perfilDasFuncoes(c);
      passo("estado pós-20261195", posMigration);
      assert.deepEqual(hashesDe(posMigration), novos);
      const segurancaInicial = seguranca(posMigration);

      // (a) Estado pós-20261195: o rollback passa e restaura os ORIGINAIS.
      await c.query("SAVEPOINT pos_migration");
      await c.query(sqlRollback);
      const depoisA = await perfilDasFuncoes(c);
      passo("a: depois do rollback", depoisA);
      assert.deepEqual(hashesDe(depoisA), antigos, "(a) corpos originais");
      assert.deepEqual(
        seguranca(depoisA),
        segurancaInicial,
        "(a) ACL/secdef/config iguais",
      );

      // (b) Aplicar de novo sobre os originais: passa (idempotente consciente)
      // e nada muda.
      await c.query(sqlRollback);
      const depoisB = await perfilDasFuncoes(c);
      passo("b: rollback de novo", depoisB);
      assert.deepEqual(depoisB, depoisA, "(b) idempotente");
      await c.query("ROLLBACK TO SAVEPOINT pos_migration");
      assert.deepEqual(await perfilDasFuncoes(c), posMigration);

      // (c) Redefinição posterior (FIXTURE) em UMA das funções: o rollback
      // RECUSA e AMBAS ficam exatamente como estavam — inclusive a que NÃO
      // divergiu, o que prova que a guarda vem antes de QUALQUER CREATE.
      const casos = [
        [
          "registrar divergente",
          ["public.registrar_pagamento_recebido(uuid,boolean)"],
          /registrar_pagamento_recebido \(hash [0-9a-f]{32}\)/,
          /confirmar_pagamento \(hash/,
        ],
        [
          "confirmar divergente",
          ["public.confirmar_pagamento(uuid,text,text)"],
          /confirmar_pagamento \(hash [0-9a-f]{32}\)/,
          /registrar_pagamento_recebido \(hash/,
        ],
        [
          "as duas divergentes",
          [
            "public.confirmar_pagamento(uuid,text,text)",
            "public.registrar_pagamento_recebido(uuid,boolean)",
          ],
          /confirmar_pagamento \(hash [0-9a-f]{32}\)/,
          null,
        ],
      ];
      for (const [rotulo, assinaturas, deveNomear, naoDeveNomear] of casos) {
        await c.query("SAVEPOINT caso_c");
        for (const assinatura of assinaturas) {
          await divergirComComentario(assinatura);
        }
        const antes = await perfilDasFuncoes(c);
        passo(`c: ${rotulo} (antes)`, antes);
        for (const assinatura of assinaturas) {
          const ehConfirmar = assinatura.includes("confirmar");
          assert.notEqual(
            antes[ehConfirmar ? 0 : 1].md5,
            ehConfirmar ? novos.confirmar : novos.registrar,
            `${rotulo}: a fixture divergiu o corpo de ${assinatura}`,
          );
        }
        await c.query("SAVEPOINT antes_do_rollback");
        await assert.rejects(
          () => c.query(sqlRollback),
          (erro) => {
            assert.match(erro.message, /B1_BASELINE_DIVERGENT/);
            assert.match(
              erro.message,
              deveNomear,
              `${rotulo}: nomeia a função`,
            );
            if (naoDeveNomear) {
              assert.doesNotMatch(
                erro.message,
                naoDeveNomear,
                `${rotulo}: não acusa a função que está íntegra`,
              );
            }
            if (assinaturas.length === 2) {
              assert.match(erro.message, /registrar_pagamento_recebido \(hash/);
            }
            return true;
          },
          rotulo,
        );
        await c.query("ROLLBACK TO SAVEPOINT antes_do_rollback");
        const depois = await perfilDasFuncoes(c);
        passo(`c: ${rotulo} (depois da recusa)`, depois);
        assert.deepEqual(depois, antes, `${rotulo}: NENHUMA função foi tocada`);

        // Comando a comando (psql -v ON_ERROR_STOP=1 -f SEM -1: cada comando a
        // sua transação, parando no 1º erro): o preflight é o PRIMEIRO
        // comando, então a recusa para tudo antes de qualquer CREATE — nenhuma
        // função muda, nem a que estava íntegra. Sem ON_ERROR_STOP isso NÃO
        // vale (o psql seguiria para os CREATE); o modo seguro é o do cabeçalho.
        const comandos = dividirEmComandos(sqlRollback);
        assert.equal(comandos.length, 3, "preflight + 2 CREATE");
        assert.match(
          comandos[0]
            .split("\n")
            .filter((linha) => !linha.trimStart().startsWith("--"))
            .join("\n")
            .trim(),
          /^DO \$preflight_rollback_20261195\$/,
          "o preflight é o primeiro comando do arquivo",
        );
        const recusou = await rodarComandoAComando(c, sqlRollback);
        assert.ok(
          recusou && /B1_BASELINE_DIVERGENT/.test(recusou.message),
          `${rotulo}: o preflight tinha de recusar no modo comando a comando`,
        );
        assert.deepEqual(
          await perfilDasFuncoes(c),
          antes,
          `${rotulo}: comando a comando, nada gravado antes da recusa`,
        );
        await c.query("ROLLBACK TO SAVEPOINT caso_c");
      }
      assert.deepEqual(await perfilDasFuncoes(c), posMigration);

      // Função AUSENTE também recusa (e não grava nada na outra).
      await c.query("SAVEPOINT caso_ausente");
      await c.query(
        "DROP FUNCTION public.registrar_pagamento_recebido(uuid, boolean)",
      );
      await c.query("SAVEPOINT antes_do_rollback_ausente");
      await assert.rejects(
        () => c.query(sqlRollback),
        /B1_BASELINE_DIVERGENT[\s\S]*registrar_pagamento_recebido \(hash ausente\)/,
      );
      await c.query("ROLLBACK TO SAVEPOINT antes_do_rollback_ausente");
      const confirmarIntacta = await c.query(
        `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc
          WHERE oid = to_regprocedure('public.confirmar_pagamento(uuid,text,text)')`,
      );
      assert.equal(
        confirmarIntacta.rows[0].h,
        novos.confirmar,
        "confirmar_pagamento intacta quando a outra sumiu",
      );
      await c.query("ROLLBACK TO SAVEPOINT caso_ausente");
      assert.deepEqual(await perfilDasFuncoes(c), posMigration);

      // (d) Corpos pós-20261195 gravados com CRLF: o preflight normaliza e o
      // rollback ACEITA. Prova de que o CRLF está lá: o md5 CRU difere.
      await c.query("SAVEPOINT caso_d");
      for (const assinatura of [
        "public.confirmar_pagamento(uuid,text,text)",
        "public.registrar_pagamento_recebido(uuid,boolean)",
      ]) {
        const def = (
          await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
            assinatura,
          ])
        ).rows[0].d;
        await c.query(def.replace(/\r?\n/g, "\r\n"));
      }
      const comCrlf = await perfilDasFuncoes(c);
      passo("d: pós-migration com CRLF", comCrlf);
      assert.deepEqual(hashesDe(comCrlf), novos, "normalizado = pós-migration");
      for (const x of comCrlf) {
        assert.notEqual(
          x.md5_cru,
          x.md5,
          `${x.proname}: o corpo vivo tem CRLF de verdade`,
        );
      }
      await c.query(sqlRollback);
      const depoisD = await perfilDasFuncoes(c);
      passo("d: depois do rollback", depoisD);
      assert.deepEqual(hashesDe(depoisD), antigos, "(d) restaura os originais");
      assert.deepEqual(seguranca(depoisD), segurancaInicial);
      await c.query("ROLLBACK TO SAVEPOINT caso_d");
    } finally {
      await c.query("ROLLBACK");
    }

    // Tudo desfeito: o banco voltou ao estado VIVO de antes da seção (o da 97,
    // se ela estava no ar), ACL, SECURITY DEFINER e config incluídos.
    assert.deepEqual(await perfilDasFuncoes(c), vivoInicial);
    assert.equal(await a97EstaNoAr(c), com97, "a 97 voltou intacta");
  },
});

// ---------------------------------------------------------------------------

async function main() {
  const url = lerDatabaseUrlEfemera();
  URL_BANCO = url;
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva dos pagamentos (rpc-ci)",
          linhas.join("\n"),
        );
        await cliente.end().catch(() => {});
        falhar(
          "FALHOU",
          "Uma regra de confirmar_pagamento ou registrar_pagamento_recebido foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[pagamentos] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva dos pagamentos (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main().catch((erro) => falhar("INDETERMINADO", erro.stack || erro.message));
