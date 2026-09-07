#!/usr/bin/env node
/**
 * Prova a migration 2026110000000_o_estorno_nasce_no_ledger.sql — Task 1 da
 * frente "estorno de dinheiro pelo app" (plano 20260907, T1) — e, desde a
 * Task 3, a migration 2026110000100_concluir_estorno.sql (P12-P13).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado — nem os
 * produtos/pedidos de teste, nem o CREATE TABLE, nem as RPCs recriadas. Isso
 * so e verdade porque a migration NAO tem BEGIN/COMMIT embutido (checado
 * abaixo, antes de aplicar — mesmo guardiao da prova do cupom).
 *
 * A DECISAO DE PRODUTO QUE ESTE SCRIPT PROVA (regra do dono, 24/08/2026):
 * pedido pago SEM envio cancelado -> o pedido de estorno NASCE NA MESMA
 * transacao do cancelamento (e' isso que torna impossivel "cancelou e
 * ninguem pediu o dinheiro de volta"); pedido pago JA enviado cancelado ->
 * NAO nasce linha nenhuma (a devolucao e' manual do lojista, e so' depois de
 * o produto voltar — o que solicitar_estorno exige).
 *
 * AS AFIRMATIVAS NOMEADAS (P1-P11, exigencia do plano T1 Step 1):
 *   P1  tabela order_refunds existe, com o CHECK de status admitindo os
 *       EXATOS 5 estados da maquina do plano (solicitado, em_processamento,
 *       concluido, falhou, recusado) — e recusando qualquer outro.
 *   P2  marketplace_orders.valor_estornado existe, NOT NULL, DEFAULT 0.
 *   P3  cancelar pedido processing PAGO como cliente cria 1 linha
 *       'solicitado' com amount = total e solicitado_por = 'cliente'.
 *   P4  cancelar o mesmo pedido de novo NAO cria segunda linha — inclusive
 *       no caminho forte: reativar para processing e cancelar OUTRA vez
 *       (a guarda NOT EXISTS e' o que segura; v_old_status sozinho nao).
 *   P5  cancelar pedido shipping PAGO NAO cria linha (estorno manual,
 *       depois do retorno — regra 24/08 do lado do enviado).
 *   P3b (laudo C2 do PR #436; o laudo chama este check de P5b) o ciclo
 *       enviado -> cancela (zero linhas, P5) -> loja REATIVA para
 *       processing -> cancela DE NOVO: continua ZERO linhas. Sem o bloco
 *       do ledger ler cancelled_after_shipping (como o bloco de estoque
 *       ja le'), este segundo cancelamento nasceria linha automatica com
 *       o produto na mao do cliente e returned_to_seller_at NULL.
 *   P6  cancelar pedido pending NAO pago NAO cria linha.
 *   P7  solicitar_estorno como nao-admin lanca 42501.
 *   P8  solicitar_estorno com p_amount maior que o saldo lanca erro com
 *       texto "maior que o valor disponivel".
 *   P8b (laudo I1 do PR #436) o termo "em curso" do saldo tem controle:
 *       com linha viva de R$ 30 num pedido de R$ 100, pedir R$ 80 RECUSA
 *       ("maior que o valor disponivel") e R$ 70 (o saldo exato) ACEITA;
 *       e num pedido que ja tem R$ 100 em curso (pos-P10), pedir R$ 0,01
 *       RECUSA. Sem o "- em curso" da formula do saldo, estas aceitariam
 *       dinheiro a mais — apagar o termo mantinha a suite verde.
 *   P9  solicitar_estorno em pedido cancelado apos envio SEM
 *       returned_to_seller_at lanca "produto ainda nao voltou".
 *   P10 com returned_to_seller_at preenchido, cria a linha 'lojista' e
 *       devolve {"refund_id": uuid, "amount": n}.
 *   P11 GRANT/REVOKE da RPC como as demais da casa: EXECUTE so' para
 *       authenticated; nada para PUBLIC nem anon.
 *
 * AS AFIRMATIVAS DA TASK 3 (concluir_estorno, plano T3 Step 3, adicionadas
 * em 07/09 pela frente estorno-t3-impl):
 *   P12 concluir_estorno soma valor_estornado e muda payment_status para
 *       'estornado' SO' no total: (P12a) linha total de R$ 100 concluida
 *       -> valor_estornado=100 e payment_status='estornado'; (P12b) linha
 *       parcial de R$ 30 -> valor_estornado=30 e payment_status SEGUE
 *       'pago'; (P12c) grants no mesmo formato das demais da casa.
 *   P13 chamada repetida NAO soma duas vezes — o UPDATE so' pega linha com
 *       (status <> 'concluido' OR concluido_em IS NULL): (P13a) chamar de
 *       novo na linha concluida do P12a mantem valor_estornado=100 e
 *       devolve ja_concluida; (P13b) linha nascida 'concluido' com
 *       concluido_em NULL (o caminho do webhook na Task 5 — estorno feito
 *       fora do app) soma UMA vez, e a repetida nao soma.
 *
 * TESTE DE ROLLBACK (plano T1 Step 5): ao final, com as migrations aplicadas
 * DENTRO desta mesma transacao, aplica o rollback-manual da T3 (a funcao
 * concluir_estorno some) e depois o da T1, e confere que a tabela, a coluna
 * e a RPC somem e que update_order_status_atomic volta
 * sem nenhuma referencia a order_refunds. Depois o ROLLBACK final devolve
 * o banco ao estado inicial.
 *
 * USO:
 *   node scripts/db-prove-estorno-ledger.cjs
 *
 * Se a migration ainda NAO existir no disco, o script nao aborta: aplica
 * nada e roda P1-P11 contra o banco — todas FALHAM (e' o vermelho do TDD
 * desta tarefa, colado no relatorio ANTES de escrever a migration).
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");
const MIGRATION = "2026110000000_o_estorno_nasce_no_ledger.sql";
const ROLLBACK = "rollback-manual-2026110000000_o_estorno_nasce_no_ledger.sql";
// Task 3 (estorno-t3-impl): a RPC concluir_estorno nasce em migration PROPIA.
const MIGRATION_T3 = "2026110000100_concluir_estorno.sql";
const ROLLBACK_T3 = "rollback-manual-2026110000100_concluir_estorno.sql";

// Cenario fixo (filho do padrao do db-prove-devolucao-de-uso-de-cupom.cjs):
// 1 unidade de um produto de R$ 100,00 com frete GRATIS "sempre" (sentinela
// free_shipping_min = 0.01 do FRETE V2, 20261081000000) -> total LITERAL de
// R$ 100,00, para a conferencia do amount nao derivar da mesma formula que a
// funcao sob teste usa. A sentenela 0.01 e' o unico caminho que a v24 de
// hoje aceita sem opcao de entrega/cotacao (a taxa fixa morreu na emenda do
// dono de 03/09) — e' cenario de prova, nao recomendacao de loja.
const PRECO = 100;
const FRETE = 0;
const TOTAL = PRECO + FRETE; // 100

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

/** A migration ja foi aplicada AO VIVO? (tabela existe fora da transacao?) */
async function migrationJaAplicadaAoVivo(client) {
  const { rows } = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'order_refunds'
    ) AS aplicada`);
  return rows[0].aplicada === true;
}

// ---------------------------------------------------------------------------
// Cenario: produto, pedidos via v24, papéis (padrao da prova do cupom).
// ---------------------------------------------------------------------------

async function criarProduto(client, estoque = 500) {
  const { rows } = await client.query(
    `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria, ativo, frete_gratis)
     VALUES ('PROVA ESTORNO LEDGER', 10.00, $1, $2, 'teste', true, false)
     RETURNING id`,
    [PRECO, estoque],
  );
  return rows[0].id;
}

const claims = (sub, admin) =>
  sub === null
    ? ""
    : JSON.stringify({
        sub,
        role: "authenticated",
        app_metadata: { role: admin ? "admin" : "authenticated" },
      });

async function descobrirAdmin(client) {
  const { rows } = await client.query(
    `SELECT id, email FROM auth.users
      WHERE COALESCE(raw_app_meta_data ->> 'role', '') = 'admin'
      ORDER BY created_at LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error("Nenhum usuario admin em auth.users para a prova.");
  }
  return rows[0];
}

