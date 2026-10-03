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
 * DOIS MODOS, ESCOLHIDOS PELO ESTADO VIVO DO BANCO (peca 12):
 *
 *   MODO HISTORICO — a Rodada 4 AINDA NAO existe no banco: aplica SO a
 *   20260901000000 na transacao e roda os grupos 1-5 (a prova original da
 *   Rodada 4, intacta — por isso ela referencia SEMPRE o mundo antigo). A
 *   prova da Fase 2 NAO roda neste modo de proposito: a varredura nova
 *   referencia colunas que nascem DEPOIS da Rodada 4 (20260970000000).
 *
 *   MODO PECA 12 — a Rodada 4 JA ESTA viva no banco: nao aplica migration
 *   nenhuma; exige a clausula nova viva (se a Rodada 4 estiver viva SEM a
 *   carencia, aborta mandando aplicar as duas da Fase 2 pelo db-apply) e
 *   roda as fichas das funcoes + o grupo 6 contra o que esta no ar. E o
 *   modo que a peca 12 manda rodar, contra banco de DESENVOLVIMENTO com a
 *   cadeia inteira aplicada.
 *
 * USO NORMAL (MODO HISTORICO, banco novo):
 *   node scripts/db-prove-devolucao-de-uso-de-cupom.cjs
 *
 * USO NORMAL (MODO PECA 12, banco de DESENVOLVIMENTO com as migrations
 * aplicadas pelo db-apply):
 *   DATABASE_URL=... node scripts/db-prove-devolucao-de-uso-de-cupom.cjs
 *   -- rodar SOMENTE contra banco de desenvolvimento comprovado. Em 15/09
 *   -- 2026 a unica DATABASE_URL desta maquina aponta para a loja PRINCIPAL
 *   -- (producao); a prova NAO rodou la. Ver o relatorio da peca 12.
 *
 * REPRODUZIR O VERMELHO (so no MODO HISTORICO; reinsere, SO EM MEMORIA --
 * nunca grava em disk --, a chamada imediata de devolver_uso_cupom que a
 * Rodada 1 fazia no cancelamento manual, simulando a regressao para o
 * desenho anterior. Os casos "grupo1/cancelamento manual" abaixo falham; o
 * resto do script continua passando, porque so' aquele ponto depende do
 * redesenho):
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
// PECA 12 (Fase 2): as duas migrations do ramo nunca-cobrado + mensagens.
const MIGRATION_MENSAGENS =
  "20261151000000_cupom_preso_diz_que_a_vaga_volta.sql";
const MIGRATION_VARREDURA =
  "20261152000000_varredura_libera_vaga_de_pedido_sem_cobranca.sql";
// A frase canonica, exatamente como as tres funcoes a escrevem (lição #53:
// o classificador do front casa um texto so).
const FRASE_VAGA_PRESA =
  "está no limite de usos. A vaga dele volta sozinha quando o pagamento de um pedido cancelado deixar de ser possível (em até 24 horas).";

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
  const total = codigo ? PRECO + FRETE - PRECO * 0.1 : PRECO + FRETE;
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
    "UPDATE public.marketplace_orders SET gateway_payment_id = $2 WHERE id = $1",
    [orderId, paymentId],
  );
}

/**
 * PECA 12: a gravação tardia do gateway COM a guarda nova do UPDATE da edge
 * (`.eq("status","pending")`). Devolve o rowCount — 0 linhas é a guarda
 * recusando gravar cobrança sobre pedido que não está mais 'pending'.
 */
async function amarrarGatewayComGuarda(client, orderId, paymentId) {
  const r = await client.query(
    "UPDATE public.marketplace_orders SET gateway_payment_id = $2 WHERE id = $1 AND status = 'pending'",
    [orderId, paymentId],
  );
  return r.rowCount;
}

/** PECA 12: expires_at vencido ha 16 minutos — FORA da carencia de 15. */
async function foraDaCarencia(client, orderId) {
  await client.query(
    `UPDATE public.marketplace_orders SET expires_at = now() - interval '16 minutes' WHERE id = $1`,
    [orderId],
  );
}

