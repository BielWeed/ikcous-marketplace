#!/usr/bin/env node
/**
 * Prova a `confirmar_pagamento` da Fase 3 (CHECKOUT-060).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado.
 * Isso so e verdade porque a migration NAO tem COMMIT embutido — se alguem
 * acrescentar um, este script passa a gravar em producao sem avisar.
 *
 * RISCO — DDL dentro da transacao: este script roda `CREATE OR REPLACE
 * FUNCTION` (duas vezes, ver main()) e `CREATE EXTENSION IF NOT EXISTS`
 * + `cron.schedule`/`cron.unschedule` (da 20260808000100_reconciliacao.sql)
 * contra o banco de PRODUCAO. Isso e' DDL na funcao de dinheiro viva, nao um
 * INSERT qualquer — mudou de classe de risco em relacao a um script que so
 * grava linha e desfaz. E' seguro porque tudo, sem excecao, esta dentro de
 * um unico `BEGIN`/`ROLLBACK` (ver main()): as funcoes mutadas e o
 * agendamento do cron NUNCA existem fora desta transacao — o ROLLBACK final
 * desfaz o CREATE OR REPLACE e o cron.schedule tanto quanto desfaria um
 * INSERT.
 *
 * Cada caso deste script e uma linha da tabela de decisao do brief da Task 2
 * (regerado em 07/08/2026 e de novo em 09/08/2026, apos duas rodadas de
 * revisao que acharam defeitos reais no SQL do plano). Tres regras vieram
 * das revisoes e valem para TODOS os casos:
 *
 * 1. TODO pedido montado leva item de verdade em marketplace_order_items
 *    (product_id, quantity > 0) — inclusive os casos cuja asserção e
 *    "estoque intacto". Na primeira versao, criarPedido() nao inseria item
 *    nenhum: devolver_estoque devolvia 0 e as asserções de "estoque
 *    intacto" passavam MESMO com o mecanismo invertido (a revisao mutou o
 *    ramo do estorno para creditar estoque e a prova continuou verde).
 * 2. CADA caso monta o proprio pedido — nao reaproveita o pedido de um caso
 *    anterior. `gateway_payment_id` e UNICO (indice parcial da
 *    20260807000000), entao cada caso usa um valor diferente. Na primeira
 *    versao, os casos 2, 6 e 7 dependiam do estado deixado pelos anteriores
 *    no MESMO pedido: mudar um mudava o significado dos outros em silencio.
 * 3. Os casos `aguardando` + `status='cancelled'` (estorno, recusado e — desde
 *    a revisao do PR #179 — pago) sao o achado da re-revisao de 09/08/2026 e
 *    da revisao de 10/08/2026: os ramos que chamam devolver_estoque OU que
 *    decidem entre 'pago' e 'pago_apos_expirar' olhavam so para
 *    payment_status='aguardando', sem olhar `status`. update_order_status_
 *    atomic devolve o estoque quando o cliente cancela pelo app e NAO
 *    escreve payment_status — o pedido fica 'aguardando' + 'cancelled' com o
 *    estoque JA de volta. Medido sem a guarda de estoque: 10 -> 13, unidade
 *    fantasma no catalogo. O ramo 'pago' (Item 1 do PR #179) era o UNICO dos
 *    tres que ainda faltava essa guarda — sem ela, pedido cancelado com PIX
 *    pago depois virava 'pago' com status 'cancelled', dinheiro recebido e
 *    sem sinal de atencao no admin.
 *
 * Este script aplica DENTRO da transacao a versao de confirmar_pagamento da
 * migration 20260810000000_confirmar_pagamento_guarda_status.sql (o CREATE OR
 * REPLACE FUNCTION, ver main()) ANTES de rodar os casos — a migration ainda
 * nao foi aplicada em producao, e e' assim que a prova cobre o SQL dela sem
 * aplicar nada: o ROLLBACK do fim desfaz o CREATE OR REPLACE tambem.
 *
 * Achado 3 da revisao do PR #179: pela mesma razao, este script TAMBEM
 * aplica DENTRO da transacao a 20260808000100_reconciliacao.sql (que cria
 * `pagamentos_a_reconciliar`) — sem isso os casos 15-19 (Task 5) estouravam
 * em "function pagamentos_a_reconciliar() does not exist" e o script morria
 * com exit code 1 ANTES do sumario, deixando o `ORDER BY expires_at DESC`
 * sem nenhum teste rodando. Antes de aplicar cada uma das duas, main()
 * mede a funcao/migration JA VIVA no banco e imprime qual dos dois mundos
 * esta sendo provado (Achado 4): se a guarda ou a reconciliacao ja tiverem
 * sido aplicadas de verdade, as assercoes passam a provar o BANCO; senao,
 * provam o ARQUIVO dentro desta transacao. So log, sem afetar o resultado —
 * a diferenca tem de ficar visivel na saida, nao implicita.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");

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
  throw new Error("DATABASE_URL não encontrada.");
}

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function criarProduto(client, nome, estoque) {
  // `custo` e NOT NULL sem default nesta tabela — omitir quebra o INSERT.
  const r = await client.query(
    `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
     VALUES ($1, 5.00, 10.00, $2, 'teste')
     RETURNING id`,
    [nome, estoque],
  );
  return r.rows[0].id;
}

/**
 * Monta um pedido com item de verdade. `quantity` e a quantidade reservada
 * no item — TODO pedido leva item, mesmo os casos que so provam "estoque
 * intacto" (ver cabecalho do arquivo, regra 1).
 */
