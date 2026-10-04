"use strict";

/**
 * PROVA VIVA da migration 20261198000000_cancelar_pedido_anula_a_cobranca.sql
 * (dinheiro, 04/10/2026 — S1 + R11 + estoque do entregue) contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero.
 *
 *   (a) BYPASS fechado: `update_order_status_atomic` recusa 'cancelled' de
 *       pedido aguardando com a vaga ocupada (PIX, cartão, sentinela) — para
 *       o CLIENTE e para o ADMIN; pedido sem vaga, pedido não online e pedido
 *       PAGO continuam cancelando como antes. A recusa sai com P0001 e com a
 *       frase "não pode ser cancelado" (a fila offline do painel a descarta).
 *   (b) `cancelar_pedido_com_cobranca` (a porta da edge): só service role;
 *       CAS na vaga E no payment_status (mudou → não cancela, devolve o
 *       pedido relido); dono ou admin ATUAL (auth.users E profiles) — admin
 *       só no app_metadata não passa; cliente nunca sobre o sentinela; admin
 *       sobre sentinela recente (< 2 min) recebe `cobranca_em_criacao`;
 *       já cancelado devolve `ja_estava`; estoque volta UMA vez; histórico
 *       grava o ator.
 *   (c) R11 — cancelar pedido pago com estornos devolve o REMANESCENTE:
 *       pago 100, 30 confirmado, 0 reservado → 70; 30 confirmado + 20
 *       reservado → 50; 100 confirmado → nenhuma linha. Pelas DUAS portas.
 *   (d) entregue → cancelado não devolve estoque; a venda de BALCÃO (canal
 *       presencial, nasce 'delivered') continua devolvendo, como sempre.
 *   (e) CORRIDA real com duas conexões: cancelar × confirmar_pagamento('pago')
 *       nas duas ordens — termina cancelado+pago_apos_expirar (estoque 1x) ou
 *       pending+pago (estoque intacto). Nunca cancelado+pago, nunca 2x.
 *   (f) rollback-manual restaura o corpo da 20261180000000 BYTE A BYTE e
 *       apaga as três funções; reaplicar a migration é idempotente; preflight
 *       recusa corpo divergente (B1_BASELINE_DIVERGENT); a guarda do rollback
 *       recusa corpo de migration posterior.
 *   (g) CONTROLE: a mesma asserção do bypass, contra o corpo ANTIGO (80),
 *       NÃO vê recusa — o teste (a) distingue o defeito do conserto.
 *   (h) ADMIN ATUAL na porta do front: JWT velho de admin com o papel atual
 *       rebaixado (nas DUAS direções: auth.users rebaixado e perfil admin;
 *       auth.users admin e perfil rebaixado) NÃO cancela pedido de outro
 *       cliente — nem com payment_status NULL + cobrança viva na vaga, nem
 *       pago, nem offline: 0 cancelamento, 0 estorno, 0 estoque. NULL com a
 *       vaga ocupada é transitório: a porta do front recusa até o dono e o
 *       admin coerente; a da edge (com a prova do MP) cancela. Controles:
 *       admin atual coerente e dono seguem cancelando.
 *   (j) ORDEM GLOBAL DE TRAVAS (linhas de order_refunds ANTES do pedido),
 *       com duas conexões de verdade: quem já segura as linhas do estorno
 *       (o 1º passo de concluir_estorno/registrar_estorno_manual) faz o
 *       cancelamento ESPERAR antes de travar o pedido — e consegue travar o
 *       pedido em seguida, sem 40P01; cancelar × concluir_estorno e ×
 *       registrar_estorno_manual nas duas ordens terminam sem deadlock e com
 *       o remanescente certo. CONTROLE: a ordem invertida (pedido antes das
 *       linhas) contra concluir_estorno dá deadlock (40P01).
 *   (k) admin_devolucao_reemitir_reembolso segue a MESMA ordem global
 *       (a 97 travava pedido → linha): com duas conexões, quem já segura as
 *       linhas faz a reemissão esperar ANTES de travar o pedido;
 *       cancelar × reemitir e reemitir × concluir_estorno, nas duas ordens,
 *       sem 40P01. CONTROLE: o corpo da 97 (copiado com outro nome) no
 *       mesmo cenário dá deadlock (40P01).
 *   (i) ENTREGUE → cancelar → reativar → cancelar: o carimbo do fato
 *       histórico (`cancelled_after_shipping`) segura o estoque e o estorno
 *       nas duas vezes; o retorno físico explícito
 *       (`confirmar_retorno_do_produto`) devolve o estoque UMA vez.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/cancelar-pedido-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome
 * fixo (constantes abaixo), nunca entrada de rede nem de terceiro. */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME_98 = "20261198000000_cancelar_pedido_anula_a_cobranca.sql";
const CAMINHO_98 = path.join(PASTA, NOME_98);
const CAMINHO_ROLLBACK_98 = path.join(PASTA, `rollback-manual-${NOME_98}`);

const HASH_80 = "ed2f7fd3e0177c027720049b2fe55d3b";
const HASH_98 = "c8df4feb3f53b90922a6c8398371e394";
// admin_devolucao_reemitir_reembolso: o corpo que a 20261197000000 deixa e o
// que a 98 deixa (ordem global de travas).
const HASH_97_REEMITIR = "7a5ce4978a989e1bebb3d048d347c0c6";
const HASH_98_REEMITIR = "422cfaa8c53cefc1913b9e082442631d";
const NOME_97 = "20261197000000_dinheiro_exige_admin_atual.sql";

const U_CLIENTE = "98111111-1111-1111-1111-111111111111";
const U_OUTRO = "98333333-3333-3333-3333-333333333333";
const U_ADMIN = "98222222-2222-2222-2222-222222222222";
// Admin só no app_metadata (JWT velho / painel do Supabase) — profiles diz
// customer: NÃO é admin atual para a porta da edge.
const U_ADMIN_SO_META = "98444444-4444-4444-4444-444444444444";
// O rebaixamento na OUTRA direção: auth.users já não diz admin, o perfil
// ainda diz. Os dois só passavam pelo is_admin() antigo com o JWT velho.
const U_REB_AUTH = "98555555-5555-5555-5555-555555555555";

const ESTOQUE_INICIAL = 10;
const QTD = 2;

let seq = 0;
function novoId(prefixo) {
  seq += 1;
  return `${prefixo}-0000-0000-0000-${String(seq).padStart(12, "0")}`;
}

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId ?? "",
  ]);
}

