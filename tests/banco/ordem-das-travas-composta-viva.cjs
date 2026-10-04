"use strict";

/**
 * PROVA VIVA COMPOSTA da ORDEM GLOBAL DAS TRAVAS do dinheiro, contra o
 * Postgres EFÊMERO com as migrations aplicadas do zero (a pilha REAL: 92, 94,
 * 95, 96, 97, 98, 99, 200, 201 — e o que vier depois).
 *
 * A REGRA: quem mexe no ledger do estorno trava PRIMEIRO as linhas de
 * `order_refunds` do pedido (por id) e SÓ DEPOIS o pedido
 * (`marketplace_orders`). Cada RPC trava o SEU subconjunto de linhas — e é
 * exatamente por isso que a composição precisa de prova própria: as provas de
 * cada migration medem a RPC dela contra uma ou duas vizinhas; aqui as RPCs
 * de lotes diferentes se encontram:
 *
 *   contestação (96)  registrar_contestacao_no_ledger — linhas do sistema
 *   REF externo (96)  registrar_estorno_externo_do_mp — sistema + o refund
 *   autorização (96)  autorizar_post_do_estorno       — a linha do POST
 *   concluir (89)     concluir_estorno                — a linha concluída
 *   manual (94/97)    registrar_estorno_manual        — as linhas vivas
 *   cancelar (98)     cancelar_pedido_com_cobranca    — todas as linhas
 *   reemitir (97/98)  admin_devolucao_reemitir_reembolso — a devolução, e
 *                     então todas as linhas
 *
 * O ROTEIRO de cada par (A, B), com DUAS conexões reais:
 *   1. A abre a transação e dá o 1º passo de A — trava o MESMO conjunto de
 *      linhas que A trava antes do pedido (as RPCs sob prova são as vivas).
 *   2. B chama a RPC B, que tem de PARAR numa trava: o observador vê
 *      `pg_stat_activity.wait_event_type = 'Lock'` no pid de B.
 *   3. A chama a RPC A inteira (re-trava as próprias linhas, trava o pedido)
 *      e comita (ou desfaz, se a regra de negócio dela recusou).
 *   4. B termina. NENHUMA das duas termina com 40P01 (deadlock) nem 55P03
 *      (lock_timeout): B parou nas LINHAS, antes de pegar o pedido.
 * O CONTROLE de cada par: o MESMO roteiro com B trocada por uma cópia da
 * RPC VIVA (pg_get_functiondef) que trava o PEDIDO antes de tudo — a ordem
 * invertida. B pega o pedido, para nas linhas de A, A pede o pedido: 40P01.
 * O controle prova que o roteiro chega no cruzamento de verdade (sem ele, um
 * "nenhum deadlock" podia vir de duas conexões que nunca se encontraram).
 *
 *   (a) contestação × concluir_estorno, nas duas direções
 *   (b) contestação × estorno manual, nas duas direções; autorização × manual
 *   (c) cancelar × concluir_estorno, nas duas direções
 *   (d) cancelar × estorno manual, nas duas direções
 *   (e) contestação × cancelar, nas duas direções
 *   (f) reemitir × concluir, × manual, × cancelar, × contestação (nas duas
 *       direções) e × autorização
 *   (g) CICLO de TRÊS conexões nos mesmos recursos (linha L1 < linha L2 <
 *       pedido): C1 conclui L2, C2 cancela (L1, L2, pedido), C3 reemite
 *       (devolução, L1, L2, pedido). Com a ordem global, C2 para em L2 e C3
 *       em L1 — ninguém segura o pedido esperando linha — e as três terminam
 *       sem 40P01. CONTROLE: C3 com o pedido primeiro fecha o ciclo
 *       C1 -> C3 -> C2 -> C1 e dá 40P01.
 *   (h) a ordem dos rollbacks: da última migration até a 96, na ordem
 *       inversa (hoje 201 -> 200 -> 99 -> 98 -> 97 -> 96), passa; a 97 antes
 *       da 98 recusa sem gravar nada.
 *   (i) REF externo × cancelar, nas duas direções (a linha do sistema)
 *   (j) REF externo × concluir_estorno do MESMO refund, nas duas direções (a
 *       linha que já carrega o id do refund): concluído uma vez
 *
 * Nenhum caso é pulado: se uma RPC da composição não existir com a
 * assinatura esperada, a prova (0) FALHA — prova pulada conta como falha.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/ordem-das-travas-composta-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório (a pasta é
 * constante; os nomes vêm do próprio readdir dela), nunca entrada de fora. */

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
const MIGRATIONS = fs
  .readdirSync(PASTA)
  .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-"))
  .sort();

/**
 * O corpo da função na ÚLTIMA migration (por nome, a ordem do db-apply) que a
 * define — o que tem de estar vivo. Devolve o arquivo e o md5 do corpo.
 */
function ultimaDefinicao(nome) {
  let achado = null;
  for (const arquivo of MIGRATIONS) {
    const texto = fs
      .readFileSync(path.join(PASTA, arquivo), "utf8")
      .replace(/\r\n/g, "\n");
    // eslint-disable-next-line security/detect-non-literal-regexp -- `nome` é uma das constantes de função deste arquivo, nunca entrada de fora.
    const re = new RegExp(
      `^CREATE (?:OR REPLACE )?FUNCTION public\\.${nome}\\(`,
      "gm",
    );
    let m = re.exec(texto);
    while (m) {
      achado = { arquivo, resto: texto.slice(m.index) };
      m = re.exec(texto);
    }
  }
  assert.ok(achado, `${nome}: nenhuma migration a define`);
  const tag = achado.resto.match(/\bAS\s+(\$[A-Za-z0-9_]*\$)/);
  const inicio = achado.resto.indexOf(tag[0]) + tag[0].length;
  const corpo = achado.resto.slice(
    inicio,
    achado.resto.indexOf(tag[1], inicio),
  );
  return {
    arquivo: achado.arquivo,
    md5: crypto.createHash("md5").update(corpo).digest("hex"),
  };
}

const U_CLIENTE = "7d111111-1111-1111-1111-111111111111";
const U_ADMIN = "7d222222-2222-2222-2222-222222222222";

let seq = 0;
/** uuid crescente: a ORDEM por id das linhas fica sob controle da prova. */
function novoId(prefixo) {
  seq += 1;
  return `${prefixo}-0000-0000-0000-${String(seq).padStart(12, "0")}`;
}

const num = (v) => Math.round(Number(v) * 100) / 100;

