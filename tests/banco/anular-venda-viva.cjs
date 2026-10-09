"use strict";

/**
 * PROVA VIVA da migration 20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql
 * (dinheiro + estoque + permissão, decisão do dono de 08/10/2026: a venda do
 * balcão se anula SÓ no mesmo dia e com motivo obrigatório) contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero.
 *
 *   (0) fixtures: admin atual, rebaixados (só profiles, só auth.users, ambos),
 *       admin só do painel, cliente; produto simples e produto com variação.
 *   (1) ACL e catálogo: SECURITY DEFINER, search_path=public, EXECUTE só para
 *       authenticated (PUBLIC/anon/service_role não), anon recusado.
 *   (2) CAMINHO FELIZ com venda REAL (registrar_venda_presencial): estoque
 *       (produto simples e variação; o pai da variação não mexe) volta uma vez,
 *       status/payment_status, os DOIS históricos com motivo e quem anulou,
 *       Financeiro (entrada + saída de mesmo valor = 0), caixa (`esperado`
 *       igual ao de antes da venda), nenhuma linha em order_refunds, alerta de
 *       dinheiro em cancelado NÃO acende, aviso ao cliente cadastrado.
 *   (3) PERMISSÃO — o controle que justifica a reescrita: o funcionário
 *       rebaixado (JWT ainda diz admin) só no profiles, só no auth.users e nos
 *       dois, e o admin só do painel, são RECUSADOS (42501) sem escrever nada;
 *       cliente e anon também; service_role não tem EXECUTE.
 *   (4) ESCOPO: canal 'online' (delivered + recebido_na_entrega + cash) e
 *       payment_method NULL são recusados; estado errado; cobrança no gateway;
 *       valor_estornado; estorno já carimbado.
 *   (5) MESMO DIA: as duas bordas da virada do dia da loja (1 s antes recusa,
 *       na virada aceita; 1 s antes da virada seguinte aceita, na virada
 *       recusa), sessão em UTC / America/Sao_Paulo / Pacific/Kiritimati igual,
 *       e "desfazer e refazer o recebido" (que re-carimba a data) recusa.
 *   (6) DEVOLUÇÃO / ESTORNO DO APP: devolução solicitada/aprovada/recebida/
 *       concluída recusa; cancelada/recusada/reprovada aceita; order_refunds
 *       solicitado/em processamento/concluído recusa; recusado/falhou aceita.
 *   (7) MOTIVO: vazio, NULL, só espaço/tab/quebra de linha/NBSP e 501
 *       caracteres -> 22023 sem escrever; 500 caracteres passa; o motivo grava
 *       aparado e intacto (inclusive com a letra 'v' nas pontas).
 *   (8) IDEMPOTÊNCIA: segundo toque -> ja_anulada=true sem escrever (estoque
 *       uma vez, 1 linha em cada histórico, 1 saída no Financeiro), inclusive
 *       depois da virada do dia; reenviar a mesma venda (mesma chave) devolve o
 *       pedido cancelado com ja_existia=true.
 *   (9) TOTAL R$0: anula, devolve o estoque e NÃO cria linha de estorno.
 *  (10) CONCORRÊNCIA com conexões reais e COMMIT: duas anulações simultâneas
 *       (a 2ª comprovadamente parada na trava) sobem o estoque UMA vez; trava
 *       do pedido por outra conexão -> 55P03 com lock_timeout; ORDEM DAS
 *       TRAVAS (a linha de order_refunds ANTES do pedido).
 *  (11) MIGRATION: reaplicar é idempotente; pré-voo recusa SEM gravar com o
 *       NOME do que falta; rollback derruba só a função, vendas anuladas
 *       continuam como fatos, aplicar -> desfazer -> aplicar volta ao estado
 *       idêntico; rollback recusa corpo de outra migration e é idempotente.
 *  (12) MUTANTES: cada guarda tirada (ou trocada) deixa a prova certa VERMELHA.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/anular-venda-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome fixo
 * (constantes abaixo), nunca entrada de rede nem de terceiro. */

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
const NOME = "20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql";
const SQL_MIGRATION = fs.readFileSync(path.join(PASTA, NOME), "utf8");
const SQL_ROLLBACK = fs.readFileSync(
  path.join(PASTA, `rollback-manual-${NOME}`),
  "utf8",
);

const FN = "public.anular_venda_presencial(uuid, text)";
const MSG_NEGADO = "Acesso negado: só a loja anula venda do balcão.";

// O bloco CREATE OR REPLACE da função, tal como está na migration (os
// mutantes trocam um pedaço dele e o recriam no banco).
const INI_FN = SQL_MIGRATION.indexOf(
  "CREATE OR REPLACE FUNCTION public.anular_venda_presencial",
);
const FIM_FN = SQL_MIGRATION.indexOf("$function$;", INI_FN) + "$function$;".length;
const SQL_FUNCAO = SQL_MIGRATION.slice(INI_FN, FIM_FN);
assert.ok(INI_FN > 0 && FIM_FN > INI_FN, "bloco da função não achado");

const U_ADMIN = "b4000000-0000-4000-8000-000000000001";
const U_REB_PERFIL = "b4000000-0000-4000-8000-000000000002";
const U_REB_AUTH = "b4000000-0000-4000-8000-000000000003";
const U_CLIENTE = "b4000000-0000-4000-8000-000000000004";
const U_REB_AMBOS = "b4000000-0000-4000-8000-000000000005";
const U_SO_AUTH = "b4000000-0000-4000-8000-000000000006";
const P_SIMPLES = "b4aaaaaa-0000-4000-8000-000000000001";
const P_VARIACAO = "b4aaaaaa-0000-4000-8000-000000000002";
const V_VARIACAO = "b4bbbbbb-0000-4000-8000-000000000001";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  cliente: {
    papel: "authenticated",
    uid: U_CLIENTE,
    jwt: claims(U_CLIENTE, null),
  },
  rebPerfil: {
    papel: "authenticated",
    uid: U_REB_PERFIL,
    jwt: claims(U_REB_PERFIL, "admin"),
  },
  rebAuth: {
    papel: "authenticated",
    uid: U_REB_AUTH,
    jwt: claims(U_REB_AUTH, "admin"),
  },
  rebAmbos: {
    papel: "authenticated",
    uid: U_REB_AMBOS,
    jwt: claims(U_REB_AMBOS, "admin"),
  },
  soAuth: {
    papel: "authenticated",
    uid: U_SO_AUTH,
    jwt: claims(U_SO_AUTH, "admin"),
  },
  admin: {
    papel: "authenticated",
    uid: U_ADMIN,
    jwt: claims(U_ADMIN, "admin"),
  },
  service: { papel: "service_role", uid: "", jwt: "" },
};

// ---------------------------------------------------------------- utilitários

