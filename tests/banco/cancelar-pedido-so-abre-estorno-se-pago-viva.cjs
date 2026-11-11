"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, FX,
 * nomes de cenário); nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA (só teste; nenhum SQL de produção muda) de que cancelar um pedido
 * SÓ abre o estorno automático (uma linha em order_refunds) quando o pedido foi
 * pago de verdade. Quem segura é o `IF` do LEDGER DO ESTORNO em
 * `public.pedido__mudar_status` (20261198000000, a porta que o painel e o app
 * usam por `update_order_status_atomic`):
 *
 *     p_new_status = 'cancelled'
 *     AND v_old_status IN ('pending', 'processing')
 *     AND v_payment_status IN ('pago', 'pago_apos_expirar')
 *     AND v_paid_at IS NOT NULL
 *     AND NOT v_cancelled_after_shipping
 *
 * Linha de estorno que não devia nascer vira devolução de dinheiro que ninguém
 * recebeu: o lojista veria um "estorno pendente" de um pedido que nunca foi pago.
 *
 * CENÁRIOS (cancelar como admin ATUAL, papel authenticated + JWT de admin, do
 * jeito do painel; cada um num SAVEPOINT desfeito; em TODOS o pedido tem de
 * terminar 'cancelled' — senão o "0 linhas" seria vácuo — e tem 1 item):
 *   C1  processing, payment_status 'aguardando' (com paid_at preenchido: só a
 *       forma do pagamento barra) -> 0 linhas
 *   C2  processing, payment_status NULL, método 'cash' (com paid_at preenchido)
 *       -> 0 linhas
 *   C3  processing, 'recebido_na_entrega' com paid_at preenchido -> 0 linhas
 *   C4  processing, 'pago' mas paid_at NULL (dado legado) -> 0 linhas
 *   C5  shipping, 'pago', paid_at preenchido, cancelled_after_shipping ainda
 *       false (o estado ANTES do cancelamento) -> 0 linhas; o produto saiu, o
 *       estorno espera o lojista
 *   K1  CONTROLE: processing, 'pago', paid_at preenchido -> EXATAMENTE 1 linha
 *       (valor do total, 'solicitado', 'lojista')
 *   K2  CONTROLE: pending, 'pago_apos_expirar', paid_at preenchido -> 1 linha
 *
 * Cada cenário deixa UMA condição como única defesa (paid_at preenchido em
 * C1-C3, status certo em C1-C4): por isso cada mutante abaixo fica vermelho
 * num cenário só (ou em dois, quando o mutante afrouxa duas formas de uma vez).
 *
 * NÃO coberto aqui: o valor da linha (remanescente, R11) -> cancelar-pedido-
 * viva.cjs (c); a porta da edge (`cancelar_pedido_com_cobranca`) chama o MESMO
 * `pedido__mudar_status`, então o IF é um só.
 *
 * MUTANTES: MUTANTE_R130D=<nome> troca UM trecho do corpo vivo de
 * pedido__mudar_status dentro da transação desfeita e roda os cenários; a
 * execução TEM de ficar vermelha, nos cenários que o nome promete, e os de
 * `verde` TÊM de continuar verdes. Nome desconhecido é ERRO.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/cancelar-pedido-so-abre-estorno-se-pago-viva.cjs
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: cancelar só abre estorno automático para pedido pago de verdade (rpc-ci)";
const FUNCAO =
  "public.pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)";

// ---------------------------------------------------------------- mutantes
// `de`/`para` trocam UM trecho EXATO do corpo vivo (cada `de` aparece 1x).
const DE_PAGO = "AND v_payment_status IN ('pago', 'pago_apos_expirar')";
const DE_STATUS = "AND v_old_status IN ('pending', 'processing')";
const DE_PAID_AT =
  "AND v_paid_at IS NOT NULL\n       AND NOT v_cancelled_after_shipping\n    THEN\n        v_saldo";