// ---------------------------------------------------------------------------
// As RPCs da composição: assinatura, quem chama, o 1º passo (as linhas que
// ela trava ANTES do pedido) e a expressão do pedido (para o CONTROLE).
// ---------------------------------------------------------------------------

const LINHAS_DO_PEDIDO =
  "SELECT 1 FROM public.order_refunds r WHERE r.order_id = $1 ORDER BY r.id FOR UPDATE";

const RPC = {
  contestacao: {
    assinatura:
      "public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)",
    nome: "public.registrar_contestacao_no_ledger",
    papel: "servico",
    pedidoNoCorpo: "p_order_id",
    primeiroPasso: (con, x) =>
      con.query(
        `SELECT 1 FROM public.order_refunds r
          WHERE r.order_id = $1 AND r.solicitado_por = 'sistema'
          ORDER BY r.id FOR UPDATE`,
        [x.pedido],
      ),
    chamar: (con, fn, x) =>
      con.query(`SELECT ${fn}($1, $2, $3, $4, $5, $6, 1) AS r`, [
        x.pedido,
        x.cbk,
        x.caseId,
        x.decisao ?? "em_analise",
        x.valorCaso ?? null,
        x.estimado ?? null,
      ]),
  },
  externo: {
    assinatura:
      "public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text)",
    nome: "public.registrar_estorno_externo_do_mp",
    papel: "servico",
    pedidoNoCorpo: "p_order_id",
    // As linhas do sistema e a que já carrega este refund — o subconjunto
    // que a 96 trava antes do pedido.
    primeiroPasso: (con, x) =>
      con.query(
        `SELECT 1 FROM public.order_refunds r
          WHERE r.order_id = $1 AND (r.solicitado_por = 'sistema' OR r.mp_refund_id = $2)
          ORDER BY r.id FOR UPDATE`,
        [x.pedido, x.refExterno],
      ),
    chamar: (con, fn, x) =>
      con.query(
        `SELECT ${fn}($1::uuid, $2, $3, 'approved', 'accredited') AS r`,
        [x.pedido, x.refExterno, x.valorExterno],
      ),
  },
  autorizar: {
    assinatura: "public.autorizar_post_do_estorno(uuid, numeric)",
    nome: "public.autorizar_post_do_estorno",
    papel: "servico",
    pedidoNoCorpo:
      "(SELECT ctl.order_id FROM public.order_refunds ctl WHERE ctl.id = p_refund_id)",
    primeiroPasso: (con, x) =>
      con.query("SELECT 1 FROM public.order_refunds WHERE id = $1 FOR UPDATE", [
        x.linhaPost,
      ]),
    chamar: (con, fn, x) =>
      con.query(`SELECT ${fn}($1::uuid, $2) AS r`, [x.linhaPost, x.valorPost]),
  },
  concluir: {
    assinatura: "public.concluir_estorno(uuid, text, text, text)",
    nome: "public.concluir_estorno",
    papel: "servico",
    pedidoNoCorpo:
      "(SELECT ctl.order_id FROM public.order_refunds ctl WHERE ctl.id = p_refund_id)",
    primeiroPasso: (con, x) =>
      con.query("SELECT 1 FROM public.order_refunds WHERE id = $1 FOR UPDATE", [
        x.linhaConcluir,
      ]),
    chamar: (con, fn, x) =>
      con.query(`SELECT ${fn}($1::uuid, $2, $3, $4) AS r`, [
        x.linhaConcluir,
        x.refConcluir ?? null,
        x.statusMp ?? "approved",
        x.detalheMp ?? "accredited",
      ]),
  },
  manual: {
    assinatura: "public.registrar_estorno_manual(uuid)",
    nome: "public.registrar_estorno_manual",
    papel: "admin",
    pedidoNoCorpo: "p_order_id",
    primeiroPasso: (con, x) =>
      con.query(
        `SELECT 1 FROM public.order_refunds viva
          WHERE viva.order_id = $1 AND viva.status IN ('solicitado', 'em_processamento')
          ORDER BY viva.id FOR UPDATE`,
        [x.pedido],
      ),
    chamar: (con, fn, x) =>
      con.query(`SELECT ${fn}($1::uuid) AS r`, [x.pedido]),
  },
  cancelar: {
    assinatura:
      "public.cancelar_pedido_com_cobranca(uuid, uuid, text, text, text)",
    nome: "public.cancelar_pedido_com_cobranca",
    papel: "servico",
    pedidoNoCorpo: "p_order_id",
    primeiroPasso: (con, x) => con.query(LINHAS_DO_PEDIDO, [x.pedido]),
    chamar: (con, fn, x) =>
      con.query(
        `SELECT ${fn}($1::uuid, $2::uuid, $3::text, 'pago', NULL) AS r`,
        [x.pedido, U_ADMIN, x.vaga ?? null],
      ),
  },
  reemitir: {
    assinatura: "public.admin_devolucao_reemitir_reembolso(uuid, boolean)",
    nome: "public.admin_devolucao_reemitir_reembolso",
    papel: "admin",
    pedidoNoCorpo:
      "(SELECT ctl.order_id FROM public.devolucoes ctl WHERE ctl.id = p_devolucao_id)",
    primeiroPasso: async (con, x) => {
      await con.query(
        "SELECT 1 FROM public.devolucoes WHERE id = $1 FOR UPDATE",
        [x.devolucao],
      );
      await con.query(LINHAS_DO_PEDIDO, [x.pedido]);
    },
    chamar: (con, fn, x) =>
      con.query(`SELECT ${fn}($1::uuid, false) AS r`, [x.devolucao]),
  },
};

const SUFIXO_CONTROLE = "__ctl_pedido_primeiro";

/**
 * O CONTROLE de uma RPC: o corpo VIVO (pg_get_functiondef), com outro nome e
 * UMA linha a mais logo no começo — o pedido travado ANTES de tudo, a ordem
 * invertida. Construído do corpo vivo, não redigitado: difere da RPC sob
 * prova só na ordem.
 */