async function prepararPessoas(cliente) {
  for (const [id, email, meta] of [
    [U_CLIENTE, "cliente@cancelar98.teste", "{}"],
    [U_OUTRO, "outro@cancelar98.teste", "{}"],
    [U_ADMIN, "admin@cancelar98.teste", '{"role":"admin"}'],
    [U_ADMIN_SO_META, "meta@cancelar98.teste", '{"role":"admin"}'],
    [U_REB_AUTH, "rebaixado@cancelar98.teste", "{}"],
  ]) {
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, email, meta],
    );
  }
  // Sem handle_new_user nesta emulação: o perfil entra direto. Os gatilhos
  // de papel de profiles deixam o superusuário da prova gravar o papel.
  await cliente.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente 98', 'customer'),
       ($2, 'Outro 98', 'customer'),
       ($3, 'Admin 98', 'admin'),
       ($4, 'Meta 98', 'customer'),
       ($5, 'Rebaixado 98', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U_CLIENTE, U_OUTRO, U_ADMIN, U_ADMIN_SO_META, U_REB_AUTH],
  );
  // O gatilho de profiles leva o papel para auth.users: reafirma as duas
  // fontes como a prova precisa (U_ADMIN_SO_META: admin SÓ no app_metadata).
  await cliente.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id IN ($1, $2)`,
    [U_ADMIN, U_ADMIN_SO_META],
  );
  // ... e o perfil admin com auth.users rebaixado (o gatilho de profiles pode
  // ter levado o papel para auth.users: reafirma o rebaixamento lá).
  await cliente.query(
    `UPDATE public.profiles SET role = 'admin' WHERE id = $1`,
    [U_REB_AUTH],
  );
  await cliente.query(
    `UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id = $1`,
    [U_REB_AUTH],
  );
}

/** O JWT da sessão (o que `is_admin()` lê). `null` limpa. */
async function jwt(cliente, userId, papel) {
  await cliente.query("SELECT set_config('request.jwt.claims', $1, false)", [
    userId
      ? JSON.stringify({ sub: userId, app_metadata: { role: papel } })
      : "",
  ]);
}

/**
 * Pedido com UM item de produto próprio (estoque ESTOQUE_INICIAL) para medir
 * `devolver_estoque` de verdade.
 */
async function criarPedido(
  cliente,
  {
    status = "pending",
    paymentMethod = "online",
    paymentStatus = "aguardando",
    vaga = null,
    metodo = null,
    total = 100,
    paidAt = null,
    valorEstornado = 0,
    dono = U_CLIENTE,
    atualizadoHaMinutos = 0,
    canal = "online",
  } = {},
) {
  const pedidoId = novoId("98aaaaaa");
  const produtoId = novoId("98bbbbbb");
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto 98', 10.00, 50.00, $2, true, false)`,
    [produtoId, ESTOQUE_INICIAL],
  );
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, expires_at, metodo_online, gateway_payment_id,
        paid_at, valor_estornado, updated_at)
     VALUES ($1, $2, 'Cliente 98', '{}'::jsonb, $3, $3, $4, $12,
             $5, $6, now() + interval '30 minutes', $7, $8, $9, $10,
             now() - make_interval(mins => $11::int))`,
    [
      pedidoId,
      dono,
      total,
      status,
      paymentMethod,
      paymentStatus,
      metodo,
      vaga,
      paidAt,
      valorEstornado,
      atualizadoHaMinutos,
      canal,
    ],
  );
  await cliente.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto 98', $3, 50.00)`,
    [pedidoId, produtoId, QTD],
  );
  return { pedidoId, produtoId };
}

async function estoque(cliente, produtoId) {
  const r = await cliente.query(
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [produtoId],
  );
  return Number(r.rows[0].estoque);
}

async function pedido(cliente, id) {
  const r = await cliente.query(
    `SELECT status, payment_status, gateway_payment_id, stock_returned_at
       FROM public.marketplace_orders WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

async function cancelarPelaPortaDoFront(cliente, userId, id) {
  await logar(cliente, userId);
  return cliente.query(
    "SELECT public.update_order_status_atomic($1::uuid, 'cancelled', NULL, false) AS r",
    [id],
  );
}

/** A porta da edge, como a edge a chama: role service_role. */
async function cancelarPelaEdge(cliente, { id, ator, vaga, pagamento }) {
  await logar(cliente, null);
  await cliente.query("BEGIN");
  try {
    await cliente.query("SET LOCAL ROLE service_role");
    const r = await cliente.query(
      "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, $3::text, $4::text, NULL) AS r",
      [id, ator, vaga, pagamento],
    );
    await cliente.query("COMMIT");
    return r.rows[0].r;
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  }
}

const RE_BYPASS =
  /cobrança aberta no Mercado Pago e não pode ser cancelado por aqui/;

async function assertRecusaBypass(promessa) {
  await assert.rejects(promessa, (erro) => {
    assert.equal(erro.code, "P0001", "o front só repassa a mensagem P0001");
    assert.match(erro.message, RE_BYPASS);
    // A fila offline do painel trata esta frase como terminal.
    assert.match(erro.message.toLowerCase(), /não pode ser cancelado/);
    return true;
  });
}

async function linhasDeEstorno(cliente, id) {
  const r = await cliente.query(
    `SELECT amount::numeric AS amount, status, solicitado_por
       FROM public.order_refunds WHERE order_id = $1 ORDER BY created_at, id`,
    [id],
  );
  return r.rows.map((l) => ({ ...l, amount: Number(l.amount) }));
}

async function md5Reemitir(cliente) {
  const r = await cliente.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc
      WHERE oid = to_regprocedure('public.admin_devolucao_reemitir_reembolso(uuid,boolean)')`,
  );
  return r.rows[0]?.h ?? null;
}