/** Roda `sql` COMO `quem` dentro da transação aberta; um erro não aborta a transação. */
async function como(c, quem, sql, params = []) {
  const q = QUEM[quem];
  await c.query("SAVEPOINT sp_como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_como");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** Uma transação que SEMPRE desfaz (ou commita, se pedido), com fuso fixo. */
async function emTx(c, corpo, { commit = false, tz = "America/Sao_Paulo" } = {}) {
  await c.query("BEGIN");
  try {
    await c.query(`SET LOCAL TIME ZONE '${tz}'`);
    const r = await corpo();
    await c.query(commit ? "COMMIT" : "ROLLBACK");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

const anular = (c, quem, id, motivo = "forma de pagamento errada") =>
  como(c, quem, "SELECT public.anular_venda_presencial($1, $2) AS r", [
    id,
    motivo,
  ]);

async function estoque(c) {
  return (
    await c.query(
      `SELECT (SELECT estoque FROM public.produtos WHERE id = $1)::int AS simples,
              (SELECT estoque FROM public.produtos WHERE id = $2)::int AS pai,
              (SELECT stock_increment FROM public.product_variants WHERE id = $3)::int AS variante`,
      [P_SIMPLES, P_VARIACAO, V_VARIACAO],
    )
  ).rows[0];
}

/** Impressão digital de TUDO que a anulação pode escrever. */
async function foto(c, id) {
  return (
    await c.query(
      `SELECT md5(concat_ws('|',
         (SELECT o::text FROM public.marketplace_orders o WHERE o.id = $1),
         (SELECT COALESCE(string_agg(h::text, ';' ORDER BY h.id), '') FROM public.marketplace_order_history h WHERE h.order_id = $1),
         (SELECT COALESCE(string_agg(h::text, ';' ORDER BY h.id), '') FROM public.marketplace_order_payment_history h WHERE h.order_id = $1),
         (SELECT COALESCE(string_agg(r::text, ';' ORDER BY r.id), '') FROM public.order_refunds r WHERE r.order_id = $1),
         (SELECT string_agg(p::text, ';' ORDER BY p.id) FROM public.produtos p WHERE p.id IN ($2, $3)),
         (SELECT v::text FROM public.product_variants v WHERE v.id = $4))) AS h`,
      [id, P_SIMPLES, P_VARIACAO, V_VARIACAO],
    )
  ).rows[0].h;
}

const contar = async (c, tabela, id) =>
  Number(
    (
      await c.query(
        `SELECT count(*) AS n FROM public.${tabela} WHERE order_id = $1`,
        [id],
      )
    ).rows[0].n,
  );

const pedido = async (c, id) =>
  (
    await c.query("SELECT * FROM public.marketplace_orders WHERE id = $1", [id])
  ).rows[0];

/** Venda REAL do balcão, pelo caminho de produção (admin atual). */
async function vender(c, o = {}) {
  const itens = o.itens || [
    { product_id: P_SIMPLES, variant_id: null, quantity: 2 },
  ];
  const r = await como(
    c,
    "admin",
    `SELECT public.registrar_venda_presencial($1::jsonb, $2, $3::uuid, NULL, NULL, $4::numeric, $5, $6::uuid) AS r`,
    [
      JSON.stringify(itens),
      o.pagamento || "cash",
      o.cliente || null,
      o.desconto || 0,
      o.obs || null,
      o.chave || null,
    ],
  );
  assert.ok(r.ok, `registrar_venda_presencial falhou: ${r.message}`);
  return r.rows[0].r.order.id;
}

/** Pedido montado direto (estados que a venda real não produz). */
async function pedidoDireto(c, o = {}) {
  const id = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, pagamento_recebido_em, pagamento_recebido_por,
        gateway_payment_id, metodo_online, valor_estornado, estorno_manual_registrado_em)
     VALUES ($1, NULL, 'Venda direta', '{}'::jsonb, 30, 30, $2, $3, $4, $5,
             ${o.recebidoEm || "now()"}, $6, $7, $8, $9, $10)`,
    [
      id,
      o.status === undefined ? "delivered" : o.status,
      o.canal === undefined ? "presencial" : o.canal,
      o.metodo === undefined ? "cash" : o.metodo,
      o.pagamento === undefined ? "recebido_na_entrega" : o.pagamento,
      U_ADMIN,
      o.gateway || null,
      o.metodoOnline || null,
      o.valorEstornado || 0,
      o.estornoEm || null,
    ],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Item direto', 2, 15)`,
    [id, P_SIMPLES],
  );
  return id;
}

async function financeiro(c, id) {
  const r = await c.query(
    `SELECT origem, tipo, valor::numeric AS valor, data::text AS data
       FROM public.fin__movimentos(NULL, NULL) WHERE pedido_id = $1 ORDER BY origem`,
    [id],
  );
  const liquido = r.rows.reduce(
    (s, l) => s + (l.tipo === "entrada" ? 1 : -1) * Number(l.valor),
    0,
  );
  return { linhas: r.rows, liquido };
}

/** Quebra de dia da loja: o instante em que `fin__hoje()` começou. */
async function inicioDoDia(c) {
  return (
    await c.query(
      `SELECT ((public.fin__hoje())::timestamp AT TIME ZONE 'America/Sao_Paulo') AS t`,
    )
  ).rows[0].t;
}

async function sqlRecebidoEm(c, deslocamento) {
  // devolve uma expressão SQL (constante) do instante: início do dia + deslocamento
  const t = await inicioDoDia(c);
  return `('${t.toISOString()}'::timestamptz ${deslocamento})`;
}

async function novoCliente() {
  const url = lerDatabaseUrlEfemera();
  const cl = new Client({ connectionString: url });
  await cl.connect();
  return cl;
}

async function esperarEspera(monitor, pid, ms = 15000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const r = await monitor.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`a conexão ${pid} não ficou parada numa trava (Lock)`);
}

// ---------------------------------------------------------------- as provas

const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

prova("(0) fixtures", async (c) => {
  await c.query(
    "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
  );
  await c.query(
    "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
  );
  for (const id of [
    U_ADMIN,
    U_REB_PERFIL,
    U_REB_AUTH,
    U_CLIENTE,
    U_REB_AMBOS,
    U_SO_AUTH,
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@anular.teste', '{}'::jsonb)`,
      [id],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin Anular', 'admin'), ($2, 'Reb Perfil', 'admin'),
       ($3, 'Reb Auth', 'admin'), ($4, 'Cliente Anular', 'customer'),
       ($5, 'Reb Ambos', 'admin')`,
    [U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_CLIENTE, U_REB_AMBOS],
  );
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
    [U_SO_AUTH],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES
       ($1, 'Produto simples anular', 15, 100, true, 5),
       ($2, 'Produto com variacao anular', 20, 50, true, 5)`,
    [P_SIMPLES, P_VARIACAO],
  );
  await c.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
     VALUES ($1, $2, 'Tamanho', 'M', 10, true)`,
    [V_VARIACAO, P_VARIACAO],
  );
  // Rebaixamento pelo app (um admin muda o papel; o gatilho de sincronia leva a auth.users).
  await c.query("BEGIN");
  await c.query(
    "SELECT set_config('request.jwt.claims', $1, true), set_config('app.rpc.user_id', $2, true)",
    [claims(U_ADMIN, "admin"), U_ADMIN],
  );
  await c.query(
    "UPDATE public.profiles SET role = 'customer' WHERE id = ANY($1::uuid[])",
    [[U_REB_AMBOS, U_REB_PERFIL]],
  );
  await c.query("COMMIT");
  // Só profiles rebaixado: auth.users volta a dizer admin.
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
    [U_REB_PERFIL],
  );
  // Só auth.users rebaixado (painel do Supabase): profiles continua admin.
  await c.query(
    `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
    [U_REB_AUTH],
  );
  const r = await c.query(
    `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS a, p.role AS p
       FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.id::text LIKE 'b4000000-%' ORDER BY u.id`,
  );
  assert.deepEqual(
    r.rows.map((l) => [l.id, l.a, l.p]),
    [
      [U_ADMIN, "admin", "admin"],
      [U_REB_PERFIL, "admin", "customer"],
      [U_REB_AUTH, "customer", "admin"],
      [U_CLIENTE, "customer", "customer"],
      [U_REB_AMBOS, "customer", "customer"],
      [U_SO_AUTH, "admin", null],
    ],
  );
});