async function criarControle(cliente, rpc) {
  const def = (
    await cliente.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [
      rpc.assinatura,
    ])
  ).rows[0].d;
  const corpo = def.indexOf("AS $function$");
  const inicio = def.indexOf("\nBEGIN\n", corpo);
  assert.ok(corpo > 0 && inicio > corpo, `${rpc.nome}: achei o BEGIN do corpo`);
  const pos = inicio + "\nBEGIN\n".length;
  let novo = `${def.slice(0, pos)}  PERFORM 1 FROM public.marketplace_orders WHERE id = ${rpc.pedidoNoCorpo} FOR UPDATE; -- CONTROLE: pedido primeiro\n${def.slice(pos)}`;
  const cabecalho = `FUNCTION ${rpc.nome}(`;
  assert.ok(novo.includes(cabecalho), `${rpc.nome}: cabeçalho da função`);
  novo = novo.replace(cabecalho, `FUNCTION ${rpc.nome}${SUFIXO_CONTROLE}(`);
  await cliente.query(novo);
  const assinaturaControle = rpc.assinatura.replace(
    `${rpc.nome}(`,
    `${rpc.nome}${SUFIXO_CONTROLE}(`,
  );
  await cliente.query(
    `GRANT EXECUTE ON FUNCTION ${assinaturaControle} TO service_role`,
  );
  return {
    nome: `${rpc.nome}${SUFIXO_CONTROLE}`,
    apagar: () =>
      cliente.query(`DROP FUNCTION IF EXISTS ${assinaturaControle}`),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function prepararPessoas(cliente) {
  for (const [id, email, meta] of [
    [U_CLIENTE, "cliente@ordem-travas.teste", "{}"],
    [U_ADMIN, "admin@ordem-travas.teste", '{"role":"admin"}'],
  ]) {
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, email, meta],
    );
  }
  // O admin ATUAL (20261197000000): o papel nas DUAS fontes. Mesma forma das
  // fixtures da 20261199000000 — idempotente; um papel diferente já gravado
  // faria a prova falhar alto (42501), nunca passar por engano.
  await cliente.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente Travas', 'customer'), ($2, 'Admin Travas', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U_CLIENTE, U_ADMIN],
  );
}

/** Pedido pago (total 100) com um item de produto próprio. `vaga` é o id da
 * cobrança no MP (a reemissão só reemite pagamento que passou pelo MP). */
async function pedidoPago(
  cliente,
  { status = "processing", vaga = null } = {},
) {
  const pedido = novoId("7daaaaaa");
  const produto = novoId("7dbbbbbb");
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
     VALUES ($1, 'Produto Travas', 10.00, 50.00, 10, true, false)`,
    [produto],
  );
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, valor_estornado, updated_at,
        gateway_payment_id, metodo_online)
     VALUES ($1, $2, 'Cliente Travas', '{}'::jsonb, 100, 100, $3, 'online',
             'online', 'pago', now(), 0, now(), $4, CASE WHEN $4::text IS NULL THEN NULL ELSE 'pix' END)`,
    [pedido, U_CLIENTE, status, vaga],
  );
  await cliente.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto Travas', 2, 50.00)`,
    [pedido, produto],
  );
  return pedido;
}

/** Linha do ledger com id CRESCENTE (a ordem por id é a ordem de criação). */
async function linha(cliente, pedido, { valor, status, por = "lojista" }) {
  const id = novoId("7dcccccc");
  await cliente.query(
    `INSERT INTO public.order_refunds (id, order_id, amount, motivo, solicitado_por, status)
     VALUES ($1, $2, $3, 'prova da ordem das travas', $4, $5)`,
    [id, pedido, valor, por, status],
  );
  return id;
}

let protocolo = 0;

/** Devolução CONCLUÍDA com o reembolso RECUSADO pelo MP (linha de 30), num
 * pedido ENTREGUE e pago — o caso que a reemissão existe para refazer. */
async function devolucaoRecusada(cliente) {
  protocolo += 1;
  const vaga = `ORDTRAVAS${protocolo}`;
  const pedido = await pedidoPago(cliente, { status: "delivered", vaga });
  const recusada = await linha(cliente, pedido, {
    valor: 30,
    status: "recusado",
  });
  const dev = await cliente.query(
    `INSERT INTO public.devolucoes
       (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final,
        modalidade, metodo_retorno, status, valor_itens, valor_reembolso, refund_id,
        reembolso_manual, prazo_ate, politica, concluida_em)
     VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso',
             'local', 'entrega_na_loja', 'concluida', 30, 30, $4,
             false, current_date + 7, '{}'::jsonb, now())
     RETURNING id`,
    [`TRAVAS-${protocolo}`, pedido, U_CLIENTE, recusada],
  );
  return { pedido, vaga, recusada, devolucao: dev.rows[0].id };
}

/** Reserva de contestação (linha do SISTEMA, em_processamento) pela RPC viva. */
async function reservaDeContestacao(cliente, pedido, valor = 40) {
  protocolo += 1;
  const cbk = `CBK-TRAVAS-${protocolo}`;
  const r = (
    await cliente.query(
      "SELECT public.registrar_contestacao_no_ledger($1, $2, $3, 'em_analise', $4, NULL, 1) AS r",
      [pedido, cbk, String(9000 + protocolo), valor],
    )
  ).rows[0].r;
  assert.equal(
    r.resultado,
    "reservado",
    `fixture: a contestação reservou (${JSON.stringify(r)})`,
  );
  const id = (
    await cliente.query(
      "SELECT id FROM public.order_refunds WHERE order_id = $1 AND mp_chargeback_id = $2",
      [pedido, cbk],
    )
  ).rows[0].id;
  return { cbk, caseId: String(9000 + protocolo), linhaDoCaso: id };
}

async function estadoDoPedido(cliente, pedido) {
  const p = (
    await cliente.query(
      "SELECT status, payment_status, total, valor_estornado FROM public.marketplace_orders WHERE id = $1",
      [pedido],
    )
  ).rows[0];
  const linhas = (
    await cliente.query(
      `SELECT amount, status, solicitado_por FROM public.order_refunds
        WHERE order_id = $1 ORDER BY id`,
      [pedido],
    )
  ).rows.map((l) => [num(l.amount), l.status, l.solicitado_por]);
  return {
    status: p.status,
    pagamento: p.payment_status,
    total: num(p.total),
    estornado: num(p.valor_estornado),
    linhas,
  };
}

// ---------------------------------------------------------------------------
// Conexões
// ---------------------------------------------------------------------------