/** Usuario comum (nao-admin) — e' o "cliente" que cancela o proprio pedido. */
async function descobrirNaoAdmin(client) {
  const { rows } = await client.query(
    `SELECT id, email FROM auth.users
      WHERE COALESCE(raw_app_meta_data ->> 'role', '') <> 'admin'
      ORDER BY created_at LIMIT 1`,
  );
  if (rows.length === 0) {
    throw new Error("Nenhum usuario nao-admin em auth.users para a prova.");
  }
  return rows[0];
}

/** Confere que o sub escolhido resolve is_admin() como esperado, sob o papel certo. */
async function conferirIsAdmin(client, sub, email, esperado) {
  await client.query("SAVEPOINT chk_role");
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(sub, esperado),
  ]);
  const { rows } = await client.query("SELECT public.is_admin() AS eh");
  await client.query("ROLLBACK TO SAVEPOINT chk_role");
  if (rows[0].eh !== esperado) {
    throw new Error(
      `${email} resolve is_admin() = ${rows[0].eh}, esperado ${esperado}. Nao serve para a prova.`,
    );
  }
}

/**
 * Cria o pedido pela via REAL (create_marketplace_order_v24) JA LOGADO como
 * o cliente — o pedido nasce com user_id dele (v24 grava auth.uid()), sem
 * UPDATE manual de cenario. Depois amarra o gateway e confirma o pagamento
 * pela RPC oficial, para payment_status/paid_at nascerem pelo caminho real.
 */
async function criarPedidoBase(client, { produtoId, clienteId }) {
  const itens = JSON.stringify([{ product_id: produtoId, quantity: 1 }]);
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(clienteId, false),
  ]);
  const { rows } = await client.query(
    `SELECT public.create_marketplace_order_v24(
       $1::jsonb, $2::numeric, $3::numeric, 'pix'::text, NULL::uuid, NULL::text,
       'PROVA ESTORNO'::text, '34999999999'::text, NULL::text, NULL::jsonb,
       NULL::text, NULL::text, NULL::uuid
     ) AS id`,
    [itens, TOTAL, FRETE],
  );
  await client.query("SELECT set_config('request.jwt.claims', '', true)");
  await client.query("RESET ROLE");
  const orderId = rows[0].id;
  const { rows: dono } = await client.query(
    "SELECT user_id, total FROM public.marketplace_orders WHERE id = $1",
    [orderId],
  );
  if (dono[0].user_id !== clienteId) {
    throw new Error(
      `pedido nasceu com user_id ${dono[0].user_id}, esperado ${clienteId} — cenario quebrado.`,
    );
  }
  if (Number(dono[0].total) !== TOTAL) {
    throw new Error(
      `pedido nasceu com total ${dono[0].total}, esperado ${TOTAL} — cenario quebrado.`,
    );
  }
  return orderId;
}

async function criarPedidoPago(
  client,
  { produtoId, clienteId, gatewayId, status },
) {
  const orderId = await criarPedidoBase(client, {
    produtoId,
    clienteId,
    gatewayId,
  });
  await client.query(
    "UPDATE public.marketplace_orders SET gateway_payment_id = $2 WHERE id = $1",
    [orderId, gatewayId],
  );
  const { rows: pagos } = await client.query(
    "SELECT public.confirmar_pagamento($1::uuid, $2::text, 'pago'::text) AS r",
    [orderId, gatewayId],
  );
  if (pagos[0].r !== "pago" && pagos[0].r !== "ja_pago") {
    throw new Error(
      `confirmar_pagamento devolveu '${pagos[0].r}' — cenario quebrado.`,
    );
  }
  if (status) {
    await client.query(
      "UPDATE public.marketplace_orders SET status = $2 WHERE id = $1",
      [orderId, status],
    );
  }
  return orderId;
}

/** Pedido NAO pago (payment_status 'aguardando'), dono = cliente. */
async function criarPedidoNaoPago(client, { produtoId, clienteId, status }) {
  const orderId = await criarPedidoBase(client, {
    produtoId,
    clienteId,
  });
  if (status) {
    await client.query(
      "UPDATE public.marketplace_orders SET status = $2 WHERE id = $1",
      [orderId, status],
    );
  }
  return orderId;
}

/** Cancela como um usuario (cliente dono ou admin) via update_order_status_atomic. */
async function cancelarComo(client, sub, admin, orderId) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(sub, admin),
  ]);
  await client.query(
    "SELECT public.update_order_status_atomic($1::uuid, 'cancelled'::text, NULL, TRUE)",
    [orderId],
  );
  await client.query("SELECT set_config('request.jwt.claims', '', true)");
  await client.query("RESET ROLE");
}

