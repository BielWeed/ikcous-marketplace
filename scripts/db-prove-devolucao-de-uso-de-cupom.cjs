#!/usr/bin/env node
/**
 * Prova a migration 20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql
 * -- a Rodada 4, o REDESENHO SUBTRATIVO.
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem o
 * produto de teste, nem os cupons, nem os pedidos, nem o CREATE OR REPLACE das
 * funcoes, nem o ALTER TABLE, nem o agendamento do cron. Isso so e verdade
 * porque a migration NAO tem BEGIN/COMMIT embutido: se alguem acrescentar um,
 * este script passa a gravar de verdade sem avisar (checado abaixo, antes de
 * aplicar).
 *
 * A DECISAO DE PRODUTO QUE ESTE SCRIPT PROVA: "a vaga fica reservada enquanto
 * o PIX estiver aberto" -- a vaga do cupom NAO volta quando o pedido e
 * desfeito, so' volta quando o PIX ja nao pode mais ser pago (expires_at + 24h,
 * o mesmo numero que pagamentos_a_reconciliar ja usa). Um lugar so' devolve:
 * devolver_cupons_de_pedidos_mortos().
 *
 * O QUE ESTE SCRIPT PRECISA PROVAR, E POR QUE CADA CASO EXISTE (as tres
 * rodadas anteriores morreram, cada uma, por um motivo diferente -- ver o
 * cabecalho da migration):
 *
 *   1. pedido desfeito DENTRO da janela -> a vaga CONTINUA ocupada. E' o
 *      coracao do redesenho: nenhum dos quatro pontos de desfazimento
 *      devolve mais nada na hora.
 *   2. pedido desfeito, janela VENCIDA -> a vaga volta. A varredura e o
 *      UNICO lugar que devolve, e so' depois do prazo.
 *   3. pedido desfeito dentro da janela -> PAGO depois -> a vaga continua
 *      ocupada, e nada foi devolvido nem reconsumido (reconsumir_uso_cupom
 *      nem existe mais). E' o caminho que a Rodada 2 tentava consertar com
 *      reconsumir e que este redesenho dissolve.
 *   4. a varredura rodando DUAS vezes -> a vaga nao volta duas vezes.
 *      Idempotencia por CONSTRUCAO (coluna coupon_usage_returned), nao por
 *      deducao de estado -- e' exatamente o que derrubou a Rodada 3.
 *   5. LINHA PRE-EXISTENTE (nascida antes do apply, ja no estado desfeito e
 *      ja fora da janela) -> comportamento correto. E' o caso que derrubou a
 *      Rodada 3: reconsumir_uso_cupom deduzia "ja devolvido" do estado, e
 *      para toda linha que ja nascia naquele estado a deducao era falsa. Aqui
 *      o fato nasce registrado (coupon_usage_returned = false, via DEFAULT da
 *      coluna nova), nunca deduzido -- entao a linha pre-existente e varrida
 *      like qualquer outra, uma unica vez.
 *
 * CENARIO FIXADO DE PROPOSITO
 *   O script fixa `store_config` (frete fixo, sem frete gratis por valor)
 *   para que os totais esperados sejam numeros LITERAIS deste arquivo, e nao
 *   a mesma formula que a funcao sob teste usa — mesmo padrao do
 *   db-prove-cupom-sem-limite.cjs.
 *
 * USO NORMAL (aplica a migration inteira, com o redesenho da Rodada 4):
 *   node scripts/db-prove-devolucao-de-uso-de-cupom.cjs
 *
 * REPRODUZIR O VERMELHO (reinsere, SO EM MEMORIA -- nunca grava em disco --,
 * a chamada imediata de devolver_uso_cupom que a Rodada 1 fazia no
 * cancelamento manual, simulando a regressao para o desenho anterior. Os
 * casos "grupo1/cancelamento manual" abaixo falham; o resto do script
 * continua passando, porque so' aquele ponto depende do redesenho):
 *   SEM_FIX_JANELA=1 node scripts/db-prove-devolucao-de-uso-de-cupom.cjs
 *
 * A saida real de cada um dos dois comandos acima, colada no relatorio da
 * tarefa que escreveu esta secao, e o que prova que a asserção "cairia sem
 * o redesenho" nao e hipotese.
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql";

// Cenario: 1 unidade de um produto de R$ 100,00 + frete fixo de R$ 10,00.
const PRECO = 100;
const FRETE = 10;

let passou = 0;
let falhou = 0;

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(RAIZ, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL nao encontrada.");
}

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function migrationJaAplicadaAoVivo(client) {
  const { rows } = await client.query(`
    SELECT COUNT(*) = 1 AS aplicada
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos'`);
  return rows[0]?.aplicada === true;
}

async function criarProduto(client, estoque = 500) {
  // `custo` e NOT NULL sem default nesta tabela — omitir quebra o INSERT.
  const { rows } = await client.query(
    `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria, ativo, frete_gratis)
     VALUES ('PROVA DEVOLUCAO CUPOM', 10.00, $1, $2, 'teste', true, false)
     RETURNING id`,
    [PRECO, estoque],
  );
  return rows[0].id;
}

/** Cria um cupom percentual de 10%, sem minimo e sem validade. */
async function criarCupom(client, { code, usageCount = 0, usageLimit = 100 }) {
  const { rows } = await client.query(
    `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, valid_until, active)
     VALUES ($1, 'percentage', 10, NULL, $2, $3, NULL, true)
     RETURNING id`,
    [code, usageLimit, usageCount],
  );
  return rows[0].id;
}