async function conectar(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function pidDe(con) {
  return (await con.query("SELECT pg_backend_pid() AS p")).rows[0].p;
}

/** Espera o pid ficar PARADO numa trava (wait_event_type = 'Lock'). */
async function esperarTrava(observador, pid) {
  for (let i = 0; i < 200; i += 1) {
    const r = await observador.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

const desfecho = (promessa) =>
  promessa.then(
    (r) => ({ ok: true, r: r.rows[0]?.r ?? null }),
    (e) => ({ ok: false, codigo: e.code, mensagem: e.message }),
  );

/** A sessão de quem chama: o admin ATUAL (superusuário + app.rpc.user_id,
 * como o auth.uid() emulado lê) ou o servidor (service_role na transação). */
async function sessao(con, papel) {
  await con.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    papel === "admin" ? U_ADMIN : "",
  ]);
}

async function abrir(con, papel) {
  await con.query("BEGIN");
  // Um travamento de verdade vira erro em 8 s (55P03), nunca uma prova
  // pendurada; o detector de deadlock do Postgres age em 1 s.
  await con.query("SET LOCAL lock_timeout = '8s'");
  if (papel === "servico") await con.query("SET LOCAL ROLE service_role");
}

/**
 * O roteiro de um par: A dá o 1º passo e segura; B chama e tem de PARAR; A
 * termina e fecha; B termina. Devolve os desfechos e se B parou.
 */
async function cruzar(url, observador, x, A, B, nomeB) {
  const a = await conectar(url);
  const b = await conectar(url);
  try {
    await sessao(a, A.papel);
    await sessao(b, B.papel);
    // O pid ANTES de disparar: o pg enfileira consultas por conexão, e
    // perguntar o pid de B com B bloqueada travaria a própria prova.
    const pidB = await pidDe(b);
    await a.query("BEGIN");
    await a.query("SET LOCAL lock_timeout = '8s'");
    await A.primeiroPasso(a, x);
    if (A.papel === "servico") await a.query("SET LOCAL ROLE service_role");
    await abrir(b, B.papel);
    const promessaB = desfecho(B.chamar(b, nomeB, x));
    const parouB = await esperarTrava(observador, pidB);
    const ra = await desfecho(A.chamar(a, A.nome, x));
    await a.query(ra.ok ? "COMMIT" : "ROLLBACK");
    const rb = await promessaB;
    await b.query(rb.ok ? "COMMIT" : "ROLLBACK");
    return { ra, rb, parouB };
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
  }
}

const codigosDe = (...rs) => rs.filter((x) => !x.ok).map((x) => x.codigo);

/** Uma linha de log por desfecho: o que cada conexão devolveu, de verdade. */
const resumo = (d) =>
  d.ok
    ? `ok ${JSON.stringify(d.r).slice(0, 80)}`
    : `ERRO ${d.codigo} ${String(d.mensagem).slice(0, 80)}`;

/**
 * Um par numa direção: o caso REAL (sem 40P01/55P03, B parou na trava) e o
 * CONTROLE (B com o pedido primeiro: 40P01), cada um com a sua fixture.
 * `conferir` recebe o desfecho real e o estado do pedido.
 */
async function parNumaDirecao(
  cliente,
  url,
  { rotulo, A, B, fixture, conferir },
) {
  const real = await fixture(cliente);
  const { ra, rb, parouB } = await cruzar(url, cliente, real, A, B, B.nome);
  assert.equal(parouB, true, `${rotulo}: B parou numa trava (wait_event Lock)`);
  const codigos = codigosDe(ra, rb);
  assert.ok(
    !codigos.includes("40P01") && !codigos.includes("55P03"),
    `${rotulo}: nenhum deadlock nem lock_timeout (${JSON.stringify({ ra, rb })})`,
  );
  console.log(`    [${rotulo}] A: ${resumo(ra)} | B: ${resumo(rb)}`);
  const estado = await estadoDoPedido(cliente, real.pedido);
  assert.ok(
    estado.estornado <= estado.total,
    `${rotulo}: estornado nunca passa do total`,
  );
  await conferir({ ra, rb, estado, x: real });

  const controle = await criarControle(cliente, B);
  try {
    const x = await fixture(cliente);
    const c = await cruzar(url, cliente, x, A, B, controle.nome);
    assert.equal(c.parouB, true, `${rotulo} CONTROLE: B parou numa trava`);
    assert.ok(
      codigosDe(c.ra, c.rb).includes("40P01"),
      `${rotulo} CONTROLE (pedido primeiro): devia dar 40P01 (${JSON.stringify(c)})`,
    );
    console.log(`    [${rotulo}] CONTROLE: ${codigosDe(c.ra, c.rb).join(",")}`);
  } finally {
    await controle.apagar();
  }
}

const OK = (d, rotulo) =>
  assert.equal(d.ok, true, `${rotulo}: ${d.mensagem ?? ""}`);
const RECUSA_DE_NEGOCIO = (d, codigo, rotulo) => {
  assert.equal(
    d.ok,
    false,
    `${rotulo}: devia recusar pela regra (${JSON.stringify(d)})`,
  );
  assert.equal(d.codigo, codigo, `${rotulo}: ${d.mensagem}`);
};

// ---------------------------------------------------------------------------
// Fixtures de cada par
// ---------------------------------------------------------------------------

/** Pedido pago com uma RESERVA de contestação (sistema, 40). */
async function fxContestacao(cliente) {
  const pedido = await pedidoPago(cliente);
  const c = await reservaDeContestacao(cliente, pedido, 40);
  return {
    pedido,
    ...c,
    // a 2ª entrega do MESMO caso (pendente de novo): idempotente.
    linhaConcluir: c.linhaDoCaso,
    statusMp: "charged_back",
    detalheMp: "settled",
  };
}

/** Pedido pago com UMA linha do lojista em processamento (30). */
async function fxEmProcessamento(cliente) {
  const pedido = await pedidoPago(cliente);
  const l = await linha(cliente, pedido, {
    valor: 30,
    status: "em_processamento",
  });
  protocolo += 1;
  return {
    pedido,
    linhaConcluir: l,
    refConcluir: `MPREF-TRAVAS-${protocolo}`,
    linhaPost: l,
    valorPost: 30,
  };
}

/** Pedido pago com UMA linha do lojista solicitada (30, viva). */
async function fxSolicitada(cliente) {
  const pedido = await pedidoPago(cliente);
  await linha(cliente, pedido, { valor: 30, status: "solicitado" });
  return { pedido };
}

/** Contestação reservada + uma linha do lojista em processamento (20): a
 * autorização do POST dela × o estorno manual. */
async function fxContestacaoComPost(cliente) {
  const x = await fxContestacao(cliente);
  const l = await linha(cliente, x.pedido, {
    valor: 20,
    status: "em_processamento",
  });
  return { ...x, linhaPost: l, valorPost: 20 };
}

/** Devolução recusada + uma linha do lojista em processamento (20). */
async function fxDevolucaoEmProcessamento(cliente) {
  const d = await devolucaoRecusada(cliente);
  const l = await linha(cliente, d.pedido, {
    valor: 20,
    status: "em_processamento",
  });
  protocolo += 1;
  return {
    ...d,
    linhaConcluir: l,
    refConcluir: `MPREF-TRAVAS-${protocolo}`,
    linhaPost: l,
    valorPost: 20,
  };
}

/** Devolução recusada + uma linha do lojista solicitada (20, viva). */
async function fxDevolucaoSolicitada(cliente) {
  const d = await devolucaoRecusada(cliente);
  await linha(cliente, d.pedido, { valor: 20, status: "solicitado" });
  return d;
}

/** Contestação reservada (sistema, 40) + um refund de 30 feito no painel do
 * MP que nenhuma linha reivindica: o REF externo trava a linha do sistema. */
async function fxExternoComReserva(cliente) {
  const x = await fxContestacao(cliente);
  protocolo += 1;
  return { ...x, refExterno: `MPREF-PAINEL-${protocolo}`, valorExterno: 30 };
}

/** Linha do lojista em processamento (30) que JÁ carrega o id do refund no
 * MP (o POST saiu): o webhook do mesmo refund (REF externo) e a conclusão
 * dela chegam juntos — os dois travam a MESMA linha. */
async function fxRefundDaLinha(cliente) {
  const x = await fxEmProcessamento(cliente);
  await cliente.query(
    "UPDATE public.order_refunds SET mp_refund_id = $2 WHERE id = $1",
    [x.linhaConcluir, x.refConcluir],
  );
  return { ...x, refExterno: x.refConcluir, valorExterno: 30 };
}

/** Devolução recusada + uma reserva de contestação (sistema, 40). */
async function fxDevolucaoContestada(cliente) {
  const d = await devolucaoRecusada(cliente);
  const c = await reservaDeContestacao(cliente, d.pedido, 40);
  return { ...d, ...c };
}

// ---------------------------------------------------------------------------

const PROVAS = [];

PROVAS.push({
  nome: "(0) a composição está no ar PELO HASH: cada RPC vive com o corpo da última migration que a define — a 96 nas três dela, a 98 no cancelamento e na reemissão (nenhum caso pulado)",
  corpo: async (cliente) => {
    await prepararPessoas(cliente);
    // De quem é cada corpo, no mínimo (uma migration POSTERIOR que redefina
    // uma delas também vale — desde que o corpo vivo seja o do arquivo dela).
    const minimo = {
      contestacao: "20261196000000",
      autorizar: "20261196000000",
      externo: "20261196000000",
      concluir: "2026110000100",
      manual: "20261197000000",
      cancelar: "20261198000000",
      reemitir: "20261198000000",
      mudar_status: "20261198000000",
      saldo: "20261198000000",
    };
    const conferidas = [
      ...Object.entries(RPC).map(([chave, rpc]) => [
        chave,
        rpc.nome,
        rpc.assinatura,
      ]),
      [
        "mudar_status",
        "public.pedido__mudar_status",
        "public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean)",
      ],
      [
        "saldo",
        "public.pedido__saldo_a_estornar",
        "public.pedido__saldo_a_estornar(uuid)",
      ],
    ];
    for (const [chave, nome, assinatura] of conferidas) {
      const vivo = (
        await cliente.query(
          "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
          [assinatura],
        )
      ).rows[0]?.h;
      assert.ok(
        vivo,
        `${chave}: ${assinatura} ausente — a prova não pula, FALHA`,
      );
      const def = ultimaDefinicao(nome.replace(/^public\./, ""));
      // eslint-disable-next-line security/detect-object-injection -- `chave` vem da lista literal `conferidas` acima.
      const piso = minimo[chave];
      assert.ok(
        def.arquivo >= piso,
        `${chave}: a última definição (${def.arquivo}) é anterior à ${piso}`,
      );
      assert.equal(
        vivo,
        def.md5,
        `${chave}: o corpo vivo não é o de ${def.arquivo}`,
      );
    }
  },
});

PROVAS.push({
  nome: "(a) contestação (96) × concluir_estorno (89), nas duas direções: B para na linha, sem 40P01; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    await parNumaDirecao(cliente, url, {
      rotulo: "a1 concluir segura a linha do caso, contestação espera",
      A: RPC.concluir,
      B: RPC.contestacao,
      fixture: fxContestacao,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "a1 concluir");
        OK(rb, "a1 contestação");
        assert.equal(estado.estornado, 40, "a1: concluído uma vez (40)");
        assert.deepEqual(estado.linhas, [[40, "concluido", "sistema"]]);
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "a2 contestação segura as linhas do sistema, concluir espera",
      A: RPC.contestacao,
      B: RPC.concluir,
      fixture: fxContestacao,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "a2 contestação");
        OK(rb, "a2 concluir");
        assert.equal(estado.estornado, 40, "a2: concluído uma vez (40)");
      },
    });
  },
});