async function md5Vivo(cliente) {
  const r = await cliente.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc
      WHERE oid = to_regprocedure('public.update_order_status_atomic(uuid,text,text,boolean)')`,
  );
  return r.rows[0]?.h ?? null;
}

const PROVAS = [];

PROVAS.push({
  nome: "(0) a migration 98 está no ar (hash do corpo vivo)",
  corpo: async (cliente) => {
    await prepararPessoas(cliente);
    assert.equal(await md5Vivo(cliente), HASH_98);
  },
});

/** Os casos do bypass — reaproveitados pelo CONTROLE (g). */
async function casosDoBypass(cliente, rodada) {
  // A vaga é UNIQUE: o sufixo da rodada deixa o CONTROLE (g) reusar os casos.
  // PIX aberto na vaga: cliente recusado, admin recusado, nada muda.
  const pix = await criarPedido(cliente, {
    vaga: `ORD98PIXABERTO${rodada}`,
    metodo: "pix",
  });
  await assertRecusaBypass(
    cancelarPelaPortaDoFront(cliente, U_CLIENTE, pix.pedidoId),
  );
  await assertRecusaBypass(
    cancelarPelaPortaDoFront(cliente, U_ADMIN, pix.pedidoId),
  );
  assert.equal((await pedido(cliente, pix.pedidoId)).status, "pending");
  assert.equal(await estoque(cliente, pix.produtoId), ESTOQUE_INICIAL);

  // Cartão vivo: o ADMIN agora também é recusado (antes passava).
  const cartao = await criarPedido(cliente, {
    vaga: `ORD98CARTAO${rodada}`,
    metodo: "credito",
  });
  await assertRecusaBypass(
    cancelarPelaPortaDoFront(cliente, U_ADMIN, cartao.pedidoId),
  );
  assert.equal((await pedido(cliente, cartao.pedidoId)).status, "pending");

  // Sentinela: admin recusado também.
  const sentinela = await criarPedido(cliente, {
    vaga: `verificando:98${rodada}:c0:p1:1790000000000`,
  });
  await assertRecusaBypass(
    cancelarPelaPortaDoFront(cliente, U_ADMIN, sentinela.pedidoId),
  );
  return { pix, cartao, sentinela };
}

PROVAS.push({
  nome: "(a) bypass fechado: cliente e admin não cancelam pela porta do front com cobrança na vaga; sem vaga, não online e pago seguem",
  corpo: async (cliente) => {
    await casosDoBypass(cliente, "a");

    // Cliente com cartão vivo continua vendo a mensagem da 80 (que vem antes).
    const cartaoCliente = await criarPedido(cliente, {
      vaga: "ORD98CARTAOCLI",
      metodo: "debito",
    });
    await assert.rejects(
      cancelarPelaPortaDoFront(cliente, U_CLIENTE, cartaoCliente.pedidoId),
      /cobrança no cartão em confirmação com o banco/,
    );

    // Online SEM cobrança na vaga: cancela como sempre, estoque volta 1x.
    const semVaga = await criarPedido(cliente, {});
    await cancelarPelaPortaDoFront(cliente, U_CLIENTE, semVaga.pedidoId);
    assert.equal((await pedido(cliente, semVaga.pedidoId)).status, "cancelled");
    assert.equal(
      await estoque(cliente, semVaga.produtoId),
      ESTOQUE_INICIAL + QTD,
    );

    // Não online (dinheiro na entrega, payment_status NULL): admin cancela.
    const naEntrega = await criarPedido(cliente, {
      paymentMethod: "cash",
      paymentStatus: null,
      status: "processing",
    });
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, naEntrega.pedidoId);
    assert.equal(
      (await pedido(cliente, naEntrega.pedidoId)).status,
      "cancelled",
    );

    // PAGO com a cobrança na vaga, em processing: o CLIENTE continua podendo
    // cancelar (contrato), e o ledger abre o estorno do total.
    const pago = await criarPedido(cliente, {
      status: "processing",
      paymentStatus: "pago",
      paidAt: new Date().toISOString(),
      vaga: "ORD98PAGO",
      metodo: "pix",
    });
    await cancelarPelaPortaDoFront(cliente, U_CLIENTE, pago.pedidoId);
    assert.equal((await pedido(cliente, pago.pedidoId)).status, "cancelled");
    assert.deepEqual(
      (await linhasDeEstorno(cliente, pago.pedidoId)).map((l) => [
        l.amount,
        l.solicitado_por,
      ]),
      [[100, "cliente"]],
    );

    // Re-cancelar um pedido JÁ cancelado com PIX ainda na vaga (cancelado
    // antes desta migration): sem efeito novo, não é recusado.
    const jaCancelado = await criarPedido(cliente, {
      status: "cancelled",
      vaga: "ORD98JACANCELADO",
      metodo: "pix",
    });
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, jaCancelado.pedidoId);
    assert.equal(
      await estoque(cliente, jaCancelado.produtoId),
      ESTOQUE_INICIAL,
    );
  },
});

PROVAS.push({
  nome: "(b) cancelar_pedido_com_cobranca: só service role, CAS na vaga e no pagamento, dono ou admin atual, sentinela",
  corpo: async (cliente) => {
    // authenticated não executa (ACL).
    const p1 = await criarPedido(cliente, { vaga: "ORD98B1", metodo: "pix" });
    await logar(cliente, U_CLIENTE);
    await cliente.query("BEGIN");
    try {
      await cliente.query("SET LOCAL ROLE authenticated");
      await assert.rejects(
        cliente.query(
          "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, 'ORD98B1', 'aguardando')",
          [p1.pedidoId, U_CLIENTE],
        ),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }
    // Superusuário SEM role de serviço (o GUC role = none) também não passa
    // pela guarda do corpo.
    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      cliente.query(
        "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, 'ORD98B1', 'aguardando')",
        [p1.pedidoId, U_CLIENTE],
      ),
      (e) => e.code === "42501",
    );

    // CAS: a vaga mudou (outra cobrança gravada) → não cancela.
    const mudou = await cancelarPelaEdge(cliente, {
      id: p1.pedidoId,
      ator: U_CLIENTE,
      vaga: "ORD98OUTRA",
      pagamento: "aguardando",
    });
    assert.equal(mudou.cancelado, false);
    assert.equal(mudou.motivo, "cobranca_mudou");
    assert.equal(
      mudou.pedido.gateway_payment_id,
      "ORD98B1",
      "devolve o pedido RELIDO",
    );
    assert.equal((await pedido(cliente, p1.pedidoId)).status, "pending");
    assert.equal(await estoque(cliente, p1.produtoId), ESTOQUE_INICIAL);

    // CAS: o pagamento mudou (o webhook confirmou) → não cancela.
    const pagoNoMeio = await criarPedido(cliente, {
      vaga: "ORD98B2",
      metodo: "pix",
      paymentStatus: "pago",
      paidAt: new Date().toISOString(),
    });
    const r2 = await cancelarPelaEdge(cliente, {
      id: pagoNoMeio.pedidoId,
      ator: U_CLIENTE,
      vaga: "ORD98B2",
      pagamento: "aguardando",
    });
    assert.equal(r2.cancelado, false);
    assert.equal(r2.motivo, "cobranca_mudou");
    assert.equal(
      (await pedido(cliente, pagoNoMeio.pedidoId)).status,
      "pending",
    );

    // Outro usuário: recusado.
    await assert.rejects(
      cancelarPelaEdge(cliente, {
        id: p1.pedidoId,
        ator: U_OUTRO,
        vaga: "ORD98B1",
        pagamento: "aguardando",
      }),
      /Não autorizado/,
    );
    // Admin SÓ no app_metadata (profiles diz customer): não é admin atual.
    await assert.rejects(
      cancelarPelaEdge(cliente, {
        id: p1.pedidoId,
        ator: U_ADMIN_SO_META,
        vaga: "ORD98B1",
        pagamento: "aguardando",
      }),
      /Não autorizado/,
    );

    // CAS certo, dono: cancela, estoque volta 1x, histórico grava o ator.
    const ok = await cancelarPelaEdge(cliente, {
      id: p1.pedidoId,
      ator: U_CLIENTE,
      vaga: "ORD98B1",
      pagamento: "aguardando",
    });
    assert.equal(ok.cancelado, true);
    assert.equal(ok.ja_estava, false);
    assert.equal(ok.pedido.status, "cancelled");
    assert.equal(await estoque(cliente, p1.produtoId), ESTOQUE_INICIAL + QTD);
    const hist = await cliente.query(
      `SELECT old_status, new_status, created_by FROM public.marketplace_order_history
        WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [p1.pedidoId],
    );
    assert.deepEqual(hist.rows[0], {
      old_status: "pending",
      new_status: "cancelled",
      created_by: U_CLIENTE,
    });
    // A vaga fica com o id anulado (o webhook do cancelamento resolve depois).
    assert.equal(
      (await pedido(cliente, p1.pedidoId)).gateway_payment_id,
      "ORD98B1",
    );

    // De novo (duas abas): ja_estava, estoque NÃO volta de novo.
    const deNovo = await cancelarPelaEdge(cliente, {
      id: p1.pedidoId,
      ator: U_CLIENTE,
      vaga: "ORD98B1",
      pagamento: "aguardando",
    });
    assert.equal(deNovo.cancelado, true);
    assert.equal(deNovo.ja_estava, true);
    assert.equal(await estoque(cliente, p1.produtoId), ESTOQUE_INICIAL + QTD);

    // Sentinela: cliente nunca.
    const sentinelaVelho = await criarPedido(cliente, {
      vaga: "verificando:98b:c0:p2:1790000000000",
      atualizadoHaMinutos: 10,
    });
    await assert.rejects(
      cancelarPelaEdge(cliente, {
        id: sentinelaVelho.pedidoId,
        ator: U_CLIENTE,
        vaga: "verificando:98b:c0:p2:1790000000000",
        pagamento: "aguardando",
      }),
      /cobrança no cartão em confirmação/,
    );
    // Sentinela RECENTE: admin recebe cobranca_em_criacao, nada muda.
    const sentinelaNovo = await criarPedido(cliente, {
      vaga: "verificando:98c:c0:p3:1790000000000",
      atualizadoHaMinutos: 0,
    });
    const emCriacao = await cancelarPelaEdge(cliente, {
      id: sentinelaNovo.pedidoId,
      ator: U_ADMIN,
      vaga: "verificando:98c:c0:p3:1790000000000",
      pagamento: "aguardando",
    });
    assert.equal(emCriacao.cancelado, false);
    assert.equal(emCriacao.motivo, "cobranca_em_criacao");
    assert.equal(
      (await pedido(cliente, sentinelaNovo.pedidoId)).status,
      "pending",
    );
    // Sentinela velho (10 min): admin cancela; o histórico grava o admin.
    const adminOk = await cancelarPelaEdge(cliente, {
      id: sentinelaVelho.pedidoId,
      ator: U_ADMIN,
      vaga: "verificando:98b:c0:p2:1790000000000",
      pagamento: "aguardando",
    });
    assert.equal(adminOk.cancelado, true);
    assert.equal(
      await estoque(cliente, sentinelaVelho.produtoId),
      ESTOQUE_INICIAL + QTD,
    );

    // Sem cobrança na vaga (CAS com NULL): o caminho da edge também cancela.
    const semVaga = await criarPedido(cliente, {});
    const r3 = await cancelarPelaEdge(cliente, {
      id: semVaga.pedidoId,
      ator: U_CLIENTE,
      vaga: null,
      pagamento: "aguardando",
    });
    assert.equal(r3.cancelado, true);
  },
});