async function usosDoCupom(client, cupomId) {
  const { rows } = await client.query(
    "SELECT usage_count FROM public.coupons WHERE id = $1",
    [cupomId],
  );
  return rows[0].usage_count;
}

async function estoqueDoProduto(client, produtoId) {
  const { rows } = await client.query(
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [produtoId],
  );
  return rows[0].estoque;
}

/**
 * Cria um pedido via create_marketplace_order_v24 (a via de pagamento online:
 * a UNICA que grava payment_status/expires_at, que e o que a varredura e os
 * quatro pontos de desfazimento desta migration exigem para agir). Convidado
 * (auth.uid() NULL): a devolucao de uso de cupom nao depende de quem e o dono
 * do pedido.
 */
async function criarPedido(client, { produtoId, codigo }) {
  const itens = JSON.stringify([{ product_id: produtoId, quantity: 1 }]);
  const total = codigo
    ? PRECO + FRETE - PRECO * 0.1
    : PRECO + FRETE;
  const { rows } = await client.query(
    `SELECT public.create_marketplace_order_v24(
       $1::jsonb, $2::numeric, $3::numeric, 'pix'::text, NULL::uuid, $4::text,
       'PROVA CUPOM'::text, '34999999999'::text, NULL::text, NULL::jsonb,
       NULL::text, NULL::text
     ) AS id`,
    [itens, total, FRETE, codigo],
  );
  return rows[0].id;
}

async function pedido(client, orderId) {
  const { rows } = await client.query(
    `SELECT coupon_id, payment_status, status, expires_at, gateway_payment_id,
            coupon_usage_returned
       FROM public.marketplace_orders WHERE id = $1`,
    [orderId],
  );
  return rows[0];
}

/**
 * Backdata expires_at para DENTRO da janela de 24h: o pedido ja cai na
 * varredura de expirar_pedidos_vencidos (que exige so' expires_at < now()),
 * mas continua PAGAVEL para efeito de coupon_usage_returned -- e' o "pedido
 * desfeito, mas o PIX ainda pode ser pago" do redesenho.
 */
async function dentroDaJanela(client, orderId) {
  await client.query(
    `UPDATE public.marketplace_orders SET expires_at = now() - interval '1 minute' WHERE id = $1`,
    [orderId],
  );
}