PROVAS.push({
  nome: "(b) contestação (96) × estorno manual (94/97), nas duas direções, e autorização do POST (96) × manual: sem 40P01; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    await parNumaDirecao(cliente, url, {
      rotulo: "b1 manual segura as linhas vivas, contestação espera",
      A: RPC.manual,
      B: RPC.contestacao,
      fixture: fxContestacao,
      conferir: ({ ra, rb, estado }) => {
        // A 94 recusa com a disputa em curso (22023) — pela REGRA, não 40P01.
        RECUSA_DE_NEGOCIO(ra, "22023", "b1 manual");
        OK(rb, "b1 contestação");
        assert.deepEqual(estado.linhas, [[40, "em_processamento", "sistema"]]);
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "b2 contestação segura as linhas do sistema, manual espera",
      A: RPC.contestacao,
      B: RPC.manual,
      fixture: fxContestacao,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "b2 contestação");
        RECUSA_DE_NEGOCIO(rb, "22023", "b2 manual");
        assert.equal(estado.estornado, 0);
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "b3 autorização segura a linha do POST, manual espera",
      A: RPC.autorizar,
      B: RPC.manual,
      fixture: fxContestacaoComPost,
      conferir: ({ ra, rb }) => {
        OK(ra, "b3 autorização");
        assert.ok(ra.r.decisao, "b3: a autorização decidiu");
        // A linha do POST em processamento é dinheiro já pedido ao MP: a 94
        // recusa pela regra (22023), não por trava.
        RECUSA_DE_NEGOCIO(rb, "22023", "b3 manual");
      },
    });
  },
});