prova("(1) catálogo e ACL", async (c) => {
  const r = await c.query(
    `SELECT prosecdef, proconfig::text AS config, prorettype::regtype::text AS ret,
            pg_get_function_identity_arguments(oid) AS args,
            EXISTS (SELECT 1 FROM aclexplode(coalesce(proacl, acldefault('f', proowner))) a
                     WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico,
            has_function_privilege('anon', oid, 'EXECUTE') AS anon,
            has_function_privilege('authenticated', oid, 'EXECUTE') AS auth,
            has_function_privilege('service_role', oid, 'EXECUTE') AS service
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [FN],
  );
  assert.equal(r.rowCount, 1, "a função não existe");
  const f = r.rows[0];
  assert.equal(f.prosecdef, true);
  assert.equal(f.config, "{search_path=public}");
  assert.equal(f.ret, "jsonb");
  assert.equal(f.args, "p_order_id uuid, p_motivo text");
  assert.equal(f.publico, false, "PUBLIC com EXECUTE");
  assert.equal(f.anon, false, "anon com EXECUTE");
  assert.equal(f.auth, true, "authenticated sem EXECUTE");
  assert.equal(f.service, false, "service_role com EXECUTE");
  await emTx(c, async () => {
    const id = await vender(c);
    const a = await anular(c, "anon", id);
    assert.equal(a.ok, false);
    assert.equal(a.code, "42501");
    const s = await anular(c, "service", id);
    assert.equal(s.ok, false);
    assert.equal(s.code, "42501");
    assert.match(s.message, /permission denied/);
  });
});

async function caminhoFeliz(c) {
  await emTx(c, async () => {
    // Caixa aberto ANTES da venda: o `esperado` tem de voltar ao de antes.
    const ab = await como(c, "admin", "SELECT public.fin_caixa_abrir(50) AS r");
    assert.ok(ab.ok, `fin_caixa_abrir: ${ab.message}`);
    const sessao = (
      await c.query(
        "SELECT id FROM public.fin_caixa_sessoes WHERE status = 'aberto' ORDER BY aberto_em DESC LIMIT 1",
      )
    ).rows[0].id;
    const esperado = async () =>
      Number(
        (await c.query("SELECT public.fin__caixa_calculo($1) AS r", [sessao]))
          .rows[0].r.esperado,
      );
    const esperado0 = await esperado();
    const est0 = await estoque(c);
    const id = await vender(c, {
      cliente: U_CLIENTE,
      itens: [
        { product_id: P_SIMPLES, variant_id: null, quantity: 2 },
        { product_id: P_VARIACAO, variant_id: V_VARIACAO, quantity: 3 },
      ],
    });
    const ped0 = await pedido(c, id);
    assert.equal(Number(ped0.total), 2 * 15 + 3 * 20);
    const est1 = await estoque(c);
    assert.deepEqual(
      est1,
      { simples: est0.simples - 2, pai: est0.pai, variante: est0.variante - 3 },
      "a venda baixa produto simples e variação (pai intacto)",
    );
    assert.equal(await esperado(), esperado0 + 90, "caixa conta a venda");
    const fin1 = await financeiro(c, id);
    assert.equal(fin1.liquido, 90);

    const a = await anular(c, "admin", id, "cliente desistiu na hora");
    assert.ok(a.ok, `anular falhou: ${a.message}`);
    assert.deepEqual(a.rows[0].r, {
      order_id: id,
      ja_anulada: false,
      status: "cancelled",
      payment_status: "estornado",
    });

    // Estoque: volta a quantidade, uma vez; o pai da variação não mexe.
    assert.deepEqual(await estoque(c), est0);
    const ped = await pedido(c, id);
    assert.equal(ped.status, "cancelled");
    assert.equal(ped.payment_status, "estornado");
    assert.ok(ped.stock_returned_at, "stock_returned_at carimbado");
    assert.ok(ped.estorno_manual_registrado_em, "carimbo do estorno");
    assert.equal(
      String(ped.pagamento_recebido_em),
      String(ped0.pagamento_recebido_em),
      "pagamento_recebido_em NÃO é apagado",
    );
    assert.equal(Number(ped.total), 90, "total intacto");
    assert.equal(Number(ped.valor_estornado || 0), 0, "valor_estornado intacto");

    // Os dois históricos, com motivo e quem anulou.
    const h = (
      await c.query(
        "SELECT old_status, new_status, notes, created_by::text AS por FROM public.marketplace_order_history WHERE order_id = $1",
        [id],
      )
    ).rows;
    assert.equal(h.length, 2, "nascimento + anulação");
    assert.deepEqual(h.find((l) => l.new_status === "cancelled"), {
      old_status: "delivered",
      new_status: "cancelled",
      notes: "Venda do balcão anulada: cliente desistiu na hora",
      por: U_ADMIN,
    });
    const hp = (
      await c.query(
        "SELECT acao, payment_status_antes, payment_status_depois, created_by::text AS por FROM public.marketplace_order_payment_history WHERE order_id = $1",
        [id],
      )
    ).rows;
    assert.equal(hp.length, 2);
    assert.deepEqual(hp.find((l) => l.acao === "desfeito"), {
      acao: "desfeito",
      payment_status_antes: "recebido_na_entrega",
      payment_status_depois: "estornado",
      por: U_ADMIN,
    });

    // Financeiro: entrada da venda + saída do estorno, mesmo valor, mesmo dia.
    const fin = await financeiro(c, id);
    assert.equal(fin.liquido, 0, "entradas − saídas do pedido = 0");
    assert.deepEqual(
      fin.linhas.map((l) => [l.origem, l.tipo, Number(l.valor)]),
      [
        ["estorno_externo", "saida", 90],
        ["venda_balcao", "entrada", 90],
      ],
    );
    assert.equal(fin.linhas[0].data, fin.linhas[1].data, "mesmo dia no extrato");
    // Caixa: o esperado volta ao de antes da venda.
    assert.equal(await esperado(), esperado0, "caixa fecha como antes da venda");
    // Nada no ledger de estornos do app; o alerta de dinheiro em cancelado não acende.
    assert.equal(await contar(c, "order_refunds", id), 0);
    const paga = (
      await c.query(
        `SELECT count(*)::int AS n FROM public.marketplace_orders
          WHERE id = $1 AND payment_status IN ('pago','pago_apos_expirar','recebido_na_entrega') AND status = 'cancelled'`,
        [id],
      )
    ).rows[0].n;
    assert.equal(paga, 0, "paid_on_cancelled inalterado");
    // Aviso ao cliente cadastrado (gatilho de sempre).
    const av = await c.query(
      "SELECT titulo FROM public.notificacoes WHERE dados ->> 'order_id' = $1 AND usuario_id = $2 ORDER BY created_at",
      [id, U_CLIENTE],
    );
    assert.ok(av.rows.some((l) => l.titulo === "Pedido cancelado"));
  });
}
prova("(2) caminho feliz: venda real anulada (estoque, histórico, Financeiro, caixa)", caminhoFeliz);

prova("(2b) PIX e maquininha anulam e fecham em zero no Financeiro", async (c) => {
  for (const forma of ["pix", "card"]) {
    await emTx(c, async () => {
      const id = await vender(c, { pagamento: forma });
      const a = await anular(c, "admin", id);
      assert.ok(a.ok, `${forma}: ${a.message}`);
      assert.equal((await financeiro(c, id)).liquido, 0, forma);
    });
  }
});

async function permissao(c) {
  for (const quem of ["rebPerfil", "rebAuth", "rebAmbos", "soAuth"]) {
    await emTx(c, async () => {
      const id = await vender(c);
      const antes = await foto(c, id);
      const a = await anular(c, quem, id);
      assert.equal(a.ok, false, `${quem} anulou a venda`);
      assert.equal(a.code, "42501", `${quem}: ${a.message}`);
      assert.equal(a.message, MSG_NEGADO, quem);
      assert.equal(await foto(c, id), antes, `${quem} escreveu algo`);
    });
  }
  await emTx(c, async () => {
    const id = await vender(c);
    const antes = await foto(c, id);
    for (const quem of ["cliente", "anon", "service"]) {
      const a = await anular(c, quem, id);
      assert.equal(a.ok, false, `${quem} anulou`);
      assert.equal(a.code, "42501", `${quem}: ${a.message}`);
    }
    assert.equal(await foto(c, id), antes);
  });
}
prova("(3) permissão: rebaixados (JWT ainda admin), cliente, anon e service_role recusados sem escrever", permissao);

async function escopo(c) {
  await emTx(c, async () => {
    const online = await pedidoDireto(c, { canal: "online" });
    const antes = await foto(c, online);
    const a = await anular(c, "admin", online);
    assert.equal(a.ok, false, "pedido do site entregue em dinheiro foi anulado");
    assert.equal(a.code, "22023");
    assert.equal(a.message, "Só venda do balcão se anula aqui.");
    assert.equal(await foto(c, online), antes);
  });
  const recusas = [
    ["metodo NULL", { metodo: null }],
    ["metodo online", { metodo: "online" }],
    ["metodo inventado", { metodo: "fiado" }],
    ["status pending", { status: "pending" }],
    ["status shipping", { status: "shipping" }],
    ["pagamento NULL", { pagamento: null }],
    ["pagamento pago", { pagamento: "pago" }],
    ["pagamento aguardando", { pagamento: "aguardando" }],
    ["pagamento nunca recebido", { recebidoEm: "NULL" }],
    ["cobrança no gateway", { gateway: "123456" }],
    ["metodo_online", { metodoOnline: "pix" }],
    ["valor_estornado", { valorEstornado: 5 }],
    ["estorno já carimbado", { estornoEm: new Date().toISOString() }],
    ["cancelada sem acertar o dinheiro", { status: "cancelled" }],
  ];
  for (const [rotulo, o] of recusas) {
    await emTx(c, async () => {
      const id = await pedidoDireto(c, o);
      const antes = await foto(c, id);
      const a = await anular(c, "admin", id);
      assert.equal(a.ok, false, `${rotulo}: foi anulada`);
      assert.equal(a.code, "22023", `${rotulo}: ${a.message}`);
      assert.equal(a.message, "Esta venda não pode ser anulada aqui.", rotulo);
      assert.equal(await foto(c, id), antes, `${rotulo}: escreveu algo`);
    });
  }
  await emTx(c, async () => {
    const a = await anular(c, "admin", crypto.randomUUID());
    assert.equal(a.ok, false);
    assert.equal(a.message, "Venda não encontrada.");
    const n = await anular(c, "admin", null);
    assert.equal(n.ok, false);
    assert.equal(n.message, "Venda não encontrada.");
  });
}
prova("(4) escopo: só canal presencial, só delivered+recebido, método válido, sem gateway/estorno", escopo);

async function mesmoDia(c) {
  const casos = [
    ["1 s antes da virada do dia", "- interval '1 second'", false],
    ["na virada do dia", "+ interval '0 seconds'", true],
    ["1 s depois da virada", "+ interval '1 second'", true],
    ["1 s antes da virada seguinte", "+ interval '1 day' - interval '1 second'", true],
    ["na virada seguinte", "+ interval '1 day'", false],
    ["ontem ao meio-dia", "- interval '12 hours'", false],
    ["ontem 23:30 (mesma data em UTC)", "- interval '30 minutes'", false],
    ["hoje 00:30 (mesma data em UTC)", "+ interval '30 minutes'", true],
  ];
  for (const tz of ["America/Sao_Paulo", "UTC", "Pacific/Kiritimati"]) {
    for (const [rotulo, desl, aceita] of casos) {
      await emTx(
        c,
        async () => {
          const expr = await sqlRecebidoEm(c, desl);
          const id = await pedidoDireto(c, { recebidoEm: expr });
          const a = await anular(c, "admin", id);
          if (aceita) {
            assert.ok(a.ok, `[${tz}] ${rotulo} devia anular: ${a.message}`);
          } else {
            assert.equal(a.ok, false, `[${tz}] ${rotulo} devia recusar`);
            assert.equal(a.code, "22023");
            assert.match(a.message, /^Só dá para anular no mesmo dia da venda\./);
          }
        },
        { tz },
      );
    }
  }
  // "Desfazer e refazer o recebido" re-carimba pagamento_recebido_em: não é do dia.
  await emTx(c, async () => {
    const id = await vender(c);
    // a venda é "de segunda": recuada para ontem, depois refeita HOJE
    await c.query(
      "UPDATE public.marketplace_orders SET pagamento_recebido_em = now() - interval '2 days' WHERE id = $1",
      [id],
    );
    for (const v of [false, true]) {
      const r = await como(
        c,
        "admin",
        "SELECT public.registrar_pagamento_recebido($1, $2::boolean) AS r",
        [id, v],
      );
      assert.ok(r.ok, `registrar_pagamento_recebido(${v}): ${r.message}`);
    }
    const p = await pedido(c, id);
    assert.equal(p.payment_status, "recebido_na_entrega");
    const antes = await foto(c, id);
    const a = await anular(c, "admin", id);
    assert.equal(a.ok, false, "pagamento desfeito e refeito foi anulado");
    assert.match(a.message, /^Só dá para anular no mesmo dia da venda\./);
    assert.equal(await foto(c, id), antes);
  });
}
prova("(5) mesmo dia: bordas da virada, fusos de sessão, desfazer+refazer", mesmoDia);

prova("(6) devolução e estorno do app: quem cuida do dinheiro é o outro caminho", async (c) => {
  const devolucao = async (id, status) => {
    const item = (
      await c.query(
        "SELECT id FROM public.marketplace_order_items WHERE order_id = $1 LIMIT 1",
        [id],
      )
    ).rows[0].id;
    const d = crypto.randomUUID();
    await c.query(
      `INSERT INTO public.devolucoes
         (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
          metodo_retorno, status, valor_itens, prazo_ate, politica)
       VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'troca', 'local',
               'entrega_na_loja', $5, 30, current_date + 7, '{}'::jsonb)`,
      [d, `ANU-${d.slice(0, 8)}`, id, U_CLIENTE, status],
    );
    await c.query(
      `INSERT INTO public.devolucao_itens (devolucao_id, order_item_id, product_id, product_name, quantidade, valor_unitario)
       VALUES ($1, $2, $3, 'Item', 1, 15)`,
      [d, item, P_SIMPLES],
    );
  };
  for (const [status, aceita] of [
    ["solicitada", false],
    ["aprovada", false],
    ["em_transito", false],
    ["recebida", false],
    ["concluida", false],
    ["recusada", true],
    ["cancelada", true],
    ["reprovada", true],
  ]) {
    await emTx(c, async () => {
      const id = await vender(c);
      await devolucao(id, status);
      const antes = await foto(c, id);
      const a = await anular(c, "admin", id);
      if (aceita) assert.ok(a.ok, `devolução ${status}: ${a.message}`);
      else {
        assert.equal(a.ok, false, `devolução ${status} devia recusar`);
        assert.equal(
          a.message,
          "Esta venda tem devolução registrada; resolva pela devolução.",
        );
        assert.equal(await foto(c, id), antes);
      }
    });
  }
  for (const [status, aceita] of [
    ["solicitado", false],
    ["em_processamento", false],
    ["concluido", false],
    ["recusado", true],
    ["falhou", true],
  ]) {
    await emTx(c, async () => {
      const id = await vender(c);
      await c.query(
        `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
         VALUES ($1, 30, 'lojista', $2)`,
        [id, status],
      );
      const antes = await foto(c, id);
      const a = await anular(c, "admin", id);
      if (aceita) assert.ok(a.ok, `refund ${status}: ${a.message}`);
      else {
        assert.equal(a.ok, false, `refund ${status} devia recusar`);
        assert.match(a.message, /dinheiro devolvido pelo app/);
        assert.equal(await foto(c, id), antes);
      }
    });
  }
});

async function motivo(c) {
  const invalidos = [
    ["vazio", ""],
    ["NULL", null],
    ["só espaços", "     "],
    ["tab e quebras", "\t\n\r\n \t"],
    ["NBSP", String.fromCharCode(160).repeat(2)],
    ["501 caracteres", "x".repeat(501)],
  ];
  for (const [rotulo, m] of invalidos) {
    await emTx(c, async () => {
      const id = await vender(c);
      const antes = await foto(c, id);
      const a = await anular(c, "admin", id, m);
      assert.equal(a.ok, false, `${rotulo}: foi anulada`);
      assert.equal(a.code, "22023", `${rotulo}: ${a.message}`);
      assert.equal(await foto(c, id), antes, `${rotulo}: escreveu algo`);
    });
  }
  await emTx(c, async () => {
    const id = await vender(c);
    const a = await anular(c, "admin", id, "y".repeat(500));
    assert.ok(a.ok, `500 caracteres devia passar: ${a.message}`);
  });
  // Aparado e INTACTO: letras nas pontas (inclusive a 'v') não podem ser comidas pelo trim.
  await emTx(c, async () => {
    const id = await vender(c);
    const a = await anular(c, "admin", id, "  \tvendi errado v \n");
    assert.ok(a.ok, a.message);
    const nota = (
      await c.query(
        "SELECT notes FROM public.marketplace_order_history WHERE order_id = $1 AND new_status = 'cancelled'",
        [id],
      )
    ).rows[0].notes;
    assert.equal(nota, "Venda do balcão anulada: vendi errado v");
  });
  // Motivo vem ANTES da existência: pedido inexistente com motivo vazio -> motivo.
  await emTx(c, async () => {
    const a = await anular(c, "admin", crypto.randomUUID(), "");
    assert.equal(a.message, "Informe o motivo para anular a venda.");
  });
}
prova("(7) motivo obrigatório, aparado e intacto", motivo);

async function idempotencia(c) {
  await emTx(c, async () => {
    const est0 = await estoque(c);
    const chave = crypto.randomUUID();
    const id = await vender(c, { chave });
    const a1 = await anular(c, "admin", id, "primeira");
    assert.ok(a1.ok, a1.message);
    const aposPrimeira = await foto(c, id);
    const est1 = await estoque(c);
    assert.deepEqual(est1, est0);
    const a2 = await anular(c, "admin", id, "segunda");
    assert.ok(a2.ok, a2.message);
    assert.deepEqual(a2.rows[0].r, {
      order_id: id,
      ja_anulada: true,
      status: "cancelled",
      payment_status: "estornado",
    });
    assert.equal(await foto(c, id), aposPrimeira, "2º toque escreveu algo");
    assert.deepEqual(await estoque(c), est0, "estoque subiu duas vezes");
    assert.equal(await contar(c, "marketplace_order_history", id), 2);
    assert.equal(await contar(c, "marketplace_order_payment_history", id), 2);
    const fin = await financeiro(c, id);
    assert.equal(fin.linhas.filter((l) => l.tipo === "saida").length, 1);
    assert.equal(fin.liquido, 0);
    // Depois da virada do dia o 2º toque continua sem erro.
    await c.query(
      "UPDATE public.marketplace_orders SET pagamento_recebido_em = now() - interval '3 days' WHERE id = $1",
      [id],
    );
    const a3 = await anular(c, "admin", id, "terceira");
    assert.ok(a3.ok && a3.rows[0].r.ja_anulada === true, "3º toque, outro dia");
    // Os não-admin continuam recusados MESMO na venda já anulada (a porta vem primeiro).
    const r = await anular(c, "rebPerfil", id);
    assert.equal(r.code, "42501");
    // Reenviar a MESMA venda (mesma chave de idempotência) devolve o pedido cancelado.
    const again = await como(
      c,
      "admin",
      `SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL, NULL, NULL, 0, NULL, $2::uuid) AS r`,
      [
        JSON.stringify([{ product_id: P_SIMPLES, variant_id: null, quantity: 2 }]),
        chave,
      ],
    );
    assert.ok(again.ok, again.message);
    assert.equal(again.rows[0].r.ja_existia, true);
    assert.equal(again.rows[0].r.order.status, "cancelled");
    assert.deepEqual(await estoque(c), est0, "reenviar não baixa de novo");
  });
}
prova("(8) idempotência: 2º toque, depois da virada, reenvio da mesma venda", idempotencia);

prova("(9) total R$0: anula, devolve o estoque, não cria linha de estorno", async (c) => {
  await emTx(c, async () => {
    const est0 = await estoque(c);
    const id = await vender(c, {
      desconto: 30,
      obs: "cortesia da casa",
    });
    assert.equal(Number((await pedido(c, id)).total), 0);
    assert.equal((await estoque(c)).simples, est0.simples - 2);
    const a = await anular(c, "admin", id, "cortesia lançada por engano");
    assert.ok(a.ok, a.message);
    assert.deepEqual(await estoque(c), est0);
    const fin = await financeiro(c, id);
    assert.equal(fin.linhas.filter((l) => l.tipo === "saida").length, 0);
    assert.equal(fin.liquido, 0);
    assert.equal(await contar(c, "order_refunds", id), 0);
  });
});

// ------------------------------------------------------------- concorrência

/** Venda real COMMITADA (as provas de concorrência precisam enxergá-la de outra conexão). */
async function vendaCommitada(c, o = {}) {
  let id;
  await emTx(
    c,
    async () => {
      id = await vender(c, o);
      if (o.refundRecusado) {
        await c.query(
          `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
           VALUES ($1, 30, 'lojista', 'recusado')`,
          [id],
        );
      }
    },
    { commit: true },
  );
  return id;
}

async function comoNaConexao(cl, quem, sql, params = []) {
  const q = QUEM[quem];
  await cl.query(`SET LOCAL ROLE ${q.papel}`);
  await cl.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
  return cl.query(sql, params);
}

async function duasAnulacoes(c) {
  const id = await vendaCommitada(c);
  const est0 = await estoque(c);
  const A = await novoCliente();
  const B = await novoCliente();
  const M = await novoCliente();
  try {
    await A.query("BEGIN");
    const ra = await comoNaConexao(
      A,
      "admin",
      "SELECT public.anular_venda_presencial($1, 'duas ao mesmo tempo A') AS r",
      [id],
    );
    assert.equal(ra.rows[0].r.ja_anulada, false);
    await B.query("BEGIN");
    const pidB = (await B.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const pb = comoNaConexao(
      B,
      "admin",
      "SELECT public.anular_venda_presencial($1, 'duas ao mesmo tempo B') AS r",
      [id],
    ).then(
      (r) => ({ ok: true, r: r.rows[0].r }),
      (e) => ({ ok: false, e }),
    );
    await esperarEspera(M, pidB);
    await A.query("COMMIT");
    const resB = await pb;
    assert.ok(resB.ok, `B: ${resB.e?.message}`);
    assert.equal(resB.r.ja_anulada, true, "a 2ª simultânea vê a venda já anulada");
    await B.query("COMMIT");
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end();
    await B.end();
    await M.end();
  }
  // O estoque subiu UMA vez (a venda baixou 2; a anulação devolve 2).
  assert.equal(
    (await estoque(c)).simples,
    est0.simples + 2,
    "estoque devolvido exatamente uma vez",
  );
  assert.equal(await contar(c, "marketplace_order_history", id), 2);
  assert.equal(await contar(c, "marketplace_order_payment_history", id), 2);
  assert.equal((await financeiro(c, id)).linhas.filter((l) => l.tipo === "saida").length, 1);
}
prova("(10a) duas anulações simultâneas (2 conexões, COMMIT real): estoque uma vez só", duasAnulacoes);

async function travaDoPedido(c) {
  const id = await vendaCommitada(c);
  const antes = await foto(c, id);
  const A = await novoCliente();
  const B = await novoCliente();
  try {
    await A.query("BEGIN");
    await A.query("SELECT 1 FROM public.marketplace_orders WHERE id = $1 FOR UPDATE", [id]);
    await B.query("BEGIN");
    await B.query("SET LOCAL lock_timeout = '300ms'");
    let erro = null;
    try {
      await comoNaConexao(
        B,
        "admin",
        "SELECT public.anular_venda_presencial($1, 'com a trava de outra conexão') AS r",
        [id],
      );
    } catch (e) {
      erro = e;
    }
    assert.ok(erro, "a anulação passou por cima da trava do pedido");
    assert.equal(erro.code, "55P03", erro.message);
    await B.query("ROLLBACK");
    await A.query("ROLLBACK");
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end();
    await B.end();
  }
  assert.equal(await foto(c, id), antes, "a recusa por trava escreveu algo");
}
prova("(10b) pedido travado por outra conexão: 55P03 com lock_timeout, nada gravado", travaDoPedido);

async function ordemDasTravas(c) {
  const id = await vendaCommitada(c, { refundRecusado: true });
  const A = await novoCliente();
  const B = await novoCliente();
  const M = await novoCliente();
  try {
    // A faz o papel de concluir_estorno/registrar_estorno_manual: segura a
    // linha do ledger do pedido (a primeira trava da ordem global).
    await A.query("BEGIN");
    await A.query(
      "SELECT 1 FROM public.order_refunds WHERE order_id = $1 ORDER BY id FOR UPDATE",
      [id],
    );
    await B.query("BEGIN");
    const pidB = (await B.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    const pb = comoNaConexao(
      B,
      "admin",
      "SELECT public.anular_venda_presencial($1, 'ordem das travas') AS r",
      [id],
    ).then(
      (r) => ({ ok: true, r: r.rows[0].r }),
      (e) => ({ ok: false, e }),
    );
    await esperarEspera(M, pidB);
    // B espera pela linha do ledger. Se tivesse travado o PEDIDO antes, este
    // NOWAIT falharia (55P03): a ordem global é ledger -> pedido.
    let pedidoLivre = true;
    try {
      await A.query(
        "SELECT 1 FROM public.marketplace_orders WHERE id = $1 FOR UPDATE NOWAIT",
        [id],
      );
    } catch (e) {
      assert.equal(e.code, "55P03");
      pedidoLivre = false;
    }
    assert.ok(
      pedidoLivre,
      "a anulação travou o pedido ANTES da linha do ledger (ordem invertida: deadlock contra o estorno)",
    );
    await A.query("COMMIT");
    const resB = await pb;
    assert.ok(resB.ok, `B: ${resB.e?.message}`);
    await B.query("COMMIT");
  } finally {
    await A.query("ROLLBACK").catch(() => {});
    await B.query("ROLLBACK").catch(() => {});
    await A.end();
    await B.end();
    await M.end();
  }
}
prova("(10c) ordem global das travas: a linha de order_refunds ANTES do pedido", ordemDasTravas);

// ------------------------------------------------------------------ migration

async function impressao(c) {
  return (
    await c.query(
      `SELECT count(*)::int AS n,
              md5(string_agg(p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid))
                  || '|' || coalesce(p.proacl::text, '') || '|' || coalesce(obj_description(p.oid, 'pg_proc'), ''),
                  E'\\n' ORDER BY p.oid::regprocedure::text)) AS h
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> 'anular_venda_presencial'`,
    )
  ).rows[0];
}

async function defDaFuncao(c) {
  const r = await c.query(
    `SELECT pg_get_functiondef(oid) AS def, proacl::text AS acl,
            obj_description(oid, 'pg_proc') AS comentario, prosecdef, proconfig::text AS cfg
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [FN],
  );
  return r.rows[0] || null;
}

