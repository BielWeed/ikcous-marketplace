"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) de
 * public.confirmar_retorno_do_produto(uuid) — o botão "o produto voltou" do
 * painel (corpo vigente desde 20261199000000_portas_do_painel_exigem_admin_atual.sql),
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O QUE ESTÁ EM JOGO (estoque e dinheiro): a RPC credita à prateleira as
 * unidades de um pedido. Só pode creditar quando a peça está de fato voltando:
 * pedido que foi enviado, cancelado, e que AINDA está cancelado. Sem as guardas
 * o banco passa a vender uma unidade que não existe (estoque fantasma).
 * `cancelled_after_shipping` é HISTÓRICO (nunca volta a false), então ele sozinho
 * não basta: a loja pode reativar o pedido cancelado e a peça está na mão do
 * cliente.
 *
 * CENÁRIOS (cada um numa transação aninhada DESFEITA, valores exatos de estoque):
 *   A  pedido 'shipping' (1 item, estoque E) cancelado (cancelled_after_shipping
 *      = true, estoque continua E) e REATIVADO para 'delivered' -> a RPC recusa
 *      "não está mais cancelado"; estoque continua E; returned_to_seller_at e
 *      stock_returned_at continuam NULL
 *   B  o mesmo reativado para 'processing' (outra tentativa)
 *   C  pedido cancelado ANTES do envio (cancelled_after_shipping = false) ->
 *      recusa "não estava enviado quando foi cancelado"; nada gravado. Pelo
 *      fluxo real (o cancelamento já devolveu o estoque)
 *   C2 linha legada cancelada direto, com o estoque NUNCA devolvido
 *      (stock_returned_at NULL): sem a guarda a RPC creditaria a peça que nunca
 *      saiu da prateleira
 *   D  CONTROLE: enviado e AINDA cancelado -> credita exatamente a quantidade
 *      (E vira E + QTD), carimba returned_to_seller_at e stock_returned_at;
 *      chamar de novo responde ja_confirmado e não credita nem regrava nada
 *   E  quem não é admin ATUAL é recusado, e nada muda: cliente comum; JWT com
 *      papel admin mas perfil rebaixado (is_admin_atual)
 *   F  pedido inexistente -> "Pedido não encontrado."
 *
 * MUTANTES: MUTANTE_R113B=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os cenários; a
 * execução TEM de ficar vermelha, e vermelha no cenário que o nome promete.
 * Nome desconhecido é ERRO. Sem MUTANTE_R113B a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/produto-voltou-so-credita-pedido-cancelado-depois-de-enviado-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: 'produto voltou' só credita pedido ainda cancelado depois de enviado (rpc-ci)";
const RPC = "public.confirmar_retorno_do_produto(uuid)";

const U_ADMIN = "c113b000-0000-4000-8000-0000000000a1";
const U_CLIENTE = "c113b000-0000-4000-8000-0000000000a2";
// JWT com papel admin, mas auth.users e profiles já não dizem admin.
const U_REBAIXADO = "c113b000-0000-4000-8000-0000000000a3";

const ESTOQUE_INICIAL = 10;
const QTD = 2;

const RE_NAO_CANCELADO =
  /Este pedido não está mais cancelado: não há retorno para confirmar/;
const RE_NAO_ENVIADO =
  /Este pedido não estava enviado quando foi cancelado: não há produto para voltar/;
const RE_NAO_AUTORIZADO =
  /Não autorizado: só a loja confirma que o produto voltou/;

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x. `espera` = cenário(s) onde a prova TEM de ficar vermelha.
const MUTANTES = {
  "retorno-sem-exigir-cancelado": {
    espera: ["A", "B"],
    de: "IF v_status IS DISTINCT FROM 'cancelled' THEN",
    para: "IF false THEN",
  },
  "retorno-sem-exigir-enviado": {
    espera: ["C", "C2"],
    de: "IF NOT v_cancelled_after_shipping THEN",
    para: "IF false THEN",
  },
  "retorno-credita-sempre": {
    espera: ["D"],
    de: "IF v_returned_at IS NOT NULL THEN",
    para: "IF false AND v_returned_at IS NOT NULL THEN",
  },
};