PROVAS.push({
  nome: "(c) cancelar (98) × concluir_estorno (89), nas duas direções: remanescente 70, nunca 130; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    await parNumaDirecao(cliente, url, {
      rotulo: "c1 concluir segura a linha, cancelar espera",
      A: RPC.concluir,
      B: RPC.cancelar,
      fixture: fxEmProcessamento,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "c1 concluir");
        OK(rb, "c1 cancelar");
        assert.equal(rb.r.cancelado, true);
        assert.equal(estado.status, "cancelled");
        // A linha do remanescente nasce com uuid aleatório: compara por valor.
        assert.deepEqual(
          estado.linhas.map(([v, s]) => [v, s]).sort((p, q) => p[0] - q[0]),
          [
            [30, "concluido"],
            [70, "solicitado"],
          ],
        );
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "c2 cancelar segura as linhas, concluir espera",
      A: RPC.cancelar,
      B: RPC.concluir,
      fixture: fxEmProcessamento,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "c2 cancelar");
        OK(rb, "c2 concluir");
        assert.equal(ra.r.cancelado, true);
        assert.deepEqual(
          estado.linhas.map(([v]) => v).sort((p, q) => p - q),
          [30, 70],
          "c2: o cancelamento viu 30 em voo — remanescente 70",
        );
      },
    });
  },
});

PROVAS.push({
  nome: "(d) cancelar (98) × estorno manual (94/97), nas duas direções: sem 40P01; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    await parNumaDirecao(cliente, url, {
      rotulo: "d1 manual segura as linhas vivas, cancelar espera",
      A: RPC.manual,
      B: RPC.cancelar,
      fixture: fxSolicitada,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "d1 manual");
        OK(rb, "d1 cancelar");
        // O pagamento virou 'estornado' enquanto o cancelamento esperava: o
        // CAS ('pago') recusa e devolve o pedido relido — nada de estorno novo.
        assert.equal(rb.r.cancelado, false);
        assert.equal(rb.r.motivo, "cobranca_mudou");
        assert.deepEqual(
          estado.linhas.map(([, s]) => s),
          ["recusado"],
        );
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "d2 cancelar segura as linhas, manual espera",
      A: RPC.cancelar,
      B: RPC.manual,
      fixture: fxSolicitada,
      conferir: ({ ra, rb }) => {
        OK(ra, "d2 cancelar");
        assert.equal(ra.r.cancelado, true);
        OK(rb, "d2 manual");
        assert.equal(rb.r.payment_status, "estornado");
      },
    });
  },
});

PROVAS.push({
  nome: "(e) contestação (96) × cancelar (98), nas duas direções: sem 40P01; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    const novoCaso = (x) => ({
      ...x,
      cbk: `${x.cbk}-2`,
      caseId: `${x.caseId}2`,
      valorCaso: 20,
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "e1 contestação segura as linhas do sistema, cancelar espera",
      A: RPC.contestacao,
      B: RPC.cancelar,
      fixture: async (c) => novoCaso(await fxContestacao(c)),
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "e1 contestação");
        OK(rb, "e1 cancelar");
        assert.equal(rb.r.cancelado, true);
        assert.equal(estado.status, "cancelled");
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "e2 cancelar segura as linhas, contestação espera",
      A: RPC.cancelar,
      B: RPC.contestacao,
      fixture: async (c) => novoCaso(await fxContestacao(c)),
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "e2 cancelar");
        OK(rb, "e2 contestação");
        assert.equal(ra.r.cancelado, true);
        assert.equal(estado.status, "cancelled");
      },
    });
  },
});