/**
 * Backdata expires_at para FORA da janela de 24h -- o mesmo numero que
 * pagamentos_a_reconciliar usa para considerar o PIX definitivamente morto.
 */
async function foraDaJanela(client, orderId) {
  await client.query(
    `UPDATE public.marketplace_orders SET expires_at = now() - interval '25 hours' WHERE id = $1`,
    [orderId],
  );
}

/** Amarra um gateway_payment_id ao pedido, exigido por confirmar_pagamento. */
async function amarrarGateway(client, orderId, paymentId) {
  await client.query(
    `UPDATE public.marketplace_orders SET gateway_payment_id = $2 WHERE id = $1`,
    [orderId, paymentId],
  );
}

const claims = (sub, admin) =>
  sub === null
    ? ""
    : JSON.stringify({
        sub,
        role: "authenticated",
        app_metadata: { role: admin ? "admin" : "authenticated" },
      });

/** Descobre um admin real (FK de marketplace_order_history.created_by para auth.users). */
async function descobrirAdmin(client) {
  const { rows } = await client.query(
    `SELECT id, email FROM auth.users
      WHERE COALESCE(raw_app_meta_data ->> 'role', '') = 'admin'
      ORDER BY created_at LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error("Nenhum usuario admin em auth.users para o cenario de cancelamento manual.");
  }
  return rows[0];
}

/** Confere que o usuario escolhido realmente resolve is_admin() = true, sob o papel certo. */
async function confirmarAdmin(client, sub, email) {
  await client.query("SAVEPOINT chk_admin");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(sub, true),
  ]);
  const { rows } = await client.query("SELECT public.is_admin() AS eh");
  await client.query("ROLLBACK TO SAVEPOINT chk_admin");
  await client.query("RESET ROLE");
  if (!rows[0].eh) {
    throw new Error(`${email} nao resolve is_admin() = true. Nao serve para o cenario de cancelamento manual.`);
  }
}

/** Cancela um pedido como admin, via update_order_status_atomic. */
async function cancelarComoAdmin(client, orderId, adminSub) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(adminSub, true),
  ]);
  await client.query(
    "SELECT public.update_order_status_atomic($1::uuid, 'cancelled'::text, NULL, TRUE)",
    [orderId],
  );
  await client.query("SELECT set_config('request.jwt.claims', '', true)");
  await client.query("RESET ROLE");
}

/**
 * Reinsere, EM MEMORIA (nunca grava em disco), a chamada imediata de
 * devolver_uso_cupom no cancelamento manual -- exatamente o desenho da
 * Rodada 1, que devolvia a vaga NO MOMENTO do desfazimento, dentro da janela
 * de 24h. Usado so' quando SEM_FIX_JANELA esta setada, para provar que o
 * teste "grupo1/cancelamento manual: vaga continua ocupada" cai de verdade
 * sem o redesenho da Rodada 4 -- ver o cabecalho deste arquivo para o comando
 * exato.
 */
function reinserirDevolucaoImediata(sql) {
  const alvo = "END LOOP;\n\n        -- A vaga do cupom NAO volta aqui";
  if (!sql.includes(alvo)) {
    throw new Error("SEM_FIX_JANELA=1 nao achou o marcador -- a migration mudou.");
  }
  return sql.replace(
    alvo,
    "END LOOP;\n\n        PERFORM public.devolver_uso_cupom(p_order_id);\n\n        -- A vaga do cupom NAO volta aqui",
  );
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    const jaAplicada = await migrationJaAplicadaAoVivo(client);
    if (jaAplicada) {
      throw new Error(
        "devolver_cupons_de_pedidos_mortos ja existe no banco AO VIVO -- este script assume " +
          "que a Rodada 4 nunca foi aplicada em producao (nenhuma rodada anterior chegou a " +
          "subir). Abortando para nao mascarar um estado inesperado.",
      );
    }
    console.log(`banco: ${MIGRATION} AINDA NAO aplicada -- aplicando na transacao (ROLLBACK no final)\n`);

    // Cenario fixo: frete de R$ 10,00 e nenhuma regra de frete gratis por valor.
    await client.query(
      `UPDATE public.store_config
          SET shipping_fee = $1, free_shipping_min = 0
        WHERE id = 1`,
      [FRETE],
    );
    const produtoId = await criarProduto(client);
    const admin = await descobrirAdmin(client);
    await confirmarAdmin(client, admin.id, admin.email);
    console.log(`Admin de teste: ${admin.email} (is_admin() = true, conferido)\n`);

    // =========================================================================
    // GRUPO 5 (parte 1): cria a linha PRE-EXISTENTE ANTES de aplicar a
    // migration -- precisa nascer antes do ALTER TABLE para provar que o
    // DEFAULT da coluna nova cobre corretamente quem ja existia. Ja sai
    // definitivamente morta e fora da janela, simulando um pedido que ja
    // estava assim quando esta migration finalmente subir em producao.
    // =========================================================================
    console.log("=== grupo 5: linha pre-existente (nasce ANTES do apply) ===");
    const cupomPre = await criarCupom(client, { code: "PRE_EXISTENTE" });
    const pedidoPre = await criarPedido(client, { produtoId, codigo: "PRE_EXISTENTE" });
    conferir("pre-existente: uso contado na criacao", (await usosDoCupom(client, cupomPre)) === 1);
    await client.query(
      `UPDATE public.marketplace_orders
          SET status = 'cancelled', payment_status = 'expirado',
              expires_at = now() - interval '25 hours'
        WHERE id = $1`,
      [pedidoPre],
    );
    console.log("  (linha nasceu 'cancelled'/'expirado', ja fora da janela -- ANTES do ALTER TABLE)\n");

    // =========================================================================
    // Aplica a migration DENTRO da transacao
    // =========================================================================
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    let sql = fs.readFileSync(
      path.join(RAIZ, "supabase", "migrations", MIGRATION),
      "utf8",
    );
    if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
      throw new Error(
        `${MIGRATION} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op e a mudanca ficaria gravada. Abortando.`,
      );
    }
    if (process.env.SEM_FIX_JANELA) {
      console.log(
        "SEM_FIX_JANELA=1: reinserindo, SO EM MEMORIA, a devolucao imediata da " +
          "Rodada 1 no cancelamento manual (reproduz a regressao para o desenho " +
          "anterior) -- nada disto vai para o arquivo.\n",
      );
      sql = reinserirDevolucaoImediata(sql);
    }
    await client.query(sql);
    conferir("migration aplicada na transacao", await migrationJaAplicadaAoVivo(client));

    // Fecha o Grupo 5: coupon_usage_returned tem de ter nascido FALSE pelo
    // DEFAULT do ALTER TABLE, para a linha que ja existia antes dele.
    let estadoPre = await pedido(client, pedidoPre);
    conferir(
      "pre-existente: coupon_usage_returned nasceu FALSE (DEFAULT da coluna nova, nao deducao)",
      estadoPre.coupon_usage_returned === false,
      `veio ${estadoPre.coupon_usage_returned}`,
    );
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "pre-existente: a varredura devolveu a vaga (1 -> 0) -- a linha pre-existente e' varrida como qualquer outra",
      (await usosDoCupom(client, cupomPre)) === 0,
    );
    estadoPre = await pedido(client, pedidoPre);
    conferir(
      "pre-existente: coupon_usage_returned virou TRUE depois da varredura",
      estadoPre.coupon_usage_returned === true,
    );

    // =========================================================================
    // GRUPO 1: pedido desfeito DENTRO da janela -> a vaga CONTINUA ocupada
    // =========================================================================
    console.log("\n=== grupo 1: desfeito DENTRO da janela -> vaga continua ocupada ===");

    // --- 1a. expiracao automatica (dentro da janela) -------------------------
    const cupomExpJanela = await criarCupom(client, { code: "G1_EXPIRA" });
    const pExpJanela = await criarPedido(client, { produtoId, codigo: "G1_EXPIRA" });
    await dentroDaJanela(client, pExpJanela);
    const estoqueAntesExpJ = await estoqueDoProduto(client, produtoId);
    await client.query("SELECT public.expirar_pedidos_vencidos()");
    conferir(
      "grupo1/expiracao: estoque VOLTOU (a funcao rodou)",
      (await estoqueDoProduto(client, produtoId)) === estoqueAntesExpJ + 1,
    );
    conferir(
      "grupo1/expiracao: usage_count CONTINUA 1 -- a vaga nao volta so' por desfazer",
      (await usosDoCupom(client, cupomExpJanela)) === 1,
    );
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo1/expiracao: a varredura rodou e NAO tocou -- ainda dentro da janela",
      (await usosDoCupom(client, cupomExpJanela)) === 1,
    );

    // --- 1b. cancelamento manual (dentro da janela) --------------------------
    const cupomCancelJanela = await criarCupom(client, { code: "G1_CANCELA" });
    const pCancelJanela = await criarPedido(client, { produtoId, codigo: "G1_CANCELA" });
    const estoqueAntesCancelJ = await estoqueDoProduto(client, produtoId);
    await cancelarComoAdmin(client, pCancelJanela, admin.id);
    conferir(
      "grupo1/cancelamento manual: estoque VOLTOU (a funcao rodou)",
      (await estoqueDoProduto(client, produtoId)) === estoqueAntesCancelJ + 1,
    );
    conferir(
      "grupo1/cancelamento manual: usage_count CONTINUA 1 -- a vaga nao volta no momento do cancelamento",
      (await usosDoCupom(client, cupomCancelJanela)) === 1,
    );
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo1/cancelamento manual: a varredura rodou e NAO tocou -- expires_at (30 min a frente) esta bem dentro da janela",
      (await usosDoCupom(client, cupomCancelJanela)) === 1,
    );

    // --- 1c. estorno com reserva intacta (dentro da janela) ------------------
    const cupomEstornoJanela = await criarCupom(client, { code: "G1_ESTORNO" });
    const pEstornoJanela = await criarPedido(client, { produtoId, codigo: "G1_ESTORNO" });
    await amarrarGateway(client, pEstornoJanela, "PAY_G1_ESTORNO");
    const rEstornoJanela = await client.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'estornado'::text) AS r",
      [pEstornoJanela, "PAY_G1_ESTORNO"],
    );
    conferir("grupo1/estorno: retorno = 'estornado'", rEstornoJanela.rows[0].r === "estornado");
    conferir(
      "grupo1/estorno: usage_count CONTINUA 1",
      (await usosDoCupom(client, cupomEstornoJanela)) === 1,
    );
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo1/estorno: a varredura rodou e NAO tocou -- ainda dentro da janela",
      (await usosDoCupom(client, cupomEstornoJanela)) === 1,
    );

    // --- 1d. cartao recusado com reserva intacta (dentro da janela) ----------
    const cupomRecusaJanela = await criarCupom(client, { code: "G1_RECUSA" });
    const pRecusaJanela = await criarPedido(client, { produtoId, codigo: "G1_RECUSA" });
    await amarrarGateway(client, pRecusaJanela, "PAY_G1_RECUSA");
    const rRecusaJanela = await client.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'recusado'::text) AS r",
      [pRecusaJanela, "PAY_G1_RECUSA"],
    );
    conferir("grupo1/recusa: retorno = 'recusado'", rRecusaJanela.rows[0].r === "recusado");
    conferir(
      "grupo1/recusa: usage_count CONTINUA 1",
      (await usosDoCupom(client, cupomRecusaJanela)) === 1,
    );
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo1/recusa: a varredura rodou e NAO tocou -- ainda dentro da janela",
      (await usosDoCupom(client, cupomRecusaJanela)) === 1,
    );

    // --- controle: cancelar pedido SEM cupom nao quebra nada -----------------
    const pCancelSemCupom = await criarPedido(client, { produtoId, codigo: null });
    await cancelarComoAdmin(client, pCancelSemCupom, admin.id);
    const estadoSemCupom = await pedido(client, pCancelSemCupom);
    conferir(
      "controle: cancelar pedido SEM cupom nao levanta erro e fecha 'cancelled'",
      estadoSemCupom.status === "cancelled",
    );

    // =========================================================================
    // GRUPO 2: pedido desfeito, JANELA VENCIDA -> a vaga volta
    // =========================================================================
    console.log("\n=== grupo 2: desfeito com a janela VENCIDA -> vaga volta ===");

    // --- 2a. expirado, depois a janela vence ---------------------------------
    const cupomExpVencida = await criarCupom(client, { code: "G2_EXPIRA" });
    const pExpVencida = await criarPedido(client, { produtoId, codigo: "G2_EXPIRA" });
    await foraDaJanela(client, pExpVencida);
    await client.query("SELECT public.expirar_pedidos_vencidos()");
    conferir(
      "grupo2/expiracao: usage_count ainda 1 logo apos expirar (a expiracao nao devolve mais)",
      (await usosDoCupom(client, cupomExpVencida)) === 1,
    );
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo2/expiracao: a varredura devolveu a vaga (1 -> 0) -- janela vencida",
      (await usosDoCupom(client, cupomExpVencida)) === 0,
    );

    // --- 2b. cancelado manualmente, janela ja vencida no momento do cancelamento
    const cupomCancelVencida = await criarCupom(client, { code: "G2_CANCELA" });
    const pCancelVencida = await criarPedido(client, { produtoId, codigo: "G2_CANCELA" });
    await foraDaJanela(client, pCancelVencida);
    await cancelarComoAdmin(client, pCancelVencida, admin.id);
    conferir(
      "grupo2/cancelamento manual: usage_count ainda 1 logo apos cancelar",
      (await usosDoCupom(client, cupomCancelVencida)) === 1,
    );
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo2/cancelamento manual: a varredura devolveu a vaga (1 -> 0) -- janela vencida",
      (await usosDoCupom(client, cupomCancelVencida)) === 0,
    );

    // --- 2c. pedido "na entrega" (v23), sem expires_at -- caminho CORRENTE,
    //     nao residuo historico: create_marketplace_order_v23 e' a via
    //     PADRAO do app (useOrders.ts:1059-1061) e nunca grava expires_at.
    const cupomSemExpires = await criarCupom(client, { code: "G2_SEM_EXPIRES" });
    const pSemExpires = await criarPedido(client, { produtoId, codigo: "G2_SEM_EXPIRES" });
    await client.query(
      `UPDATE public.marketplace_orders SET expires_at = NULL WHERE id = $1`,
      [pSemExpires],
    );
    await cancelarComoAdmin(client, pSemExpires, admin.id);
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo2/pedido na entrega sem expires_at: a varredura devolveu a vaga imediatamente -- nunca houve PIX por este caminho, sem janela para proteger",
      (await usosDoCupom(client, cupomSemExpires)) === 0,
    );

    // =========================================================================
    // GRUPO 3: desfeito DENTRO da janela, PAGO depois -> vaga continua ocupada,
    // nada devolvido nem reconsumido (reconsumir_uso_cupom nem existe mais).
    // =========================================================================
    console.log("\n=== grupo 3: desfeito na janela, pago depois -> nada mexe em usage_count ===");

    // --- 3a. expirado -> pago depois ------------------------------------------
    const cupomExpPago = await criarCupom(client, { code: "G3_EXPIRA_PAGO" });
    const pExpPago = await criarPedido(client, { produtoId, codigo: "G3_EXPIRA_PAGO" });
    await amarrarGateway(client, pExpPago, "PAY_G3_EXPIRA_PAGO");
    await dentroDaJanela(client, pExpPago);
    await client.query("SELECT public.expirar_pedidos_vencidos()");
    conferir(
      "grupo3/expirado->pago: usage_count 1 logo apos expirar (nada devolvido)",
      (await usosDoCupom(client, cupomExpPago)) === 1,
    );
    const rExpPago = await client.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago'::text) AS r",
      [pExpPago, "PAY_G3_EXPIRA_PAGO"],
    );
    conferir(
      "grupo3/expirado->pago: retorno = 'pago_apos_expirar'",
      rExpPago.rows[0].r === "pago_apos_expirar",
      `veio '${rExpPago.rows[0].r}'`,
    );
    conferir(
      "grupo3/expirado->pago: usage_count CONTINUA 1 -- nada foi reconsumido (a funcao nem existe mais)",
      (await usosDoCupom(client, cupomExpPago)) === 1,
    );
    // A varredura, mesmo depois de a janela ter passado (se passasse), NAO
    // pode tocar um pedido que ja esta 'pago_apos_expirar' -- simula isso
    // empurrando expires_at para fora da janela e rodando a varredura mesmo
    // assim.
    await foraDaJanela(client, pExpPago);
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo3/expirado->pago: a varredura NAO mexeu -- payment_status = 'pago_apos_expirar' fica fora do WHERE dela",
      (await usosDoCupom(client, cupomExpPago)) === 1,
    );

    // --- 3b. cancelado manualmente -> pago depois -----------------------------
    const cupomCancelPago = await criarCupom(client, { code: "G3_CANCELA_PAGO" });
    const pCancelPago = await criarPedido(client, { produtoId, codigo: "G3_CANCELA_PAGO" });
    await amarrarGateway(client, pCancelPago, "PAY_G3_CANCELA_PAGO");
    await cancelarComoAdmin(client, pCancelPago, admin.id);
    conferir(
      "grupo3/cancelado->pago: usage_count 1 logo apos cancelar (nada devolvido)",
      (await usosDoCupom(client, cupomCancelPago)) === 1,
    );
    const rCancelPago = await client.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago'::text) AS r",
      [pCancelPago, "PAY_G3_CANCELA_PAGO"],
    );
    conferir(
      "grupo3/cancelado->pago: retorno = 'pago_apos_expirar'",
      rCancelPago.rows[0].r === "pago_apos_expirar",
      `veio '${rCancelPago.rows[0].r}'`,
    );
    conferir(
      "grupo3/cancelado->pago: usage_count CONTINUA 1 -- nada foi reconsumido",
      (await usosDoCupom(client, cupomCancelPago)) === 1,
    );
    await foraDaJanela(client, pCancelPago);
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "grupo3/cancelado->pago: a varredura NAO mexeu mesmo com a janela vencida",
      (await usosDoCupom(client, cupomCancelPago)) === 1,
    );

    // --- controle: o mesmo pagamento confirmado duas vezes nao muda nada -----
    const rExpPago2 = await client.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago'::text) AS r",
      [pExpPago, "PAY_G3_EXPIRA_PAGO"],
    );
    conferir(
      "controle (2a confirmacao do MESMO pagamento): retorno = 'ja_pago'",
      rExpPago2.rows[0].r === "ja_pago",
      `veio '${rExpPago2.rows[0].r}'`,
    );
    conferir(
      "controle (2a confirmacao do MESMO pagamento): usage_count continua 1",
      (await usosDoCupom(client, cupomExpPago)) === 1,
    );

    // =========================================================================
    // GRUPO 4: a varredura rodando DUAS vezes -> a vaga nao volta duas vezes
    // =========================================================================
    console.log("\n=== grupo 4: varredura chamada duas vezes -> nao devolve duas vezes ===");

    const cupomIdemA = await criarCupom(client, { code: "G4_IDEM_A" });
    const pIdemA = await criarPedido(client, { produtoId, codigo: "G4_IDEM_A" });
    await foraDaJanela(client, pIdemA);
    await cancelarComoAdmin(client, pIdemA, admin.id);

    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "idempotencia (1a chamada): pedido A devolveu o cupom (1 -> 0)",
      (await usosDoCupom(client, cupomIdemA)) === 0,
    );
    const estadoIdemA = await pedido(client, pIdemA);
    conferir(
      "idempotencia (1a chamada): coupon_usage_returned virou TRUE",
      estadoIdemA.coupon_usage_returned === true,
    );

    // Antes da 2a chamada: cria um pedido B NOVO, tambem morto e fora da
    // janela, com cupom proprio — o controle positivo desta rodada (prova
    // que a 2a chamada nao e' um no-op geral, so' o pedido A que ja foi
    // processado que fica parado).
    const cupomIdemB = await criarCupom(client, { code: "G4_IDEM_B" });
    const pIdemB = await criarPedido(client, { produtoId, codigo: "G4_IDEM_B" });
    await foraDaJanela(client, pIdemB);
    await cancelarComoAdmin(client, pIdemB, admin.id);

    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "idempotencia (2a chamada): pedido A NAO foi mexido de novo (continua 0, nao foi a -1)",
      (await usosDoCupom(client, cupomIdemA)) === 0,
    );
    conferir(
      "idempotencia (2a chamada): pedido B, novo e morto fora da janela, devolveu o cupom (1 -> 0) — instrumento vivo",
      (await usosDoCupom(client, cupomIdemB)) === 0,
    );

    // Trava direta: chamar devolver_uso_cupom() (a funcao interna, sem a
    // guarda de coupon_usage_returned) duas vezes seguidas -- usage_count
    // nunca fica negativo, mesmo bypassando a orquestracao de proposito.
    console.log("\n=== trava: usage_count nunca fica negativo (devolver_uso_cupom direto) ===");
    const cupomPiso = await criarCupom(client, { code: "PISO_ZERO", usageCount: 0 });
    const pPiso = await criarPedido(client, { produtoId, codigo: "PISO_ZERO" });
    await client.query("UPDATE public.coupons SET usage_count = 0 WHERE id = $1", [cupomPiso]);
    await client.query("SELECT public.devolver_uso_cupom($1::uuid)", [pPiso]);
    conferir(
      "piso (1a chamada direta): usage_count 0 -> 0, nao vira -1",
      (await usosDoCupom(client, cupomPiso)) === 0,
    );
    await client.query("SELECT public.devolver_uso_cupom($1::uuid)", [pPiso]);
    conferir(
      "piso (2a chamada direta): continua 0, nao vira -2",
      (await usosDoCupom(client, cupomPiso)) === 0,
    );

    // --- controle: pedido SEM cupom nao quebra devolver_uso_cupom nem a varredura
    const pSemCupomDireto = await criarPedido(client, { produtoId, codigo: null });
    const { rows: retornoSemCupom } = await client.query(
      "SELECT public.devolver_uso_cupom($1::uuid) AS r",
      [pSemCupomDireto],
    );
    conferir(
      "controle: devolver_uso_cupom em pedido SEM cupom devolve 0, sem erro",
      retornoSemCupom[0].r === 0,
    );
    await foraDaJanela(client, pSemCupomDireto);
    await cancelarComoAdmin(client, pSemCupomDireto, admin.id);
    await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
    conferir(
      "controle: a varredura ignora pedido SEM cupom sem erro",
      true, // se chegou ate aqui sem excecao, a asserção e' o proprio fluxo nao ter falhado
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