/** PECA 12: expires_at vencido ha 5 minutos — DENTRO da carencia de 15. */
async function dentroDaCarencia(client, orderId) {
  await client.query(
    `UPDATE public.marketplace_orders SET expires_at = now() - interval '5 minutes' WHERE id = $1`,
    [orderId],
  );
}

/** PECA 12: corpo (ou corpos) vivos de uma funcao, via pg_get_functiondef. */
async function corposFuncaoViva(client, nome) {
  const { rows } = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS corpo
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`,
    [nome],
  );
  return rows.map((r) => r.corpo).join("\n");
}

/** PECA 12: a clausula nova da varredura esta viva no banco? */
async function clausulaPeca12VivaAoVivo(client) {
  const { rows } = await client.query(`
    SELECT pg_get_functiondef(p.oid) LIKE '%gateway_payment_id IS NULL AND expires_at < now() - interval ''15 minutes''%' AS viva
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'devolver_cupons_de_pedidos_mortos'`);
  return rows.length > 0 && rows[0].viva === true;
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
    throw new Error(
      "Nenhum usuario admin em auth.users para o cenario de cancelamento manual.",
    );
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
    throw new Error(
      `${email} nao resolve is_admin() = true. Nao serve para o cenario de cancelamento manual.`,
    );
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
    throw new Error(
      "SEM_FIX_JANELA=1 nao achou o marcador -- a migration mudou.",
    );
  }
  return sql.replace(
    alvo,
    "END LOOP;\n\n        PERFORM public.devolver_uso_cupom(p_order_id);\n\n        -- A vaga do cupom NAO volta aqui",
  );
}

/**
 * PECA 12 (Fase 2): fichas das funcoes + GRUPO 6 — o ramo nunca-cobrado e a
 * porta B1. Roda nos DOIS modos: no MODO HISTORICO, DEPOIS de as duas
 * migrations da Fase 2 serem aplicadas na transacao; no MODO PECA 12,
 * contra as funcoes ja vivas no banco de desenvolvimento. Tudo dentro da
 * MESMA transacao terminada em ROLLBACK.
 */
async function provarFase2(client, produtoId, adminSub) {
  // =========================================================================
  // FICHAS: as funcoes vivas (na transacao) carregam a Fase 2 inteira
  // =========================================================================
  console.log(
    "\n=== fichas (peca 12): as funcoes vivas tem a Fase 2 inteira ===",
  );
  const corpoVarredura = await corposFuncaoViva(
    client,
    "devolver_cupons_de_pedidos_mortos",
  );
  conferir(
    "ficha/varredura: a carencia de 15 minutos esta viva",
    corpoVarredura.includes(
      "gateway_payment_id IS NULL AND expires_at < now() - interval '15 minutes'",
    ),
  );
  conferir(
    "ficha/varredura: as 24 horas do ramo antigo permanecem",
    corpoVarredura.includes("interval '24 hours'"),
  );
  conferir(
    "ficha/varredura: a 7a clausula (cancelled_after_shipping) permanece",
    corpoVarredura.includes(
      "cancelled_after_shipping = false OR returned_to_seller_at IS NOT NULL",
    ),
  );
  conferir(
    "ficha/varredura: o laco segue com FOR UPDATE SKIP LOCKED e o fato gravado",
    corpoVarredura.includes("FOR UPDATE SKIP LOCKED") &&
      corpoVarredura.includes("SET coupon_usage_returned = TRUE"),
  );
  for (const nome of [
    "validate_coupon_secure_v2",
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const corpo = await corposFuncaoViva(client, nome);
    conferir(
      `ficha/${nome}: a frase canonica de vaga presa esta viva`,
      corpo.includes(FRASE_VAGA_PRESA),
    );
  }
  const { rows: privilegios } = await client.query(`
    SELECT has_function_privilege('anon', 'public.validate_coupon_secure_v2(text,numeric)', 'EXECUTE') AS anon_validate,
           has_function_privilege('authenticated', 'public.validate_coupon_secure_v2(text,numeric)', 'EXECUTE') AS auth_validate,
           has_function_privilege('anon', 'public.devolver_cupons_de_pedidos_mortos()', 'EXECUTE') AS anon_varredura,
           has_function_privilege('authenticated', 'public.devolver_cupons_de_pedidos_mortos()', 'EXECUTE') AS auth_varredura`);
  conferir(
    "ficha/grants: anon e authenticated alcancam o validate (convidado aplica cupom)",
    privilegios[0].anon_validate === true &&
      privilegios[0].auth_validate === true,
  );
  conferir(
    "ficha/grants: papeis web NAO alcancam a varredura (so o pg_cron)",
    privilegios[0].anon_varredura === false &&
      privilegios[0].auth_varredura === false,
  );

  // =========================================================================
  // GRUPO 6 (peca 12): o ramo nunca-cobrado e a porta B1
  // =========================================================================
  console.log("\n=== grupo 6 (peca 12): o ramo nunca-cobrado e a porta B1 ===");

  // --- 6a. nunca-cobrado, vencido FORA da carencia -> a vaga volta ----------
  const cupomNunca = await criarCupom(client, { code: "G6_NUNCA" });
  const pNunca = await criarPedido(client, { produtoId, codigo: "G6_NUNCA" });
  await foraDaCarencia(client, pNunca);
  await cancelarComoAdmin(client, pNunca, adminSub);
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/nunca-cobrado vencido (16 min): a varredura devolveu a vaga (1 -> 0)",
    (await usosDoCupom(client, cupomNunca)) === 0,
  );
  const estadoNunca = await pedido(client, pNunca);
  conferir(
    "grupo6/nunca-cobrado vencido: coupon_usage_returned virou TRUE",
    estadoNunca.coupon_usage_returned === true,
  );

  // --- 6b. vencido DENTRO da carencia -> a vaga NAO volta --------------------
  const cupomCarencia = await criarCupom(client, { code: "G6_CARENCIA" });
  const pCarencia = await criarPedido(client, {
    produtoId,
    codigo: "G6_CARENCIA",
  });
  await dentroDaCarencia(client, pCarencia);
  await cancelarComoAdmin(client, pCarencia, adminSub);
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/vencido dentro da carencia (5 min): a varredura NAO tocou — a carencia segura a gravação em voo",
    (await usosDoCupom(client, cupomCarencia)) === 1,
  );

  // --- 6c. prazo no FUTURO -> a vaga NAO volta -------------------------------
  const cupomFuturo = await criarCupom(client, { code: "G6_FUTURO" });
  const pFuturo = await criarPedido(client, { produtoId, codigo: "G6_FUTURO" });
  await cancelarComoAdmin(client, pFuturo, adminSub); // expires_at segue now()+30min
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/prazo no futuro: a varredura NAO tocou",
    (await usosDoCupom(client, cupomFuturo)) === 1,
  );

  // --- 6d. a corrida B1, em ordem ---------------------------------------------
  // Pedido cancelado sem cobranca, ja fora da carencia. A gravação tardia do
  // gateway da edge aterrissa COM a guarda nova (WHERE status = 'pending') e
  // NAO grava (0 linhas) — a cobranca fica orfa, nenhum QR chega ao cliente.
  // A varredura devolve; e um pagamento tardio qualquer cai em 'divergente':
  // a vaga devolvida nunca convive com pagamento que possa entrar (item 3 da
  // prova da opcao D do desenho).
  const cupomB1 = await criarCupom(client, { code: "G6_B1" });
  const pB1 = await criarPedido(client, { produtoId, codigo: "G6_B1" });
  await foraDaCarencia(client, pB1);
  await cancelarComoAdmin(client, pB1, adminSub);
  const gravadoB1 = await amarrarGatewayComGuarda(client, pB1, "PAY_G6_B1");
  conferir(
    "grupo6/B1: a gravação tardia do gateway bate na guarda de status e NÃO grava (0 linhas)",
    gravadoB1 === 0,
  );
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/B1: a varredura devolveu a vaga (1 -> 0) — o pedido segue nunca-cobrado de verdade",
    (await usosDoCupom(client, cupomB1)) === 0,
  );
  const rB1 = await client.query(
    "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago'::text) AS r",
    [pB1, "PAY_G6_B1"],
  );
  conferir(
    "grupo6/B1: pagamento tardio sobre o pedido ja liberado = 'divergente' (nada gravado)",
    rB1.rows[0].r === "divergente",
    `veio '${rB1.rows[0].r}'`,
  );
  const estadoB1 = await pedido(client, pB1);
  conferir(
    "grupo6/B1: payment_status NAO virou 'pago' e a vaga segue devolvida (usage 0)",
    estadoB1.payment_status !== "pago" &&
      (await usosDoCupom(client, cupomB1)) === 0,
  );

  // --- 6d-bis. dentro da carencia, a gravação em voo aterra e o pedido SAI --
  // O outro lado da corrida: gravação que aterrissou a tempo (a edge leu o
  // pedido ANTES do prazo/cancelamento). A carencia segurou a varredura; o
  // gateway gravado tira o pedido do ramo nunca-cobrado — volta ao ramo das
  // 24h, onde o QR pago vira 'pago_apos_expirar' (envelope residual aceito).
  const cupomVoo = await criarCupom(client, { code: "G6_VOO" });
  const pVoo = await criarPedido(client, { produtoId, codigo: "G6_VOO" });
  await dentroDaCarencia(client, pVoo);
  await cancelarComoAdmin(client, pVoo, adminSub);
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/B1-voo (1): dentro da carencia, a varredura NAO devolveu",
    (await usosDoCupom(client, cupomVoo)) === 1,
  );
  await amarrarGateway(client, pVoo, "PAY_G6_VOO");
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/B1-voo (2): com o gateway gravado, o pedido SAIU do ramo novo — a varredura segue sem tocar",
    (await usosDoCupom(client, cupomVoo)) === 1,
  );

  // --- 6e. gateway NOT NULL dentro das 24h -> ramo antigo segue de pe -------
  const cupomComGateway = await criarCupom(client, { code: "G6_COM_GATEWAY" });
  const pComGateway = await criarPedido(client, {
    produtoId,
    codigo: "G6_COM_GATEWAY",
  });
  await amarrarGateway(client, pComGateway, "PAY_G6_GATEWAY");
  await client.query(
    `UPDATE public.marketplace_orders SET expires_at = now() - interval '1 hour' WHERE id = $1`,
    [pComGateway],
  );
  await cancelarComoAdmin(client, pComGateway, adminSub);
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/cobranca existente vencida ha 1h: a varredura NAO tocou — o ramo das 24h governa",
    (await usosDoCupom(client, cupomComGateway)) === 1,
  );

  // --- 6f. piso em zero NO ramo novo ------------------------------------------
  const cupomPisoNovo = await criarCupom(client, { code: "G6_PISO_NOVO" });
  const pPisoNovo = await criarPedido(client, {
    produtoId,
    codigo: "G6_PISO_NOVO",
  });
  await client.query(
    "UPDATE public.coupons SET usage_count = 0 WHERE id = $1",
    [cupomPisoNovo],
  );
  await foraDaCarencia(client, pPisoNovo);
  await cancelarComoAdmin(client, pPisoNovo, adminSub);
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  const estadoPisoNovo = await pedido(client, pPisoNovo);
  conferir(
    "grupo6/piso no ramo novo: varredura sobre usage_count 0 DEIXA 0, nunca -1",
    (await usosDoCupom(client, cupomPisoNovo)) === 0,
  );
  conferir(
    "grupo6/piso no ramo novo: a varredura PROCESSOU o pedido (coupon_usage_returned = true) — o 0 é o piso GREATEST, não desinteresse",
    estadoPisoNovo.coupon_usage_returned === true,
  );

  // --- 6g. varredura DUAS vezes no ramo novo -> devolve UMA vez ---------------
  const cupomIdemNovo = await criarCupom(client, { code: "G6_IDEM_NOVO" });
  const pIdemNovo = await criarPedido(client, {
    produtoId,
    codigo: "G6_IDEM_NOVO",
  });
  await foraDaCarencia(client, pIdemNovo);
  await cancelarComoAdmin(client, pIdemNovo, adminSub);
  // Controle positivo vivo: um pedido no ramo ANTIGO (janela de 24h vencida),
  // para provar que a 2a chamada nao e' no-op geral.
  const cupomIdemAntigo = await criarCupom(client, { code: "G6_IDEM_ANTIGO" });
  const pIdemAntigo = await criarPedido(client, {
    produtoId,
    codigo: "G6_IDEM_ANTIGO",
  });
  await foraDaJanela(client, pIdemAntigo);
  await cancelarComoAdmin(client, pIdemAntigo, adminSub);

  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/idempotencia (1a chamada): ramo novo devolveu (1 -> 0) e ramo antigo devolveu (1 -> 0)",
    (await usosDoCupom(client, cupomIdemNovo)) === 0 &&
      (await usosDoCupom(client, cupomIdemAntigo)) === 0,
  );
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/idempotencia (2a chamada): NEM o ramo novo NEM o antigo foram mexidos de novo",
    (await usosDoCupom(client, cupomIdemNovo)) === 0 &&
      (await usosDoCupom(client, cupomIdemAntigo)) === 0,
  );
  const estadoIdemNovo = await pedido(client, pIdemNovo);
  conferir(
    "grupo6/idempotencia (2a chamada): o fato gravado segura o ramo novo (coupon_usage_returned = true)",
    estadoIdemNovo.coupon_usage_returned === true,
  );

  // --- 6h. a 7a clausula bloqueia TAMBEM no ramo novo -------------------------
  const cupomAposEnvio = await criarCupom(client, { code: "G6_APOS_ENVIO" });
  const pAposEnvio = await criarPedido(client, {
    produtoId,
    codigo: "G6_APOS_ENVIO",
  });
  await client.query(
    "UPDATE public.marketplace_orders SET status = 'shipping' WHERE id = $1",
    [pAposEnvio],
  );
  await cancelarComoAdmin(client, pAposEnvio, adminSub); // grava cancelled_after_shipping = true
  conferir(
    "grupo6/apos-envio: o cancelamento apos o envio ficou registrado (cancelled_after_shipping = true)",
    (
      await client.query(
        "SELECT cancelled_after_shipping AS c FROM public.marketplace_orders WHERE id = $1",
        [pAposEnvio],
      )
    ).rows[0].c === true,
  );
  await foraDaCarencia(client, pAposEnvio);
  await client.query("SELECT public.devolver_cupons_de_pedidos_mortos()");
  conferir(
    "grupo6/apos-envio: nunca-cobrado e vencido, mas SEM o produto de volta a varredura NAO devolve",
    (await usosDoCupom(client, cupomAposEnvio)) === 1,
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
    const rodada4Viva = await migrationJaAplicadaAoVivo(client);
    if (rodada4Viva) {
      // MODO PECA 12: a Rodada 4 ja esta viva. Exige a clausula nova viva e
      // roda as fichas + o grupo 6 contra o que esta no ar — NENHUMA
      // migration aplicada, tudo em transacao com ROLLBACK.
      const carenciaViva = await clausulaPeca12VivaAoVivo(client);
      if (!carenciaViva) {
        throw new Error(
          `devolver_cupons_de_pedidos_mortos ja existe AO VIVO, mas SEM a clausula da peca 12 (gateway_payment_id IS NULL AND expires_at < now() - interval '15 minutes'). Aplique ${MIGRATION_MENSAGENS} e ${MIGRATION_VARREDURA} pelo db-apply (fluxo da casa) antes de rodar esta prova.`,
        );
      }
      console.log(
        "banco: Rodada 4 viva COM a clausula da peca 12 — MODO PECA 12: provando as funcoes NO AR " +
          "(ROLLBACK no final; nenhuma migration aplicada)\n",
      );

      // Cenario fixo + produto + admin para o grupo 6.
      await client.query(
        `UPDATE public.store_config
            SET shipping_fee = $1, free_shipping_min = 0
          WHERE id = 1`,
        [FRETE],
      );
      const produtoId = await criarProduto(client);
      const admin = await descobrirAdmin(client);
      await confirmarAdmin(client, admin.id, admin.email);
      console.log(
        `Admin de teste: ${admin.email} (is_admin() = true, conferido)\n`,
      );

      await provarFase2(client, produtoId, admin.id);
      return; // o finally faz o ROLLBACK e encerra
    }
    console.log(
      `banco: ${MIGRATION} AINDA NAO aplicada -- MODO HISTORICO: aplicando a Rodada 4 na transacao (ROLLBACK no final)\n`,
    );

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
    console.log(
      `Admin de teste: ${admin.email} (is_admin() = true, conferido)\n`,
    );

    // =========================================================================
    // GRUPO 5 (parte 1): cria a linha PRE-EXISTENTE ANTES de aplicar a
    // migration -- precisa nascer antes do ALTER TABLE para provar que o
    // DEFAULT da coluna nova cobre corretamente quem ja existia. Ja sai
    // definitivamente morta e fora da janela, simulando um pedido que ja
    // estava assim quando esta migration finalmente subir em producao.
    // =========================================================================
    console.log("=== grupo 5: linha pre-existente (nasce ANTES do apply) ===");
    const cupomPre = await criarCupom(client, { code: "PRE_EXISTENTE" });
    const pedidoPre = await criarPedido(client, {
      produtoId,
      codigo: "PRE_EXISTENTE",
    });
    conferir(
      "pre-existente: uso contado na criacao",
      (await usosDoCupom(client, cupomPre)) === 1,
    );
    await client.query(
      `UPDATE public.marketplace_orders
          SET status = 'cancelled', payment_status = 'expirado',
              expires_at = now() - interval '25 hours'
        WHERE id = $1`,
      [pedidoPre],
    );
    console.log(
      "  (linha nasceu 'cancelled'/'expirado', ja fora da janela -- ANTES do ALTER TABLE)\n",
    );

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
    conferir(
      "migration aplicada na transacao",
      await migrationJaAplicadaAoVivo(client),
    );

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
    console.log(
      "\n=== grupo 1: desfeito DENTRO da janela -> vaga continua ocupada ===",
    );

    // --- 1a. expiracao automatica (dentro da janela) -------------------------
    const cupomExpJanela = await criarCupom(client, { code: "G1_EXPIRA" });
    const pExpJanela = await criarPedido(client, {
      produtoId,
      codigo: "G1_EXPIRA",
    });
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
    const pCancelJanela = await criarPedido(client, {
      produtoId,
      codigo: "G1_CANCELA",
    });
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
    const pEstornoJanela = await criarPedido(client, {
      produtoId,
      codigo: "G1_ESTORNO",
    });
    await amarrarGateway(client, pEstornoJanela, "PAY_G1_ESTORNO");
    const rEstornoJanela = await client.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'estornado'::text) AS r",
      [pEstornoJanela, "PAY_G1_ESTORNO"],
    );
    conferir(
      "grupo1/estorno: retorno = 'estornado'",
      rEstornoJanela.rows[0].r === "estornado",
    );
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
    const pRecusaJanela = await criarPedido(client, {
      produtoId,
      codigo: "G1_RECUSA",
    });
    await amarrarGateway(client, pRecusaJanela, "PAY_G1_RECUSA");
    const rRecusaJanela = await client.query(
      "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'recusado'::text) AS r",
      [pRecusaJanela, "PAY_G1_RECUSA"],
    );
    conferir(
      "grupo1/recusa: retorno = 'recusado'",
      rRecusaJanela.rows[0].r === "recusado",
    );
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
    const pCancelSemCupom = await criarPedido(client, {
      produtoId,
      codigo: null,
    });
    await cancelarComoAdmin(client, pCancelSemCupom, admin.id);
    const estadoSemCupom = await pedido(client, pCancelSemCupom);
    conferir(
      "controle: cancelar pedido SEM cupom nao levanta erro e fecha 'cancelled'",
      estadoSemCupom.status === "cancelled",
    );

    // =========================================================================
    // GRUPO 2: pedido desfeito, JANELA VENCIDA -> a vaga volta
    // =========================================================================
    console.log(
      "\n=== grupo 2: desfeito com a janela VENCIDA -> vaga volta ===",
    );

    // --- 2a. expirado, depois a janela vence ---------------------------------
    const cupomExpVencida = await criarCupom(client, { code: "G2_EXPIRA" });
    const pExpVencida = await criarPedido(client, {
      produtoId,
      codigo: "G2_EXPIRA",
    });
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
    const pCancelVencida = await criarPedido(client, {
      produtoId,
      codigo: "G2_CANCELA",
    });
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
    const cupomSemExpires = await criarCupom(client, {
      code: "G2_SEM_EXPIRES",
    });
    const pSemExpires = await criarPedido(client, {
      produtoId,
      codigo: "G2_SEM_EXPIRES",
    });
    await client.query(
      "UPDATE public.marketplace_orders SET expires_at = NULL WHERE id = $1",
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
    console.log(
      "\n=== grupo 3: desfeito na janela, pago depois -> nada mexe em usage_count ===",
    );

    // --- 3a. expirado -> pago depois ------------------------------------------
    const cupomExpPago = await criarCupom(client, { code: "G3_EXPIRA_PAGO" });
    const pExpPago = await criarPedido(client, {
      produtoId,
      codigo: "G3_EXPIRA_PAGO",
    });
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
    const cupomCancelPago = await criarCupom(client, {
      code: "G3_CANCELA_PAGO",
    });
    const pCancelPago = await criarPedido(client, {
      produtoId,
      codigo: "G3_CANCELA_PAGO",
    });
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
    console.log(
      "\n=== grupo 4: varredura chamada duas vezes -> nao devolve duas vezes ===",
    );

    const cupomIdemA = await criarCupom(client, { code: "G4_IDEM_A" });
    const pIdemA = await criarPedido(client, {
      produtoId,
      codigo: "G4_IDEM_A",
    });
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
    const pIdemB = await criarPedido(client, {
      produtoId,
      codigo: "G4_IDEM_B",
    });
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
    console.log(
      "\n=== trava: usage_count nunca fica negativo (devolver_uso_cupom direto) ===",
    );
    const cupomPiso = await criarCupom(client, {
      code: "PISO_ZERO",
      usageCount: 0,
    });
    const pPiso = await criarPedido(client, { produtoId, codigo: "PISO_ZERO" });
    await client.query(
      "UPDATE public.coupons SET usage_count = 0 WHERE id = $1",
      [cupomPiso],
    );
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
    const pSemCupomDireto = await criarPedido(client, {
      produtoId,
      codigo: null,
    });
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

    // PECA 12: a prova da Fase 2 (fichas + grupo 6) NAO roda aqui de proposito.
    // Este modo simula um banco so' ate a Rodada 4 — e a varredura da Fase 2
    // referencia colunas que nascem DEPOIS dela (cancelled_after_shipping e
    // returned_to_seller_at, 20260970000000): aplica-la neste mundo sintetico
    // quebraria a execucao. O grupo 6 roda no MODO PECA 12, contra banco com a
    // cadeia inteira aplicada — que e o que a peca manda provar.
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