PROVAS.push({
  nome: "(f) reemitir a devolução × concluir, × manual, × cancelar, × contestação (nas duas direções) e × autorização: sem 40P01; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    // × concluir_estorno (outra linha do pedido em processamento)
    await parNumaDirecao(cliente, url, {
      rotulo: "f1a concluir segura a linha, reemitir espera",
      A: RPC.concluir,
      B: RPC.reemitir,
      fixture: fxDevolucaoEmProcessamento,
      conferir: ({ ra, rb }) => {
        OK(ra, "f1a concluir");
        OK(rb, "f1a reemitir");
        assert.ok(rb.r.refund_id, "f1a: a reemissão abriu a linha nova");
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "f1b reemitir segura devolução e linhas, concluir espera",
      A: RPC.reemitir,
      B: RPC.concluir,
      fixture: fxDevolucaoEmProcessamento,
      conferir: ({ ra, rb }) => {
        OK(ra, "f1b reemitir");
        OK(rb, "f1b concluir");
        assert.equal(rb.r.concluido, true);
      },
    });
    // × estorno manual (outra linha viva)
    await parNumaDirecao(cliente, url, {
      rotulo: "f2a manual segura as linhas vivas, reemitir espera",
      A: RPC.manual,
      B: RPC.reemitir,
      fixture: fxDevolucaoSolicitada,
      conferir: ({ ra, rb }) => {
        OK(ra, "f2a manual");
        // O pagamento virou 'estornado' enquanto a reemissão esperava: ela
        // recusa pela regra dela (22023) — nunca deadlock.
        RECUSA_DE_NEGOCIO(rb, "22023", "f2a reemitir");
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "f2b reemitir segura devolução e linhas, manual espera",
      A: RPC.reemitir,
      B: RPC.manual,
      fixture: fxDevolucaoSolicitada,
      conferir: ({ ra, rb }) => {
        OK(ra, "f2b reemitir");
        OK(rb, "f2b manual");
        assert.equal(rb.r.payment_status, "estornado");
      },
    });
    // × cancelar (98)
    await parNumaDirecao(cliente, url, {
      rotulo: "f3a cancelar segura as linhas, reemitir espera",
      A: RPC.cancelar,
      B: RPC.reemitir,
      fixture: devolucaoRecusada,
      conferir: ({ ra, rb }) => {
        OK(ra, "f3a cancelar");
        assert.equal(ra.r.cancelado, true);
        RECUSA_DE_NEGOCIO(rb, "22023", "f3a reemitir");
        assert.match(rb.mensagem, /não está mais entregue/);
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "f3b reemitir segura devolução e linhas, cancelar espera",
      A: RPC.reemitir,
      B: RPC.cancelar,
      fixture: devolucaoRecusada,
      conferir: ({ ra, rb }) => {
        OK(ra, "f3b reemitir");
        OK(rb, "f3b cancelar");
        assert.equal(rb.r.cancelado, true);
      },
    });
    // × contestação (96)
    const novoCaso = (x) => ({
      ...x,
      cbk: `${x.cbk}-2`,
      caseId: `${x.caseId}2`,
      valorCaso: 10,
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "f4a contestação segura as linhas do sistema, reemitir espera",
      A: RPC.contestacao,
      B: RPC.reemitir,
      fixture: async (c) => novoCaso(await fxDevolucaoContestada(c)),
      conferir: ({ ra, rb }) => {
        OK(ra, "f4a contestação");
        OK(rb, "f4a reemitir");
        assert.ok(rb.r.refund_id, "f4a: a reemissão abriu a linha nova");
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "f4b reemitir segura devolução e linhas, contestação espera",
      A: RPC.reemitir,
      B: RPC.contestacao,
      fixture: async (c) => novoCaso(await fxDevolucaoContestada(c)),
      conferir: ({ ra, rb }) => {
        OK(ra, "f4b reemitir");
        assert.ok(ra.r.refund_id, "f4b: a reemissão abriu a linha nova");
        OK(rb, "f4b contestação");
      },
    });
    // × autorização do POST (96)
    await parNumaDirecao(cliente, url, {
      rotulo: "f5 autorização segura a linha do POST, reemitir espera",
      A: RPC.autorizar,
      B: RPC.reemitir,
      fixture: fxDevolucaoEmProcessamento,
      conferir: ({ ra, rb }) => {
        OK(ra, "f5 autorização");
        assert.ok(ra.r.decisao, "f5: a autorização decidiu");
        OK(rb, "f5 reemitir");
        assert.ok(rb.r.refund_id, "f5: a reemissão abriu a linha nova");
      },
    });
  },
});

/**
 * (g) O CICLO de três conexões nos mesmos recursos: L1 (a linha recusada da
 * devolução, id menor) < L2 (outra linha em processamento) < o pedido.
 *   C1: concluir_estorno(L2) — 1º passo L2, depois o pedido.
 *   C2: cancelar_pedido_com_cobranca — L1, L2 (para em L2), depois o pedido.
 *   C3: reemitir — a devolução, L1 (para em L1), L2, depois o pedido.
 * Com a ordem global ninguém espera linha segurando o pedido: C1 conclui, C2
 * e C3 seguem. CONTROLE: C3 com o pedido primeiro pega o pedido e para em L1
 * (C2); C1 pede o pedido (C3); C2 espera L2 (C1) — o ciclo
 * C1 -> C3 -> C2 -> C1 fecha e o Postgres derruba um com 40P01.
 */
async function ciclo(url, observador, x, nomeC3) {
  const c1 = await conectar(url);
  const c2 = await conectar(url);
  const c3 = await conectar(url);
  try {
    await sessao(c1, "servico");
    await sessao(c2, "servico");
    await sessao(c3, "admin");
    const pid2 = await pidDe(c2);
    const pid3 = await pidDe(c3);
    await c1.query("BEGIN");
    await c1.query("SET LOCAL lock_timeout = '8s'");
    await RPC.concluir.primeiroPasso(c1, x);
    await c1.query("SET LOCAL ROLE service_role");
    await abrir(c2, "servico");
    const p2 = desfecho(RPC.cancelar.chamar(c2, RPC.cancelar.nome, x));
    const parou2 = await esperarTrava(observador, pid2);
    await abrir(c3, "admin");
    const p3 = desfecho(RPC.reemitir.chamar(c3, nomeC3, x));
    const parou3 = await esperarTrava(observador, pid3);
    const r1 = await desfecho(RPC.concluir.chamar(c1, RPC.concluir.nome, x));
    await c1.query(r1.ok ? "COMMIT" : "ROLLBACK");
    const r2 = await p2;
    await c2.query(r2.ok ? "COMMIT" : "ROLLBACK");
    const r3 = await p3;
    await c3.query(r3.ok ? "COMMIT" : "ROLLBACK");
    return { r1, r2, r3, parou2, parou3 };
  } finally {
    for (const c of [c1, c2, c3]) await c.end().catch(() => {});
  }
}

PROVAS.push({
  nome: "(g) ciclo de TRÊS conexões (concluir L2 · cancelar L1→L2 · reemitir dev→L1): as três terminam sem 40P01; CONTROLE (reemitir com o pedido primeiro) fecha o ciclo e dá 40P01",
  corpo: async (cliente, url) => {
    {
      const x = await fxDevolucaoEmProcessamento(cliente);
      const ids = (
        await cliente.query(
          "SELECT id FROM public.order_refunds WHERE order_id = $1 ORDER BY id",
          [x.pedido],
        )
      ).rows.map((r) => r.id);
      assert.deepEqual(
        ids,
        [x.recusada, x.linhaConcluir],
        "g: L1 (recusada) < L2 (em processamento)",
      );
      const { r1, r2, r3, parou2, parou3 } = await ciclo(
        url,
        cliente,
        x,
        RPC.reemitir.nome,
      );
      console.log(
        `    [g ciclo] C1: ${resumo(r1)} | C2: ${resumo(r2)} | C3: ${resumo(r3)}`,
      );
      assert.equal(parou2, true, "g: C2 (cancelar) parou numa trava");
      assert.equal(parou3, true, "g: C3 (reemitir) parou numa trava");
      const codigos = codigosDe(r1, r2, r3);
      assert.ok(
        !codigos.includes("40P01") && !codigos.includes("55P03"),
        `g: nenhum deadlock nem lock_timeout (${JSON.stringify({ r1, r2, r3 })})`,
      );
      OK(r1, "g C1 concluir");
      OK(r2, "g C2 cancelar");
      assert.equal(r2.r.cancelado, true);
      // C3 chega depois do cancelamento: o pedido não está mais entregue.
      RECUSA_DE_NEGOCIO(r3, "22023", "g C3 reemitir");
      const e = await estadoDoPedido(cliente, x.pedido);
      assert.equal(e.status, "cancelled");
      assert.ok(e.estornado <= e.total);
    }
    const controle = await criarControle(cliente, RPC.reemitir);
    try {
      const x = await fxDevolucaoEmProcessamento(cliente);
      const c = await ciclo(url, cliente, x, controle.nome);
      assert.equal(c.parou2, true, "g CONTROLE: C2 parou");
      assert.equal(c.parou3, true, "g CONTROLE: C3 parou");
      assert.ok(
        codigosDe(c.r1, c.r2, c.r3).includes("40P01"),
        `g CONTROLE: o ciclo de três devia dar 40P01 (${JSON.stringify(c)})`,
      );
      console.log(
        `    [g ciclo] CONTROLE: ${codigosDe(c.r1, c.r2, c.r3).join(",")}`,
      );
    } finally {
      await controle.apagar();
    }
  },
});

/** O rollback-manual da migration `prefixo` (ex.: "20261198000000"). */
PROVAS.push({
  nome: "(i) REF externo (96) × cancelar (98), nas duas direções: B para na linha do sistema, sem 40P01; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    await parNumaDirecao(cliente, url, {
      rotulo: "i1 REF externo segura a linha do sistema, cancelar espera",
      A: RPC.externo,
      B: RPC.cancelar,
      fixture: fxExternoComReserva,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "i1 REF externo");
        OK(rb, "i1 cancelar");
        assert.equal(ra.r.resultado, "inserido");
        assert.equal(rb.r.cancelado, true);
        assert.equal(estado.status, "cancelled");
        assert.equal(estado.estornado, 30, "i1: o refund do painel entrou uma vez");
        // O cancelamento esperou o REF: viu 30 já estornado e 40 reservado,
        // e abriu só o remanescente (30). Compromisso total = 100.
        assert.deepEqual(
          estado.linhas
            .map(([v, s, por]) => `${v} ${s} ${por}`)
            .sort(),
          [
            "30 concluido sistema",
            "30 solicitado lojista",
            "40 em_processamento sistema",
          ],
        );
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "i2 cancelar segura as linhas, REF externo espera",
      A: RPC.cancelar,
      B: RPC.externo,
      fixture: fxExternoComReserva,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "i2 cancelar");
        OK(rb, "i2 REF externo");
        assert.equal(ra.r.cancelado, true);
        assert.equal(estado.status, "cancelled");
        // O REF externo esperou o cancelamento e entrou inteiro: a 96 decide
        // pelo dinheiro REAL (estornado + reserva do sistema) e não conta a
        // linha do app ainda sem POST (o remanescente de 60) — quem segura
        // esse POST é a autorizar_post_do_estorno. A trava só garante que
        // ninguém decidiu sobre retrato velho; a regra do saldo é da 96.
        assert.equal(rb.r.resultado, "inserido");
        assert.equal(estado.estornado, 30, "i2: o refund do painel entrou uma vez");
        console.log(`    [i2] linhas: ${JSON.stringify(estado.linhas)}`);
      },
    });
  },
});