async function cenarioR11(
  cliente,
  porta,
  { confirmado, reservado, orfao = 0 },
) {
  // A vaga é UNIQUE (idx_marketplace_orders_gateway_payment_id): uma por cenário.
  const vaga = `ORD98R11${porta}${confirmado}x${reservado}x${orfao}`;
  const p = await criarPedido(cliente, {
    status: "processing",
    paymentStatus: "pago",
    paidAt: new Date().toISOString(),
    vaga,
    metodo: "pix",
    valorEstornado: confirmado,
  });
  if (confirmado > 0) {
    await cliente.query(
      // Já SOMADA em valor_estornado: concluir_estorno carimba concluido_em.
      `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status, concluido_em)
       VALUES ($1, $2, 'devolução parcial anterior', 'lojista', 'concluido', now())`,
      [p.pedidoId, confirmado],
    );
  }
  if (orfao > 0) {
    // R1 (revisão Opus de d5d7d1fd): a linha que o webhook insere ANTES do
    // concluir_estorno — dinheiro que já saiu no MP, 'concluido' mas ainda
    // NÃO somado (concluido_em NULL, valor_estornado intocado). O saldo tem de
    // descontá-la; senão o cancelamento reserva de novo o que já saiu.
    await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status, mp_refund_id)
       VALUES ($1, $2, 'estorno feito fora do app (Mercado Pago)', 'sistema', 'concluido', $3)`,
      [p.pedidoId, orfao, `MPREF98ORFAO${porta}${orfao}`],
    );
    // CONTROLE dentro da prova: a fórmula SEM o termo da órfã (a de antes da
    // correção) dá outro número neste pedido — o caso distingue as duas.
    const semOrfao = (
      await cliente.query(
        `SELECT o.total - COALESCE(o.valor_estornado, 0)
                - COALESCE((SELECT sum(r.amount) FROM public.order_refunds r
                             WHERE r.order_id = o.id
                               AND r.status IN ('solicitado', 'em_processamento')), 0) AS s
           FROM public.marketplace_orders o WHERE o.id = $1`,
        [p.pedidoId],
      )
    ).rows[0].s;
    const vivo = (
      await cliente.query("SELECT public.pedido__saldo_a_estornar($1) AS s", [
        p.pedidoId,
      ])
    ).rows[0].s;
    assert.equal(
      Number(semOrfao) - Number(vivo),
      orfao,
      "CONTROLE: sem descontar a órfã o saldo seria maior exatamente pela órfã",
    );
  }
  if (reservado > 0) {
    await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
       VALUES ($1, $2, 'estorno em voo', 'lojista', 'solicitado')`,
      [p.pedidoId, reservado],
    );
  }
  if (porta === "front") {
    await cancelarPelaPortaDoFront(cliente, U_CLIENTE, p.pedidoId);
  } else {
    const r = await cancelarPelaEdge(cliente, {
      id: p.pedidoId,
      ator: U_CLIENTE,
      vaga,
      pagamento: "pago",
    });
    assert.equal(r.cancelado, true);
  }
  assert.equal((await pedido(cliente, p.pedidoId)).status, "cancelled");
  return (await linhasDeEstorno(cliente, p.pedidoId)).filter(
    (l) => l.status === "solicitado" && l.solicitado_por === "cliente",
  );
}

PROVAS.push({
  nome: "(c) R11: cancelar pedido pago com estornos abre o REMANESCENTE (70 / 50 / nada; a linha concluída ainda não somada também desconta), pelas duas portas",
  corpo: async (cliente) => {
    for (const porta of ["front", "edge"]) {
      assert.deepEqual(
        (
          await cenarioR11(cliente, porta, { confirmado: 30, reservado: 0 })
        ).map((l) => l.amount),
        [70],
        `${porta}: 100 − 30 confirmado = 70`,
      );
      assert.deepEqual(
        (
          await cenarioR11(cliente, porta, { confirmado: 30, reservado: 20 })
        ).map((l) => l.amount),
        [50],
        `${porta}: 100 − 30 − 20 = 50`,
      );
      assert.deepEqual(
        (
          await cenarioR11(cliente, porta, { confirmado: 100, reservado: 0 })
        ).map((l) => l.amount),
        [],
        `${porta}: 100 confirmado = nada a estornar`,
      );
      // R1: 'concluido' sem concluido_em (já saiu no MP, ainda não somado).
      assert.deepEqual(
        (
          await cenarioR11(cliente, porta, {
            confirmado: 0,
            reservado: 0,
            orfao: 100,
          })
        ).map((l) => l.amount),
        [],
        `${porta}: 100 já saiu (órfã não somada) = nada a estornar, nunca 200 no ledger`,
      );
      assert.deepEqual(
        (
          await cenarioR11(cliente, porta, {
            confirmado: 0,
            reservado: 0,
            orfao: 30,
          })
        ).map((l) => l.amount),
        [70],
        `${porta}: 100 − 30 da órfã = 70`,
      );
    }

    // Reativar → cancelar de novo: a 1ª linha reserva o saldo inteiro, a 2ª
    // vê zero (a "uma linha na vida" de antes continua valendo).
    const p = await criarPedido(cliente, {
      status: "processing",
      paymentStatus: "pago",
      paidAt: new Date().toISOString(),
    });
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, p.pedidoId);
    await logar(cliente, U_ADMIN);
    await cliente.query(
      "SELECT public.update_order_status_atomic($1::uuid, 'processing') AS r",
      [p.pedidoId],
    );
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, p.pedidoId);
    assert.deepEqual(
      (await linhasDeEstorno(cliente, p.pedidoId)).map((l) => l.amount),
      [100],
    );
  },
});

PROVAS.push({
  nome: "(d) entregue → cancelado NÃO devolve estoque (pela porta do front e pela da edge); balcão (nasce entregue) continua devolvendo",
  corpo: async (cliente) => {
    const entregue = await criarPedido(cliente, {
      status: "delivered",
      paymentMethod: "cash",
      paymentStatus: null,
    });
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, entregue.pedidoId);
    const depois = await pedido(cliente, entregue.pedidoId);
    assert.equal(depois.status, "cancelled");
    assert.equal(await estoque(cliente, entregue.produtoId), ESTOQUE_INICIAL);
    assert.equal(depois.stock_returned_at, null);

    const entregueOnline = await criarPedido(cliente, {
      status: "delivered",
      paymentStatus: "pago",
      paidAt: new Date().toISOString(),
      vaga: "ORD98ENTREGUE",
      metodo: "pix",
    });
    const r = await cancelarPelaEdge(cliente, {
      id: entregueOnline.pedidoId,
      ator: U_ADMIN,
      vaga: "ORD98ENTREGUE",
      pagamento: "pago",
    });
    assert.equal(r.cancelado, true);
    assert.equal(
      await estoque(cliente, entregueOnline.produtoId),
      ESTOQUE_INICIAL,
    );

    // Venda de BALCÃO nasce 'delivered' e o cancelamento dela continua
    // devolvendo o estoque (invariante (d)(j) de invariantes-dinheiro.cjs —
    // o plano S1 não decidiu sobre o balcão).
    const balcao = await criarPedido(cliente, {
      status: "delivered",
      paymentMethod: "cash",
      paymentStatus: null,
      canal: "presencial",
    });
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, balcao.pedidoId);
    assert.equal(
      await estoque(cliente, balcao.produtoId),
      ESTOQUE_INICIAL + QTD,
    );

    // Controle: o MESMO cancelamento a partir de processing devolve.
    const processando = await criarPedido(cliente, {
      status: "processing",
      paymentMethod: "cash",
      paymentStatus: null,
    });
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, processando.pedidoId);
    assert.equal(
      await estoque(cliente, processando.produtoId),
      ESTOQUE_INICIAL + QTD,
    );
  },
});

async function contarEstornos(cliente, id) {
  return (await linhasDeEstorno(cliente, id)).length;
}