/** Muda status pela RPC como admin (reativacao do ciclo forte do P4). */
async function mudarStatusComoAdmin(client, adminSub, orderId, novoStatus) {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
    claims(adminSub, true),
  ]);
  await client.query(
    "SELECT public.update_order_status_atomic($1::uuid, $2::text, NULL, TRUE)",
    [orderId, novoStatus],
  );
  await client.query("SELECT set_config('request.jwt.claims', '', true)");
  await client.query("RESET ROLE");
}

/**
 * Chama uma funcao sob um papel/claims e captura o erro SEM abortar a
 * transacao da prova (savepoint + ROLLBACK TO). Devolve {erro} ou {ok, rows}.
 */
async function tentarComo(client, sub, admin, sql, params) {
  await client.query("SAVEPOINT tentativa");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      claims(sub, admin),
    ]);
    const r = await client.query(sql, params);
    await client.query("SELECT set_config('request.jwt.claims', '', true)");
    await client.query("RESET ROLE");
    await client.query("RELEASE SAVEPOINT tentativa");
    return { ok: true, rows: r.rows };
  } catch (e) {
    // Desfaz ate o savepoint: limpa o erro E o SET LOCAL ROLE/config (efeitos
    // posteriores ao savepoint sao revertidos pelo proprio ROLLBACK TO).
    await client.query("ROLLBACK TO SAVEPOINT tentativa");
    await client.query("RESET ROLE");
    return { ok: false, erro: e };
  }
}

