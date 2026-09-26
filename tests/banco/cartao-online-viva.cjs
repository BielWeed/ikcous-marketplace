"use strict";

/**
 * PROVA VIVA da migration 20261176000000_o_cartao_online_nasce.sql (plano
 * docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md, tarefa 2)
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (a) configuração: nasce DESLIGADA; visitante lê; só admin salva; teto de
 *       parcelas fora de 1..12 é recusado.
 *   (b) colunas do pedido: pedido existente fica com 0/NULL/NULL; CHECKs
 *       recusam método e parcelas inválidos.
 *   (c) liberar_cobranca_do_pedido: solta só a cobrança que AINDA é a
 *       gravada, só com o pedido aguardando e sem pagamento, conta a
 *       tentativa; sem id, só conta quando a vaga está vazia.
 *   (d) liberar_cobranca_do_pedido é do service role: authenticated não
 *       executa.
 *   (7) achado 7 da revisão de 26/09/2026 (rodada 2): confirmar_pagamento
 *       ('estornado') — o caminho DIRETO do Mercado Pago, fora de
 *       registrar_estorno_manual — também carimba estorno_manual_registrado_em
 *       pelo gatilho novo, e uma edição qualquer POSTERIOR do pedido não
 *       empurra esse carimbo (a mesma razão do achado F, por outra porta).
 *   (e) achado independente de risco (dinheiro, 26/09/2026) — migration
 *       20261180000000_cliente_nao_cancela_com_cartao_vivo.sql:
 *       update_order_status_atomic recusa o CLIENTE (nunca o admin) quando o
 *       pedido está 'aguardando' com uma cobrança de cartão em jogo (vaga
 *       gravada com metodo_online credito/debito, OU o sentinela
 *       `verificando:`); PIX 'aguardando' e admin continuam cancelando como
 *       antes; pedido já PAGO segue o ledger do estorno automático de sempre.
 *       Casos A/B/C/D/F/G do laudo de revisão (rodadas 2 e 3, `prova-
 *       rev80.cjs`), portados para a suíte viva do CI. O caso E (vaga E
 *       metodo_online NULL) é um GAP CONHECIDO, documentado no próprio
 *       teste — e NÃO é o 409 de idempotência (esse já é coberto hoje: o 409
 *       `idempotency_key_already_used`, corrida de retry com o MESMO token,
 *       já grava o sentinela `verificando:` na hora, em `fe045945`/`fe045939`
 *       — `criar-pagamento/index.ts:1598-1607`, `respostaCartaoEmVerificacao`
 *       — e o caso C acima prova que a guarda alcança). O gap real é a falha
 *       de REDE/timeout/5xx na CRIAÇÃO da cobrança (`criar-pagamento/
 *       index.ts:1742-1745`, `!r.ok`): hoje isso responde 502 SEM tocar a
 *       vaga — nada foi cobrado com certeza, mas o MP pode ter processado a
 *       order antes de a resposta se perder — e a guarda não tem o que ler.
 *       Só fecha quando a edge de `fix/cartao-edge-achados` publicar
 *       (`respostaCartaoAmbiguoNaCriacao`, commit `bf15876f`), porque é ELA
 *       quem passa a gravar o sentinela `verificando:` nesse 502 de criação
 *       (ver o cabeçalho da migration 20261180000000 para a citação exata).
 *
 * USO: node tests/banco/cartao-online-viva.cjs (depois de provisionar.cjs e
 * aplicar-migrations.cjs, como no rpc-ci.yml)
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_CLIENTE = "41111111-1111-1111-1111-111111111111";
const U_ADMIN = "42222222-2222-2222-2222-222222222222";
const O_AGUARDANDO = "4ccccccc-0000-0000-0000-000000000001";
const O_PAGO = "4ccccccc-0000-0000-0000-000000000002";

// (e) update_order_status_atomic / 20261180000000 — pedidos próprios, para
// não perturbar a sequência que (b)/(c)/(d) já esperam em O_AGUARDANDO/O_PAGO.
const O_CARTAO_CREDITO = "4ccccccc-0000-0000-0000-00000000000a";
const O_CARTAO_DEBITO = "4ccccccc-0000-0000-0000-00000000000b";
const O_SENTINELA = "4ccccccc-0000-0000-0000-00000000000c";
const O_PIX_AGUARDANDO = "4ccccccc-0000-0000-0000-00000000000d";
const O_GAP_502_AMBIGUO = "4ccccccc-0000-0000-0000-00000000000e";
const O_ADMIN_CARTAO = "4ccccccc-0000-0000-0000-00000000000f";
const O_PAGO_CREDITO = "4ccccccc-0000-0000-0000-000000000010";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}

async function linhaDoPedido(cliente, id) {
  const r = await cliente.query(
    `SELECT gateway_payment_id, tentativas_de_pagamento, metodo_online, parcelas
       FROM public.marketplace_orders WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

async function liberar(cliente, id, gateway) {
  const r = await cliente.query(
    "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2::text) AS r",
    [id, gateway],
  );
  return r.rows[0].r;
}

const PROVAS = [];

PROVAS.push({
  nome: "(a) configuração nasce desligada, visitante lê, só admin salva, teto 1..12",
  corpo: async (cliente) => {
    for (const [id, email, meta] of [
      [U_CLIENTE, "cliente@cartao.teste", "{}"],
      [U_ADMIN, "admin@cartao.teste", '{"role":"admin"}'],
    ]) {
      await cliente.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [id, email, meta],
      );
    }
    await cliente.query("BEGIN");
    try {
      await cliente.query("SET LOCAL ROLE anon");
      const r = await cliente.query(
        "SELECT credito, debito, parcelas_max FROM public.config_pagamento_cartao WHERE id = 1",
      );
      assert.deepEqual(r.rows[0], {
        credito: false,
        debito: false,
        parcelas_max: 1,
      });
      await cliente.query("SAVEPOINT s1");
      await assert.rejects(
        () =>
          cliente.query(
            "UPDATE public.config_pagamento_cartao SET credito = true",
          ),
        /permission denied/,
      );
      await cliente.query("ROLLBACK TO SAVEPOINT s1");
      // Achado L (revisão de 26/09/2026): grant por coluna — anon lê
      // credito/debito/parcelas_max/updated_at, mas não updated_by (o uuid
      // do admin que mexeu por último não é dado público).
      await assert.rejects(
        () =>
          cliente.query(
            "SELECT updated_by FROM public.config_pagamento_cartao WHERE id = 1",
          ),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }

    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        cliente.query(
          "SELECT public.salvar_config_pagamento_cartao(true, true, 6)",
        ),
      /Acesso negado/,
    );
    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        cliente.query(
          "SELECT public.salvar_config_pagamento_cartao(true, false, 13)",
        ),
      /1 a 12/,
    );
    const salvo = (
      await cliente.query(
        "SELECT public.salvar_config_pagamento_cartao(true, true, 6) AS r",
      )
    ).rows[0].r;
    assert.equal(salvo.credito, true);
    assert.equal(salvo.debito, true);
    assert.equal(salvo.parcelas_max, 6);
  },
});

PROVAS.push({
  nome: "(b) colunas do pedido: defaults de hoje e CHECKs",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
          payment_method, payment_status, expires_at, gateway_payment_id)
       VALUES ($1, $3, 'Cliente Cartão', '{}'::jsonb, 50, 50, 'pending', 'online',
               'online', 'aguardando', now() + interval '30 minutes', 'ORD-CARTAO-1'),
              ($2, $3, 'Cliente Cartão', '{}'::jsonb, 50, 50, 'processing', 'online',
               'online', 'pago', now() + interval '30 minutes', 'ORD-CARTAO-2')`,
      [O_AGUARDANDO, O_PAGO, U_CLIENTE],
    );
    await cliente.query(
      "UPDATE public.marketplace_orders SET paid_at = now() WHERE id = $1",
      [O_PAGO],
    );
    const linha = await linhaDoPedido(cliente, O_AGUARDANDO);
    assert.equal(linha.tentativas_de_pagamento, 0);
    assert.equal(linha.metodo_online, null);
    assert.equal(linha.parcelas, null);
    await assert.rejects(
      () =>
        cliente.query(
          "UPDATE public.marketplace_orders SET metodo_online = 'boleto' WHERE id = $1",
          [O_AGUARDANDO],
        ),
      /metodo_online_check/,
    );
    await assert.rejects(
      () =>
        cliente.query(
          "UPDATE public.marketplace_orders SET parcelas = 13 WHERE id = $1",
          [O_AGUARDANDO],
        ),
      /parcelas_check/,
    );
  },
});

PROVAS.push({
  nome: "(c) liberar_cobranca_do_pedido solta só a cobrança gravada, com o pedido aguardando",
  corpo: async (cliente) => {
    await cliente.query(
      "UPDATE public.marketplace_orders SET metodo_online = 'credito', parcelas = 3 WHERE id = $1",
      [O_AGUARDANDO],
    );
    // Resposta atrasada de outra cobrança: não mexe.
    assert.equal(await liberar(cliente, O_AGUARDANDO, "ORD-ANTIGA"), false);
    assert.equal(
      (await linhaDoPedido(cliente, O_AGUARDANDO)).gateway_payment_id,
      "ORD-CARTAO-1",
    );
    // Sem id com a vaga ocupada: não conta.
    assert.equal(await liberar(cliente, O_AGUARDANDO, null), false);

    assert.equal(await liberar(cliente, O_AGUARDANDO, "ORD-CARTAO-1"), true);
    let linha = await linhaDoPedido(cliente, O_AGUARDANDO);
    assert.equal(linha.gateway_payment_id, null);
    assert.equal(linha.metodo_online, null);
    assert.equal(linha.parcelas, null);
    assert.equal(linha.tentativas_de_pagamento, 1);
    // Segunda vez: nada a liberar.
    assert.equal(await liberar(cliente, O_AGUARDANDO, "ORD-CARTAO-1"), false);
    // Recusa imediata (sem id, vaga vazia): conta a tentativa.
    assert.equal(await liberar(cliente, O_AGUARDANDO, null), true);
    linha = await linhaDoPedido(cliente, O_AGUARDANDO);
    assert.equal(linha.tentativas_de_pagamento, 2);
    // Pedido pago nunca perde a cobrança.
    assert.equal(await liberar(cliente, O_PAGO, "ORD-CARTAO-2"), false);
    assert.equal(
      (await linhaDoPedido(cliente, O_PAGO)).gateway_payment_id,
      "ORD-CARTAO-2",
    );
  },
});

PROVAS.push({
  nome: "(d) liberar_cobranca_do_pedido é só do service role",
  corpo: async (cliente) => {
    await cliente.query("BEGIN");
    try {
      await logar(cliente, U_CLIENTE);
      await cliente.query("SET LOCAL ROLE authenticated");
      await assert.rejects(
        () => liberar(cliente, O_AGUARDANDO, null),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }
    await cliente.query("BEGIN");
    try {
      await cliente.query("SET LOCAL ROLE service_role");
      assert.equal(await liberar(cliente, O_AGUARDANDO, null), true);
    } finally {
      await cliente.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(7) confirmar_pagamento('estornado') carimba o mesmo campo que registrar_estorno_manual",
  corpo: async (cliente) => {
    const antes = (
      await cliente.query(
        "SELECT estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
        [O_PAGO],
      )
    ).rows[0];
    assert.equal(
      antes.estorno_manual_registrado_em,
      null,
      "O_PAGO ainda não foi estornado por nenhum caminho",
    );

    // O caminho DIRETO (gateway avisando por fora do ledger de order_refunds
    // — nunca passa por registrar_estorno_manual): mesmo assim o gatilho do
    // achado 7 carimba.
    await cliente.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'estornado') AS r",
      [O_PAGO, "ORD-CARTAO-2"],
    );
    const depois = (
      await cliente.query(
        "SELECT payment_status, estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
        [O_PAGO],
      )
    ).rows[0];
    assert.equal(depois.payment_status, "estornado");
    assert.notEqual(
      depois.estorno_manual_registrado_em,
      null,
      "achado 7: o gatilho carimba mesmo sem passar por registrar_estorno_manual",
    );

    // A MESMA razão do achado F, por outra porta: uma edição qualquer
    // POSTERIOR do pedido (aqui, uma coluna que nem é payment_status) não
    // pode empurrar o carimbo — o gatilho é `UPDATE OF payment_status`, e
    // dentro dele só grava na PRIMEIRA vez (COALESCE).
    const carimbo1 = depois.estorno_manual_registrado_em;
    await cliente.query(
      "UPDATE public.marketplace_orders SET notes = 'nota qualquer, sem relação com o estorno' WHERE id = $1",
      [O_PAGO],
    );
    const outraVolta = (
      await cliente.query(
        "SELECT estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
        [O_PAGO],
      )
    ).rows[0];
    assert.equal(
      outraVolta.estorno_manual_registrado_em.getTime(),
      carimbo1.getTime(),
      "uma edição qualquer depois não pode empurrar o carimbo do estorno",
    );

    // Chamar de novo com o mesmo payment_id: 'ja_estornado', e o carimbo
    // continua o mesmo (não regrava).
    const resultado = await cliente.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'estornado') AS r",
      [O_PAGO, "ORD-CARTAO-2"],
    );
    assert.equal(resultado.rows[0].r, "ja_estornado");
  },
});

const MENSAGEM_CARTAO_VIVO = /cobrança no cartão em confirmação com o banco/;

async function criarPedidoParaCancelamento(
  cliente,
  id,
  { metodo, vaga, paymentStatus = "aguardando", paidAt = null },
) {
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, expires_at, metodo_online, gateway_payment_id, paid_at)
     VALUES ($1, $2, 'Cliente Cartão', '{}'::jsonb, 80, 80, 'pending', 'online',
             'online', $5, now() + interval '30 minutes', $3, $4, $6)`,
    [id, U_CLIENTE, metodo, vaga, paymentStatus, paidAt],
  );
}

async function cancelarComo(cliente, userId, id) {
  await logar(cliente, userId);
  return cliente.query(
    "SELECT public.update_order_status_atomic($1::uuid, 'cancelled', NULL, false) AS r",
    [id],
  );
}

// (nit A/B/C da revisão, rodada 3): a recusa precisa sair com code P0001 —
// é o ÚNICO código que `mensagemAmigavelErroAtualizacaoStatus`
// (src/hooks/useOrders.ts) repassa ao cliente tal como veio do banco; um
// ERRCODE diferente faria o front mostrar o genérico "Não foi possível
// atualizar..." em vez desta mensagem (ver o cabeçalho da 20261180000000).
async function assertRecusaCartaoVivo(promessa) {
  await assert.rejects(promessa, (erro) => {
    assert.equal(
      erro.code,
      "P0001",
      "front só repassa a mensagem quando o SQLSTATE é P0001",
    );
    assert.match(erro.message, MENSAGEM_CARTAO_VIVO);
    return true;
  });
}

PROVAS.push({
  nome: "(e) update_order_status_atomic (20261180000000) recusa o cliente com cartão vivo; PIX e admin continuam",
  corpo: async (cliente) => {
    for (const [id, email, meta] of [
      [U_CLIENTE, "cliente-cancela@cartao.teste", "{}"],
      [U_ADMIN, "admin-cancela@cartao.teste", '{"role":"admin"}'],
    ]) {
      await cliente.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [id, email, meta],
      );
    }

    // A: crédito com id real na vaga — a cobrança pode ser aprovada a
    // qualquer momento (3DS/antifraude). O cliente NÃO cancela.
    await criarPedidoParaCancelamento(cliente, O_CARTAO_CREDITO, {
      metodo: "credito",
      vaga: "ORD-CANCELA-CREDITO",
    });
    await assertRecusaCartaoVivo(
      cancelarComo(cliente, U_CLIENTE, O_CARTAO_CREDITO),
    );
    assert.equal(
      (await linhaDoPedido(cliente, O_CARTAO_CREDITO)).gateway_payment_id,
      "ORD-CANCELA-CREDITO",
      "a vaga do crédito não pode ter sido tocada pela recusa",
    );

    // B: débito — mesma guarda, mesma recusa.
    await criarPedidoParaCancelamento(cliente, O_CARTAO_DEBITO, {
      metodo: "debito",
      vaga: "ORD-CANCELA-DEBITO",
    });
    await assertRecusaCartaoVivo(
      cancelarComo(cliente, U_CLIENTE, O_CARTAO_DEBITO),
    );

    // C: sentinela de verificação (metodo_online NULL — a adoção é quem
    // grava a forma, nunca o próprio sentinela). Também recusa: a cobrança
    // da tentativa anterior pode estar aprovada por baixo. Este é o 409
    // idempotency_key_already_used (retry com o MESMO token) — JÁ coberto
    // hoje (fe045939): a distinção com o gap real do caso E está no
    // cabeçalho deste arquivo.
    await criarPedidoParaCancelamento(cliente, O_SENTINELA, {
      metodo: null,
      vaga: "verificando:ORD-CANCELA-SENTINELA:c0:1790000000000",
    });
    await assertRecusaCartaoVivo(cancelarComo(cliente, U_CLIENTE, O_SENTINELA));

    // D: PIX aguardando — nada muda, o cliente cancela como sempre.
    await criarPedidoParaCancelamento(cliente, O_PIX_AGUARDANDO, {
      metodo: "pix",
      vaga: "ORD-CANCELA-PIX",
    });
    await cancelarComo(cliente, U_CLIENTE, O_PIX_AGUARDANDO);
    assert.equal(
      (await estadoDoPedidoAposCancelar(cliente, O_PIX_AGUARDANDO)).status,
      "cancelled",
    );

    // E — GAP CONHECIDO (ver o cabeçalho deste arquivo e o cabeçalho da
    // 20261180000000): vaga E metodo_online NULL é o estado que uma falha de
    // REDE/timeout/5xx na CRIAÇÃO da cobrança deixa HOJE em produção
    // (fe045939, `criar-pagamento/index.ts:1742-1745`, antes de
    // fix/cartao-edge-achados publicar) — NÃO o 409 de idempotência (esse já
    // grava o sentinela hoje, ver o caso C acima). A guarda não tem o que
    // ler — o cliente CANCELA. Isto não é uma falha desta migration: é o
    // motivo documentado pelo qual "ligar o cartão" também exige aquela edge
    // (ver docs/runbooks/publicar-painel-cartao-devolucoes.md, §6).
    await criarPedidoParaCancelamento(cliente, O_GAP_502_AMBIGUO, {
      metodo: null,
      vaga: null,
    });
    await cancelarComo(cliente, U_CLIENTE, O_GAP_502_AMBIGUO);
    assert.equal(
      (await estadoDoPedidoAposCancelar(cliente, O_GAP_502_AMBIGUO)).status,
      "cancelled",
      "GAP CONHECIDO: sem a edge de fix/cartao-edge-achados a vaga fica NULL e a guarda não alcança este caso",
    );

    // F (achado da revisão, rodada 3 — mutante M1 sobrevivia aqui: trocar
    // `v_payment_status = 'aguardando'` por `v_payment_status IS NOT NULL`
    // faria esta guarda travar TAMBÉM um pedido já pago, e nenhuma prova
    // viva cobria esse caso ainda). Pedido de CRÉDITO já PAGO, não enviado:
    // a guarda nova não se aplica (só olha 'aguardando'), o cliente cancela
    // normalmente e o ledger do estorno automático (Seção 11 da 175) abre a
    // linha em order_refunds — comportamento de hoje, intocado pela 80.
    await criarPedidoParaCancelamento(cliente, O_PAGO_CREDITO, {
      metodo: "credito",
      vaga: "ORD-CANCELA-PAGO",
      paymentStatus: "pago",
      paidAt: new Date().toISOString(),
    });
    await cancelarComo(cliente, U_CLIENTE, O_PAGO_CREDITO);
    const estadoPago = await estadoDoPedidoAposCancelar(
      cliente,
      O_PAGO_CREDITO,
    );
    assert.equal(estadoPago.status, "cancelled");
    const refundsPago = await cliente.query(
      "SELECT count(*)::int AS n FROM public.order_refunds WHERE order_id = $1",
      [O_PAGO_CREDITO],
    );
    assert.equal(
      refundsPago.rows[0].n,
      1,
      "cartão já pago e cancelado antes do envio abre UMA linha no ledger do estorno, igual a qualquer outra forma de pagamento",
    );

    // G: ADMIN cancela um pedido com cartão vivo — a guarda mora só no ramo
    // do cliente; a reconciliação do painel depende disto continuar assim.
    await criarPedidoParaCancelamento(cliente, O_ADMIN_CARTAO, {
      metodo: "credito",
      vaga: "ORD-CANCELA-ADMIN",
    });
    await cancelarComo(cliente, U_ADMIN, O_ADMIN_CARTAO);
    assert.equal(
      (await estadoDoPedidoAposCancelar(cliente, O_ADMIN_CARTAO)).status,
      "cancelled",
    );
  },
});

async function estadoDoPedidoAposCancelar(cliente, id) {
  const r = await cliente.query(
    "SELECT status FROM public.marketplace_orders WHERE id = $1",
    [id],
  );
  return r.rows[0];
}

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
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva do cartão online (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra do cartão online foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(`\n[cartao] ${PROVAS.length}/${PROVAS.length} provas passaram.`);
  anexarAoSummary(
    "Prova viva do cartão online (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