// ------------------------------------------------------------------ semente

let seq = 0;
function novoId(prefixo) {
  seq += 1;
  return `${prefixo}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

async function logar(c, userId) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId ?? "",
  ]);
}

/** O JWT da sessão (o que `is_admin()` lê). `null` limpa. */
async function jwt(c, userId, papel) {
  await c.query("SELECT set_config('request.jwt.claims', $1, false)", [
    userId
      ? JSON.stringify({ sub: userId, app_metadata: { role: papel } })
      : "",
  ]);
}

async function prepararPessoas(c) {
  for (const [id, email, meta] of [
    [U_ADMIN, "admin@retorno113b.fixture.invalid", '{"role":"admin"}'],
    [U_CLIENTE, "cliente@retorno113b.fixture.invalid", "{}"],
    [U_REBAIXADO, "rebaixado@retorno113b.fixture.invalid", "{}"],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, email, meta],
    );
  }
  // Sem handle_new_user nesta emulação: o perfil entra direto.
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 113b', 'admin'),
       ($2, 'Cliente 113b', 'customer'),
       ($3, 'Rebaixado 113b', 'customer')
     ON CONFLICT (id) DO NOTHING`,
    [U_ADMIN, U_CLIENTE, U_REBAIXADO],
  );
  // O gatilho de papel de profiles leva o papel para auth.users: reafirma as
  // duas fontes como a prova precisa (admin atual = as DUAS dizem admin).
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
    [U_ADMIN],
  );
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = '{}'::jsonb WHERE id IN ($1, $2)`,
    [U_CLIENTE, U_REBAIXADO],
  );
}

/**
 * Pedido com UM item de produto próprio (estoque ESTOQUE_INICIAL, quantidade
 * QTD), para medir o crédito de verdade. Nasce no status dado, pago e sem
 * cobrança na vaga (cancelável pela porta do front).
 */
async function criarPedido(c, { status, pago = true }) {
  const pedidoId = novoId("c113b0aa");
  const produtoId = novoId("c113b0bb");
  await c.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto 113b', 10.00, 50.00, $2, true, false)`,
    [produtoId, ESTOQUE_INICIAL],
  );
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, expires_at, paid_at)
     VALUES ($1, $2, 'Cliente 113b', '{}'::jsonb, 100, 100, $3, 'online',
             'online', $4, now() + interval '30 minutes', $5)`,
    [
      pedidoId,
      U_CLIENTE,
      status,
      pago ? "pago" : "aguardando",
      pago ? new Date().toISOString() : null,
    ],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto 113b', $3, 50.00)`,
    [pedidoId, produtoId, QTD],
  );
  return { pedidoId, produtoId };
}

/** Estado completo que a RPC pode mexer (o que as asserções comparam). */
async function estado(c, { pedidoId, produtoId }) {
  const r = await c.query(
    `SELECT o.status, o.cancelled_after_shipping, o.returned_to_seller_at,
            o.stock_returned_at, p.estoque
       FROM public.marketplace_orders o, public.produtos p
      WHERE o.id = $1 AND p.id = $2`,
    [pedidoId, produtoId],
  );
  const l = r.rows[0];
  return { ...l, estoque: Number(l.estoque) };
}

/** A porta do painel que muda o status (como admin atual coerente). */
async function mudarStatus(c, pedidoId, novoStatus) {
  await jwt(c, U_ADMIN, "admin");
  await logar(c, U_ADMIN);
  return c.query(
    "SELECT public.update_order_status_atomic($1::uuid, $2::text, NULL, false) AS r",
    [pedidoId, novoStatus],
  );
}