async function criarPedido(
  client,
  { nome, paymentStatus, status, gatewayPaymentId, produtoId, quantity },
) {
  // `customer_data` (jsonb) e `subtotal` sao NOT NULL sem default nesta
  // tabela — omitir qualquer um dos dois quebra o INSERT.
  const r = await client.query(
    `INSERT INTO public.marketplace_orders
       (total, subtotal, status, payment_status, gateway_payment_id,
        customer_name, customer_data)
     VALUES (10.00, 10.00, $1, $2, $3, $4, '{}'::jsonb)
     RETURNING id`,
    [status, paymentStatus, gatewayPaymentId, nome],
  );
  const pedidoId = r.rows[0].id;
  await client.query(
    `INSERT INTO public.marketplace_order_items
       (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, $3, $4, 10.00)`,
    [pedidoId, produtoId, nome, quantity],
  );
  return pedidoId;
}

/**
 * Monta um pedido para os casos de `pagamentos_a_reconciliar` — diferente de
 * `criarPedido`, aceita `paidAt`/`expiresAt` explicitos porque a funcao sob
 * prova decide inteiramente a partir dessas duas colunas. Mesma regra 1 do
 * cabecalho: leva item de verdade mesmo nos casos que esperam "nao aparece".
 */
async function criarPedidoReconciliacao(
  client,
  {
    nome,
    paymentStatus = "expirado",
    status = "cancelled",
    gatewayPaymentId,
    paidAt,
    expiresAt,
    produtoId,
    quantity,
  },
) {
  const r = await client.query(
    `INSERT INTO public.marketplace_orders
       (total, subtotal, status, payment_status, gateway_payment_id, paid_at,
        expires_at, customer_name, customer_data)
     VALUES (10.00, 10.00, $1, $2, $3, $4, $5, $6, '{}'::jsonb)
     RETURNING id`,
    [status, paymentStatus, gatewayPaymentId, paidAt, expiresAt, nome],
  );
  const pedidoId = r.rows[0].id;
  await client.query(
    `INSERT INTO public.marketplace_order_items
       (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, $3, $4, 10.00)`,
    [pedidoId, produtoId, nome, quantity],
  );
  return pedidoId;
}

/** Le a lista de candidatos que a `pagamentos_a_reconciliar` devolve hoje. */
async function candidatosReconciliacao(client) {
  const r = await client.query(
    "SELECT order_id, gateway_payment_id FROM public.pagamentos_a_reconciliar()",
  );
  return r.rows;
}

async function estadoPedido(client, pedidoId) {
  const r = await client.query(
    `SELECT payment_status, status, paid_at
       FROM public.marketplace_orders
      WHERE id = $1`,
    [pedidoId],
  );
  return r.rows[0];
}

async function estoqueDe(client, produtoId) {
  const r = await client.query(
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [produtoId],
  );
  return r.rows[0].estoque;
}

/**
 * Achado 4 da revisao do PR #179: depois que as duas migrations forem
 * aplicadas de verdade em producao, este script passaria a provar o
 * ARQUIVO (porque o CREATE OR REPLACE dentro da transacao so reescreve o
 * que ja e' identico), nao mais o banco vivo antes de main() mexer nele —
 * e ficaria verde do mesmo jeito mesmo que a migration nunca tivesse
 * rodado de verdade fora desta transacao. Isto mede o mundo ANTES do
 * CREATE OR REPLACE desta run, para a saida dizer qual dos dois esta
 * sendo provado. So log — nao entra em `passou`/`falhou`.
 */