PROVAS.push({
  nome: "(h) admin com JWT velho e papel ATUAL rebaixado (nas 2 direções) não cancela pedido de outro cliente (NULL+vaga, pago, offline); NULL com vaga é transitório; admin coerente e dono seguem",
  corpo: async (cliente) => {
    const vagaNula = async (sufixo) =>
      criarPedido(cliente, {
        paymentStatus: null,
        vaga: `ORD98NULO${sufixo}`,
        metodo: "pix",
      });
    const pagoDeOutro = async () =>
      criarPedido(cliente, {
        status: "processing",
        paymentStatus: "pago",
        paidAt: new Date().toISOString(),
      });
    const offlineDeOutro = async () =>
      criarPedido(cliente, {
        status: "processing",
        paymentMethod: "cash",
        paymentStatus: null,
      });

    try {
      for (const [quem, rotulo] of [
        [U_REB_AUTH, "auth rebaixado + perfil admin"],
        [U_ADMIN_SO_META, "auth admin + perfil rebaixado"],
      ]) {
        // O JWT de ANTES do rebaixamento ainda diz admin.
        await jwt(cliente, quem, "admin");
        for (const [criar, caso] of [
          [() => vagaNula(`${quem.slice(0, 4)}h`), "(a) NULL + cobrança viva"],
          [pagoDeOutro, "(b) pago de outro cliente"],
          [offlineDeOutro, "(c) offline de outro cliente"],
        ]) {
          const alvo = await criar();
          await assert.rejects(
            cancelarPelaPortaDoFront(cliente, quem, alvo.pedidoId),
            (erro) => {
              assert.equal(erro.code, "P0001", `${rotulo} ${caso}`);
              assert.match(erro.message, /Não autorizado/, `${rotulo} ${caso}`);
              return true;
            },
          );
          const depois = await pedido(cliente, alvo.pedidoId);
          assert.notEqual(
            depois.status,
            "cancelled",
            `${rotulo} ${caso}: 0 cancelamento`,
          );
          assert.equal(
            depois.stock_returned_at,
            null,
            `${rotulo} ${caso}: 0 estoque`,
          );
          assert.equal(
            await estoque(cliente, alvo.produtoId),
            ESTOQUE_INICIAL,
            `${rotulo} ${caso}: estoque intacto`,
          );
          assert.equal(
            await contarEstornos(cliente, alvo.pedidoId),
            0,
            `${rotulo} ${caso}: 0 estorno`,
          );
        }
      }

      // Controle: admin ATUAL coerente (com o mesmo tipo de JWT) cancela o
      // pago (estorno do remanescente) e o offline (estoque 1x) de outro.
      await jwt(cliente, U_ADMIN, "admin");
      const pago = await pagoDeOutro();
      await cancelarPelaPortaDoFront(cliente, U_ADMIN, pago.pedidoId);
      assert.equal((await pedido(cliente, pago.pedidoId)).status, "cancelled");
      assert.deepEqual(
        (await linhasDeEstorno(cliente, pago.pedidoId)).map((l) => l.amount),
        [100],
      );
      const offline = await offlineDeOutro();
      await cancelarPelaPortaDoFront(cliente, U_ADMIN, offline.pedidoId);
      assert.equal(
        await estoque(cliente, offline.produtoId),
        ESTOQUE_INICIAL + QTD,
      );

      // NULL com a vaga ocupada: TRANSITÓRIO — a porta do front recusa o
      // admin coerente E o dono; nada muda.
      const nulo = await vagaNula("CTL");
      await assertRecusaBypass(
        cancelarPelaPortaDoFront(cliente, U_ADMIN, nulo.pedidoId),
      );
      await jwt(cliente, U_CLIENTE, "customer");
      await assertRecusaBypass(
        cancelarPelaPortaDoFront(cliente, U_CLIENTE, nulo.pedidoId),
      );
      assert.equal((await pedido(cliente, nulo.pedidoId)).status, "pending");
      assert.equal(await estoque(cliente, nulo.produtoId), ESTOQUE_INICIAL);

      // ... e a porta da edge (depois da prova do MP) cancela, com o CAS no
      // NULL que a edge leu.
      const r = await cancelarPelaEdge(cliente, {
        id: nulo.pedidoId,
        ator: U_CLIENTE,
        vaga: "ORD98NULOCTL",
        pagamento: null,
      });
      assert.equal(r.cancelado, true);
      assert.equal(
        await estoque(cliente, nulo.produtoId),
        ESTOQUE_INICIAL + QTD,
      );

      // Controle: o DONO cancela o próprio pedido pago pela porta do front.
      const meu = await pagoDeOutro();
      await cancelarPelaPortaDoFront(cliente, U_CLIENTE, meu.pedidoId);
      assert.equal((await pedido(cliente, meu.pedidoId)).status, "cancelled");
    } finally {
      await jwt(cliente, null);
    }
  },
});