async function tentarSql(c, sql) {
  await c.query("SAVEPOINT sp_sql");
  try {
    await c.query(sql);
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: true };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_sql");
    await c.query("RELEASE SAVEPOINT sp_sql");
    return { ok: false, message: e.message };
  }
}

prova("(11a) reaplicar a migration é idempotente (mesma função, mesma ACL)", async (c) => {
  const antes = await defDaFuncao(c);
  assert.ok(antes);
  await emTx(c, async () => {
    await c.query(SQL_MIGRATION);
    await c.query(SQL_MIGRATION);
    assert.deepEqual(await defDaFuncao(c), antes);
  });
  assert.deepEqual(await defDaFuncao(c), antes);
});

prova("(11b) pré-voo recusa SEM gravar, com o nome do que falta", async (c) => {
  const quebras = [
    ["devolver_estoque", "ALTER FUNCTION public.devolver_estoque(uuid) RENAME TO devolver_estoque_x", /devolver_estoque/],
    ["fin__dia", "ALTER FUNCTION public.fin__dia(timestamptz) RENAME TO fin__dia_x", /fin__dia/],
    ["fin__hoje", "ALTER FUNCTION public.fin__hoje() RENAME TO fin__hoje_x", /fin__hoje/],
    ["is_admin_atual", "ALTER FUNCTION public.is_admin_atual() RENAME TO is_admin_atual_x", /is_admin_atual/],
    ["pedido__mudar_status", "ALTER FUNCTION public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean) RENAME TO pedido__mudar_status_x", /pedido__mudar_status/],
    ["tabela devolucoes", "ALTER TABLE public.devolucoes RENAME TO devolucoes_x", /public\.devolucoes/],
    ["tabela payment_history", "ALTER TABLE public.marketplace_order_payment_history RENAME TO mophx", /marketplace_order_payment_history/],
    ["coluna order_refunds.status", "ALTER TABLE public.order_refunds RENAME COLUMN status TO st", /order_refunds\.status/],
    ["coluna gateway_payment_id", "ALTER TABLE public.marketplace_orders RENAME COLUMN gateway_payment_id TO gpi", /gateway_payment_id/],
  ];
  for (const [rotulo, quebra, esperado] of quebras) {
    await emTx(c, async () => {
      await c.query(`DROP FUNCTION ${FN}`);
      await c.query(quebra);
      const r = await tentarSql(c, SQL_MIGRATION);
      assert.equal(r.ok, false, `${rotulo}: a migration passou`);
      assert.match(r.message, /PREFLIGHT_20261204/, rotulo);
      assert.match(r.message, esperado, rotulo);
      assert.equal(
        (await c.query("SELECT to_regprocedure($1) AS f", [FN])).rows[0].f,
        null,
        `${rotulo}: criou a função apesar do pré-voo`,
      );
    });
  }
  // Corpo vivo de is_admin_atual diferente do esperado.
  await emTx(c, async () => {
    await c.query(`DROP FUNCTION ${FN}`);
    await c.query(
      "CREATE OR REPLACE FUNCTION public.is_admin_atual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT true $$",
    );
    const r = await tentarSql(c, SQL_MIGRATION);
    assert.equal(r.ok, false);
    assert.match(r.message, /PREFLIGHT_20261204.*is_admin_atual/);
  });
  // Função com o mesmo nome e OUTRO corpo: não sobrescreve.
  await emTx(c, async () => {
    await c.query(
      `CREATE OR REPLACE FUNCTION ${FN.replace("(uuid, text)", "(p_order_id uuid, p_motivo text)")} RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
    );
    const r = await tentarSql(c, SQL_MIGRATION);
    assert.equal(r.ok, false);
    assert.match(r.message, /ja existe com outro corpo/);
  });
});

prova("(11c) rollback: derruba só a função, vendas anuladas continuam, aplicar -> desfazer -> aplicar volta idêntico", async (c) => {
  await emTx(c, async () => {
    const id = await vender(c);
    assert.ok((await anular(c, "admin", id)).ok);
    const pedidoAntes = await foto(c, id);
    const finAntes = await financeiro(c, id);
    const def0 = await defDaFuncao(c);
    const f0 = await impressao(c);

    await c.query(SQL_ROLLBACK);
    assert.equal(await defDaFuncao(c), null, "a função continua depois do rollback");
    assert.deepEqual(await impressao(c), f0, "o rollback mexeu em outra função");
    assert.equal(await foto(c, id), pedidoAntes, "a venda anulada mudou");
    assert.deepEqual(await financeiro(c, id), finAntes, "o Financeiro mudou");

    // Rollback repetido é idempotente.
    await c.query(SQL_ROLLBACK);
    assert.equal(await defDaFuncao(c), null);

    await c.query(SQL_MIGRATION);
    assert.deepEqual(await defDaFuncao(c), def0, "reaplicar não voltou ao estado idêntico");
    assert.deepEqual(await impressao(c), f0);

    // A ACL do estado anterior à migration: sem a função, nada a conferir; com ela, só authenticated.
    const acl = (await defDaFuncao(c)).acl;
    assert.ok(/authenticated=X/.test(acl) && !/anon=/.test(acl) && !/service_role=/.test(acl), acl);
  });
});

prova("(11d) rollback recusa corpo de OUTRA migration e não derruba", async (c) => {
  await emTx(c, async () => {
    await c.query(
      `CREATE OR REPLACE FUNCTION public.anular_venda_presencial(p_order_id uuid, p_motivo text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT '{"posterior":true}'::jsonb $$`,
    );
    const r = await tentarSql(c, SQL_ROLLBACK);
    assert.equal(r.ok, false);
    assert.match(r.message, /migration posterior/);
    assert.ok(await defDaFuncao(c), "derrubou o corpo de outra migration");
  });
});

// ------------------------------------------------------------------- mutantes

async function mutar(c, rotulo, buscar, trocar, proveCom) {
  assert.equal(
    SQL_FUNCAO.split(buscar).length - 1,
    1,
    `mutante "${rotulo}": o trecho a trocar tem de aparecer UMA vez na função`,
  );
  const mutada = SQL_FUNCAO.replace(buscar, () => trocar);
  assert.notEqual(mutada, SQL_FUNCAO);
  await c.query(mutada);
  let sobreviveu = false;
  let morreuCom = null;
  try {
    for (const p of proveCom) {
      try {
        await p(c);
      } catch (e) {
        if (e instanceof assert.AssertionError || e.code === "ERR_ASSERTION") {
          morreuCom = e.message.split("\n")[0].slice(0, 110);
          break;
        }
        throw e;
      }
    }
    if (morreuCom === null) sobreviveu = true;
  } finally {
    await c.query(SQL_FUNCAO); // restaura a função verdadeira
  }
  assert.equal(sobreviveu, false, `MUTANTE SOBREVIVEU: ${rotulo}`);
  console.log(`      mutante morto: ${rotulo}  <-  ${morreuCom}`);
}

const GUARDA_ATUAL = `    IF public.is_admin_atual() IS DISTINCT FROM true THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso negado: só a loja anula venda do balcão.';
    END IF;
`;

prova("(12) mutantes: tirar cada guarda deixa a prova certa vermelha", async (c) => {
  const antes = (await defDaFuncao(c)).def;
  await mutar(c, "sem a guarda is_admin_atual()", GUARDA_ATUAL, "", [permissao]);
  // A brecha de verdade: sem a guarda E o cancelamento recebendo "é admin".
  const semGuardaEPassaTrue = SQL_FUNCAO.replace(GUARDA_ATUAL, "").replace(
    "v_usuario, public.is_admin_atual(), false",
    "v_usuario, true, false",
  );
  assert.notEqual(semGuardaEPassaTrue, SQL_FUNCAO);
  await c.query(semGuardaEPassaTrue);
  try {
    let morreu = false;
    try {
      await permissao(c);
    } catch (e) {
      assert.ok(e.code === "ERR_ASSERTION", e.message);
      morreu = true;
    }
    // E, mais forte: o rebaixado REALMENTE consegue anular nesse mutante.
    await emTx(c, async () => {
      const id = await vender(c);
      const a = await anular(c, "rebPerfil", id);
      assert.ok(a.ok, "o controle sem a guarda devia anular (a brecha existe sem ela)");
    });
    assert.ok(morreu, "mutante sem guarda + true sobreviveu");
    console.log("      mutante morto: sem a guarda e com 'é admin' fixo (a brecha real: o rebaixado anula)");
  } finally {
    await c.query(SQL_FUNCAO);
  }

  await mutar(c, "sem a trava FOR UPDATE do pedido", `     WHERE o.id = p_order_id
       FOR UPDATE;`, `     WHERE o.id = p_order_id;`, [duasAnulacoes]);
  await mutar(c, "sem a trava das linhas de order_refunds (ordem pedido -> ledger)", `    PERFORM 1
       FROM public.order_refunds r
      WHERE r.order_id = p_order_id
      ORDER BY r.id
        FOR UPDATE;
`, "", [ordemDasTravas]);
  await mutar(c, "sem a checagem de canal", `IF v_pedido.canal IS DISTINCT FROM 'presencial' THEN`, "IF false THEN", [escopo]);
  await mutar(c, "payment_method NOT IN sem COALESCE (NULL passa)", `COALESCE(v_pedido.payment_method, '') NOT IN ('cash', 'pix', 'card')`, `v_pedido.payment_method NOT IN ('cash', 'pix', 'card')`, [escopo]);
  await mutar(c, "sem recusar cobrança no gateway", `       OR v_pedido.gateway_payment_id IS NOT NULL
`, "", [escopo]);
  await mutar(c, "sem recusar valor_estornado", `       OR COALESCE(v_pedido.valor_estornado, 0) <> 0
`, "", [escopo]);
  await mutar(c, "sem recusar estorno já carimbado", `       OR v_pedido.estorno_manual_registrado_em IS NOT NULL THEN`, `       OR false THEN`, [escopo]);
  await mutar(c, "sem a regra do mesmo dia", `IF public.fin__dia(v_pedido.pagamento_recebido_em) IS DISTINCT FROM public.fin__hoje()
       OR EXISTS (`, `IF false
       OR EXISTS (`, [mesmoDia]);
  await mutar(c, "dia pelo UTC em vez do fuso da loja", `IF public.fin__dia(v_pedido.pagamento_recebido_em) IS DISTINCT FROM public.fin__hoje()`, `IF (v_pedido.pagamento_recebido_em AT TIME ZONE 'UTC')::date IS DISTINCT FROM (now() AT TIME ZONE 'UTC')::date`, [mesmoDia]);
  await mutar(c, "dia pelo fuso da SESSÃO", `IF public.fin__dia(v_pedido.pagamento_recebido_em) IS DISTINCT FROM public.fin__hoje()`, `IF v_pedido.pagamento_recebido_em::date IS DISTINCT FROM now()::date`, [mesmoDia]);
  await mutar(c, "sem a marca de pagamento desfeito e refeito", `       OR EXISTS (
            SELECT 1 FROM public.marketplace_order_payment_history h
             WHERE h.order_id = p_order_id AND h.acao = 'desfeito'
          ) THEN`, ` THEN`, [mesmoDia]);
  await mutar(c, "sem recusar devolução viva", `AND d.status NOT IN ('recusada', 'cancelada', 'reprovada')`, "AND false", [async (cc) => {
    // reaproveita o corpo da prova (6) só para devolução
    await PROVAS.find((p) => p.nome.startsWith("(6)")).corpo(cc);
  }]);
  await mutar(c, "sem recusar linha viva do ledger de estornos", `r.status IN ('solicitado', 'em_processamento', 'concluido')`, "false", [async (cc) => {
    await PROVAS.find((p) => p.nome.startsWith("(6)")).corpo(cc);
  }]);
  await mutar(c, "motivo vazio aceito", `IF v_motivo IS NULL THEN`, "IF false THEN", [motivo]);
  await mutar(c, "teto de 500 caracteres solto", `IF char_length(v_motivo) > 500 THEN`, "IF false THEN", [motivo]);
  await mutar(c, "trim só de espaços (tab, quebra de linha e NBSP viram motivo)", `btrim(COALESCE(p_motivo, ''), E' \\t\\r\\n\\f\\x0b\\u00a0')`, `btrim(COALESCE(p_motivo, ''))`, [motivo]);
  await mutar(c, "sem o atalho do segundo toque (ja_anulada)", `IF v_pedido.status = 'cancelled' AND v_pedido.payment_status = 'estornado' THEN`, "IF false THEN", [idempotencia]);
  await mutar(c, "dinheiro não marcado (fica recebido_na_entrega)", `       SET payment_status = 'estornado',
`, `       SET payment_status = payment_status,
`, [caminhoFeliz]);

  assert.equal((await defDaFuncao(c)).def, antes, "a função não foi restaurada");
});

// -------------------------------------------------------------------- runner

async function main() {
  const url = lerDatabaseUrlEfemera();
  const c = new Client({ connectionString: url });
  await c.connect();
  const resultados = [];
  try {
    const existe = await c.query("SELECT to_regprocedure($1) AS f", [FN]);
    if (!existe.rows[0].f) {
      falhar("FALHOU", `${FN} não existe: a migration 20261204000000 não foi aplicada.`);
    }
    for (const { nome, corpo } of PROVAS) {
      const t0 = Date.now();
      try {
        await corpo(c);
        resultados.push({ nome, ok: true });
        console.log(`  ok   ${nome} (${Date.now() - t0} ms)`);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        await c.query("RESET ROLE").catch(() => {});
        resultados.push({ nome, ok: false, erro: e.stack || String(e) });
        console.log(`  FAIL ${nome}\n${e.stack || e}`);
      }
    }
  } finally {
    await c.end();
  }
  const falhas = resultados.filter((r) => !r.ok);
  const resumo = `${resultados.length - falhas.length}/${resultados.length} provas da anulação da venda do balcão verdes.`;
  console.log(`\n[anular-venda] ${resumo}`);
  anexarAoSummary(
    "Prova viva: anular venda do balcão (20261204000000)",
    falhas.length
      ? `**${falhas.length} falha(s)**:\n\n${falhas.map((f) => `- ${f.nome}`).join("\n")}`
      : `**${resumo}**`,
  );
  if (falhas.length) process.exit(1);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