async function guardaStatusJaAplicadaAoVivo(client) {
  const { rows } = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'confirmar_pagamento'`,
  );
  const def = (rows[0]?.def ?? "").replace(/\r\n/g, "\n");
  // MESMO furo que o Item 2 fechou no VERIFICACOES do db-apply.cjs, e o mesmo
  // conserto: "IF v_pedido.status = 'cancelled' THEN" sozinho JA EXISTE hoje
  // em outro ramo desta funcao (o do estorno tambem raciocina sobre
  // 'cancelled') e pode aparecer de novo no ramo do estorno numa migration
  // futura sem que o ramo 'pago' tenha a guarda — o marcador de uma linha
  // acusaria "JA aplicada" mesmo assim. So o bloco inteiro, na mesma ordem
  // do marcador de db-apply.cjs, prova que e' ESTE ramo que tem a guarda.
  const bloco = `IF v_pedido.status = 'cancelled' THEN
                UPDATE public.marketplace_orders
                   SET payment_status = 'pago_apos_expirar',
                       paid_at        = now(),
                       updated_at     = now()
                 WHERE id = p_order_id;
                RETURN 'pago_apos_expirar';
            END IF;`;
  return def.includes(bloco);
}

/** Mesma ideia acima, para a 20260808000100_reconciliacao.sql: a funcao ou
 * existe ao vivo, ou este script vai cria-la dentro da transacao. */
async function reconciliacaoJaAplicadaAoVivo(client) {
  const { rows } = await client.query(
    `SELECT 1
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'pagamentos_a_reconciliar'`,
  );
  return rows.length > 0;
}

async function confirmar(client, pedidoId, paymentId, status) {
  const r = await client.query(
    "SELECT public.confirmar_pagamento($1, $2, $3) AS resultado",
    [pedidoId, paymentId, status],
  );
  return r.rows[0].resultado;
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    // Achado 4 da revisao do PR #179: mede o mundo ANTES de mexer em nada,
    // para a saida dizer se as assercoes a seguir provam o BANCO (migration
    // ja aplicada de verdade em producao) ou o ARQUIVO (aplicado so aqui,
    // dentro desta transacao — o caso comum hoje).
    console.log(
      (await guardaStatusJaAplicadaAoVivo(client))
        ? "banco: 20260810000000 JA aplicada (assercoes provam o BANCO real)"
        : "banco: 20260810000000 AINDA NAO aplicada (assercoes provam o ARQUIVO, dentro da transacao)",
    );
    console.log(
      (await reconciliacaoJaAplicadaAoVivo(client))
        ? "banco: 20260808000100 JA aplicada (assercoes provam o BANCO real)"
        : "banco: 20260808000100 AINDA NAO aplicada (assercoes provam o ARQUIVO, dentro da transacao)",
    );

    // Aplica DENTRO da transacao a versao nova de confirmar_pagamento (Item 1
    // do achado bloqueante da revisao do PR #179 — a migration ainda NAO foi
    // aplicada em producao). E' assim que este script prova o SQL da
    // migration sem aplica-la: CREATE OR REPLACE dentro da transacao, roda as
    // asserções, termina em ROLLBACK — a funcao nova nunca existe fora desta
    // transacao.
    // O caminho e' montado de constantes deste arquivo, nao de entrada — o
    // mesmo motivo pelo qual a leitura do .env em lerDatabaseUrl() ja suprime
    // esta regra. Sem a supressao, sobe a catraca de eslint em +1.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const guardaStatusSql = fs.readFileSync(
      path.join(
        RAIZ,
        "supabase",
        "migrations",
        "20260810000000_confirmar_pagamento_guarda_status.sql",
      ),
      "utf8",
    );
    await client.query(guardaStatusSql);

    // Achado 3 da revisao do PR #179: mesma logica para a reconciliacao —
    // sem isto os casos 15-19 estouravam em "function
    // pagamentos_a_reconciliar() does not exist" e o script morria antes do
    // sumario. Aplicada dentro da MESMA transacao, junto com a guarda acima:
    // um unico ROLLBACK no fim desfaz as duas.
    // Mesma supressao da leitura acima, pelo mesmo motivo.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const reconciliacaoSql = fs.readFileSync(
      path.join(
        RAIZ,
        "supabase",
        "migrations",
        "20260808000100_reconciliacao.sql",
      ),
      "utf8",
    );
    await client.query(reconciliacaoSql);

    console.log("\n=== confirmar_pagamento ===");

    // --- caso 1: 'aguardando' + ('MP1','pago') -> 'pago' -------------------
    const produto1 = await criarProduto(client, "PROVA CONFIRMAR PAGO", 5);
    const pedido1 = await criarPedido(client, {
      nome: "PROVA PAGO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP1",
      produtoId: produto1,
      quantity: 2,
    });

    const r1 = await confirmar(client, pedido1, "MP1", "pago");
    conferir("aguardando + pago -> 'pago'", r1 === "pago", `veio ${r1}`);

    const estado1 = await estadoPedido(client, pedido1);
    conferir("paid_at carimbado na confirmacao", estado1.paid_at !== null);
    const paidAtOriginal = estado1.paid_at;

    conferir(
      "estoque intacto ao confirmar pagamento",
      (await estoqueDe(client, produto1)) === 5,
    );

    // --- caso 2: mesmo pedido, 'pago' de novo -> 'ja_pago' (idempotencia) --
    const r2 = await confirmar(client, pedido1, "MP1", "pago");
    conferir(
      "segunda confirmacao -> 'ja_pago'",
      r2 === "ja_pago",
      `veio ${r2}`,
    );

    const estado2 = await estadoPedido(client, pedido1);
    conferir(
      "paid_at inalterado na segunda confirmacao",
      estado2.paid_at.getTime() === paidAtOriginal.getTime(),
    );

    // --- caso 3: 'expirado' + ('MP2','pago') -> 'pago_apos_expirar' --------
    // A varredura ja ganhou a corrida (ver linhas 87-95 da 20260807000000):
    // estoque JA voltou, status JA e 'cancelled'. A funcao so pode marcar e
    // chamar uma pessoa — nunca mexer em estoque ou desfazer o cancelamento.
    const produto3 = await criarProduto(client, "PROVA CONFIRMAR EXPIRADO", 8);
    const pedido3 = await criarPedido(client, {
      nome: "PROVA EXPIRADO",
      paymentStatus: "expirado",
      status: "cancelled",
      gatewayPaymentId: "MP2",
      produtoId: produto3,
      quantity: 1,
    });

    const r3 = await confirmar(client, pedido3, "MP2", "pago");
    conferir(
      "expirado + pago -> 'pago_apos_expirar'",
      r3 === "pago_apos_expirar",
      `veio ${r3}`,
    );

    const estado3 = await estadoPedido(client, pedido3);
    conferir(
      "status continua 'cancelled' (nao desfaz o cancelamento)",
      estado3.status === "cancelled",
    );
    conferir(
      "estoque inalterado (a varredura ja devolveu)",
      (await estoqueDe(client, produto3)) === 8,
    );

    // --- caso 4: 'aguardando' com 3 unidades reservadas + recusado ---------
    const produto4 = await criarProduto(client, "PROVA CONFIRMAR RECUSADO", 2);
    const pedido4 = await criarPedido(client, {
      nome: "PROVA RECUSADO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP3",
      produtoId: produto4,
      quantity: 3,
    });

    const r4 = await confirmar(client, pedido4, "MP3", "recusado");
    conferir(
      "aguardando + recusado -> 'recusado'",
      r4 === "recusado",
      `veio ${r4}`,
    );

    conferir(
      "estoque devolvido (+3) ao recusar",
      (await estoqueDe(client, produto4)) === 5,
    );
    const estado4 = await estadoPedido(client, pedido4);
    conferir(
      "status vira 'cancelled' ao recusar",
      estado4.status === "cancelled",
    );

    // --- caso 5: pedido ja 'recusado' + recusado de novo -> 'ignorado' -----
    // A prova de que devolver_estoque (nao idempotente) NAO e chamada de novo.
    const r5 = await confirmar(client, pedido4, "MP3", "recusado");
    conferir("recusado de novo -> 'ignorado'", r5 === "ignorado", `veio ${r5}`);
    conferir(
      "estoque NAO e creditado uma segunda vez",
      (await estoqueDe(client, produto4)) === 5,
    );

    // --- caso 6: 'pago' com 3 unidades + estornado -> 'estornado' ----------
    // A partir de 'pago' a mercadoria pode ja ter saido: estornar NAO mexe
    // em estoque.
    const produto6 = await criarProduto(client, "PROVA ESTORNO DE PAGO", 4);
    const pedido6 = await criarPedido(client, {
      nome: "PROVA ESTORNO DE PAGO",
      paymentStatus: "pago",
      status: "processing",
      gatewayPaymentId: "MP4",
      produtoId: produto6,
      quantity: 3,
    });

    const r6 = await confirmar(client, pedido6, "MP4", "estornado");
    conferir(
      "pago + estornado -> 'estornado'",
      r6 === "estornado",
      `veio ${r6}`,
    );
    conferir(
      "estorno a partir de 'pago' nao mexe em estoque (pode ter saido)",
      (await estoqueDe(client, produto6)) === 4,
    );

    // --- caso 7: 'aguardando' com 3 unidades + estornado -> 'estornado' ----
    // O achado 2 da revisao de 07/08/2026: a partir de 'aguardando' NADA
    // saiu, entao estornar tem que DEVOLVER o estoque e CANCELAR o pedido —
    // senao a reserva fica presa para sempre (expirar_pedidos_vencidos so
    // varre 'aguardando', e o pedido deixou de estar 'aguardando').
    const produto7 = await criarProduto(
      client,
      "PROVA ESTORNO DE AGUARDANDO",
      1,
    );
    const pedido7 = await criarPedido(client, {
      nome: "PROVA ESTORNO DE AGUARDANDO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP5",
      produtoId: produto7,
      quantity: 3,
    });

    const r7 = await confirmar(client, pedido7, "MP5", "estornado");
    conferir(
      "aguardando + estornado -> 'estornado'",
      r7 === "estornado",
      `veio ${r7}`,
    );
    conferir(
      "estoque devolvido (+3) ao estornar a partir de 'aguardando'",
      (await estoqueDe(client, produto7)) === 4,
    );
    const estado7 = await estadoPedido(client, pedido7);
    conferir(
      "status vira 'cancelled' ao estornar a partir de 'aguardando'",
      estado7.status === "cancelled",
    );

    // --- caso 8: mesmo pedido, estornado de novo -> 'ja_estornado' ---------
    const r8 = await confirmar(client, pedido7, "MP5", "estornado");
    conferir(
      "estornado de novo -> 'ja_estornado'",
      r8 === "ja_estornado",
      `veio ${r8}`,
    );
    conferir(
      "estoque NAO e creditado uma segunda vez no reestorno",
      (await estoqueDe(client, produto7)) === 4,
    );

    // --- caso 9: 'aguardando' + payment_id que nao bate -> 'divergente' ----
    const produto9 = await criarProduto(client, "PROVA DIVERGENTE", 5);
    const pedido9 = await criarPedido(client, {
      nome: "PROVA DIVERGENTE",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP6",
      produtoId: produto9,
      quantity: 1,
    });

    const antesDivergente = await estadoPedido(client, pedido9);
    const r9 = await confirmar(client, pedido9, "OUTRO", "pago");
    conferir(
      "payment_id divergente -> 'divergente'",
      r9 === "divergente",
      `veio ${r9}`,
    );
    const depoisDivergente = await estadoPedido(client, pedido9);
    conferir(
      "payment_status inalterado quando o payment_id diverge",
      depoisDivergente.payment_status === antesDivergente.payment_status,
    );

    // --- caso 10: 'aguardando' SEM gateway_payment_id + p_payment_id NULL --
    // O achado 1 da revisao: IS DISTINCT FROM sozinho trata NULL/NULL como
    // igual, e essa e' a combinacao NORMAL de todo pedido entre o checkout e
    // a criacao da cobranca. Sem as duas clausulas extras, isto virava
    // 'pago' com paid_at carimbado e nenhum pagamento de verdade.
    const produto10 = await criarProduto(client, "PROVA NULL/NULL", 5);
    const pedido10 = await criarPedido(client, {
      nome: "PROVA NULL/NULL",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: null,
      produtoId: produto10,
      quantity: 1,
    });

    const r10 = await confirmar(client, pedido10, null, "pago");
    conferir(
      "aguardando sem gateway_payment_id + payment_id NULL -> 'divergente' (nao 'pago')",
      r10 === "divergente",
      `veio ${r10}`,
    );
    const estado10 = await estadoPedido(client, pedido10);
    conferir(
      "payment_status/paid_at inalterados no par NULL/NULL",
      estado10.payment_status === "aguardando" && estado10.paid_at === null,
    );

    // --- caso 11: 'aguardando' com gateway_payment_id + p_payment_id NULL --
    const produto11 = await criarProduto(client, "PROVA PAYMENT_ID NULL", 5);
    const pedido11 = await criarPedido(client, {
      nome: "PROVA PAYMENT_ID NULL",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP7",
      produtoId: produto11,
      quantity: 1,
    });

    const r11 = await confirmar(client, pedido11, null, "pago");
    conferir(
      "gateway_payment_id preenchido + payment_id NULL -> 'divergente'",
      r11 === "divergente",
      `veio ${r11}`,
    );

    // --- caso 12: 'aguardando' + status='cancelled' com 3 un. + estornado --
    // O achado da re-revisao de 09/08/2026: o cliente cancelou pelo app (a
    // update_order_status_atomic ja devolveu o estoque e NAO escreve
    // payment_status), entao o pedido fica 'aguardando' + 'cancelled' com o
    // estoque JA de volta. Sem `AND status='pending'`, o estorno credita de
    // novo — unidade fantasma. Aqui o estoque tem que ficar INALTERADO e o
    // status continua 'cancelled' (nao pode "descancelar" o pedido).
    const produto12 = await criarProduto(
      client,
      "PROVA ESTORNO JA CANCELADO",
      5,
    );
    const pedido12 = await criarPedido(client, {
      nome: "PROVA ESTORNO JA CANCELADO",
      paymentStatus: "aguardando",
      status: "cancelled",
      gatewayPaymentId: "MP8",
      produtoId: produto12,
      quantity: 3,
    });

    const r12 = await confirmar(client, pedido12, "MP8", "estornado");
    conferir(
      "aguardando + cancelled + estornado -> 'estornado'",
      r12 === "estornado",
      `veio ${r12}`,
    );
    conferir(
      "estoque INALTERADO ao estornar pedido ja cancelado (nao credita fantasma)",
      (await estoqueDe(client, produto12)) === 5,
    );
    const estado12 = await estadoPedido(client, pedido12);
    conferir(
      "status continua 'cancelled' (nao descancela)",
      estado12.status === "cancelled",
    );

    // --- caso 13: 'aguardando' + status='cancelled' com 3 un. + recusado ---
    // Mesmo achado, ramo 'recusado' — gatilho ainda mais provavel: cartao
    // recusado logo depois de o cliente desistir e cancelar pelo app.
    const produto13 = await criarProduto(
      client,
      "PROVA RECUSADO JA CANCELADO",
      5,
    );
    const pedido13 = await criarPedido(client, {
      nome: "PROVA RECUSADO JA CANCELADO",
      paymentStatus: "aguardando",
      status: "cancelled",
      gatewayPaymentId: "MP9",
      produtoId: produto13,
      quantity: 3,
    });

    const r13 = await confirmar(client, pedido13, "MP9", "recusado");
    conferir(
      "aguardando + cancelled + recusado -> 'recusado'",
      r13 === "recusado",
      `veio ${r13}`,
    );
    conferir(
      "estoque INALTERADO ao recusar pedido ja cancelado (nao credita fantasma)",
      (await estoqueDe(client, produto13)) === 5,
    );

    // --- caso 13b: 'aguardando' + status='cancelled' com 3 un. + pago ------
    // O Item 1 do achado bloqueante da revisao do PR #179: irmao do meio dos
    // casos 12 e 13, o que tem dinheiro. Cliente cancela pelo app (estoque
    // JA voltou pela update_order_status_atomic, payment_status continua
    // 'aguardando') e paga o PIX assim mesmo. Sem a guarda de status, isto
    // virava 'pago' com o pedido 'cancelled' — dinheiro recebido, estoque ja
    // revendivel, badge "Pago" verde sem sinal de atencao. Tem de virar
    // 'pago_apos_expirar' (mesmo balde de atencao que o caso 3 ja prova para
    // a rota da expiracao), com paid_at carimbado, status continuando
    // 'cancelled' e estoque INALTERADO.
    const produto13b = await criarProduto(
      client,
      "PROVA PAGO APOS CANCELAR NO APP",
      5,
    );
    const pedido13b = await criarPedido(client, {
      nome: "PROVA PAGO APOS CANCELAR NO APP",
      paymentStatus: "aguardando",
      status: "cancelled",
      gatewayPaymentId: "MP_PAGO_CANCELADO",
      produtoId: produto13b,
      quantity: 3,
    });

    const r13b = await confirmar(
      client,
      pedido13b,
      "MP_PAGO_CANCELADO",
      "pago",
    );
    conferir(
      "aguardando + cancelled + pago -> 'pago_apos_expirar'",
      r13b === "pago_apos_expirar",
      `veio ${r13b}`,
    );
    const estado13b = await estadoPedido(client, pedido13b);
    conferir(
      "paid_at carimbado ao pagar pedido ja cancelado no app",
      estado13b.paid_at !== null,
    );
    conferir(
      "status continua 'cancelled' (nao descancela)",
      estado13b.status === "cancelled",
    );
    conferir(
      "estoque INALTERADO ao pagar pedido ja cancelado (nao mexe de novo)",
      (await estoqueDe(client, produto13b)) === 5,
    );

    // --- caso 13c: 'aguardando' + status='processing' + pago -> 'pago' -----
    // A REGRESSAO que a revisao do PR #179 pegou na primeira versao deste
    // conserto (que usava `status <> 'pending'` em vez de `= 'cancelled'`).
    // Cenario: o admin adianta o pedido para 'processing' dentro dos 30 min
    // (20260807000000_reserva_com_expiracao.sql:100-102 documenta este
    // avanco como esperado), e SO DEPOIS o cliente paga o PIX. Aqui o
    // estoque NUNCA voltou — 'processing' nao passa pela
    // update_order_status_atomic com p_new_status='cancelled' — entao o
    // resultado tem que continuar sendo 'pago', igual ao caso 1, e NAO
    // 'pago_apos_expirar'. Com `<> 'pending'` este caso cairia no ramo
    // errado e o pedido ficaria preso na fila de atencao do admin para
    // sempre, porque nada reescreve 'pago_apos_expirar' de volta para
    // 'pago'.
    const produto13c = await criarProduto(
      client,
      "PROVA PAGO APOS ADIANTAR PARA PROCESSING",
      5,
    );
    const pedido13c = await criarPedido(client, {
      nome: "PROVA PAGO APOS ADIANTAR PARA PROCESSING",
      paymentStatus: "aguardando",
      status: "processing",
      gatewayPaymentId: "MP_PAGO_PROCESSING",
      produtoId: produto13c,
      quantity: 3,
    });

    const r13c = await confirmar(
      client,
      pedido13c,
      "MP_PAGO_PROCESSING",
      "pago",
    );
    conferir(
      "aguardando + processing + pago -> 'pago' (NAO 'pago_apos_expirar')",
      r13c === "pago",
      `veio ${r13c}`,
    );
    const estado13c = await estadoPedido(client, pedido13c);
    conferir(
      "paid_at carimbado ao pagar pedido em 'processing'",
      estado13c.paid_at !== null,
    );
    conferir(
      "status continua 'processing' (venda em andamento, nao mexe)",
      estado13c.status === "processing",
    );
    conferir(
      "estoque INALTERADO ao pagar pedido em 'processing' (nunca voltou)",
      (await estoqueDe(client, produto13c)) === 5,
    );

    // --- caso 14: pedido inexistente -> 'inexistente' ----------------------
    const r14 = await confirmar(client, crypto.randomUUID(), "X", "pago");
    conferir(
      "id inexistente -> 'inexistente'",
      r14 === "inexistente",
      `veio ${r14}`,
    );

    console.log("\n=== pagamentos_a_reconciliar (Task 5) ===");

    const AGORA = Date.now();
    const UMA_HORA_MS = 60 * 60 * 1000;

    // --- caso 15: expirado + cobranca + paid_at nulo + expirou ha 1h -------
    const produto15 = await criarProduto(
      client,
      "PROVA RECONCILIACAO APARECE",
      5,
    );
    const pedido15 = await criarPedidoReconciliacao(client, {
      nome: "PROVA RECONCILIACAO APARECE",
      gatewayPaymentId: "MP10",
      paidAt: null,
      expiresAt: new Date(AGORA - UMA_HORA_MS),
      produtoId: produto15,
      quantity: 1,
    });

    // --- caso 16: expirado SEM gateway_payment_id -> nunca teve cobranca ---
    const produto16 = await criarProduto(
      client,
      "PROVA RECONCILIACAO SEM GATEWAY",
      5,
    );
    const pedido16 = await criarPedidoReconciliacao(client, {
      nome: "PROVA RECONCILIACAO SEM GATEWAY",
      gatewayPaymentId: null,
      paidAt: null,
      expiresAt: new Date(AGORA - UMA_HORA_MS),
      produtoId: produto16,
      quantity: 1,
    });

    // --- caso 17: expirado + paid_at preenchido -> ja reconciliado ---------
    const produto17 = await criarProduto(
      client,
      "PROVA RECONCILIACAO JA PAGO",
      5,
    );
    const pedido17 = await criarPedidoReconciliacao(client, {
      nome: "PROVA RECONCILIACAO JA PAGO",
      gatewayPaymentId: "MP11",
      paidAt: new Date(AGORA - UMA_HORA_MS),
      expiresAt: new Date(AGORA - UMA_HORA_MS),
      produtoId: produto17,
      quantity: 1,
    });

    // --- caso 18: expirado ha 30h -> fora da janela de 24h ------------------
    const produto18 = await criarProduto(
      client,
      "PROVA RECONCILIACAO FORA DA JANELA",
      5,
    );
    const pedido18 = await criarPedidoReconciliacao(client, {
      nome: "PROVA RECONCILIACAO FORA DA JANELA",
      gatewayPaymentId: "MP12",
      paidAt: null,
      expiresAt: new Date(AGORA - 30 * UMA_HORA_MS),
      produtoId: produto18,
      quantity: 1,
    });

    // --- caso 19: 'aguardando' no prazo -> nunca expirou --------------------
    const produto19 = await criarProduto(
      client,
      "PROVA RECONCILIACAO AGUARDANDO",
      5,
    );
    const pedido19 = await criarPedidoReconciliacao(client, {
      nome: "PROVA RECONCILIACAO AGUARDANDO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP13",
      paidAt: null,
      expiresAt: new Date(AGORA + 30 * 60 * 1000),
      produtoId: produto19,
      quantity: 1,
    });

    // --- caso 20: dois candidatos elegiveis, expires_at diferentes ---------
    // Prova o `ORDER BY expires_at DESC` (Item 3 do achado da revisao do PR
    // #179 — sem este caso o DESC nao tinha NENHUM teste, porque os casos
    // 15-19 morriam antes de rodar). Dois pedidos elegiveis, o mais recente
    // (expirou ha 10 min) tem que vir ANTES do mais antigo (expirou ha 50
    // min) na lista — com ASC os dois trocariam de posicao.
    const produto20a = await criarProduto(
      client,
      "PROVA RECONCILIACAO DESC MAIS VELHO",
      5,
    );
    const pedido20a = await criarPedidoReconciliacao(client, {
      nome: "PROVA RECONCILIACAO DESC MAIS VELHO",
      gatewayPaymentId: "MP14",
      paidAt: null,
      expiresAt: new Date(AGORA - 50 * 60 * 1000),
      produtoId: produto20a,
      quantity: 1,
    });
    const produto20b = await criarProduto(
      client,
      "PROVA RECONCILIACAO DESC MAIS RECENTE",
      5,
    );
    const pedido20b = await criarPedidoReconciliacao(client, {
      nome: "PROVA RECONCILIACAO DESC MAIS RECENTE",
      gatewayPaymentId: "MP15",
      paidAt: null,
      expiresAt: new Date(AGORA - 10 * 60 * 1000),
      produtoId: produto20b,
      quantity: 1,
    });

    const listaCandidatos = await candidatosReconciliacao(client);
    const idsCandidatos = listaCandidatos.map((linha) => linha.order_id);

    const posicao20a = idsCandidatos.indexOf(pedido20a);
    const posicao20b = idsCandidatos.indexOf(pedido20b);
    // `pagamentos_a_reconciliar()` le linhas REAIS de producao sob
    // `LIMIT 100` — hoje ha poucos candidatos e os dois sinteticos sempre
    // aparecem, mas no dia em que houver mais de 100 um dos dois pode nao
    // entrar no resultado. Sem esta trava, `indexOf` devolve -1 para o que
    // sumiu, e "-1 < indice_do_outro" pode dar TRUE por acidente (ex.:
    // mais_recente sumiu, mais_velho ficou no indice 5: "-1 < 5" e' true) —
    // a comparacao de ORDEM passaria em verde mesmo com um candidato
    // ausente. `presentes` blinda a comparacao de ordem: se qualquer um dos
    // dois sumiu, a asserção de ordem reprova junto, em vez de um "ok"
    // contraditorio ao lado do FALHA de presenca.
    const presentes = posicao20a !== -1 && posicao20b !== -1;
    conferir(
      "os dois candidatos do caso 20 aparecem na lista",
      presentes,
      `posicoes: mais_velho=${posicao20a} mais_recente=${posicao20b}`,
    );
    conferir(
      "ORDER BY expires_at DESC: o mais recente vem ANTES do mais velho",
      presentes && posicao20b < posicao20a,
      `posicoes: mais_velho=${posicao20a} mais_recente=${posicao20b}`,
    );

    conferir(
      "expirado recente com cobranca -> aparece na lista",
      idsCandidatos.includes(pedido15),
    );
    const achado15 = listaCandidatos.find(
      (linha) => linha.order_id === pedido15,
    );
    conferir(
      "gateway_payment_id devolvido bate com o do pedido",
      achado15?.gateway_payment_id === "MP10",
      `veio ${achado15?.gateway_payment_id}`,
    );
    conferir(
      "expirado sem gateway_payment_id -> nao aparece (nunca teve cobranca)",
      !idsCandidatos.includes(pedido16),
    );
    conferir(
      "expirado com paid_at preenchido -> nao aparece (ja reconciliado)",
      !idsCandidatos.includes(pedido17),
    );
    conferir(
      "expirado ha 30h -> nao aparece (fora da janela de 24h)",
      !idsCandidatos.includes(pedido18),
    );
    conferir(
      "'aguardando' no prazo -> nao aparece (nunca expirou)",
      !idsCandidatos.includes(pedido19),
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