/** Pedido 'shipping' cancelado pelo admin: enviado, e AINDA cancelado. */
async function pedidoEnviadoECancelado(c) {
  const p = await criarPedido(c, { status: "shipping" });
  await mudarStatus(c, p.pedidoId, "cancelled");
  const e = await estado(c, p);
  // Pré-condições (se falharem, o cenário não prova nada sobre a RPC).
  assert.equal(e.status, "cancelled", "pré-condição: o pedido ficou cancelado");
  assert.equal(
    e.cancelled_after_shipping,
    true,
    "pré-condição: o cancelamento de pedido enviado carimba cancelled_after_shipping",
  );
  assert.equal(
    e.estoque,
    ESTOQUE_INICIAL,
    "pré-condição: cancelar pedido enviado NÃO devolve a peça (ela não voltou)",
  );
  assert.equal(
    e.stock_returned_at,
    null,
    "pré-condição: stock_returned_at NULL",
  );
  assert.equal(
    e.returned_to_seller_at,
    null,
    "pré-condição: returned_to_seller_at NULL",
  );
  return p;
}

/**
 * Chama a RPC como admin atual (ou como quem se pedir) dentro de um SAVEPOINT:
 * uma recusa aborta só a chamada. Devolve { r } (resultado) ou { erro }.
 */
async function confirmarRetorno(
  c,
  pedidoId,
  { userId = U_ADMIN, papel = "admin" } = {},
) {
  await jwt(c, userId, papel);
  await logar(c, userId);
  await c.query("SAVEPOINT chamada_rpc");
  try {
    const r = await c.query(
      "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
      [pedidoId],
    );
    await c.query("RELEASE SAVEPOINT chamada_rpc");
    return { r: r.rows[0].r };
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT chamada_rpc");
    await c.query("RELEASE SAVEPOINT chamada_rpc");
    return { erro };
  }
}

function assertRecusou(rotulo, resp, regex) {
  assert.ok(
    resp.erro,
    `[${rotulo}] a RPC tinha de RECUSAR e respondeu ${JSON.stringify(resp.r)}`,
  );
  assert.equal(resp.erro.code, "P0001", `[${rotulo}] código da recusa`);
  assert.match(resp.erro.message, regex, `[${rotulo}] mensagem da recusa`);
}