PROVAS.push({
  nome: "(j) REF externo (96) × concluir_estorno (89) do MESMO refund, nas duas direções: B para na linha, concluído uma vez, sem 40P01; CONTROLE 40P01",
  corpo: async (cliente, url) => {
    await parNumaDirecao(cliente, url, {
      rotulo: "j1 concluir segura a linha do refund, REF externo espera",
      A: RPC.concluir,
      B: RPC.externo,
      fixture: fxRefundDaLinha,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "j1 concluir");
        OK(rb, "j1 REF externo");
        assert.equal(rb.r.resultado, "ja_registrado", "j1: um refund credita UMA linha");
        assert.equal(estado.estornado, 30, "j1: concluído uma vez (30)");
        assert.deepEqual(estado.linhas, [[30, "concluido", "lojista"]]);
      },
    });
    await parNumaDirecao(cliente, url, {
      rotulo: "j2 REF externo segura a linha do refund, concluir espera",
      A: RPC.externo,
      B: RPC.concluir,
      fixture: fxRefundDaLinha,
      conferir: ({ ra, rb, estado }) => {
        OK(ra, "j2 REF externo");
        OK(rb, "j2 concluir");
        assert.equal(ra.r.resultado, "ja_registrado", "j2: um refund credita UMA linha");
        assert.equal(estado.estornado, 30, "j2: concluído uma vez (30)");
        assert.deepEqual(estado.linhas, [[30, "concluido", "lojista"]]);
      },
    });
  },
});

function rollbackDe(prefixo) {
  const nome = fs
    .readdirSync(PASTA)
    .find((n) => n.startsWith(`rollback-manual-${prefixo}_`));
  assert.ok(nome, `rollback-manual da ${prefixo} ausente`);
  return fs.readFileSync(path.join(PASTA, nome), "utf8");
}

PROVAS.push({
  nome: "(h) ordem dos rollbacks na pilha viva: da última até a 96 (201 → 200 → 99 → 98 → 97 → 96) passa inteira; a 97 ANTES da 98 recusa (B1_BASELINE_DIVERGENT, o reemitir é o da 98) sem gravar nada — tudo desfeito no ROLLBACK",
  corpo: async (cliente) => {
    const vivo = (assinatura) =>
      cliente
        .query("SELECT to_regprocedure($1) IS NOT NULL AS sim", [assinatura])
        .then((r) => r.rows[0].sim);
    const FN_96 =
      "public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)";
    const FN_97 = "public.is_admin_atual()";
    const FN_98 = RPC.cancelar.assinatura;
    await cliente.query("BEGIN");
    try {
      // Fora de ordem: a 97 por baixo da 98.
      await cliente.query("SAVEPOINT fora_de_ordem");
      await assert.rejects(
        cliente.query(rollbackDe("20261197000000")),
        /B1_BASELINE_DIVERGENT[\s\S]*admin_devolucao_reemitir_reembolso/,
      );
      await cliente.query("ROLLBACK TO SAVEPOINT fora_de_ordem");
      assert.equal(await vivo(FN_97), true, "a recusa não apagou a 97");
      assert.equal(await vivo(FN_98), true, "a recusa não apagou a 98");

      // Na ordem inversa da aplicação: TODA migration da 96 em diante (a
      // pilha que vier depois entra sozinha — hoje 201, 200, 99, 98, 97, 96),
      // cada uma pelo seu rollback-manual, e cada uma passa. Migration sem
      // rollback nessa faixa FALHA aqui, não é pulada.
      const pilha = MIGRATIONS.map((n) => n.slice(0, 14))
        .filter((p) => p >= "20261196000000")
        .reverse();
      for (const obrigatoria of [
        "20261196000000",
        "20261197000000",
        "20261198000000",
        "20261199000000",
      ]) {
        assert.ok(pilha.includes(obrigatoria), `a pilha tem a ${obrigatoria}`);
      }
      console.log(`    [h] rollbacks na ordem: ${pilha.join(" -> ")}`);
      for (const prefixo of pilha) {
        await cliente.query(rollbackDe(prefixo));
      }
      assert.equal(await vivo(FN_98), false, "a 98 saiu");
      assert.equal(await vivo(FN_97), false, "a 97 saiu");
      assert.equal(await vivo(FN_96), false, "a 96 saiu");
    } finally {
      await cliente.query("ROLLBACK");
    }
    assert.equal(await vivo(FN_98), true, "o ROLLBACK devolveu a 98");
    assert.equal(await vivo(FN_96), true, "o ROLLBACK devolveu a 96");
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
          "Prova viva da ordem das travas composta (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra da ordem global das travas foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[ordem-das-travas] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva da ordem das travas composta (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