const MUTANTES = {
  "qualquer-forma-de-pagamento": {
    // `IS NOT NULL`: 'aguardando' e 'recebido_na_entrega' passam a abrir
    // estorno; o NULL do C2 continua barrado (NULL IS NOT NULL é falso).
    espera: ["C1", "C3"],
    verde: ["C2", "C4", "C5", "K1", "K2"],
    de: DE_PAGO,
    para: "AND v_payment_status IS NOT NULL",
  },
  "forma-de-pagamento-nula-tambem": {
    // O NULL do dinheiro na entrega passa a abrir estorno.
    espera: ["C2"],
    verde: ["C1", "C3", "C4", "C5", "K1", "K2"],
    de: DE_PAGO,
    para: "AND (v_payment_status IN ('pago', 'pago_apos_expirar') OR v_payment_status IS NULL)",
  },
  "shipping-na-lista-de-status": {
    // Pedido que já saiu passa a abrir estorno sem a peça voltar.
    espera: ["C5"],
    verde: ["C1", "C2", "C3", "C4", "K1", "K2"],
    de: DE_STATUS,
    para: "AND v_old_status IN ('pending', 'processing', 'shipping')",
  },
  "sem-paid-at": {
    // Dado legado 'pago' sem paid_at passa a abrir estorno.
    espera: ["C4"],
    verde: ["C1", "C2", "C3", "C5", "K1", "K2"],
    de: DE_PAID_AT,
    para: "AND NOT v_cancelled_after_shipping\n    THEN\n        v_saldo",
  },
};

// ------------------------------------------------------------------ semente
const id = (n) => `130d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
const CLIENTE = id(2);
let seq = 100;

async function semear(c) {
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated");
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
       ($1, 'admin@estorno130d.fixture.invalid', '{"role":"admin"}'::jsonb),
       ($2, 'cliente@estorno130d.fixture.invalid', '{}'::jsonb)`,
    [ADMIN, CLIENTE],
  );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Estorno 130d', 'admin'),
       ($2, 'Cliente Estorno 130d', 'customer')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [ADMIN, CLIENTE],
  );
  // O gatilho de profiles leva o papel para auth.users: reafirma as duas
  // fontes como a prova precisa (o admin é admin nas duas; o cliente, não).
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
    [ADMIN],
  );
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id = $1`,
    [CLIENTE],
  );
}

/** Pedido do CLIENTE com 1 item de produto próprio; sem vaga (sem cobrança aberta). */
async function criarPedido(
  c,
  { status, paymentMethod = "online", paymentStatus, paidAt },
) {
  seq += 1;
  const pedidoId = id(seq);
  seq += 1;
  const produtoId = id(seq);
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto Estorno 130d', 10.00, 50.00, 10, true, false)`,
    [produtoId],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, expires_at, paid_at, valor_estornado)
     VALUES ($1, $2, 'Cliente Estorno 130d', '{}'::jsonb, 100, 100, $3, 'online',
             $4, $5, now() + interval '30 minutes', $6, 0)`,
    [pedidoId, CLIENTE, status, paymentMethod, paymentStatus, paidAt],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto Estorno 130d', 2, 50.00)`,
    [pedidoId, produtoId],
  );
  return pedidoId;
}

const AGORA = () => new Date().toISOString();

// ------------------------------------------------------------------ chamadas
/** Cancela como admin ATUAL, pela porta do front (papel authenticated + JWT). */
async function cancelarComoAdmin(c, pedidoId) {
  await c.query("SAVEPOINT cancelar");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [
        ADMIN,
        JSON.stringify({
          sub: ADMIN,
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ],
    );
    await c.query(
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled', NULL, false)",
      [pedidoId],
    );
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT cancelar");
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT cancelar");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT cancelar");
    throw erro;
  }
}

const estornos = async (c, pedidoId) =>
  (
    await c.query(
      `SELECT amount::numeric AS amount, status, solicitado_por
         FROM public.order_refunds WHERE order_id = $1 ORDER BY created_at, id`,
      [pedidoId],
    )
  ).rows.map((l) => ({ ...l, amount: Number(l.amount) }));

const statusDe = async (c, pedidoId) =>
  (
    await c.query(
      "SELECT status, cancelled_after_shipping FROM public.marketplace_orders WHERE id = $1",
      [pedidoId],
    )
  ).rows[0];

/** Cancela e exige: pedido 'cancelled' (senão o 0 é vácuo) e o ledger do pedido. */
async function cancelarEConferir(c, rotulo, pedidoId) {
  await cancelarComoAdmin(c, pedidoId);
  assert.equal(
    (await statusDe(c, pedidoId)).status,
    "cancelled",
    `[${rotulo}] o cancelamento não aconteceu (o 0 linhas seria vácuo)`,
  );
  return estornos(c, pedidoId);
}

async function semEstorno(c, rotulo, pedido) {
  const id1 = await criarPedido(c, pedido);
  const antes = await statusDe(c, id1);
  assert.equal(
    antes.cancelled_after_shipping,
    false,
    `[${rotulo}] a semente tem cancelled_after_shipping false`,
  );
  const linhas = await cancelarEConferir(c, rotulo, id1);
  assert.deepEqual(
    linhas,
    [],
    `[${rotulo}] abriu estorno automático para pedido que não foi pago de verdade: ${JSON.stringify(linhas)}`,
  );
}