function assertNadaMudou(rotulo, antes, depois) {
  assert.deepStrictEqual(
    depois,
    antes,
    `[${rotulo}] a recusa não pode mexer em estoque, status nem nos carimbos`,
  );
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

async function reativadoPara(c, rotulo, novoStatus) {
  const p = await pedidoEnviadoECancelado(c);
  await mudarStatus(c, p.pedidoId, novoStatus);
  const antes = await estado(c, p);
  assert.equal(antes.status, novoStatus, `[${rotulo}] pré-condição: reativado`);
  assert.equal(
    antes.cancelled_after_shipping,
    true,
    `[${rotulo}] pré-condição: o carimbo histórico continua true`,
  );
  assert.equal(
    antes.estoque,
    ESTOQUE_INICIAL,
    `[${rotulo}] pré-condição: reativar não mexe na prateleira (estoque E)`,
  );
  assert.equal(antes.stock_returned_at, null, `[${rotulo}] pré-condição`);
  assert.equal(antes.returned_to_seller_at, null, `[${rotulo}] pré-condição`);

  const resp = await confirmarRetorno(c, p.pedidoId);
  assertRecusou(rotulo, resp, RE_NAO_CANCELADO);
  const depois = await estado(c, p);
  assert.equal(
    depois.estoque,
    ESTOQUE_INICIAL,
    `[${rotulo}] a peça está com o cliente: o estoque continua exatamente E (${ESTOQUE_INICIAL})`,
  );
  assert.equal(
    depois.returned_to_seller_at,
    null,
    `[${rotulo}] returned_to_seller_at continua NULL`,
  );
  assert.equal(
    depois.stock_returned_at,
    null,
    `[${rotulo}] stock_returned_at continua NULL`,
  );
  assertNadaMudou(rotulo, antes, depois);

  // Chamar de novo (aba velha, duplo clique) continua recusado e continua parado.
  const outra = await confirmarRetorno(c, p.pedidoId);
  assertRecusou(`${rotulo}-de-novo`, outra, RE_NAO_CANCELADO);
  assertNadaMudou(`${rotulo}-de-novo`, antes, await estado(c, p));
}

CENARIOS.push({
  id: "A",
  nome: "A: enviado, cancelado e reativado para 'delivered' -> 'produto voltou' recusa; estoque E; nenhum carimbo",
  corpo: (c) => reativadoPara(c, "A", "delivered"),
});

CENARIOS.push({
  id: "B",
  nome: "B: enviado, cancelado e reativado para 'processing' -> 'produto voltou' recusa; estoque E; nenhum carimbo",
  corpo: (c) => reativadoPara(c, "B", "processing"),
});

CENARIOS.push({
  id: "C",
  nome: "C: cancelado ANTES do envio (cancelled_after_shipping = false) -> recusa 'não estava enviado'; nada gravado",
  corpo: async (c) => {
    // Pelo fluxo real. Pendente e cancelado pelo admin: a peça nunca saiu,
    // o cancelamento já devolveu o estoque (E + QTD, uma vez).
    const p1 = await criarPedido(c, { status: "pending", pago: false });
    await mudarStatus(c, p1.pedidoId, "cancelled");
    const antes1 = await estado(c, p1);
    assert.equal(antes1.status, "cancelled", "[C] pré-condição");
    assert.equal(
      antes1.cancelled_after_shipping,
      false,
      "[C] pré-condição: cancelado antes do envio",
    );
    assert.equal(
      antes1.estoque,
      ESTOQUE_INICIAL + QTD,
      "[C] pré-condição: o cancelamento antes do envio devolveu a peça",
    );
    const r1 = await confirmarRetorno(c, p1.pedidoId);
    assertRecusou("C", r1, RE_NAO_ENVIADO);
    assertNadaMudou("C", antes1, await estado(c, p1));
  },
});

CENARIOS.push({
  id: "C2",
  nome: "C2: linha legada cancelada direto, estoque nunca devolvido (cancelled_after_shipping = false) -> recusa; estoque continua E",
  corpo: async (c) => {
    // Linha legada, cancelada direto e com o estoque NUNCA devolvido
    // (stock_returned_at NULL). Sem a guarda, a RPC creditaria uma peça que
    // nunca saiu da prateleira.
    const p2 = await criarPedido(c, { status: "cancelled", pago: false });
    const antes2 = await estado(c, p2);
    assert.equal(antes2.cancelled_after_shipping, false, "[C2] pré-condição");
    assert.equal(antes2.stock_returned_at, null, "[C2] pré-condição");
    assert.equal(antes2.estoque, ESTOQUE_INICIAL, "[C2] pré-condição");
    const r2 = await confirmarRetorno(c, p2.pedidoId);
    assertRecusou("C2", r2, RE_NAO_ENVIADO);
    const depois2 = await estado(c, p2);
    assert.equal(
      depois2.estoque,
      ESTOQUE_INICIAL,
      `[C2] estoque continua exatamente E (${ESTOQUE_INICIAL}): peça que nunca saiu não se credita`,
    );
    assertNadaMudou("C2", antes2, depois2);
  },
});

CENARIOS.push({
  id: "D",
  nome: "D: controle — enviado e ainda cancelado: credita exatamente a quantidade, carimba, e repetir não credita nem regrava",
  corpo: async (c) => {
    const p = await pedidoEnviadoECancelado(c);

    const r1 = await confirmarRetorno(c, p.pedidoId);
    assert.ok(
      !r1.erro,
      `[D] a RPC não pode recusar o caso legítimo: ${r1.erro?.message}`,
    );
    assert.equal(r1.r.ok, true, "[D] ok");
    assert.equal(
      r1.r.ja_confirmado,
      false,
      "[D] 1ª chamada: não era confirmado",
    );
    const depois1 = await estado(c, p);
    assert.equal(
      depois1.estoque,
      ESTOQUE_INICIAL + QTD,
      `[D] a peça voltou: estoque E (${ESTOQUE_INICIAL}) + quantidade (${QTD})`,
    );
    assert.notEqual(
      depois1.returned_to_seller_at,
      null,
      "[D] returned_to_seller_at carimbado",
    );
    assert.notEqual(
      depois1.stock_returned_at,
      null,
      "[D] stock_returned_at carimbado",
    );
    assert.equal(depois1.status, "cancelled", "[D] o pedido segue cancelado");

    // Recua o carimbo de retorno para ontem: assim uma regravação (corpo sem a
    // idempotência) aparece como mudança de valor, mesmo dentro da mesma
    // transação (now() é o mesmo o tempo todo aqui).
    await c.query(
      `UPDATE public.marketplace_orders
          SET returned_to_seller_at = now() - interval '1 day'
        WHERE id = $1`,
      [p.pedidoId],
    );
    const meio = await estado(c, p);

    const r2 = await confirmarRetorno(c, p.pedidoId);
    assert.ok(!r2.erro, `[D] repetir não pode estourar: ${r2.erro?.message}`);
    assert.equal(
      r2.r.ja_confirmado,
      true,
      "[D] 2ª chamada: responde ja_confirmado (dois cliques não repetem o efeito)",
    );
    assert.equal(
      new Date(r2.r.returned_to_seller_at).getTime(),
      new Date(meio.returned_to_seller_at).getTime(),
      "[D] a 2ª chamada devolve o carimbo ORIGINAL do retorno",
    );
    const depois2 = await estado(c, p);
    assert.equal(
      depois2.estoque,
      ESTOQUE_INICIAL + QTD,
      `[D] repetir não credita duas vezes: estoque continua E + quantidade (${ESTOQUE_INICIAL + QTD})`,
    );
    assert.equal(
      depois2.returned_to_seller_at.getTime(),
      meio.returned_to_seller_at.getTime(),
      "[D] repetir não regrava returned_to_seller_at",
    );
    assertNadaMudou("D-repetir", meio, depois2);
  },
});

CENARIOS.push({
  id: "E",
  nome: "E: quem não é admin ATUAL (cliente; JWT admin com perfil rebaixado) é recusado e nada muda",
  corpo: async (c) => {
    const p = await pedidoEnviadoECancelado(c);
    const antes = await estado(c, p);

    const comum = await confirmarRetorno(c, p.pedidoId, {
      userId: U_CLIENTE,
      papel: "customer",
    });
    assertRecusou("E-cliente", comum, RE_NAO_AUTORIZADO);
    assertNadaMudou("E-cliente", antes, await estado(c, p));

    const rebaixado = await confirmarRetorno(c, p.pedidoId, {
      userId: U_REBAIXADO,
      papel: "admin",
    });
    assertRecusou("E-rebaixado", rebaixado, RE_NAO_AUTORIZADO);
    const depois = await estado(c, p);
    assert.equal(
      depois.estoque,
      ESTOQUE_INICIAL,
      `[E] estoque continua exatamente E (${ESTOQUE_INICIAL})`,
    );
    assertNadaMudou("E-rebaixado", antes, depois);
  },
});

CENARIOS.push({
  id: "F",
  nome: "F: pedido inexistente -> 'Pedido não encontrado.'",
  corpo: async (c) => {
    const resp = await confirmarRetorno(
      c,
      "c113b0aa-0000-4000-8000-0000000fffff",
    );
    assertRecusou("F", resp, /Pedido não encontrado\./);
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R113B='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const def = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [RPC])
  ).rows[0].d.replace(/\r/g, "");
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [RPC])
  ).rows[0].d.replace(/\r/g, "");
  assert.strictEqual(
    depois,
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: (mutante), pessoas, e cada cenário num
 * SAVEPOINT. Devolve {passou:[ids], falhou:[{id, nome, erro}]}. Erro que não é
 * de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await prepararPessoas(c);

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
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

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R113B || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R113B='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
    for (const id of r.passou) console.log(`  PASSOU ${id}`);
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
        (id) => !r.falhou.some((f) => f.id === id),
      );
      if (faltou.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho, mas NÃO em [${faltou.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
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
        "'Produto voltou' creditou (ou deixou de recusar/creditar) onde não devia — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[produto-voltou] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
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