async function carimbo(cliente, id) {
  const r = await cliente.query(
    `SELECT cancelled_after_shipping, returned_to_seller_at
       FROM public.marketplace_orders WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

PROVAS.push({
  nome: "(i) entregue → cancelar → reativar → cancelar: estoque e estorno ficam parados nas duas vezes (o fato histórico é carimbado); o retorno físico explícito devolve UMA vez",
  corpo: async (cliente) => {
    const p = await criarPedido(cliente, {
      status: "delivered",
      paymentStatus: "pago",
      paidAt: new Date().toISOString(),
    });

    // 1º cancelamento (admin coerente, pela porta do front).
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, p.pedidoId);
    assert.equal((await pedido(cliente, p.pedidoId)).status, "cancelled");
    assert.equal(await estoque(cliente, p.produtoId), ESTOQUE_INICIAL);
    assert.equal(
      (await carimbo(cliente, p.pedidoId)).cancelled_after_shipping,
      true,
    );
    assert.equal(await contarEstornos(cliente, p.pedidoId), 0);

    // Reativa (a lojista volta o pedido para processing) — o carimbo fica.
    await logar(cliente, U_ADMIN);
    await cliente.query(
      "SELECT public.update_order_status_atomic($1::uuid, 'processing') AS r",
      [p.pedidoId],
    );
    assert.equal(
      (await carimbo(cliente, p.pedidoId)).cancelled_after_shipping,
      true,
    );

    // 2º cancelamento: a memória da entrega continua valendo.
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, p.pedidoId);
    assert.equal((await pedido(cliente, p.pedidoId)).status, "cancelled");
    assert.equal(
      await estoque(cliente, p.produtoId),
      ESTOQUE_INICIAL,
      "o 2º cancelamento não credita a peça que está com o cliente",
    );
    assert.equal((await pedido(cliente, p.pedidoId)).stock_returned_at, null);
    assert.equal(
      await contarEstornos(cliente, p.pedidoId),
      0,
      "nenhum estorno automático sem a peça voltar",
    );

    // O retorno físico EXPLÍCITO (o fluxo que já existe) devolve UMA vez.
    try {
      await jwt(cliente, U_ADMIN, "admin");
      await logar(cliente, U_ADMIN);
      const r1 = await cliente.query(
        "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
        [p.pedidoId],
      );
      assert.equal(r1.rows[0].r.ja_confirmado, false);
      assert.equal(await estoque(cliente, p.produtoId), ESTOQUE_INICIAL + QTD);
      const r2 = await cliente.query(
        "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
        [p.pedidoId],
      );
      assert.equal(r2.rows[0].r.ja_confirmado, true, "repetir é idempotente");
      assert.equal(await estoque(cliente, p.produtoId), ESTOQUE_INICIAL + QTD);
    } finally {
      await jwt(cliente, null);
    }

    // Balcão (nasce entregue): sem carimbo — o cancelamento devolve na hora,
    // como sempre (a prova (d) mede o estoque).
    const balcao = await criarPedido(cliente, {
      status: "delivered",
      paymentMethod: "cash",
      paymentStatus: null,
      canal: "presencial",
    });
    await cancelarPelaPortaDoFront(cliente, U_ADMIN, balcao.pedidoId);
    assert.equal(
      (await carimbo(cliente, balcao.pedidoId)).cancelled_after_shipping,
      false,
    );
  },
});

/**
 * Corrida real: a conexão A segura o FOR UPDATE dentro de uma transação
 * aberta; a B chama a outra RPC e fica ESPERANDO (medido por pg_locks/
 * wait_event antes de soltar A).
 */
async function correr(url, observador, { primeiro, segundo }) {
  const a = new Client({ connectionString: url });
  const b = new Client({ connectionString: url });
  await a.connect();
  await b.connect();
  try {
    await a.query("BEGIN");
    await a.query("SET LOCAL ROLE service_role");
    const rA = await primeiro(a);
    const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    await b.query("BEGIN");
    await b.query("SET LOCAL ROLE service_role");
    const promessaB = segundo(b);
    // Espera B ficar de fato bloqueada no lock da linha. Quem olha é a
    // conexão de superusuário da prova: a A está com role service_role, que
    // não enxerga o wait_event de outra sessão.
    let bloqueada = false;
    for (let i = 0; i < 100 && !bloqueada; i += 1) {
      const w = await observador.query(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
        [pidB],
      );
      bloqueada = w.rows[0]?.wait_event_type === "Lock";
      if (!bloqueada) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(bloqueada, "a 2ª conexão tem de esperar o FOR UPDATE da 1ª");
    await a.query("COMMIT");
    const rB = await promessaB;
    await b.query("COMMIT");
    return { rA, rB };
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
}

async function conectar(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function pid(con) {
  return (await con.query("SELECT pg_backend_pid() AS p")).rows[0].p;
}

/** Espera a conexão `alvo` ficar bloqueada num lock (visto pelo superusuário). */
async function esperarBloqueio(observador, pidAlvo, rotulo) {
  for (let i = 0; i < 150; i += 1) {
    const w = await observador.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pidAlvo],
    );
    if (w.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`${rotulo}: a conexão devia estar esperando um lock`);
}

/** Pedido pago em processing (total 100) com UMA linha de estorno. */
async function pagoComLinha(cliente, statusDaLinha, valor = 30) {
  const p = await criarPedido(cliente, {
    status: "processing",
    paymentStatus: "pago",
    paidAt: new Date().toISOString(),
  });
  const r = await cliente.query(
    `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
     VALUES ($1, $2, 'prova da ordem de travas', 'lojista', $3) RETURNING id`,
    [p.pedidoId, valor, statusDaLinha],
  );
  return { ...p, linhaId: r.rows[0].id };
}

const SQL_CANCELAR_PAGO =
  "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, NULL, 'pago') AS r";

/**
 * Roda `primeiro` numa transação aberta de A, dispara `segundo` em B, espera B
 * bloquear, comita A e devolve os dois resultados. Qualquer 40P01 sobe.
 */
async function emSequencia(url, observador, primeiro, segundo, rotulo) {
  const a = await conectar(url);
  const b = await conectar(url);
  try {
    await a.query("BEGIN");
    await a.query("SET LOCAL ROLE service_role");
    const rA = await primeiro(a);
    const pidB = await pid(b);
    await b.query("BEGIN");
    await b.query("SET LOCAL ROLE service_role");
    const promessaB = segundo(b);
    promessaB.catch(() => {});
    await esperarBloqueio(observador, pidB, rotulo);
    await a.query("COMMIT");
    const rB = await promessaB;
    await b.query("COMMIT");
    return { rA, rB };
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
}

PROVAS.push({
  nome: "(j) ordem global de travas: linhas do estorno ANTES do pedido — cancelar × concluir_estorno e × registrar_estorno_manual sem deadlock; a ordem invertida dá 40P01",
  corpo: async (cliente, url) => {
    // J1 — o alinhamento em si: A segura SÓ as linhas do estorno (o 1º passo
    // de concluir_estorno/registrar_estorno_manual). O cancelamento tem de
    // esperar ANTES de travar o pedido: A consegue travar o pedido em
    // seguida (sem 40P01) e só então solta.
    {
      const p = await pagoComLinha(cliente, "solicitado");
      const a = await conectar(url);
      const b = await conectar(url);
      try {
        await a.query("BEGIN");
        await a.query(
          "SELECT 1 FROM public.order_refunds WHERE order_id = $1 ORDER BY id FOR UPDATE",
          [p.pedidoId],
        );
        // O pid ANTES de disparar: o pg enfileira consultas por conexão, e
        // perguntar o pid de B com B bloqueada travaria a própria prova.
        const pidB = await pid(b);
        await b.query("BEGIN");
        await b.query("SET LOCAL ROLE service_role");
        const promessaB = b.query(SQL_CANCELAR_PAGO, [p.pedidoId, U_ADMIN]);
        promessaB.catch(() => {});
        await esperarBloqueio(cliente, pidB, "J1");
        // O passo 2 de quem segura as linhas: travar o pedido. Com a ordem
        // global, o cancelamento NÃO pegou o pedido antes — isto não espera.
        await a.query("SET LOCAL lock_timeout = '3s'");
        await a.query(
          "SELECT 1 FROM public.marketplace_orders WHERE id = $1 FOR UPDATE",
          [p.pedidoId],
        );
        await a.query("COMMIT");
        const rB = (await promessaB).rows[0].r;
        await b.query("COMMIT");
        assert.equal(rB.cancelado, true, "J1: o cancelamento conclui depois");
        // Remanescente: 100 − 30 em voo = 70 (sob a trava, sem reservar 100).
        assert.deepEqual(
          (await linhasDeEstorno(cliente, p.pedidoId)).map((l) => l.amount),
          [30, 70],
        );
      } finally {
        await a.end().catch(() => {});
        await b.end().catch(() => {});
      }
    }

    // J2 — concluir_estorno (linha em_processamento de 30) × cancelar, nas
    // duas ordens. Sem 40P01; o remanescente é 70 nos dois casos.
    {
      const p = await pagoComLinha(cliente, "em_processamento");
      const { rA, rB } = await emSequencia(
        url,
        cliente,
        (con) =>
          con
            .query(
              "SELECT public.concluir_estorno($1::uuid, 'MPREF98J2', 'approved', 'accredited') AS r",
              [p.linhaId],
            )
            .then((r) => r.rows[0].r),
        (con) =>
          con
            .query(SQL_CANCELAR_PAGO, [p.pedidoId, U_ADMIN])
            .then((r) => r.rows[0].r),
        "J2 concluir→cancelar",
      );
      assert.equal(rA.concluido, true);
      assert.equal(rB.cancelado, true);
      assert.deepEqual(
        (await linhasDeEstorno(cliente, p.pedidoId)).map((l) => [
          l.amount,
          l.status,
        ]),
        [
          [30, "concluido"],
          [70, "solicitado"],
        ],
      );
    }
    {
      const p = await pagoComLinha(cliente, "em_processamento");
      const { rA, rB } = await emSequencia(
        url,
        cliente,
        (con) =>
          con
            .query(SQL_CANCELAR_PAGO, [p.pedidoId, U_ADMIN])
            .then((r) => r.rows[0].r),
        (con) =>
          con
            .query(
              "SELECT public.concluir_estorno($1::uuid, 'MPREF98J2B', 'approved', 'accredited') AS r",
              [p.linhaId],
            )
            .then((r) => r.rows[0].r),
        "J2 cancelar→concluir",
      );
      assert.equal(rA.cancelado, true);
      assert.equal(rB.concluido, true);
      // O cancelamento viu 30 EM VOO: 100 − 30 = 70; a conclusão depois só
      // move os 30 para confirmado. Total devolvido = 100, nunca 130.
      assert.deepEqual(
        (await linhasDeEstorno(cliente, p.pedidoId)).map((l) => l.amount),
        [30, 70],
      );
    }

    // J3 — registrar_estorno_manual (corpo 94) × cancelar, nas duas ordens.
    {
      const p = await pagoComLinha(cliente, "solicitado");
      const { rA, rB } = await emSequencia(
        url,
        cliente,
        (con) =>
          con
            .query("SELECT public.registrar_estorno_manual($1::uuid) AS r", [
              p.pedidoId,
            ])
            .then((r) => r.rows[0].r),
        (con) =>
          con
            .query(SQL_CANCELAR_PAGO, [p.pedidoId, U_ADMIN])
            .then((r) => r.rows[0].r),
        "J3 registrar→cancelar",
      );
      assert.equal(rA.ok, true);
      // O pagamento virou 'estornado' enquanto o cancelamento esperava: o CAS
      // ('pago') recusa e devolve o pedido relido — nada de estorno novo.
      assert.equal(rB.cancelado, false);
      assert.equal(rB.motivo, "cobranca_mudou");
      assert.deepEqual(
        (await linhasDeEstorno(cliente, p.pedidoId)).map((l) => l.status),
        ["recusado"],
      );
    }
    {
      const p = await pagoComLinha(cliente, "solicitado");
      let erroB = null;
      const { rA } = await emSequencia(
        url,
        cliente,
        (con) =>
          con
            .query(SQL_CANCELAR_PAGO, [p.pedidoId, U_ADMIN])
            .then((r) => r.rows[0].r),
        (con) =>
          con
            .query("SELECT public.registrar_estorno_manual($1::uuid) AS r", [
              p.pedidoId,
            ])
            .then((r) => r.rows[0].r)
            .catch((e) => {
              erroB = e;
              return null;
            }),
        "J3 cancelar→registrar",
      );
      assert.equal(rA.cancelado, true);
      assert.notEqual(erroB?.code, "40P01", "sem deadlock");
    }

    // J4 — CONTROLE: a ordem INVERTIDA (pedido antes das linhas) contra o
    // concluir_estorno real dá deadlock. É o que a ordem global evita.
    {
      const p = await pagoComLinha(cliente, "em_processamento");
      const a = await conectar(url);
      const b = await conectar(url);
      const codigos = [];
      try {
        await a.query("BEGIN");
        await a.query(
          "SELECT 1 FROM public.marketplace_orders WHERE id = $1 FOR UPDATE",
          [p.pedidoId],
        );
        const pidB = await pid(b);
        await b.query("BEGIN");
        await b.query("SET LOCAL ROLE service_role");
        const promessaB = b
          .query(
            "SELECT public.concluir_estorno($1::uuid, 'MPREF98J4', 'approved', 'accredited')",
            [p.linhaId],
          )
          .catch((e) => {
            codigos.push(e.code);
          });
        await esperarBloqueio(cliente, pidB, "J4");
        await a
          .query(
            "SELECT 1 FROM public.order_refunds WHERE order_id = $1 ORDER BY id FOR UPDATE",
            [p.pedidoId],
          )
          .catch((e) => {
            codigos.push(e.code);
          });
        await promessaB;
        await a.query("ROLLBACK").catch(() => {});
        await b.query("ROLLBACK").catch(() => {});
      } finally {
        await a.end().catch(() => {});
        await b.end().catch(() => {});
      }
      assert.ok(
        codigos.includes("40P01"),
        `a ordem invertida devia dar deadlock; códigos: ${JSON.stringify(codigos)}`,
      );
    }
  },
});

let protocolo = 0;

/**
 * Devolução CONCLUÍDA com reembolso RECUSADO pelo MP (o caso que a
 * reemissão existe para refazer), num pedido entregue e pago pelo app
 * (total 100). A linha recusada é de 30.
 */
async function devolucaoRecusada(cliente) {
  protocolo += 1;
  const vaga = `ORD98DEV${protocolo}`;
  const p = await criarPedido(cliente, {
    status: "delivered",
    paymentStatus: "pago",
    paidAt: new Date().toISOString(),
    vaga,
    metodo: "pix",
  });
  const linha = await cliente.query(
    `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
     VALUES ($1, 30, 'devolução recusada pelo MP', 'lojista', 'recusado') RETURNING id`,
    [p.pedidoId],
  );
  const dev = await cliente.query(
    `INSERT INTO public.devolucoes
       (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
        modalidade, metodo_retorno, status, valor_itens, valor_reembolso, refund_id,
        reembolso_manual, prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
             'local', 'entrega_na_loja', 'concluida', 30, 30, $4,
             false, current_date + 7, '{}'::jsonb, now())
     RETURNING id`,
    [`DEV98-${protocolo}`, p.pedidoId, U_CLIENTE, linha.rows[0].id],
  );
  return {
    ...p,
    vaga,
    linhaRecusada: linha.rows[0].id,
    devolucaoId: dev.rows[0].id,
  };
}

/**
 * A conexão A segura as LINHAS do pedido (o 1º passo de quem segue a ordem
 * global); a B chama `sqlB`. Espera B bloquear, e então A tenta travar o
 * PEDIDO. Com a ordem global, B ainda não pegou o pedido: A trava e solta, B
 * conclui. Com a ordem invertida, B já segura o pedido: deadlock (40P01).
 * Devolve os códigos de erro e o resultado de B.
 */
async function linhasDepoisPedido(
  url,
  observador,
  pedidoId,
  sqlB,
  argsB,
  rotulo,
) {
  const a = await conectar(url);
  const b = await conectar(url);
  const codigos = [];
  let resultadoB = null;
  try {
    await a.query("BEGIN");
    await a.query(
      "SELECT 1 FROM public.order_refunds WHERE order_id = $1 ORDER BY id FOR UPDATE",
      [pedidoId],
    );
    const pidB = await pid(b);
    await b.query("BEGIN");
    await b.query("SET LOCAL ROLE service_role");
    const promessaB = b
      .query(sqlB, argsB)
      .then((r) => {
        resultadoB = r.rows[0]?.r ?? null;
      })
      .catch((e) => {
        codigos.push(e.code);
      });
    await esperarBloqueio(observador, pidB, rotulo);
    await a.query("SET LOCAL lock_timeout = '5s'");
    await a
      .query(
        "SELECT 1 FROM public.marketplace_orders WHERE id = $1 FOR UPDATE",
        [pedidoId],
      )
      .catch((e) => {
        codigos.push(e.code);
      });
    await a.query(codigos.length ? "ROLLBACK" : "COMMIT").catch(() => {});
    await promessaB;
    await b.query(codigos.length ? "ROLLBACK" : "COMMIT").catch(() => {});
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
  return { codigos, resultadoB };
}

const SQL_REEMITIR =
  "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, false) AS r";

PROVAS.push({
  nome: "(k) admin_devolucao_reemitir_reembolso trava as linhas ANTES do pedido: cancelar × reemitir e reemitir × concluir_estorno sem deadlock; o corpo da 97 dá 40P01",
  corpo: async (cliente, url) => {
    assert.equal(await md5Reemitir(cliente), HASH_98_REEMITIR);

    // K1 — quem segura as linhas faz a reemissão esperar antes do pedido.
    {
      const d = await devolucaoRecusada(cliente);
      const { codigos, resultadoB } = await linhasDepoisPedido(
        url,
        cliente,
        d.pedidoId,
        SQL_REEMITIR,
        [d.devolucaoId],
        "K1",
      );
      assert.deepEqual(codigos, [], "K1: sem 40P01 nem lock_timeout");
      assert.equal(resultadoB.reembolso_manual, false);
      assert.ok(resultadoB.refund_id, "K1: a reemissão abriu a linha nova");
    }

    // K2 — cancelar × reemitir, nas duas ordens (2 conexões de verdade).
    {
      const d = await devolucaoRecusada(cliente);
      const { rA, rB } = await emSequencia(
        url,
        cliente,
        (con) =>
          con.query(SQL_REEMITIR, [d.devolucaoId]).then((r) => r.rows[0].r),
        (con) =>
          con
            .query(
              "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, $3::text, 'pago') AS r",
              [d.pedidoId, U_ADMIN, d.vaga],
            )
            .then((r) => r.rows[0].r),
        "K2 reemitir→cancelar",
      );
      assert.ok(rA.refund_id);
      assert.equal(rB.cancelado, true);
    }
    {
      const d = await devolucaoRecusada(cliente);
      let erroB = null;
      const { rA } = await emSequencia(
        url,
        cliente,
        (con) =>
          con
            .query(
              "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, $3::text, 'pago') AS r",
              [d.pedidoId, U_ADMIN, d.vaga],
            )
            .then((r) => r.rows[0].r),
        (con) =>
          con
            .query(SQL_REEMITIR, [d.devolucaoId])
            .then((r) => r.rows[0].r)
            .catch((e) => {
              erroB = e;
              return null;
            }),
        "K2 cancelar→reemitir",
      );
      assert.equal(rA.cancelado, true);
      // O pedido deixou de estar entregue enquanto a reemissão esperava: ela
      // recusa pela regra dela (22023) — nunca deadlock.
      assert.equal(erroB?.code, "22023");
      assert.match(erroB.message, /não está mais entregue/);
    }

    // K3 — reemitir × concluir_estorno (outra linha do mesmo pedido em
    // processamento), nas duas ordens.
    for (const reemitirPrimeiro of [true, false]) {
      const d = await devolucaoRecusada(cliente);
      const outra = await cliente.query(
        `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
         VALUES ($1, 20, 'outra devolução em voo', 'lojista', 'em_processamento') RETURNING id`,
        [d.pedidoId],
      );
      const reemitir = (con) =>
        con.query(SQL_REEMITIR, [d.devolucaoId]).then((r) => r.rows[0].r);
      const concluir = (con) =>
        con
          .query(
            "SELECT public.concluir_estorno($1::uuid, $2, 'approved', 'accredited') AS r",
            [outra.rows[0].id, `MPREF98K3${reemitirPrimeiro ? "a" : "b"}`],
          )
          .then((r) => r.rows[0].r);
      const { rA, rB } = await emSequencia(
        url,
        cliente,
        reemitirPrimeiro ? reemitir : concluir,
        reemitirPrimeiro ? concluir : reemitir,
        `K3 ${reemitirPrimeiro ? "reemitir→concluir" : "concluir→reemitir"}`,
      );
      const re = reemitirPrimeiro ? rA : rB;
      const co = reemitirPrimeiro ? rB : rA;
      assert.ok(re.refund_id);
      assert.equal(co.concluido, true);
    }

    // K4 — CONTROLE: o corpo da 97 (pedido → linha), copiado com outro nome,
    // no MESMO cenário do K1 dá deadlock. É o que a 98 corrige.
    const m97 = fs
      .readFileSync(path.join(PASTA, NOME_97), "utf8")
      .replace(/\r\n/g, "\n");
    const i97 = m97.indexOf(
      "CREATE OR REPLACE FUNCTION public.admin_devolucao_reemitir_reembolso(",
    );
    const corpo97 = m97
      .slice(i97, m97.indexOf("\n$$;", i97) + 4)
      .replace(
        "public.admin_devolucao_reemitir_reembolso(",
        "public.reemitir_97_controle_98(",
      );
    await cliente.query(corpo97);
    await cliente.query(
      "GRANT EXECUTE ON FUNCTION public.reemitir_97_controle_98(uuid, boolean) TO service_role",
    );
    try {
      const d = await devolucaoRecusada(cliente);
      const { codigos } = await linhasDepoisPedido(
        url,
        cliente,
        d.pedidoId,
        "SELECT public.reemitir_97_controle_98($1::uuid, false) AS r",
        [d.devolucaoId],
        "K4",
      );
      assert.ok(
        codigos.includes("40P01"),
        `o corpo da 97 devia dar deadlock; códigos: ${JSON.stringify(codigos)}`,
      );
    } finally {
      await cliente.query(
        "DROP FUNCTION IF EXISTS public.reemitir_97_controle_98(uuid, boolean)",
      );
    }
  },
});

PROVAS.push({
  nome: "(e) corrida com duas conexões: cancelar × confirmar_pagamento('pago') — nunca estado incoerente, estoque 1x",
  corpo: async (cliente, url) => {
    // Ordem 1: o cancelamento pega o lock primeiro.
    const c1 = await criarPedido(cliente, {
      vaga: "ORD98CORRIDA1",
      metodo: "pix",
    });
    const o1 = await correr(url, cliente, {
      primeiro: (con) =>
        con
          .query(
            "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, 'ORD98CORRIDA1', 'aguardando') AS r",
            [c1.pedidoId, U_CLIENTE],
          )
          .then((r) => r.rows[0].r),
      segundo: (con) =>
        con
          .query(
            "SELECT public.confirmar_pagamento($1::uuid, 'ORD98CORRIDA1', 'pago') AS r",
            [c1.pedidoId],
          )
          .then((r) => r.rows[0].r),
    });
    assert.equal(o1.rA.cancelado, true);
    assert.equal(o1.rB, "pago_apos_expirar");
    const f1 = await pedido(cliente, c1.pedidoId);
    assert.deepEqual(
      [f1.status, f1.payment_status],
      ["cancelled", "pago_apos_expirar"],
    );
    assert.equal(
      await estoque(cliente, c1.produtoId),
      ESTOQUE_INICIAL + QTD,
      "estoque volta UMA vez",
    );

    // Ordem 2: o pagamento pega o lock primeiro.
    const c2 = await criarPedido(cliente, {
      vaga: "ORD98CORRIDA2",
      metodo: "pix",
    });
    const o2 = await correr(url, cliente, {
      primeiro: (con) =>
        con
          .query(
            "SELECT public.confirmar_pagamento($1::uuid, 'ORD98CORRIDA2', 'pago') AS r",
            [c2.pedidoId],
          )
          .then((r) => r.rows[0].r),
      segundo: (con) =>
        con
          .query(
            "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, 'ORD98CORRIDA2', 'aguardando') AS r",
            [c2.pedidoId, U_CLIENTE],
          )
          .then((r) => r.rows[0].r),
    });
    assert.equal(o2.rA, "pago");
    assert.equal(o2.rB.cancelado, false);
    assert.equal(o2.rB.motivo, "cobranca_mudou");
    const f2 = await pedido(cliente, c2.pedidoId);
    assert.deepEqual([f2.status, f2.payment_status], ["pending", "pago"]);
    assert.equal(
      await estoque(cliente, c2.produtoId),
      ESTOQUE_INICIAL,
      "pago e vivo: estoque intacto",
    );
  },
});

PROVAS.push({
  nome: "(f) rollback byte a byte, reaplicação idempotente, preflight e guarda do rollback recusam corpo divergente",
  corpo: async (cliente) => {
    const sql98 = fs.readFileSync(CAMINHO_98, "utf8");
    const sqlRollback = fs.readFileSync(CAMINHO_ROLLBACK_98, "utf8");
    await cliente.query("BEGIN");
    try {
      // Reaplicar a 98 por cima dela mesma: idempotente.
      await cliente.query(sql98);
      assert.equal(await md5Vivo(cliente), HASH_98);
      assert.equal(await md5Reemitir(cliente), HASH_98_REEMITIR);

      await cliente.query(sqlRollback);
      assert.equal(
        await md5Vivo(cliente),
        HASH_80,
        "o rollback devolve o corpo da 80 byte a byte",
      );
      assert.equal(
        await md5Reemitir(cliente),
        HASH_97_REEMITIR,
        "o rollback devolve o reemitir da 97 byte a byte",
      );
      const restantes = await cliente.query(
        `SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
           AND proname IN ('cancelar_pedido_com_cobranca', 'pedido__mudar_status', 'pedido__saldo_a_estornar')`,
      );
      assert.deepEqual(restantes.rows, []);
      // Rollback repetido: idempotente.
      await cliente.query(sqlRollback);
      assert.equal(await md5Vivo(cliente), HASH_80);
      // E a 98 aplica de novo por cima da 80/97.
      await cliente.query(sql98);
      assert.equal(await md5Vivo(cliente), HASH_98);
      assert.equal(await md5Reemitir(cliente), HASH_98_REEMITIR);

      // Corpo de uma migration POSTERIOR: preflight da 98 e guarda do
      // rollback recusam.
      await cliente.query(`
        CREATE OR REPLACE FUNCTION public.update_order_status_atomic(
          p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL, p_silent boolean DEFAULT FALSE
        ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $divergente$
        BEGIN RETURN jsonb_build_object('divergente', true); END;
        $divergente$;
      `);
      await cliente.query("SAVEPOINT s1");
      await assert.rejects(cliente.query(sql98), /B1_BASELINE_DIVERGENT/);
      await cliente.query("ROLLBACK TO SAVEPOINT s1");
      await assert.rejects(cliente.query(sqlRollback), /migration posterior/);
      await cliente.query("ROLLBACK TO SAVEPOINT s1");
    } finally {
      await cliente.query("ROLLBACK");
    }
    assert.equal(
      await md5Vivo(cliente),
      HASH_98,
      "nada vazou da prova para o banco",
    );
  },
});

PROVAS.push({
  nome: "(g) CONTROLE: contra o corpo ANTIGO (80) a asserção do bypass FALHA — o teste (a) distingue defeito de conserto",
  corpo: async (cliente) => {
    const sqlRollback = fs.readFileSync(CAMINHO_ROLLBACK_98, "utf8");
    await cliente.query("BEGIN");
    try {
      await cliente.query(sqlRollback);
      await cliente.query("SAVEPOINT controle");
      let pegouODefeito = false;
      try {
        await casosDoBypass(cliente, "g");
      } catch (erro) {
        pegouODefeito = /Missing expected rejection/.test(erro.message);
        if (!pegouODefeito) throw erro;
      }
      assert.ok(
        pegouODefeito,
        "com o corpo da 80, o cancelamento com PIX na vaga PASSA — a asserção do bypass tem de reprovar",
      );
      await cliente.query("ROLLBACK TO SAVEPOINT controle");
    } finally {
      await cliente.query("ROLLBACK");
    }
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
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
        await corpo(cliente, url);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva do cancelamento que anula a cobrança (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra do cancelamento com cobrança foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[cancelar-98] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do cancelamento que anula a cobrança (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