// ---------------------------------------------------------------- cenários
const CENARIOS = [];

CENARIOS.push({
  id: "C1",
  nome: "C1: processing com payment_status 'aguardando' -> cancela, 0 linhas de estorno",
  corpo: (c) =>
    semEstorno(c, "C1", {
      status: "processing",
      paymentStatus: "aguardando",
      paidAt: AGORA(),
    }),
});

CENARIOS.push({
  id: "C2",
  nome: "C2: processing com payment_status NULL e método 'cash' -> cancela, 0 linhas de estorno",
  corpo: (c) =>
    semEstorno(c, "C2", {
      status: "processing",
      paymentMethod: "cash",
      paymentStatus: null,
      paidAt: AGORA(),
    }),
});

CENARIOS.push({
  id: "C3",
  nome: "C3: processing 'recebido_na_entrega' com paid_at preenchido -> cancela, 0 linhas de estorno",
  corpo: (c) =>
    semEstorno(c, "C3", {
      status: "processing",
      paymentMethod: "cash",
      paymentStatus: "recebido_na_entrega",
      paidAt: AGORA(),
    }),
});

CENARIOS.push({
  id: "C4",
  nome: "C4: processing 'pago' com paid_at NULL (dado legado) -> cancela, 0 linhas de estorno",
  corpo: (c) =>
    semEstorno(c, "C4", {
      status: "processing",
      paymentStatus: "pago",
      paidAt: null,
    }),
});

CENARIOS.push({
  id: "C5",
  nome: "C5: shipping pago (cancelled_after_shipping ainda false) -> cancela, 0 linhas; o estorno espera o lojista",
  corpo: async (c) => {
    await semEstorno(c, "C5", {
      status: "shipping",
      paymentStatus: "pago",
      paidAt: AGORA(),
    });
  },
});

CENARIOS.push({
  id: "K1",
  nome: "K1: controle — processing pago com paid_at abre EXATAMENTE 1 linha (100, solicitado, lojista)",
  corpo: async (c) => {
    const pedidoId = await criarPedido(c, {
      status: "processing",
      paymentStatus: "pago",
      paidAt: AGORA(),
    });
    const linhas = await cancelarEConferir(c, "K1", pedidoId);
    assert.deepEqual(
      linhas.map((l) => [l.amount, l.status, l.solicitado_por]),
      [[100, "solicitado", "lojista"]],
      `[K1] o pedido pago de verdade tem de abrir exatamente 1 linha: ${JSON.stringify(linhas)}`,
    );
  },
});

CENARIOS.push({
  id: "K2",
  nome: "K2: controle — pending 'pago_apos_expirar' com paid_at abre EXATAMENTE 1 linha",
  corpo: async (c) => {
    const pedidoId = await criarPedido(c, {
      status: "pending",
      paymentStatus: "pago_apos_expirar",
      paidAt: AGORA(),
    });
    const linhas = await cancelarEConferir(c, "K2", pedidoId);
    assert.deepEqual(
      linhas.map((l) => [l.amount, l.status, l.solicitado_por]),
      [[100, "solicitado", "lojista"]],
      `[K2] o pago após expirar tem de abrir exatamente 1 linha: ${JSON.stringify(linhas)}`,
    );
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R130D='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const ler = async () =>
    (
      await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
        FUNCAO,
      ])
    ).rows[0].d.replace(/\r/g, "");
  const def = await ler();
  const ocorrencias = def.split(m.de).length - 1;
  assert.equal(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.equal(
    await ler(),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), fixture, e cada cenário num
 * SAVEPOINT. Erro que não é de asserção (SQL, conexão) sobe: é do teste.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await semear(c);
    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id: cid, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(cid);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id: cid, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) => `${e.message.split("\n")[0]}`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R130D || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R130D='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const cid of r.passou) console.log(`  PASSOU ${cid}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (cid) => !r.falhou.some((f) => f.id === cid),
      );
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
        );
      }
      const quebrou = (r.mutante.verde || []).filter((cid) =>
        r.falhou.some((f) => f.id === cid),
      );
      if (quebrou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} derrubou [${quebrou.join(", ")}], que deveriam seguir verdes`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "Cancelar abre estorno automático para pedido que não foi pago de verdade (ou deixou de abrir para o pago) — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[cancelar-so-estorna-se-pago] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