async function linhasDeEstorno(client, orderId) {
  const { rows } = await client.query(
    "SELECT order_id, amount, motivo, solicitado_por, status FROM public.order_refunds WHERE order_id = $1",
    [orderId],
  );
  return rows;
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    if (await migrationJaAplicadaAoVivo(client)) {
      throw new Error(
        "public.order_refunds JA existe no banco AO VIVO — esta prova assume que a migration " +
          "nunca foi aplicada em producao. Abortando para nao mascarar estado inesperado.",
      );
    }

    const caminhoMigration = path.join(
      RAIZ,
      "supabase",
      "migrations",
      MIGRATION,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const migrationExiste = fs.existsSync(caminhoMigration);
    if (migrationExiste) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sql = fs.readFileSync(caminhoMigration, "utf8");
      if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
        throw new Error(
          `${MIGRATION} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op e a mudanca ficaria gravada. Abortando.`,
        );
      }
      await client.query(sql);
      console.log(
        `banco: ${MIGRATION} aplicada DENTRO da transacao (ROLLBACK no final)\n`,
      );
    } else {
      console.log(
        `banco: ${MIGRATION} AINDA NAO EXISTE no disco — nada foi aplicado; P1-P11 correm contra o estado atual (vermelho do TDD)\n`,
      );
    }

    // Task 3: concluir_estorno em migration PROPIA, aplicada junto (a prova
    // dela precisa do ledger da T1 vivo DENTRO da transacao). Se a T1 nao
    // foi aplicada aqui, a T3 tampouco roda — P12/P13 falham no vermelho.
    const caminhoMigrationT3 = path.join(
      RAIZ,
      "supabase",
      "migrations",
      MIGRATION_T3,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const migrationT3Existe = fs.existsSync(caminhoMigrationT3);
    if (migrationT3Existe && migrationExiste) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sqlT3 = fs.readFileSync(caminhoMigrationT3, "utf8");
      if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sqlT3)) {
        throw new Error(
          `${MIGRATION_T3} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op. Abortando.`,
        );
      }
      await client.query(sqlT3);
      console.log(
        `banco: ${MIGRATION_T3} aplicada DENTRO da transacao (ROLLBACK no final)\n`,
      );
    } else if (migrationT3Existe && !migrationExiste) {
      console.log(
        `banco: ${MIGRATION_T3} existe mas ${MIGRATION} nao — T3 nao aplicada (o ledger e' pre-requisito); P12/P13 falham no vermelho\n`,
      );
    } else {
      console.log(
        `banco: ${MIGRATION_T3} AINDA NAO EXISTE no disco — P12/P13 correm contra o estado atual (vermelho do TDD da Task 3)\n`,
      );
    }

    // --- cenario -------------------------------------------------------------
    await client.query(
      `UPDATE public.store_config
          SET free_shipping_min = 0.01
        WHERE id = 1`,
    );
    const produtoId = await criarProduto(client);
    const admin = await descobrirAdmin(client);
    await conferirIsAdmin(client, admin.id, admin.email, true);
    const cliente = await descobrirNaoAdmin(client);
    await conferirIsAdmin(client, cliente.id, cliente.email, false);
    console.log(
      `papeis conferidos — admin: ${admin.email} (is_admin=true); cliente: ${cliente.email} (is_admin=false)\n`,
    );

    // =========================================================================
    // P1 — tabela + CHECK de status com os EXATOS 5 estados
    // =========================================================================
    console.log("=== P1: tabela order_refunds e o CHECK dos 5 estados ===");
    const { rows: tabelas } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'order_refunds'
       ) AS existe`,
    );
    const tabelaExiste = tabelas[0].existe === true;
    conferir("P1: tabela public.order_refunds existe", tabelaExiste);

    if (tabelaExiste) {
      const { rows: checks } = await client.query(
        `SELECT pg_get_constraintdef(oid) AS d
           FROM pg_constraint
          WHERE conrelid = 'public.order_refunds'::regclass AND contype = 'c'`,
      );
      const checkStatus = checks.find(
        (c) => c.d.includes("status") && c.d.includes("solicitado"),
      );
      const cinco = [
        "solicitado",
        "em_processamento",
        "concluido",
        "falhou",
        "recusado",
      ];
      conferir(
        "P1: CHECK de status admite os EXATOS 5 estados da maquina do plano",
        cinco.every((s) => checkStatus?.d.includes(`'${s}'`)) &&
          !checkStatus?.d.includes("'xpto_nunca'"),
        checkStatus
          ? `def: ${checkStatus.d}`
          : "check de status nao encontrado",
      );

      // INSERT com status invalido TEM de violar (a prova negativa do CHECK).
      // Roda como POSTGRES (dono, sem passagem por grant de tabela): o que se
      // mede aqui e' o CHECK, nao a ceremony de grants — authenticated nem
      // tem INSERT por desenho (conferido no bloco extra:rls).
      let ruim = null;
      await client.query("SAVEPOINT tentativa");
      try {
        await client.query(
          `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
           VALUES (
             (SELECT id FROM public.marketplace_orders LIMIT 1), 1.00, 'sistema', 'xpto_nunca'
           )`,
        );
      } catch (e) {
        ruim = e;
      }
      await client.query("ROLLBACK TO SAVEPOINT tentativa");
      conferir(
        "P1: INSERT com status fora dos 5 e REJEITADO (check negativo)",
        ruim !== null &&
          /order_refunds_status_check|check constraint/i.test(
            String(ruim?.message),
          ),
        ruim ? `erro: ${ruim.message}` : "aceitou status invalido!",
      );
    } else {
      conferir(
        "P1: CHECK de status admite os EXATOS 5 estados",
        false,
        "tabela inexistente",
      );
      conferir(
        "P1: INSERT com status fora dos 5 e REJEITADO",
        false,
        "tabela inexistente",
      );
    }

    // =========================================================================
    // P2 — coluna valor_estornado
    // =========================================================================
    console.log("\n=== P2: marketplace_orders.valor_estornado ===");
    const { rows: coluna } = await client.query(
      `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'marketplace_orders'
          AND column_name = 'valor_estornado'`,
    );
    conferir("P2: coluna valor_estornado existe", coluna.length === 1);
    conferir(
      "P2: NOT NULL com DEFAULT 0 (pedido novo nasce com nada devolvido)",
      coluna.length === 1 &&
        coluna[0].is_nullable === "NO" &&
        /0/.test(coluna[0].column_default || ""),
      coluna.length === 1
        ? `null=${coluna[0].is_nullable} def=${coluna[0].column_default}`
        : "coluna inexistente",
    );

    // =========================================================================
    // P3 — cancelar processing pago como CLIENTE cria a linha
    // =========================================================================
    console.log(
      "\n=== P3: cancelamento pago SEM envio (cliente) nasce no ledger ===",
    );
    const p3 = await criarPedidoPago(client, {
      produtoId,
      clienteId: cliente.id,
      gatewayId: "PAY_PROVA_P3",
      status: "processing",
    });
    await cancelarComo(client, cliente.id, false, p3);
    const linhasP3 = tabelaExiste ? await linhasDeEstorno(client, p3) : [];
    conferir(
      "P3: exatamente 1 linha criada",
      linhasP3.length === 1,
      `linhas=${linhasP3.length}`,
    );
    conferir(
      `P3: status 'solicitado', amount = total (${TOTAL.toFixed(2)}), solicitado_por = 'cliente', motivo do cancelamento antes do envio`,
      linhasP3.length === 1 &&
        linhasP3[0].status === "solicitado" &&
        Number(linhasP3[0].amount) === TOTAL &&
        linhasP3[0].solicitado_por === "cliente" &&
        /envio/.test(String(linhasP3[0].motivo || "")),
      linhasP3.length === 1
        ? `status=${linhasP3[0].status} amount=${linhasP3[0].amount} por=${linhasP3[0].solicitado_por} motivo=${linhasP3[0].motivo}`
        : "sem linha",
    );

    // =========================================================================
    // P4 — cancelar DE NAO cria segunda linha (ciclo forte: reativar e cancelar)
    // =========================================================================
    console.log(
      "\n=== P4: segunda linha nao existe (nem reativando e cancelando) ===",
    );
    // (a) cancelar DE NOVO, direto — como admin (cliente e' barrado pela guarda
    // de status, que e' justamente o comportamento certo; o segundo cancela-
    // mento valido so' existe pela mao da loja).
    await cancelarComo(client, admin.id, true, p3);
    // (b) o caminho FORTE: reativa para processing e cancela OUTRA vez — pago,
    // v_old_status de volta ao ramo que criaria linha; a guarda NOT EXISTS e'
    // a unica coisa entre isto e uma segunda linha.
    await mudarStatusComoAdmin(client, admin.id, p3, "processing");
    await cancelarComo(client, cliente.id, false, p3);
    const linhasP4 = tabelaExiste ? await linhasDeEstorno(client, p3) : [];
    conferir(
      "P4: depois de cancelar/reativar/cancelar, continua EXATAMENTE 1 linha (guarda NOT EXISTS)",
      linhasP4.length === 1,
      `linhas=${linhasP4.length}`,
    );

    // =========================================================================
    // P5 — pedido shipping pago cancelado NAO cria linha
    // =========================================================================
    console.log(
      "\n=== P5: cancelamento pago JA ENVIADO nao nasce linha (regra 24/08) ===",
    );
    const p5 = await criarPedidoPago(client, {
      produtoId,
      clienteId: cliente.id,
      gatewayId: "PAY_PROVA_P5",
      status: "shipping",
    });
    await cancelarComo(client, cliente.id, false, p5);
    const linhasP5 = tabelaExiste ? await linhasDeEstorno(client, p5) : [];
    conferir(
      "P5: zero linhas para cancelamento de pedido enviado",
      linhasP5.length === 0,
      `linhas=${linhasP5.length}`,
    );
    const { rows: estadoP5 } = await client.query(
      "SELECT status, cancelled_after_shipping, returned_to_seller_at FROM public.marketplace_orders WHERE id = $1",
      [p5],
    );
    conferir(
      "P5 (cenario): pedido ficou cancelled/cancelled_after_shipping=true/retorno NULL — o cenario da regra do enviado",
      estadoP5[0].status === "cancelled" &&
        estadoP5[0].cancelled_after_shipping === true &&
        estadoP5[0].returned_to_seller_at === null,
    );

    // =========================================================================
    // P3b — o ciclo do C2 (laudo do PR #436; o laudo chama de P5b): enviado
    // > cancela (zero linhas, acima) > loja REATIVA para processing >
    // cancela DE NOVO -> TEM de continuar ZERO. v_old_status volta a ser
    // 'processing' e a coluna cancelled_after_shipping CONTINUA true (ela
    // nunca volta a false): sem a guarda NOT v_cancelled_after_shipping no
    // bloco do ledger — a mesma que o bloco de estoque ja usa —, este
    // segundo cancelamento nasceria linha automatica de R$ 100 com o
    // produto na mao do cliente e returned_to_seller_at NULL.
    // =========================================================================
    console.log(
      "\n=== P3b: reativado e cancelado de novo, enviado continua sem linha ===",
    );
    await mudarStatusComoAdmin(client, admin.id, p5, "processing");
    const { rows: reativadoP3b } = await client.query(
      "SELECT status, cancelled_after_shipping FROM public.marketplace_orders WHERE id = $1",
      [p5],
    );
    conferir(
      "P3b (cenario): reativado para processing, cancelled_after_shipping CONTINUA true",
      reativadoP3b[0].status === "processing" &&
        reativadoP3b[0].cancelled_after_shipping === true,
    );
    await cancelarComo(client, cliente.id, false, p5);
    const linhasP3b = tabelaExiste ? await linhasDeEstorno(client, p5) : [];
    conferir(
      "P3b: enviado->cancela->reativa->cancela NAO cria linha (guarda cancelled_after_shipping do ledger)",
      linhasP3b.length === 0,
      `linhas=${linhasP3b.length}`,
    );

    // =========================================================================
    // P6 — pedido pending NAO pago cancelado NAO cria linha
    // =========================================================================
    console.log("\n=== P6: cancelamento NAO pago nao nasce linha ===");
    const p6 = await criarPedidoNaoPago(client, {
      produtoId,
      clienteId: cliente.id,
      status: "pending",
    });
    await cancelarComo(client, cliente.id, false, p6);
    const linhasP6 = tabelaExiste ? await linhasDeEstorno(client, p6) : [];
    conferir(
      "P6: zero linhas para cancelamento de pedido sem pagamento",
      linhasP6.length === 0,
      `linhas=${linhasP6.length}`,
    );

    // =========================================================================
    // P7 — solicitar_estorno como nao-admin: 42501
    // =========================================================================
    console.log("\n=== P7: somente a loja pede o estorno pelo botao ===");
    const p7 = await tentarComo(
      client,
      cliente.id,
      false,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p5, TOTAL],
    );
    conferir(
      "P7: nao-admin recebe 42501",
      p7.ok === false && p7.erro?.code === "42501",
      p7.ok
        ? "nao lançou erro"
        : `code=${p7.erro?.code} msg=${p7.erro?.message}`,
    );

    // =========================================================================
    // P9 — cancelado apos envio SEM retorno: "produto ainda nao voltou"
    // (antes do P8 de proposito: a guarda da regra 24/08 vem antes da de
    // saldo, e o P8 so' mede saldo de verdade em pedido COM retorno.)
    // =========================================================================
    console.log(
      "\n=== P9: enviado sem retorno — o lojista nao devolve antes do produto voltar ===",
    );
    const p9 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p5, TOTAL],
    );
    conferir(
      'P9: erro com texto "produto ainda nao voltou"',
      p9.ok === false && /ainda não voltou/i.test(String(p9.erro?.message)),
      p9.ok ? "nao lançou erro" : `msg=${p9.erro?.message}`,
    );

    // O retorno do produto pela porta REAL (confirmar_retorno_do_produto).
    const retorno = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
      [p5],
    );
    conferir(
      "P9 (cenario): confirmar_retorno_do_produto gravou returned_to_seller_at",
      retorno.ok === true,
      retorno.ok ? "" : `msg=${retorno.erro?.message}`,
    );

    // =========================================================================
    // P8 — amount maior que o saldo disponivel
    // =========================================================================
    console.log("\n=== P8: valor maior que o disponivel e recusado ===");
    const p8 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p5, TOTAL + 889],
    );
    conferir(
      'P8: erro com texto "maior que o valor disponivel"',
      p8.ok === false &&
        /maior que o valor dispon/i.test(String(p8.erro?.message)),
      p8.ok ? "nao lançou erro" : `msg=${p8.erro?.message}`,
    );

    // =========================================================================
    // P10 — com retorno confirmado, cria a linha do lojista
    // =========================================================================
    console.log(
      "\n=== P10: enviado, produto voltou — o lojista pede a devolucao ===",
    );
    const p10 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, 'devolucao combinada'::text) AS r",
      [p5, TOTAL],
    );
    conferir(
      "P10: chamada aceita (sem erro)",
      p10.ok === true,
      p10.ok ? "" : `msg=${p10.erro?.message}`,
    );
    if (p10.ok) {
      const r = p10.rows[0].r;
      const linhasP10 = await linhasDeEstorno(client, p5);
      conferir(
        "P10: retorno {refund_id, amount} com o amount pedido",
        r && typeof r.refund_id === "string" && Number(r.amount) === TOTAL,
        `r=${JSON.stringify(r)}`,
      );
      conferir(
        "P10: linha gravada solicitado_por='lojista', status='solicitado'",
        linhasP10.length === 1 &&
          linhasP10[0].solicitado_por === "lojista" &&
          linhasP10[0].status === "solicitado" &&
          Number(linhasP10[0].amount) === TOTAL,
        `linhas=${JSON.stringify(linhasP10)}`,
      );
      // A T1 NAO soma valor_estornado: quem soma e' concluir_estorno (T3).
      const { rows: ve } = await client.query(
        "SELECT valor_estornado FROM public.marketplace_orders WHERE id = $1",
        [p5],
      );
      conferir(
        "P10 (honestidade do ledger): valor_estornado continua 0 — somar e' da T3, nao daqui",
        Number(ve[0].valor_estornado) === 0,
        `valor_estornado=${ve[0].valor_estornado}`,
      );
    }

    // =========================================================================
    // P8b — o termo "em curso" do saldo tem controle (laudo I1 do PR #436).
    // O P8 acima mediu recusa num pedido com ZERO linhas vivas: apagar o
    // "- v_em_curso" da formula do saldo mantinha a suite inteira verde.
    // Aqui a linha viva EXISTE e reserva saldo — nos dois sentidos: pedir
    // acima do saldo restante recusa, pedir o exato aceita.
    // =========================================================================
    console.log(
      "\n=== P8b: linha em andamento reserva saldo (o termo em curso) ===",
    );
    const p8b = await criarPedidoPago(client, {
      produtoId,
      clienteId: cliente.id,
      gatewayId: "PAY_PROVA_P8B",
      status: "shipping",
    });
    await cancelarComo(client, cliente.id, false, p8b);
    const retorno8b = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
      [p8b],
    );
    conferir(
      "P8b (cenario): produto do pedido novo voltou (retorno confirmado)",
      retorno8b.ok === true,
      retorno8b.ok ? "" : `msg=${retorno8b.erro?.message}`,
    );
    const p8b30 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p8b, 30],
    );
    conferir(
      "P8b: devolucao parcial de R$ 30 ACEITA — nasce a linha viva que reserva saldo",
      p8b30.ok === true,
      p8b30.ok ? "" : `msg=${p8b30.erro?.message}`,
    );
    const p8b80 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p8b, 80],
    );
    conferir(
      'P8b: pedir R$ 80 RECUSA com "maior que o valor disponivel" (saldo = 100 - 30 em curso)',
      p8b80.ok === false &&
        /maior que o valor dispon/i.test(String(p8b80.erro?.message)),
      p8b80.ok ? "nao lançou erro" : `msg=${p8b80.erro?.message}`,
    );
    const p8b70 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p8b, 70],
    );
    conferir(
      "P8b: pedir R$ 70 (o saldo exato) ACEITA — o termo em curso nao subestima o saldo",
      p8b70.ok === true,
      p8b70.ok ? "" : `msg=${p8b70.erro?.message}`,
    );
    // A letra do laudo I1: pos-P10, o p5 ja tem R$ 100 pedidos e ZERO de
    // saldo — ate' R$ 0,01 tem de recusar pelo mesmo texto.
    const p8b001 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p5, 0.01],
    );
    conferir(
      "P8b: pedido com R$ 100 em curso (pos-P10), pedir R$ 0,01 RECUSA (saldo zero)",
      p8b001.ok === false &&
        /maior que o valor dispon/i.test(String(p8b001.erro?.message)),
      p8b001.ok ? "nao lançou erro" : `msg=${p8b001.erro?.message}`,
    );

    // =========================================================================
    // P11 — GRANT/REVOKE como as demais
    // =========================================================================
    console.log(
      "\n=== P11: EXECUTE so' para authenticated (padrao da casa) ===",
    );
    const { rows: grants } = await client.query(
      `SELECT routine_name, grantee, privilege_type
         FROM information_schema.routine_privileges
        WHERE routine_schema = 'public'
          AND routine_name IN ('solicitar_estorno', 'update_order_status_atomic')
        ORDER BY routine_name, grantee`,
    );
    const daNova = grants.filter((g) => g.routine_name === "solicitar_estorno");
    const daVelha = grants.filter(
      (g) => g.routine_name === "update_order_status_atomic",
    );
    conferir(
      "P11: solicitar_estorno tem EXECUTE para authenticated e para NINGUEM de fora",
      daNova.some((g) => g.grantee === "authenticated") &&
        daNova.every((g) =>
          ["authenticated", "postgres", "service_role"].includes(g.grantee),
        ),
      `grants=${JSON.stringify(daNova)}`,
    );
    conferir(
      "P11: o mesmo formato de grants de update_order_status_atomic (a regua da casa)",
      daNova
        .map((g) => `${g.grantee}:${g.privilege_type}`)
        .sort()
        .join(",") ===
        daVelha
          .map((g) => `${g.grantee}:${g.privilege_type}`)
          .sort()
          .join(","),
      `nova=[${daNova.map((g) => g.grantee)}] velha=[${daVelha.map((g) => g.grantee)}]`,
    );

    // =========================================================================
    // RLS da tabela (conferencia extra — as interfaces da T1 pedem)
    // =========================================================================
    console.log("\n=== extra: RLS e policies da tabela nova ===");
    if (tabelaExiste) {
      const { rows: rls } = await client.query(
        `SELECT relrowsecurity AS rls FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'order_refunds'`,
      );
      conferir("rls: Row Level Security ATIVA na tabela", rls[0]?.rls === true);
      const { rows: pols } = await client.query(
        `SELECT policyname, cmd, roles, qual FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'order_refunds' ORDER BY policyname`,
      );
      conferir(
        "rls: policy do cliente e' SELECT das proprias linhas via marketplace_orders.user_id",
        pols.some(
          (p) =>
            p.cmd === "SELECT" &&
            /user_id = auth.uid\(\)|auth.uid\(\) = user_id/.test(
              String(p.qual || ""),
            ),
        ),
        `policies=${JSON.stringify(pols)}`,
      );
      conferir(
        "rls: policy admin (ALL por is_admin) presente",
        pols.some(
          (p) => p.cmd === "ALL" && /is_admin/.test(String(p.qual || "")),
        ),
      );
      const { rows: tg } = await client.query(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_schema='public' AND table_name='order_refunds' AND grantee='authenticated'`,
      );
      conferir(
        "rls: authenticated so' tem SELECT na tabela (escrita e' das SECURITY DEFINER/service_role)",
        tg.length === 1 && tg[0].privilege_type === "SELECT",
        `privs=${tg.map((x) => x.privilege_type).join(",")}`,
      );
      const { rows: anon } = await client.query(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_schema='public' AND table_name='order_refunds' AND grantee IN ('anon','PUBLIC')`,
      );
      conferir("rls: anon/PUBLIC sem privilegio nenhum", anon.length === 0);
    } else {
      conferir(
        "rls: Row Level Security ATIVA na tabela",
        false,
        "tabela inexistente",
      );
    }

    // =========================================================================
    // P12/P13 — concluir_estorno (Task 3, migration 2026110000100): a soma
    // atômica de valor_estornado + a virada condicional de payment_status +
    // a idempotência da chamada repetida.
    // =========================================================================
    console.log(
      "\n=== P12: concluir_estorno soma e vira payment_status so' no total ===",
    );
    // P12a — linha TOTAL nasce pelo caminho REAL: cliente cancela pedido
    // processing pago de R$ 100 (a linha nasce na MESMA transacao, T1 P3).
    const p12a = await criarPedidoPago(client, {
      produtoId,
      clienteId: cliente.id,
      gatewayId: "PAY_PROVA_P12A",
      status: "processing",
    });
    await cancelarComo(client, cliente.id, false, p12a);
    const { rows: linhaP12a } = await client.query(
      "SELECT id, amount, status FROM public.order_refunds WHERE order_id = $1",
      [p12a],
    );
    const refundP12a = linhaP12a[0]?.id;
    const rP12a = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.concluir_estorno($1::uuid, '111222333'::text, 'approved'::text, NULL::text) AS r",
      [refundP12a],
    );
    conferir(
      "P12a: chamada aceita (sem erro)",
      rP12a.ok === true,
      rP12a.ok ? "" : `msg=${rP12a.erro?.message}`,
    );
    if (rP12a.ok) {
      const r = rP12a.rows[0].r;
      conferir(
        "P12a: retorno {concluido:true, ja_concluida:false}",
        r.concluido === true && r.ja_concluida === false,
        `r=${JSON.stringify(r)}`,
      );
      const { rows: posP12a } = await client.query(
        `SELECT (SELECT status FROM public.order_refunds WHERE id = $1) AS status,
                (SELECT mp_refund_id FROM public.order_refunds WHERE id = $1) AS mp_refund_id,
                (SELECT concluido_em IS NOT NULL FROM public.order_refunds WHERE id = $1) AS tem_carimbo,
                (SELECT valor_estornado FROM public.marketplace_orders WHERE id = $2) AS valor_estornado,
                (SELECT payment_status FROM public.marketplace_orders WHERE id = $2) AS payment_status`,
        [refundP12a, p12a],
      );
      conferir(
        "P12a: linha concluida com mp_refund_id e concluido_em carimbados",
        posP12a[0].status === "concluido" &&
          posP12a[0].mp_refund_id === "111222333" &&
          posP12a[0].tem_carimbo === true,
        `pos=${JSON.stringify(posP12a[0])}`,
      );
      conferir(
        "P12a: valor_estornado somou 100 e payment_status virou 'estornado' (total)",
        Number(posP12a[0].valor_estornado) === TOTAL &&
          posP12a[0].payment_status === "estornado",
        `valor=${posP12a[0].valor_estornado} ps=${posP12a[0].payment_status}`,
      );
    }

    // P12b — PARCIAL: pedido enviado cancelado com produto de volta, linha de
    // R$ 30 pelo botao (solicitar_estorno) -> concluida -> soma 30 e
    // payment_status SEGUE 'pago' (30 < 100 — o CASE so' vira no total).
    const p12b = await criarPedidoPago(client, {
      produtoId,
      clienteId: cliente.id,
      gatewayId: "PAY_PROVA_P12B",
      status: "shipping",
    });
    await cancelarComo(client, cliente.id, false, p12b);
    await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.confirmar_retorno_do_produto($1::uuid) AS r",
      [p12b],
    );
    const rP12bSol = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.solicitar_estorno($1::uuid, $2::numeric, NULL::text) AS r",
      [p12b, 30],
    );
    const refundP12b = rP12bSol.ok ? rP12bSol.rows[0].r.refund_id : null;
    const rP12b = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.concluir_estorno($1::uuid, '444555666'::text, 'approved'::text, 'partially_refunded'::text) AS r",
      [refundP12b],
    );
    conferir(
      "P12b: chamada aceita (sem erro)",
      rP12b.ok === true,
      rP12b.ok ? "" : `msg=${rP12b.erro?.message}`,
    );
    if (rP12b.ok) {
      const { rows: posP12b } = await client.query(
        `SELECT (SELECT status FROM public.order_refunds WHERE id = $1) AS status,
                (SELECT valor_estornado FROM public.marketplace_orders WHERE id = $2) AS valor_estornado,
                (SELECT payment_status FROM public.marketplace_orders WHERE id = $2) AS payment_status`,
        [refundP12b, p12b],
      );
      conferir(
        "P12b: linha concluida",
        posP12b[0].status === "concluido",
        `pos=${JSON.stringify(posP12b[0])}`,
      );
      conferir(
        "P12b: valor_estornado somou 30 e payment_status SEGUE 'pago' (parcial nao vira)",
        Number(posP12b[0].valor_estornado) === 30 &&
          posP12b[0].payment_status === "pago",
        `valor=${posP12b[0].valor_estornado} ps=${posP12b[0].payment_status}`,
      );
    }

    // P12c — grants no mesmo formato das demais da casa (regua: a propria
    // solicitar_estorno, conferida no P11).
    console.log(
      "\n=== P12c: EXECUTE so' para authenticated (regua da casa) ===",
    );
    const { rows: grantsT3 } = await client.query(
      `SELECT routine_name, grantee, privilege_type
         FROM information_schema.routine_privileges
        WHERE routine_schema = 'public'
          AND routine_name IN ('concluir_estorno', 'solicitar_estorno')
        ORDER BY routine_name, grantee`,
    );
    const daConcluir = grantsT3.filter(
      (g) => g.routine_name === "concluir_estorno",
    );
    const daSolicitar = grantsT3.filter(
      (g) => g.routine_name === "solicitar_estorno",
    );
    conferir(
      "P12c: concluir_estorno tem EXECUTE para authenticated e para NINGUEM de fora",
      daConcluir.some((g) => g.grantee === "authenticated") &&
        daConcluir.every((g) =>
          ["authenticated", "postgres", "service_role"].includes(g.grantee),
        ),
      `grants=${JSON.stringify(daConcluir)}`,
    );
    conferir(
      "P12c: o mesmo formato de grants de solicitar_estorno (a regua da casa)",
      daConcluir
        .map((g) => `${g.grantee}:${g.privilege_type}`)
        .sort()
        .join(",") ===
        daSolicitar
          .map((g) => `${g.grantee}:${g.privilege_type}`)
          .sort()
          .join(","),
      `concluir=[${daConcluir.map((g) => g.grantee)}] solicitar=[${daSolicitar.map((g) => g.grantee)}]`,
    );

    // =========================================================================
    // P13 — idempotencia: chamada repetida NAO soma duas vezes.
    // =========================================================================
    console.log("\n=== P13: chamada repetida nao soma duas vezes ===");
    // P13a — a MESMA linha do P12a, chamada de novo (o webhook e o cron podem
    // completar o que a edge ja completou): o UPDATE nao pega (status =
    // 'concluido' E concluido_em preenchido), nada soma, nada sobrescreve.
    const rP13a = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.concluir_estorno($1::uuid, '999000999'::text, 'refunded'::text, NULL::text) AS r",
      [refundP12a],
    );
    conferir(
      "P13a: chamada repetida aceita (idempotente, sem erro)",
      rP13a.ok === true,
      rP13a.ok ? "" : `msg=${rP13a.erro?.message}`,
    );
    if (rP13a.ok) {
      const r = rP13a.rows[0].r;
      conferir(
        "P13a: retorno diz ja_concluida=true",
        r.ja_concluida === true,
        `r=${JSON.stringify(r)}`,
      );
      const { rows: posP13a } = await client.query(
        `SELECT (SELECT valor_estornado FROM public.marketplace_orders WHERE id = $2) AS valor_estornado,
                (SELECT mp_refund_id FROM public.order_refunds WHERE id = $1) AS mp_refund_id`,
        [refundP12a, p12a],
      );
      conferir(
        "P13a: valor_estornado continua 100 (NAO somou de novo) e o mp_refund_id nao foi sobrescrito",
        Number(posP13a[0].valor_estornado) === TOTAL &&
          posP13a[0].mp_refund_id === "111222333",
        `valor=${posP13a[0].valor_estornado} mp=${posP13a[0].mp_refund_id}`,
      );
    }

    // P13b — linha NASCIDA 'concluido' com concluido_em NULL: e' o caminho do
    // webhook na Task 5 (estorno feito FORA do app: a linha e' inserida ja'
    // concluida e a RPC e' chamada na sequencia para somar). A guarda
    // (status <> 'concluido' OR concluido_em IS NULL) deixa esta SOMAR uma
    // vez — e a repetida, nao. Sem a segunda clausula, o plano da T5 nasceria
    // quebrado por construcao (linha concluida que nunca soma).
    const p13b = await criarPedidoPago(client, {
      produtoId,
      clienteId: cliente.id,
      gatewayId: "PAY_PROVA_P13B",
      status: "processing",
    });
    await cancelarComo(client, cliente.id, false, p13b);
    const { rows: insP13b } = await client.query(
      `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status, mp_status)
       VALUES ($1, 40, 'estorno feito fora do app (prova P13b)', 'sistema', 'concluido', 'refunded')
       RETURNING id`,
      [p13b],
    );
    const refundP13b = insP13b[0].id;
    const rP13b = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.concluir_estorno($1::uuid, '777888'::text, 'refunded'::text, NULL::text) AS r",
      [refundP13b],
    );
    conferir(
      "P13b: linha nascida concluida (webhook, T5) SOMA na primeira chamada",
      rP13b.ok === true && rP13b.ok && rP13b.rows[0].r.ja_concluida === false,
      rP13b.ok
        ? `r=${JSON.stringify(rP13b.rows[0].r)}`
        : `msg=${rP13b.erro?.message}`,
    );
    const rP13b2 = await tentarComo(
      client,
      admin.id,
      true,
      "SELECT public.concluir_estorno($1::uuid, '777888'::text, 'refunded'::text, NULL::text) AS r",
      [refundP13b],
    );
    const { rows: posP13b } = await client.query(
      `SELECT (SELECT valor_estornado FROM public.marketplace_orders WHERE id = $2) AS valor_estornado,
              (SELECT payment_status FROM public.marketplace_orders WHERE id = $2) AS payment_status,
              (SELECT concluido_em IS NOT NULL FROM public.order_refunds WHERE id = $1) AS tem_carimbo`,
      [refundP13b, p13b],
    );
    conferir(
      "P13b: somou UMA vez (40) e a repetida nao somou (segue 40, nao 80)",
      Number(posP13b[0].valor_estornado) === 40,
      `valor=${posP13b[0].valor_estornado}`,
    );
    conferir(
      "P13b: payment_status segue 'pago' (40 < 100) e concluido_em foi carimbado",
      posP13b[0].payment_status === "pago" && posP13b[0].tem_carimbo === true,
      `ps=${posP13b[0].payment_status} carimbo=${posP13b[0].tem_carimbo}`,
    );
    conferir(
      "P13b: a repetida devolve ja_concluida=true",
      rP13b2.ok === true && rP13b2.rows[0].r.ja_concluida === true,
      rP13b2.ok
        ? `r=${JSON.stringify(rP13b2.rows[0].r)}`
        : `msg=${rP13b2.erro?.message}`,
    );

    // =========================================================================
    // TESTE DE ROLLBACK (T1 Step 5): migration + rollback-manual + P1 invertida,
    // tudo dentro desta MESMA transacao (o ROLLBACK final devolve tudo).
    // =========================================================================
    // =========================================================================
    // TESTE DE ROLLBACK da Task 3 (concluir_estorno): aplicado ANTES do
    // rollback da T1 (ordem inversa da aplicacao), a funcao some.
    // =========================================================================
    console.log("\n=== rollback T3: rollback-manual da concluir_estorno ===");
    const caminhoRollbackT3 = path.join(
      RAIZ,
      "supabase",
      "migrations",
      ROLLBACK_T3,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminhoRollbackT3)) {
      conferir(
        "rollback T3: arquivo rollback-manual versionado existe",
        false,
        caminhoRollbackT3,
      );
    } else {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sqlRollbackT3 = fs.readFileSync(caminhoRollbackT3, "utf8");
      if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sqlRollbackT3)) {
        throw new Error(
          `${ROLLBACK_T3} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op. Abortando.`,
        );
      }
      if (!(migrationT3Existe && migrationExiste)) {
        conferir(
          "rollback T3: aplicado apos a migration (pulado — T3 nao aplicada no vermelho)",
          false,
          "sem migration aplicada nao ha o que desfazer",
        );
      } else {
        await client.query(sqlRollbackT3);
        const { rows: posT3 } = await client.query(`
          SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname='concluir_estorno') AS rpc`);
        conferir("rollback T3: concluir_estorno some", posT3[0].rpc === false);
      }
    }

    console.log(
      "\n=== rollback: migration + rollback-manual + P1 invertida ===",
    );
    const caminhoRollback = path.join(RAIZ, "supabase", "migrations", ROLLBACK);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminhoRollback)) {
      conferir(
        "rollback: arquivo rollback-manual versionado existe",
        false,
        caminhoRollback,
      );
    } else {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const sqlRollback = fs.readFileSync(caminhoRollback, "utf8");
      if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sqlRollback)) {
        throw new Error(
          `${ROLLBACK} tem BEGIN/COMMIT embutido: o ROLLBACK desta prova viraria no-op. Abortando.`,
        );
      }
      if (!migrationExiste) {
        conferir(
          "rollback: aplicado apos a migration (pulado — migration inexistente no vermelho)",
          false,
          "sem migration nao ha o que desfazer",
        );
      } else {
        await client.query(sqlRollback);
        const { rows: pos } = await client.query(`
          SELECT EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_schema='public' AND table_name='order_refunds') AS tabela,
                 EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema='public' AND table_name='marketplace_orders'
                            AND column_name='valor_estornado') AS coluna,
                 EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname='solicitar_estorno') AS rpc`);
        conferir(
          "rollback: order_refunds some (P1 invertida)",
          pos[0].tabela === false,
        );
        conferir(
          "rollback: valor_estornado some (P2 invertida)",
          pos[0].coluna === false,
        );
        conferir("rollback: solicitar_estorno some", pos[0].rpc === false);
        const { rows: def } = await client.query(
          `SELECT pg_get_functiondef(p.oid) AS d
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND p.proname='update_order_status_atomic'`,
        );
        conferir(
          "rollback: update_order_status_atomic volta SEM qualquer referencia a order_refunds",
          def.length === 1 && !def[0].d.includes("order_refunds"),
        );
      }
    }
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
