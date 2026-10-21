"use strict";

/**
 * Prova VIVA da migration 20261226000000 (a reemissao do reembolso consulta o Mercado Pago antes de pagar de novo;
 * decisao do dono, 14/10/2026) num Postgres EFEMERO local, sem rede, com os papeis de verdade
 * (anon, authenticated, service_role) e com o fluxo REAL do painel (`admin_devolucao_concluir`, `concluir_estorno`).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (as corridas usam conexoes reais, gravam de verdade e
 * desfazem). O banco e' o clone do rodar-isolado.cjs: a arvore migrada.
 *
 *  DIAGNOSTICO  registrar_diagnostico_do_estorno: incrementa no banco (2 conexoes nao perdem contagem), o carimbo de
 *               incerteza nunca sai, so servidor, e a tabela nao e' lida por nenhum papel de API.
 *  REEMISSAO    o desenho do laudo do critico (D1..D11): so cria chave nova quando o MP PROVOU que nada saiu; so adota
 *               a linha incerta; nunca cria depois de devolucao pelo painel do MP; o saldo e' o da funcao unica;
 *               duplo clique e dois lojistas nao criam duas linhas; ator = admin ATUAL nas duas fontes; ACL fechada.
 *  POR FORA     "Ja devolvi por fora" como funcao propria do lojista logado, para `falhou` e `recusado`.
 *  MIGRATION    reaplicar (2x) e CRLF = mesmo estado; o rollback apaga so o que a migration criou; o pre-voo recusa SEM
 *               escrever; a conferencia final recusa estado ruim; nenhum dado existente muda.
 *  MUTANTES     o mesmo comportamento esperado, rodado sobre corpos sabotados, FICA VERMELHO (cada um morto por um
 *               cenario NOMEADO).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/reemissao-do-reembolso-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  desfazerReembolsoEmDuvidaNaTransacao,
} = require("./reembolso-em-duvida-posterior.cjs");
const {
  desfazerPagamentoAdiantadoNaTransacao,
} = require("./pagamento-adiantado-posterior.cjs");

/**
 * Abre a transacao e desfaz as sucessoras no ar, da mais nova para a mais velha: 270 antes da 241.
 * Elas reescrevem corpos que o pre-voo daqui (e do rollback daqui) recusa.
 * Assim cada caso mede ESTA migration isolada, como antes das sucessoras existirem.
 */
async function comecarSem1241() {
  await C.query("BEGIN");
  await desfazerPagamentoAdiantadoNaTransacao(C);
  await desfazerReembolsoEmDuvidaNaTransacao(C);
}

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ARQ24 =
  "20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql";
const ARQ =
  "20261226000000_a_reemissao_do_reembolso_consulta_o_mercado_pago_antes_de_pagar_de_novo.sql";
const MIGRATION24 = fs.readFileSync(path.join(MIGRATIONS, ARQ24), "utf8");
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) =>
  crypto.createHash("md5").update(s.replace(/\r/g, "")).digest("hex");

/** O CREATE OR REPLACE FUNCTION inteiro de uma funcao da migration, pelo marcador de dolar-quote. */
const statementDe = (tag) => {
  const fim = MIGRATION.indexOf(`$${tag}$;`);
  assert.ok(fim > 0, `tag ${tag} nao achada`);
  const ini = MIGRATION.lastIndexOf("CREATE OR REPLACE FUNCTION", fim);
  return MIGRATION.slice(ini, fim + `$${tag}$;`.length);
};
const corpoDaTag = (tag) => {
  const a = MIGRATION.indexOf(`AS $${tag}$`) + `AS $${tag}$`.length;
  return MIGRATION.slice(a, MIGRATION.indexOf(`$${tag}$;`, a));
};
const FUNCOES = {
  diagnostico: {
    tag: "registrar_diagnostico",
    nome: "registrar_diagnostico_do_estorno",
    sig: "public.registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)",
  },
  reemitir: {
    tag: "reemitir",
    nome: "reemitir_reembolso_da_devolucao",
    sig: "public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)",
  },
  porFora: {
    tag: "por_fora",
    nome: "admin_devolucao_reembolso_por_fora",
    sig: "public.admin_devolucao_reembolso_por_fora(uuid,uuid)",
  },
};
const H = Object.fromEntries(
  Object.entries(FUNCOES).map(([k, v]) => [k, md5(corpoDaTag(v.tag))]),
);

const U = {
  cliente: "7e7e2250-0000-4000-8000-0000000000c1",
  outro: "7e7e2250-0000-4000-8000-0000000000c2",
  admin: "7e7e2250-0000-4000-8000-0000000000a1",
  adminSoNoAuth: "7e7e2250-0000-4000-8000-0000000000a2", // auth.users diz admin, profiles diz customer
  adminSoNoProfile: "7e7e2250-0000-4000-8000-0000000000a3", // profiles diz admin, auth.users nao
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({
  role: "authenticated",
  app_metadata: {},
});
let SEQ = 0;
const idDe = (prefixo) =>
  `7e7e2250-${prefixo}-4000-8000-${String(++SEQ).padStart(12, "0")}`;

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

const hashDe = async (sig) =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  ).rows[0]?.h ?? null;

/** Uma transacao por caso, sempre desfeita, no estado DEPOIS (24 + 25 aplicadas, idempotente) ou ANTES (25 desfeita). */
async function emTransacao(fn, { estado = "depois" } = {}) {
  await comecarSem1241();
  try {
    await C.query(MIGRATION24);
    if (estado === "antes") {
      await C.query(MIGRATION);
      await C.query(ROLLBACK);
      assert.equal(
        await hashDe(FUNCOES.reemitir.sig),
        null,
        "o estado ANTES nao montou",
      );
    } else {
      await C.query(MIGRATION);
      assert.equal(
        await hashDe(FUNCOES.reemitir.sig),
        H.reemitir,
        "o estado DEPOIS nao montou",
      );
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel`, com o JWT e o auth.uid() pedidos; devolve as linhas (o erro sobe). */
async function como(
  papel,
  sql,
  params = [],
  { uid = "", claims = "" } = {},
  conexao = C,
) {
  await conexao.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await conexao.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await conexao.query(sql, params)).rows;
  } finally {
    await conexao.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
async function tentar(papel, sql, params = [], id = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, id);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

/** Aplica um texto dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

// ---------------------------------------------------------------------------
// Fixtures: pessoas, pedido entregue e pago pelo app, devolucao concluida pelo painel, linha ruim
// ---------------------------------------------------------------------------

async function semearPessoas() {
  for (const [id, meta] of [
    [U.cliente, "{}"],
    [U.outro, "{}"],
    [U.admin, '{"role":"admin"}'],
    [U.adminSoNoAuth, '{"role":"admin"}'],
    [U.adminSoNoProfile, "{}"],
  ]) {
    await C.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@25.teste', $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, meta],
    );
  }
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Cliente 25', 'customer'), ($2, 'Outro 25', 'customer'), ($3, 'Admin 25', 'admin'),
       ($4, 'So Auth 25', 'customer'), ($5, 'So Profile 25', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U.cliente, U.outro, U.admin, U.adminSoNoAuth, U.adminSoNoProfile],
  );
  // O gatilho tr_sync_profile_role_to_auth leva o papel de profiles a auth.users: as DUAS fontes so'
  // divergem se a divergencia for gravada DEPOIS (o painel do Supabase edita auth.users direto).
  for (const [id, meta] of [
    [U.cliente, "{}"],
    [U.outro, "{}"],
    [U.admin, '{"role":"admin"}'],
    [U.adminSoNoAuth, '{"role":"admin"}'],
    [U.adminSoNoProfile, "{}"],
  ]) {
    await C.query(
      "UPDATE auth.users SET raw_app_meta_data = $2::jsonb WHERE id = $1::uuid",
      [id, meta],
    );
  }
}

/** Pedido entregue e pago; `o` muda o que o caso precisa. Devolve o id. */
async function pedido(o = {}) {
  const id = o.id ?? idDe("0001");
  await C.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal,
        payment_method, payment_status, paid_at, pagamento_recebido_em, gateway_payment_id, valor_estornado)
     VALUES ($1, $2, 'Cliente 25', '{"whatsapp":"5534999990000"}'::jsonb, $3, $3, 0, $4, 'online',
             $5, $6, now() - make_interval(days => $7::int), now() - make_interval(days => $7::int), $8, $9)`,
    [
      id,
      o.userId ?? U.cliente,
      o.total ?? 300,
      o.status ?? "delivered",
      o.metodo ?? "online",
      o.pagamento ?? "pago",
      o.pagoHaDias ?? 3,
      o.gateway === undefined ? `ORD25-AUTO-${SEQ}` : o.gateway,
      o.valorEstornado ?? 0,
    ],
  );
  return id;
}

/** Devolucao 'recebida' (pronta para o lojista concluir). */
async function devolucaoRecebida(
  orderId,
  { valor = 100, userId = U.cliente } = {},
) {
  const id = idDe("0002");
  await C.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno,
        status, valor_itens, valor_frete_ida, prazo_ate, politica)
     VALUES ($1::uuid, 'DEV-25-' || substr($1::text, 31), $2::uuid, $3::uuid, 'arrependimento', 'desisti', 'reembolso', 'nacional',
             'envio_proprio', 'recebida', $4, 0, current_date + 7, '{}'::jsonb)`,
    [id, orderId, userId, valor],
  );
  return id;
}

/** O lojista conclui pelo painel (RPC real). Devolve {devolucao, refund}. */
async function concluirComReembolso(devolucaoId, valor) {
  const r = await como(
    "authenticated",
    "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', '[]'::jsonb, $2::numeric, NULL) AS r",
    [devolucaoId, valor ?? null],
    { uid: U.admin, claims: JWT_ADMIN },
  );
  return { devolucao: devolucaoId, refund: r[0].r.refund_id };
}

/** Pedido + devolucao concluida pelo painel (linha do reembolso 'solicitado'). */
async function cenario(o = {}) {
  await semearPessoas();
  const orderId = await pedido(o.pedido);
  const dev = await devolucaoRecebida(orderId, { valor: o.valor ?? 100 });
  const { refund } = await concluirComReembolso(dev, o.valor ?? 100);
  return { orderId, dev, refund };
}

const diag = (refund, codigo, { incerto = false, transitorio = false } = {}) =>
  como(
    "service_role",
    "SELECT public.registrar_diagnostico_do_estorno($1::uuid, $2::text, $3::boolean, $4::boolean) AS r",
    [refund, codigo, incerto, transitorio],
  ).then((r) => r[0].r);

/**
 * Cenario em que a linha do reembolso JA falhou (ou foi recusada): `diagnostico` e' a lista de chamadas
 * [codigo, incerto, transitorio] que o servidor teria gravado ANTES de marcar a linha.
 */
async function falha({
  valor = 100,
  status = "falhou",
  diagnostico = [],
  mpRefundId = null,
  pedido: po,
} = {}) {
  const c = await cenario({ valor, pedido: po });
  await C.query(
    "UPDATE public.order_refunds SET status = $2, ultimo_erro = 'x', mp_refund_id = $3, tentativas = 1 WHERE id = $1",
    [c.refund, status, mpRefundId],
  );
  for (const [codigo, incerto, transitorio] of diagnostico) {
    await diag(c.refund, codigo, { incerto, transitorio });
  }
  return c;
}
/** O MP provou que nada saiu: 'sem saldo' repetido, sem carimbo de incerteza. */
const NADA_SAIU = [
  ["insufficient_money_for_refund", false, true],
  ["insufficient_money_for_refund", false, true],
  ["insufficient_money_for_refund", false, true],
  ["insufficient_money_for_refund", false, true],
  ["insufficient_money_for_refund", false, true],
];

const NAO = { resultado: "nao_achou" };
const ACHOU = (valor = 100, id = "MP-REF-A", status = "processed") => ({
  resultado: "achou",
  mp_refund_id: id,
  mp_status: status,
  valor,
});

const refundAtual = async (dev) =>
  (
    await C.query("SELECT refund_id FROM public.devolucoes WHERE id = $1", [
      dev,
    ])
  ).rows[0].refund_id;

async function reemitir(dev, consulta, { ator = U.admin, esperado } = {}) {
  const refund = esperado !== undefined ? esperado : await refundAtual(dev);
  const r = await como(
    "service_role",
    "SELECT public.reemitir_reembolso_da_devolucao($1::uuid, $2::uuid, $3::uuid, $4::jsonb) AS r",
    [dev, ator, refund, JSON.stringify(consulta)],
  );
  return r[0].r;
}

const tentarReemitir = async (
  dev,
  consulta,
  { ator = U.admin, esperado } = {},
) => {
  const refund = esperado !== undefined ? esperado : await refundAtual(dev);
  return tentar(
    "service_role",
    "SELECT public.reemitir_reembolso_da_devolucao($1::uuid, $2::uuid, $3::uuid, $4::jsonb) AS r",
    [dev, ator, refund, JSON.stringify(consulta)],
  );
};

const linha = async (id) =>
  (await C.query("SELECT * FROM public.order_refunds WHERE id = $1", [id]))
    .rows[0];
const linhasDoPedido = async (orderId) =>
  Number(
    (
      await C.query(
        "SELECT count(*) AS n FROM public.order_refunds WHERE order_id = $1",
        [orderId],
      )
    ).rows[0].n,
  );
const devolucaoDe = async (dev) =>
  (await C.query("SELECT * FROM public.devolucoes WHERE id = $1", [dev]))
    .rows[0];
const valorEstornado = async (orderId) =>
  Number(
    (
      await C.query(
        "SELECT valor_estornado FROM public.marketplace_orders WHERE id = $1",
        [orderId],
      )
    ).rows[0].valor_estornado,
  );
const avisos = async (dev, evento) =>
  (
    await C.query(
      `SELECT tipo, titulo, mensagem, dados FROM public.notificacoes
        WHERE dados ->> 'devolucao_id' = $1 ${evento ? "AND dados ->> 'evento' = $2" : ""} ORDER BY created_at, id`,
      evento ? [dev, evento] : [dev],
    )
  ).rows;
const diagnosticoDe = async (refund) =>
  (
    await C.query(
      "SELECT * FROM public.order_refund_diagnostico WHERE refund_id = $1",
      [refund],
    )
  ).rows[0];

/** Linha de rastreio do sistema (o webhook registra devolucao feita pelo painel do MP). */
async function linhaSistema(
  orderId,
  { valor = 100, chargeback = null, criadaHa = null, mpId = "SYS-1" } = {},
) {
  await C.query(
    `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, mp_refund_id, mp_chargeback_id, concluido_em, created_at)
     VALUES ($1, $2, 'sistema', 'concluido', $3, $4, now(), COALESCE(now() - $5::interval, now()))`,
    [orderId, valor, mpId, chargeback, criadaHa],
  );
  await C.query(
    "UPDATE public.marketplace_orders SET valor_estornado = valor_estornado + $2 WHERE id = $1",
    [orderId, valor],
  );
}

/** Nada mudou na devolucao nem no ledger do pedido (a recusa nao escreve). */
async function fotoDoCaso(orderId, dev) {
  return {
    d: await devolucaoDe(dev),
    linhas: (
      await C.query(
        "SELECT id, status, mp_refund_id, amount FROM public.order_refunds WHERE order_id = $1 ORDER BY id",
        [orderId],
      )
    ).rows,
    estornado: await valorEstornado(orderId),
  };
}

// ---------------------------------------------------------------------------
// OS CENARIOS: o COMPORTAMENTO que a migration promete, sobre os corpos que estiverem vivos.
// Cada um LEVANTA (assert) se falhar; as provas os rodam e os MUTANTES rodam o nomeado.
// ---------------------------------------------------------------------------
const S = {};

S.criaAposRecusado = async () => {
  const c = await falha({ status: "recusado" });
  const r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "reemitido");
  assert.notEqual(r.refund_id, c.refund);
  assert.equal(r.refund_anterior, c.refund);
  const nova = await linha(r.refund_id);
  assert.equal(nova.status, "solicitado");
  assert.equal(nova.solicitado_por, "lojista");
  assert.equal(Number(nova.amount), 100);
  assert.equal((await devolucaoDe(c.dev)).refund_id, r.refund_id);
  assert.equal((await linha(c.refund)).status, "recusado", "a antiga fica");
  assert.equal(await linhasDoPedido(c.orderId), 2);
  // o dinheiro SAI pela linha nova: soma UMA vez e a cliente ganha UM "liberado"
  await como(
    "service_role",
    "SELECT public.concluir_estorno($1::uuid, 'REF-NOVA', 'processed', NULL)",
    [r.refund_id],
  );
  assert.equal(await valorEstornado(c.orderId), 100);
  assert.equal((await avisos(c.dev, "reembolso_liberado")).length, 1);
};

S.recusadoEAchouNaoAdota = async () => {
  const c = await falha({ status: "recusado" });
  const antes = await fotoDoCaso(c.orderId, c.dev);
  const r = await reemitir(c.dev, ACHOU(100, "MP-DO-PAINEL"));
  assert.equal(r.resultado, "indeterminado");
  assert.equal(r.detalhe, "reembolso_do_mp_sem_dono");
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
  assert.equal((await linha(c.refund)).status, "recusado");
};

S.nadaSaiuCriaSoSemReembolsoNoMp = async () => {
  // D4: 5 falhas transitorias ('sem saldo'), sem carimbo: o MP provou que nada saiu
  const c1 = await falha({ diagnostico: NADA_SAIU });
  assert.equal((await diagnosticoDe(c1.refund)).transitorios, 5);
  const r1 = await reemitir(c1.dev, NAO);
  assert.equal(r1.resultado, "reemitido");
  assert.equal((await linha(r1.refund_id)).status, "solicitado");
  // com um reembolso sem dono no MP: nem cria nem adota
  const c2 = await falha({ diagnostico: NADA_SAIU });
  const antes = await fotoDoCaso(c2.orderId, c2.dev);
  const r2 = await reemitir(c2.dev, ACHOU(100, "MP-X"));
  assert.equal(r2.resultado, "indeterminado");
  assert.deepEqual(await fotoDoCaso(c2.orderId, c2.dev), antes);
  // o outro codigo "nada saiu" (ainda nao liberado) tambem cria
  const c3 = await falha({
    diagnostico: [["order_payment_not_yet_enabled_for_refund", false, true]],
  });
  assert.equal((await reemitir(c3.dev, NAO)).resultado, "reemitido");
};

S.legadoSemDiagnosticoNuncaGanhaChaveNova = async () => {
  // falhou ANTES desta migration: nenhuma linha de diagnostico = incerta (D1)
  const c = await falha();
  assert.equal(await diagnosticoDe(c.refund), undefined);
  const antes = await fotoDoCaso(c.orderId, c.dev);
  const r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "use_por_fora");
  assert.equal(r.detalhe, "sem_prova_de_que_nao_saiu");
  assert.deepEqual(
    await fotoDoCaso(c.orderId, c.dev),
    antes,
    "nenhuma linha nova",
  );
};

S.incertaNuncaGanhaChaveNova = async () => {
  for (const [rotulo, opcoes] of [
    [
      "carimbo de incerteza mesmo com codigo 'sem saldo'",
      {
        diagnostico: [
          ["insufficient_money_for_refund", false, true],
          [null, true, false],
        ],
      },
    ],
    [
      "idempotency_key_already_used",
      { diagnostico: [["idempotency_key_already_used", false, false]] },
    ],
    [
      "confirmacao_insuficiente",
      { diagnostico: [["confirmacao_insuficiente", false, false]] },
    ],
    ["http_409", { diagnostico: [["http_409", false, false]] }],
    [
      "tem id do MP",
      {
        diagnostico: [["insufficient_money_for_refund", false, true]],
        mpRefundId: "MP-JA-TEM-ID",
      },
    ],
    ["diagnostico sem codigo", { diagnostico: [[null, false, true]] }],
  ]) {
    const c = await falha(opcoes);
    const antes = await fotoDoCaso(c.orderId, c.dev);
    const r = await reemitir(c.dev, NAO);
    assert.equal(r.resultado, "use_por_fora", rotulo);
    assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes, rotulo);
  }
};

S.adotaOReembolsoQueOMpJaFez = async () => {
  const c = await falha();
  const r = await reemitir(c.dev, ACHOU(100, "MP-REF-A"));
  assert.equal(r.resultado, "ja_existia");
  assert.equal(r.refund_id, c.refund);
  const l = await linha(c.refund);
  assert.equal(l.status, "concluido");
  assert.equal(l.mp_refund_id, "MP-REF-A");
  assert.notEqual(l.concluido_em, null);
  assert.equal(await valorEstornado(c.orderId), 100, "soma UMA vez");
  assert.equal(await linhasDoPedido(c.orderId), 1, "nenhuma linha nova");
  assert.equal((await devolucaoDe(c.dev)).refund_id, c.refund);
  const lib = await avisos(c.dev, "reembolso_liberado");
  assert.equal(lib.length, 1, "o 'liberado' nasce UMA vez");
  // de novo (duplo clique / tela velha): nada soma, nada avisa
  const r2 = await reemitir(c.dev, ACHOU(100, "MP-REF-A"));
  assert.equal(r2.resultado, "ja_concluido");
  assert.equal(await valorEstornado(c.orderId), 100);
  assert.equal((await avisos(c.dev, "reembolso_liberado")).length, 1);
};

S.adotarTemGuardas = async () => {
  // valor diferente
  let c = await falha();
  let antes = await fotoDoCaso(c.orderId, c.dev);
  let r = await reemitir(c.dev, ACHOU(50, "MP-V"));
  assert.equal(r.resultado, "indeterminado");
  assert.equal(r.detalhe, "valor_diferente");
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
  // o id do MP ja e' de OUTRA linha do pedido (D7)
  c = await falha();
  await C.query(
    `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, mp_refund_id, concluido_em)
     VALUES ($1, 20, 'lojista', 'concluido', 'MP-JA-DE-OUTRA', now())`,
    [c.orderId],
  );
  antes = await fotoDoCaso(c.orderId, c.dev);
  r = await reemitir(c.dev, ACHOU(100, "MP-JA-DE-OUTRA"));
  assert.equal(r.resultado, "indeterminado");
  assert.equal(r.detalhe, "reembolso_ja_registrado_em_outra_linha");
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
  // outra linha PENDENTE do mesmo valor, sem id: o reembolso achado pode ser dela (D7)
  c = await falha();
  await C.query(
    `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
     VALUES ($1, 100, 'lojista', 'em_processamento')`,
    [c.orderId],
  );
  antes = await fotoDoCaso(c.orderId, c.dev);
  r = await reemitir(c.dev, ACHOU(100, "MP-AMBIGUO"));
  assert.equal(r.resultado, "indeterminado");
  assert.equal(r.detalhe, "outra_linha_do_mesmo_valor");
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
  // passaria do total do pedido: a conclusao e' DESFEITA (subtransacao), a linha segue falhou
  c = await falha({ pedido: { total: 150 } });
  await C.query(
    "UPDATE public.marketplace_orders SET valor_estornado = 100 WHERE id = $1",
    [c.orderId],
  );
  r = await reemitir(c.dev, ACHOU(100, "MP-ACIMA"));
  assert.equal(r.resultado, "indeterminado");
  assert.equal(r.detalhe, "passaria_do_total_do_pedido");
  assert.equal((await linha(c.refund)).status, "falhou");
  assert.equal(await valorEstornado(c.orderId), 100);
  assert.equal((await avisos(c.dev, "reembolso_liberado")).length, 0);
  // consulta mal formada nao adota
  c = await falha();
  for (const ruim of [
    {
      resultado: "achou",
      mp_refund_id: "X",
      mp_status: "processing",
      valor: 100,
    },
    { resultado: "achou", mp_status: "processed", valor: 100 },
    { resultado: "achou", mp_refund_id: "X", mp_status: "processed" },
    {
      resultado: "achou",
      mp_refund_id: "X",
      mp_status: "processed",
      valor: "abc",
    },
  ]) {
    const e = await tentarReemitir(c.dev, ruim);
    assert.equal(e.codigo, "22023", JSON.stringify(ruim));
  }
  assert.equal((await linha(c.refund)).status, "falhou");
};

S.devolucaoPeloPainelDoMpBloqueiaACriacao = async () => {
  // D3: o lojista devolveu pelo painel do MP DEPOIS de concluir a devolucao: o webhook registrou a linha `sistema`
  let c = await falha({ status: "recusado" });
  await linhaSistema(c.orderId, { valor: 100 });
  const antes = await fotoDoCaso(c.orderId, c.dev);
  let r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "use_por_fora");
  assert.equal(r.detalhe, "devolvido_pelo_painel_do_mp");
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
  // vale tambem para `falhou` em que o MP provou que nada saiu
  c = await falha({ diagnostico: NADA_SAIU });
  await linhaSistema(c.orderId, { valor: 100 });
  r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "use_por_fora");
  assert.equal(r.detalhe, "devolvido_pelo_painel_do_mp");
  // a linha de sistema ANTERIOR a conclusao ja foi descontada do saldo na conclusao: nao bloqueia
  c = await falha({ status: "recusado" });
  await linhaSistema(c.orderId, { valor: 30, criadaHa: "2 days" });
  r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "reemitido");
  // contestacao (chargeback) nao e' devolucao feita pela loja: nao bloqueia
  c = await falha({ status: "recusado" });
  await linhaSistema(c.orderId, { valor: 30, chargeback: "CB-1" });
  r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "reemitido");
};

S.saldoVemDaFuncaoUnica = async () => {
  // D11: uma linha 'concluido' SEM concluido_em ainda nao foi somada no pedido e RESERVA saldo
  let c = await falha({ diagnostico: NADA_SAIU });
  await C.query(
    `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, mp_refund_id)
     VALUES ($1, 250, 'lojista', 'concluido', 'MP-AINDA-NAO-SOMADA')`,
    [c.orderId],
  );
  assert.equal(
    Number(
      (
        await C.query("SELECT public.pedido__saldo_a_estornar($1) AS s", [
          c.orderId,
        ])
      ).rows[0].s,
    ),
    50,
  );
  let antes = await fotoDoCaso(c.orderId, c.dev);
  let r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "sem_saldo_para_reemitir");
  assert.equal(Number(r.saldo), 50);
  assert.equal(Number(r.valor), 100);
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
  // saldo curto por valor ja estornado
  c = await falha({ status: "recusado" });
  await C.query(
    "UPDATE public.marketplace_orders SET valor_estornado = 250 WHERE id = $1",
    [c.orderId],
  );
  r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "sem_saldo_para_reemitir");
  // reembolso manual de OUTRA devolucao concluida do mesmo pedido tambem desconta: 300 - 150 = 150 cabe 100 ...
  c = await falha({ status: "recusado" });
  let outra = await devolucaoRecebida(c.orderId, { valor: 150 });
  await C.query(
    `UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso', valor_reembolso = 150,
            reembolso_manual = true, concluida_em = now() WHERE id = $1`,
    [outra],
  );
  r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "reemitido", "300 - 150 manual = 150 cabe os 100");
  // ... e 300 - 250 = 50 nao cabe
  c = await falha({ status: "recusado" });
  outra = await devolucaoRecebida(c.orderId, { valor: 250 });
  await C.query(
    `UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso', valor_reembolso = 250,
            reembolso_manual = true, concluida_em = now() WHERE id = $1`,
    [outra],
  );
  antes = await fotoDoCaso(c.orderId, c.dev);
  r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "sem_saldo_para_reemitir");
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
};

S.estadosDaLinhaEDaDevolucao = async () => {
  // em andamento
  let c = await cenario();
  let r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "em_andamento");
  assert.equal(r.detalhe, "solicitado");
  await C.query(
    "UPDATE public.order_refunds SET status = 'em_processamento' WHERE id = $1",
    [c.refund],
  );
  assert.equal((await reemitir(c.dev, NAO)).resultado, "em_andamento");
  // ja paga
  await C.query(
    "UPDATE public.order_refunds SET status = 'concluido', concluido_em = now() WHERE id = $1",
    [c.refund],
  );
  r = await reemitir(c.dev, NAO);
  assert.equal(r.resultado, "ja_concluido");
  assert.equal(await linhasDoPedido(c.orderId), 1);
  // tela velha
  c = await falha({ status: "recusado" });
  r = await reemitir(c.dev, NAO, { esperado: idDe("0003") });
  assert.equal(r.resultado, "reembolso_mudou");
  assert.equal(r.refund_id, c.refund);
  assert.equal(await linhasDoPedido(c.orderId), 1);
  // linha esperada obrigatoria; consulta sem veredito nao reemite
  assert.equal(
    (await tentarReemitir(c.dev, NAO, { esperado: null })).codigo,
    "22023",
  );
  for (const ruim of [null, {}, { resultado: "indeterminado" }, "achou"]) {
    assert.equal(
      (await tentarReemitir(c.dev, ruim)).codigo,
      "22023",
      JSON.stringify(ruim),
    );
  }
  // devolucao ja resolvida por fora: nada a reemitir
  await C.query(
    "UPDATE public.devolucoes SET reembolso_manual = true, refund_id = NULL WHERE id = $1",
    [c.dev],
  );
  r = await reemitir(c.dev, NAO, { esperado: c.refund });
  assert.equal(r.resultado, "ja_concluido");
  assert.equal(r.detalhe, "por_fora");
  // devolucao que nao e' reembolso concluido
  const o = await pedido({ id: idDe("0001") });
  const d = await devolucaoRecebida(o);
  assert.equal(
    (await tentarReemitir(d, NAO, { esperado: c.refund })).codigo,
    "22023",
  );
  assert.equal(
    (await tentarReemitir(idDe("0009"), NAO, { esperado: c.refund })).codigo,
    "P0002",
  );
};

S.duploCliqueNaoCriaDuasLinhas = async () => {
  const c = await falha({ status: "recusado" });
  const r1 = await reemitir(c.dev, NAO, { esperado: c.refund });
  assert.equal(r1.resultado, "reemitido");
  // o segundo clique chega com a linha esperada VELHA (a que a tela mostrava)
  const r2 = await reemitir(c.dev, NAO, { esperado: c.refund });
  assert.equal(r2.resultado, "reembolso_mudou");
  assert.equal(r2.refund_id, r1.refund_id);
  // e com a linha nova esperada: ja esta em andamento
  const r3 = await reemitir(c.dev, NAO, { esperado: r1.refund_id });
  assert.equal(r3.resultado, "em_andamento");
  assert.equal(await linhasDoPedido(c.orderId), 2, "UMA linha nova, nao mais");
};

S.soCriaParaPedidoElegivel = async () => {
  const casos = [
    [
      "pedido cancelado depois de entregue",
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      "pedido_nao_entregue",
    ],
    [
      "pagamento ja estornado",
      "UPDATE public.marketplace_orders SET payment_status = 'estornado' WHERE id = $1",
      "sem_pagamento_pelo_app",
    ],
    [
      "mais de 180 dias",
      "UPDATE public.marketplace_orders SET paid_at = now() - interval '200 days' WHERE id = $1",
      "fora_do_prazo_ou_da_forma",
    ],
    [
      "sem gateway",
      "UPDATE public.marketplace_orders SET gateway_payment_id = NULL WHERE id = $1",
      "fora_do_prazo_ou_da_forma",
    ],
  ];
  for (const [rotulo, sql, detalhe] of casos) {
    const c = await falha({ status: "recusado" });
    await C.query(sql, [c.orderId]);
    const r = await reemitir(c.dev, NAO);
    assert.equal(r.resultado, "use_por_fora", rotulo);
    assert.equal(r.detalhe, detalhe, rotulo);
    assert.equal(await linhasDoPedido(c.orderId), 1, rotulo);
  }
};

S.oAtorEAdminAtualNasDuasFontes = async () => {
  const c = await falha({ status: "recusado" });
  const antes = await fotoDoCaso(c.orderId, c.dev);
  for (const [rotulo, ator] of [
    ["ator ausente", null],
    ["cliente comum", U.cliente],
    ["admin so em auth.users", U.adminSoNoAuth],
    ["admin so em profiles", U.adminSoNoProfile],
    ["ator que nao existe", idDe("0004")],
  ]) {
    const e = await tentarReemitir(c.dev, NAO, { ator });
    assert.equal(e.codigo, "42501", rotulo);
    assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes, rotulo);
  }
  assert.equal((await reemitir(c.dev, NAO)).resultado, "reemitido");
};

S.aPortaDeServidorEstaFechada = async () => {
  const c = await falha({ status: "recusado" });
  const args = [c.dev, U.admin, c.refund, JSON.stringify(NAO)];
  for (const papel of ["anon", "authenticated"]) {
    const e = await tentar(
      papel,
      "SELECT public.reemitir_reembolso_da_devolucao($1::uuid, $2::uuid, $3::uuid, $4::jsonb)",
      args,
      { uid: U.admin, claims: JWT_ADMIN },
    );
    assert.equal(e.codigo, "42501", `${papel} nao executa a reemissao`);
    assert.match(e.erro, /permission denied/);
    const d = await tentar(
      papel,
      "SELECT public.registrar_diagnostico_do_estorno($1::uuid, 'x', false, false)",
      [c.refund],
      { uid: U.admin, claims: JWT_ADMIN },
    );
    assert.equal(d.codigo, "42501", `${papel} nao grava diagnostico`);
  }
  for (const f of [FUNCOES.reemitir, FUNCOES.diagnostico]) {
    const acl = (
      await C.query(
        `SELECT has_function_privilege('anon', $1::text, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1::text, 'EXECUTE') AS auth,
                has_function_privilege('service_role', $1::text, 'EXECUTE') AS svc,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
           FROM pg_proc p WHERE p.oid = to_regprocedure($1::text)`,
        [f.sig],
      )
    ).rows[0];
    assert.deepEqual(
      acl,
      { anon: false, auth: false, svc: true, publico: false },
      f.nome,
    );
  }
};

S.ACorpoRecusaPapelDeApiMesmoComGrant = async () => {
  // defesa em profundidade: se alguem abrir o EXECUTE por engano, o CORPO ainda recusa quem nao e' servidor
  const c = await falha({ status: "recusado" });
  await C.query(
    `GRANT EXECUTE ON FUNCTION ${FUNCOES.reemitir.sig} TO authenticated`,
  );
  await C.query(
    `GRANT EXECUTE ON FUNCTION ${FUNCOES.diagnostico.sig} TO authenticated`,
  );
  const e = await tentar(
    "authenticated",
    "SELECT public.reemitir_reembolso_da_devolucao($1::uuid, $2::uuid, $3::uuid, $4::jsonb)",
    [c.dev, U.admin, c.refund, JSON.stringify(NAO)],
    { uid: U.admin, claims: JWT_ADMIN },
  );
  assert.equal(e.codigo, "42501");
  assert.match(e.erro, /só acontece pelo servidor/);
  assert.equal(await linhasDoPedido(c.orderId), 1);
  const d = await tentar(
    "authenticated",
    "SELECT public.registrar_diagnostico_do_estorno($1::uuid, 'x', true, true)",
    [c.refund],
    { uid: U.admin, claims: JWT_ADMIN },
  );
  assert.equal(d.codigo, "42501");
  assert.match(d.erro, /só é gravado pelo servidor/);
  assert.equal(await diagnosticoDe(c.refund), undefined);
};

S.diagnosticoIncrementaECarimboNaoSai = async () => {
  const c = await cenario();
  let r = await diag(c.refund, "insufficient_money_for_refund", {
    transitorio: true,
  });
  assert.deepEqual(r, {
    transitorios: 1,
    post_incerto: false,
    mp_codigo: "insufficient_money_for_refund",
  });
  r = await diag(c.refund, null, { transitorio: true });
  assert.equal(r.transitorios, 2);
  assert.equal(
    r.mp_codigo,
    "insufficient_money_for_refund",
    "codigo ausente nao apaga o ultimo",
  );
  r = await diag(c.refund, "http_500", { incerto: true });
  assert.equal(r.post_incerto, true);
  assert.equal(r.mp_codigo, "http_500", "o ultimo codigo vence");
  const t1 = (await diagnosticoDe(c.refund)).post_incerto_em;
  r = await diag(c.refund, null, {});
  assert.equal(r.transitorios, 2, "sem transitorio nao soma");
  assert.equal(r.post_incerto, true, "o carimbo nao sai");
  assert.equal(
    (await diagnosticoDe(c.refund)).post_incerto_em.getTime(),
    t1.getTime(),
    "o carimbo mantem a primeira hora",
  );
  assert.equal(
    (
      await tentar(
        "service_role",
        "SELECT public.registrar_diagnostico_do_estorno($1::uuid)",
        [idDe("0007")],
      )
    ).codigo,
    "P0002",
  );
};

S.aTabelaDeDiagnosticoNaoELidaPorPapelDeApi = async () => {
  const c = await falha({ diagnostico: NADA_SAIU });
  for (const papel of ["anon", "authenticated"]) {
    for (const sql of [
      "SELECT * FROM public.order_refund_diagnostico",
      "INSERT INTO public.order_refund_diagnostico (refund_id) VALUES ('7e7e2250-0000-4000-8000-0000000000ff')",
      "UPDATE public.order_refund_diagnostico SET transitorios = 0",
      "DELETE FROM public.order_refund_diagnostico",
    ]) {
      const e = await tentar(papel, sql, [], {
        uid: U.cliente,
        claims: JWT_CLIENTE,
      });
      assert.equal(e.codigo, "42501", `${papel}: ${sql}`);
    }
  }
  // a cliente le a linha do reembolso dela, e NAO o diagnostico
  const lido = await tentar(
    "authenticated",
    "SELECT id, status FROM public.order_refunds WHERE id = $1",
    [c.refund],
    { uid: U.cliente, claims: JWT_CLIENTE },
  );
  assert.equal(lido.linhas.length, 1);
  assert.ok(!("mp_codigo" in lido.linhas[0]));
  const colunas = (
    await C.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'order_refunds'`,
    )
  ).rows.map((x) => x.column_name);
  assert.ok(
    !colunas.includes("mp_codigo") && !colunas.includes("post_incerto_em"),
    "o diagnostico nao mora na linha que a cliente le",
  );
  assert.equal(
    (
      await C.query(
        `SELECT relrowsecurity, (SELECT count(*) FROM pg_policy WHERE polrelid = c.oid) AS politicas
           FROM pg_class c WHERE c.oid = 'public.order_refund_diagnostico'::regclass`,
      )
    ).rows[0].politicas,
    "0",
  );
};

// "Ja devolvi por fora" --------------------------------------------------------------------------

const porFora = (
  dev,
  esperado,
  ident = { uid: U.admin, claims: JWT_ADMIN },
  papel = "authenticated",
) =>
  como(
    papel,
    "SELECT public.admin_devolucao_reembolso_por_fora($1::uuid, $2::uuid) AS r",
    [dev, esperado],
    ident,
  ).then((r) => r[0].r);
const tentarPorFora = (
  dev,
  esperado,
  ident = { uid: U.admin, claims: JWT_ADMIN },
  papel = "authenticated",
) =>
  tentar(
    papel,
    "SELECT public.admin_devolucao_reembolso_por_fora($1::uuid, $2::uuid) AS r",
    [dev, esperado],
    ident,
  );

S.porForaResolveFalhouERecusado = async () => {
  // falhou com prova de que nada saiu: sem risco
  let c = await falha({ diagnostico: NADA_SAIU });
  let r = await porFora(c.dev, c.refund);
  assert.equal(r.resultado, "combinado");
  assert.equal(r.risco_de_dobro, false);
  const d = await devolucaoDe(c.dev);
  assert.equal(d.reembolso_manual, true);
  assert.equal(d.refund_id, null);
  const av = await avisos(c.dev, "reembolso_combinado");
  assert.equal(av.length, 1, "avisa a cliente UMA vez");
  assert.match(av[0].mensagem, /combinado com a loja/);
  // de novo: nada muda, nao avisa de novo
  r = await porFora(c.dev, c.refund);
  assert.equal(r.resultado, "ja_concluido");
  assert.equal((await avisos(c.dev, "reembolso_combinado")).length, 1);
  // o saldo passa a descontar o valor manual (fonte unica)
  assert.equal(
    Number(
      (
        await C.query("SELECT public.pedido__saldo_a_estornar($1) AS s", [
          c.orderId,
        ])
      ).rows[0].s,
    ),
    200,
  );
  // recusado
  c = await falha({ status: "recusado" });
  r = await porFora(c.dev, c.refund);
  assert.equal(r.resultado, "combinado");
  assert.equal(r.risco_de_dobro, false);
  // falhou INCERTA (legado, sem diagnostico): resolve, e SINALIZA o risco de o MP ainda pagar
  c = await falha();
  r = await porFora(c.dev, c.refund);
  assert.equal(r.resultado, "combinado");
  assert.equal(r.risco_de_dobro, true);
  assert.equal(r.detalhe, "pode_ter_saido_no_mp");
  // pedido cancelado depois de entregue TAMBEM tem saida (D11)
  c = await falha({ status: "recusado" });
  await C.query(
    "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
    [c.orderId],
  );
  r = await porFora(c.dev, c.refund);
  assert.equal(r.resultado, "combinado");
  assert.equal((await devolucaoDe(c.dev)).reembolso_manual, true);
};

S.porForaRespeitaOEstadoDaLinha = async () => {
  let c = await cenario();
  let r = await porFora(c.dev, c.refund);
  assert.equal(
    r.resultado,
    "em_andamento",
    "linha viva: o robo ainda trabalha",
  );
  assert.equal((await devolucaoDe(c.dev)).reembolso_manual, false);
  await C.query(
    "UPDATE public.order_refunds SET status = 'concluido', concluido_em = now() WHERE id = $1",
    [c.refund],
  );
  r = await porFora(c.dev, c.refund);
  assert.equal(
    r.resultado,
    "ja_concluido",
    "o dinheiro ja saiu: por fora pagaria 2x",
  );
  assert.equal((await devolucaoDe(c.dev)).reembolso_manual, false);
  c = await falha({ status: "recusado" });
  r = await porFora(c.dev, idDe("0003"));
  assert.equal(r.resultado, "reembolso_mudou");
  assert.equal((await devolucaoDe(c.dev)).reembolso_manual, false);
  assert.equal((await tentarPorFora(c.dev, null)).codigo, "22023");
};

S.porForaSoParaOAdminAtual = async () => {
  const c = await falha({ status: "recusado" });
  const antes = await fotoDoCaso(c.orderId, c.dev);
  // anon: sem EXECUTE
  let e = await tentarPorFora(c.dev, c.refund, { uid: "", claims: "" }, "anon");
  assert.equal(e.codigo, "42501");
  assert.match(e.erro, /permission denied/);
  // logado comum
  e = await tentarPorFora(c.dev, c.refund, {
    uid: U.cliente,
    claims: JWT_CLIENTE,
  });
  assert.equal(e.codigo, "42501");
  // JWT diz admin, mas o papel de AGORA (profiles) nao: rebaixado
  e = await tentarPorFora(c.dev, c.refund, {
    uid: U.adminSoNoAuth,
    claims: JWT_ADMIN,
  });
  assert.equal(e.codigo, "42501");
  assert.match(e.erro, /Acesso negado/);
  // servidor sem usuario nenhum
  e = await tentarPorFora(
    c.dev,
    c.refund,
    { uid: "", claims: "" },
    "service_role",
  );
  assert.equal(e.codigo, "42501");
  assert.deepEqual(await fotoDoCaso(c.orderId, c.dev), antes);
  const acl = (
    await C.query(
      `SELECT has_function_privilege('anon', $1::text, 'EXECUTE') AS anon,
              has_function_privilege('authenticated', $1::text, 'EXECUTE') AS auth,
              EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS publico
         FROM pg_proc p WHERE p.oid = to_regprocedure($1::text)`,
      [FUNCOES.porFora.sig],
    )
  ).rows[0];
  assert.deepEqual(acl, { anon: false, auth: true, publico: false });
};

// ---------------------------------------------------------------------------
// As provas
// ---------------------------------------------------------------------------

prova(
  "DIAGNOSTICO: incrementa no banco, o carimbo de incerteza nao sai, o ultimo codigo vence, linha inexistente falha alto",
  () => emTransacao(S.diagnosticoIncrementaECarimboNaoSai),
);
prova(
  "DIAGNOSTICO: a tabela nao e' lida nem escrita por anon/authenticated e nao mora na linha que a cliente le",
  () => emTransacao(S.aTabelaDeDiagnosticoNaoELidaPorPapelDeApi),
);
prova(
  "REEMISSAO: linha 'recusado' + MP sem reembolso = tentativa nova; a antiga fica; o dinheiro novo soma 1x e avisa 1x",
  () => emTransacao(S.criaAposRecusado),
);
prova(
  "REEMISSAO: 'recusado' + reembolso sem dono no MP = indeterminado (nunca adota, nunca cria)",
  () => emTransacao(S.recusadoEAchouNaoAdota),
);
prova(
  "REEMISSAO: 'falhou' em que o MP PROVOU que nada saiu (5x sem saldo / ainda nao liberado) cria so se o MP nao tem reembolso",
  () => emTransacao(S.nadaSaiuCriaSoSemReembolsoNoMp),
);
prova(
  "REEMISSAO: 'falhou' LEGADA (sem diagnostico) nunca ganha chave nova (D1/D4): use_por_fora, nada escrito",
  () => emTransacao(S.legadoSemDiagnosticoNuncaGanhaChaveNova),
);
prova(
  "REEMISSAO: 'falhou' incerta (carimbo, idempotency_key_already_used, confirmacao_insuficiente, http_*, com id do MP, sem codigo) nunca ganha chave nova",
  () => emTransacao(S.incertaNuncaGanhaChaveNova),
);
prova(
  "REEMISSAO: adotar = o MP ja fez; a linha vira 'concluido', soma 1x, 1 aviso 'liberado', nenhuma linha nova; repetir nao soma de novo",
  () => emTransacao(S.adotaOReembolsoQueOMpJaFez),
);
prova(
  "REEMISSAO: adotar tem guardas (valor, id de outra linha, outra linha pendente do mesmo valor, passa do total, consulta mal formada)",
  () => emTransacao(S.adotarTemGuardas),
);
prova(
  "REEMISSAO: devolucao pelo painel do MP depois da conclusao (linha `sistema`) bloqueia a criacao; contestacao e linha anterior nao",
  () => emTransacao(S.devolucaoPeloPainelDoMpBloqueiaACriacao),
);
prova(
  "REEMISSAO: o saldo e' o da funcao unica (linha 'concluido' sem concluido_em reserva; ja estornado e manual de outra devolucao descontam)",
  () => emTransacao(S.saldoVemDaFuncaoUnica),
);
prova(
  "REEMISSAO: estados (em andamento, ja paga, tela velha, linha esperada obrigatoria, consulta sem veredito, ja por fora, nao e' reembolso)",
  () => emTransacao(S.estadosDaLinhaEDaDevolucao),
);
prova("REEMISSAO: duplo clique / dois lojistas nao criam duas linhas", () =>
  emTransacao(S.duploCliqueNaoCriaDuasLinhas),
);
prova(
  "REEMISSAO: so cria para pedido elegivel (entregue, pago pelo app, <= 180 dias, com gateway)",
  () => emTransacao(S.soCriaParaPedidoElegivel),
);
prova(
  "REEMISSAO: o ator tem de ser admin ATUAL nas DUAS fontes (auth.users e profiles); ausente, cliente, so-auth, so-profile e inexistente recusam sem escrever",
  () => emTransacao(S.oAtorEAdminAtualNasDuasFontes),
);
prova(
  "REEMISSAO: anon e authenticated nao executam a reemissao nem o diagnostico (ACL fechada)",
  () => emTransacao(S.aPortaDeServidorEstaFechada),
);
prova(
  "REEMISSAO: mesmo com EXECUTE aberto por engano, o CORPO recusa quem nao e' servidor",
  () => emTransacao(S.ACorpoRecusaPapelDeApiMesmoComGrant),
);
prova(
  "POR FORA: resolve 'falhou' e 'recusado', avisa a cliente 1x, desconta o saldo, funciona em pedido cancelado, sinaliza o risco quando a linha e' incerta",
  () => emTransacao(S.porForaResolveFalhouERecusado),
);
prova(
  "POR FORA: respeita o estado da linha (em andamento, ja paga, tela velha, linha esperada obrigatoria)",
  () => emTransacao(S.porForaRespeitaOEstadoDaLinha),
);
prova(
  "POR FORA: so o admin ATUAL do lojista logado (anon, cliente, rebaixado e servidor sem usuario recusam sem escrever)",
  () => emTransacao(S.porForaSoParaOAdminAtual),
);

// ---------------------------------------------------------------------------
// CORRIDAS (conexoes reais): gravam de verdade e desfazem
// ---------------------------------------------------------------------------

async function limpar(ids) {
  await C.query("ROLLBACK").catch(() => {});
  if (!ids) return;
  const q = (sql, p) => C.query(sql, p).catch(() => {});
  await q("UPDATE public.devolucoes SET refund_id = NULL WHERE order_id = $1", [
    ids.orderId,
  ]);
  await q(
    "DELETE FROM public.notificacoes WHERE dados ->> 'devolucao_id' = $1",
    [ids.dev],
  );
  await q("DELETE FROM public.devolucoes WHERE order_id = $1", [ids.orderId]);
  await q(
    "DELETE FROM public.order_refund_diagnostico WHERE refund_id IN (SELECT id FROM public.order_refunds WHERE order_id = $1)",
    [ids.orderId],
  );
  await q("DELETE FROM public.order_refunds WHERE order_id = $1", [
    ids.orderId,
  ]);
  await q("DELETE FROM public.marketplace_orders WHERE id = $1", [ids.orderId]);
  await q("DELETE FROM public.profiles WHERE id = ANY($1::uuid[])", [
    Object.values(U),
  ]);
  await q("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
    Object.values(U),
  ]);
}

/** Uma chamada de servidor numa transacao PROPRIA da conexao dada (commit no fim). */
async function comoServidor(conexao, sql, params) {
  await conexao.query("BEGIN");
  try {
    await conexao.query("SET LOCAL ROLE service_role");
    const r = await conexao.query(sql, params);
    await conexao.query("COMMIT");
    return r.rows[0].r;
  } catch (e) {
    await conexao.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

prova(
  "CORRIDA: duas conexoes reemitindo a MESMA devolucao ao mesmo tempo criam UMA linha nova (a outra recebe 'reembolso_mudou'), sem deadlock",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    let ids = null;
    try {
      await comecarSem1241();
      await C.query(MIGRATION24);
      await C.query(MIGRATION);
      const c = await falha({ status: "recusado" });
      await C.query("COMMIT");
      ids = c;
      const chamar = (conexao) =>
        comoServidor(
          conexao,
          "SELECT public.reemitir_reembolso_da_devolucao($1::uuid, $2::uuid, $3::uuid, $4::jsonb) AS r",
          [c.dev, U.admin, c.refund, JSON.stringify(NAO)],
        );
      const [x, y] = await Promise.all([chamar(C), chamar(B)]);
      assert.deepEqual([x.resultado, y.resultado].sort(), [
        "reembolso_mudou",
        "reemitido",
      ]);
      assert.equal(await linhasDoPedido(c.orderId), 2, "UMA linha nova");
    } finally {
      await B.end().catch(() => {});
      await limpar(ids);
    }
  },
);

prova(
  "CORRIDA: reemitir e 'Ja devolvi por fora' ao mesmo tempo na mesma devolucao nunca deixam as duas coisas (linha nova E devolucao manual), sem deadlock",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    let ids = null;
    try {
      await comecarSem1241();
      await C.query(MIGRATION24);
      await C.query(MIGRATION);
      const c = await falha({ status: "recusado" });
      await C.query("COMMIT");
      ids = c;
      await B.query("SET statement_timeout = 20000");
      await C.query("SET statement_timeout = 20000");
      const reemitirNaB = comoServidor(
        B,
        "SELECT public.reemitir_reembolso_da_devolucao($1::uuid, $2::uuid, $3::uuid, $4::jsonb) AS r",
        [c.dev, U.admin, c.refund, JSON.stringify(NAO)],
      );
      const porForaNaC = (async () => {
        await comecarSem1241();
        try {
          await C.query(
            "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
            [U.admin, JWT_ADMIN],
          );
          await C.query("SET LOCAL ROLE authenticated");
          const r = (
            await C.query(
              "SELECT public.admin_devolucao_reembolso_por_fora($1::uuid, $2::uuid) AS r",
              [c.dev, c.refund],
            )
          ).rows[0].r;
          await C.query("COMMIT");
          return r;
        } catch (e) {
          await C.query("ROLLBACK").catch(() => {});
          throw e;
        }
      })();
      const [a, b] = await Promise.all([reemitirNaB, porForaNaC]);
      const d = await devolucaoDe(c.dev);
      const n = await linhasDoPedido(c.orderId);
      if (d.reembolso_manual) {
        assert.equal(n, 1, "por fora venceu: nenhuma linha nova");
        assert.equal(a.resultado, "ja_concluido");
        assert.equal(b.resultado, "combinado");
      } else {
        assert.equal(n, 2, "reemitir venceu: uma linha nova");
        assert.equal(a.resultado, "reemitido");
        assert.equal(b.resultado, "reembolso_mudou");
      }
    } finally {
      await B.end().catch(() => {});
      await C.query("RESET statement_timeout").catch(() => {});
      await limpar(ids);
    }
  },
);

prova(
  "CORRIDA: duas conexoes gravando diagnostico (25 chamadas cada) nao perdem contagem",
  async () => {
    const B = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await B.connect();
    let ids = null;
    try {
      await comecarSem1241();
      await C.query(MIGRATION24);
      await C.query(MIGRATION);
      const c = await falha({ status: "recusado" });
      await C.query("COMMIT");
      ids = c;
      const laco = async (conexao) => {
        for (let i = 0; i < 25; i++) {
          await comoServidor(
            conexao,
            "SELECT public.registrar_diagnostico_do_estorno($1::uuid, 'insufficient_money_for_refund', false, true) AS r",
            [c.refund],
          );
        }
      };
      await Promise.all([laco(C), laco(B)]);
      assert.equal((await diagnosticoDe(c.refund)).transitorios, 50);
    } finally {
      await B.end().catch(() => {});
      await limpar(ids);
    }
  },
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, rollback, pre-voo, conferencia, so o que devia mudar
// ---------------------------------------------------------------------------

/** O retrato do schema `public` (corpo, ACL, atributos de funcao; ACL de tabela; gatilhos) para comparar antes/depois. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.proacl::text AS acl, md5(p.prosrc) AS corpo, p.prosecdef,
              p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl, c.relrowsecurity AS rls
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  const gatilhos = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, g.tgname, pg_get_triggerdef(g.oid) AS def, g.tgenabled
         FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT g.tgisinternal ORDER BY 1, 2`,
    )
  ).rows;
  return { funcoes, tabelas, gatilhos };
}
const porChave = (linhas, k) => new Map(linhas.map((l) => [l[k], l]));

prova(
  "MIGRATION: do ANTES (rollback) ao DEPOIS nascem 3 funcoes e 1 tabela — nenhum corpo, ACL ou gatilho que ja existia muda; o rollback apaga so isso e a ida e volta termina igual",
  () =>
    emTransacao(async () => {
      await C.query(ROLLBACK);
      const antes = await retratoDoSchema();
      await C.query(MIGRATION);
      const depois = await retratoDoSchema();
      const fa = porChave(antes.funcoes, "f");
      const fd = porChave(depois.funcoes, "f");
      assert.deepEqual(
        [...fd.keys()].filter((k) => !fa.has(k)).sort(),
        [
          "admin_devolucao_reembolso_por_fora(uuid,uuid)",
          "registrar_diagnostico_do_estorno(uuid,text,boolean,boolean)",
          "reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)",
        ].sort(),
      );
      assert.deepEqual(
        [...fa.keys()].filter((k) => !fd.has(k)),
        [],
        "nenhuma funcao some",
      );
      assert.deepEqual(
        [...fa.keys()].filter(
          (k) => JSON.stringify(fa.get(k)) !== JSON.stringify(fd.get(k)),
        ),
        [],
        "nenhum corpo, ACL ou atributo de funcao existente muda",
      );
      const ta = porChave(antes.tabelas, "t");
      const td = porChave(depois.tabelas, "t");
      assert.deepEqual(
        [...td.keys()].filter((k) => !ta.has(k)),
        ["order_refund_diagnostico"],
      );
      assert.deepEqual(
        [...ta.keys()].filter(
          (k) => JSON.stringify(ta.get(k)) !== JSON.stringify(td.get(k)),
        ),
        [],
        "nenhuma tabela existente muda (nem a ACL, nem a RLS)",
      );
      assert.deepEqual(depois.gatilhos, antes.gatilhos, "nenhum gatilho muda");
      await C.query(ROLLBACK);
      assert.deepEqual(
        await retratoDoSchema(),
        antes,
        "rollback = estado de antes",
      );
      await C.query(MIGRATION);
      assert.deepEqual(
        await retratoDoSchema(),
        depois,
        "reaplicar = estado de depois",
      );
    }),
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = o mesmo estado (corpos, ACL, tabela)",
  () =>
    emTransacao(async () => {
      const um = await retratoDoSchema();
      await C.query(MIGRATION);
      assert.deepEqual(await retratoDoSchema(), um, "reaplicar nao muda nada");
      await C.query(emCRLF(MIGRATION));
      for (const k of Object.keys(FUNCOES)) {
        assert.equal(await hashDe(FUNCOES[k].sig), H[k], k);
      }
      const crlf = await retratoDoSchema();
      assert.deepEqual(
        crlf.funcoes.map((f) => [
          f.f,
          f.acl,
          f.prosecdef,
          f.provolatile,
          f.cfg,
        ]),
        um.funcoes.map((f) => [f.f, f.acl, f.prosecdef, f.provolatile, f.cfg]),
      );
      assert.deepEqual(crlf.tabelas, um.tabelas);
      assert.deepEqual(crlf.gatilhos, um.gatilhos);
    }),
);

prova(
  "MIGRATION: reaplicar nao apaga o diagnostico que ja existe; o rollback RECUSA perder diagnostico sem a declaracao do operador (e funciona com ela)",
  () =>
    emTransacao(async () => {
      const c = await falha({ diagnostico: NADA_SAIU });
      await C.query(MIGRATION);
      assert.equal((await diagnosticoDe(c.refund)).transitorios, 5);
      const e = await aplicar(ROLLBACK);
      assert.ok(e);
      assert.match(e.erro, /ROLLBACK_PERDERIA_DADO/);
      assert.equal((await diagnosticoDe(c.refund)).transitorios, 5);
      assert.equal(
        await hashDe(FUNCOES.reemitir.sig),
        H.reemitir,
        "recusou sem apagar nada",
      );
      await C.query(
        "SELECT set_config('app.rollback_aceita_perder_diagnostico', 'sim', true)",
      );
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await hashDe(FUNCOES.reemitir.sig), null);
      assert.equal(
        (
          await C.query(
            "SELECT to_regclass('public.order_refund_diagnostico') AS t",
          )
        ).rows[0].t,
        null,
      );
      // as linhas do reembolso ficam intactas
      assert.equal((await linha(c.refund)).status, "falhou");
    }),
);

prova(
  "MIGRATION: nenhum dado existente muda no apply nem no rollback (devolucoes, order_refunds, pedidos, avisos, trilha)",
  () =>
    emTransacao(async () => {
      const c = await falha();
      await avisos(c.dev);
      const foto = async () =>
        (
          await C.query(
            `SELECT (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.devolucoes x) AS d,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.order_refunds x) AS r,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.marketplace_orders x) AS o,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') FROM public.notificacoes x) AS n,
                    (SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id)), '') FROM public.devolucao_eventos x) AS e`,
          )
        ).rows[0];
      const antes = await foto();
      await C.query(ROLLBACK);
      assert.deepEqual(await foto(), antes, "rollback nao toca dado");
      await C.query(MIGRATION);
      assert.deepEqual(await foto(), antes, "apply nao toca dado");
      // a linha que ja era falhou continua incerta (sem diagnostico) e o apply nao inventou um
      assert.equal(await diagnosticoDe(c.refund), undefined);
    }),
);

prova(
  "MIGRATION: o pre-voo RECUSA (B1_BASELINE_DIVERGENT) sem escrever: funcao chamada com outro corpo ou ausente, funcao nova com outro corpo, sobrecarga, tabela com outras colunas, coluna ausente",
  () =>
    emTransacao(async () => {
      const recusa = async (
        rotulo,
        preparar,
        regex = /B1_BASELINE_DIVERGENT/,
      ) => {
        await C.query("SAVEPOINT estado_ruim");
        try {
          await preparar();
          const antes = await retratoDoSchema();
          const e = await aplicar(MIGRATION);
          assert.ok(e, `${rotulo}: devia recusar`);
          assert.match(e.erro, regex, rotulo);
          assert.deepEqual(
            await retratoDoSchema(),
            antes,
            `${rotulo}: a recusa nao escreveu`,
          );
        } finally {
          await C.query("ROLLBACK TO SAVEPOINT estado_ruim");
        }
      };
      await recusa("concluir_estorno com outro corpo", () =>
        C.query(`CREATE OR REPLACE FUNCTION public.concluir_estorno(p_refund_id uuid, p_mp_refund_id text DEFAULT NULL,
                   p_mp_status text DEFAULT NULL, p_mp_status_detail text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$`),
      );
      await recusa("pedido__saldo_a_estornar com outro corpo", () =>
        C.query(
          "CREATE OR REPLACE FUNCTION public.pedido__saldo_a_estornar(p_order_id uuid) RETURNS numeric LANGUAGE sql AS $x$ SELECT 0::numeric $x$",
        ),
      );
      await recusa("auxiliar de aviso da 20261225 ausente", () =>
        C.query(
          "DROP FUNCTION public.devolucao__avisar_reembolso(uuid, text, text, text, text)",
        ),
      );
      await recusa("funcao nova com outro corpo (reemissao)", () =>
        C.query(`CREATE OR REPLACE FUNCTION public.reemitir_reembolso_da_devolucao(p_devolucao_id uuid, p_ator uuid, p_refund_esperado uuid, p_consulta jsonb)
                   RETURNS jsonb LANGUAGE sql AS $x$ SELECT '{}'::jsonb $x$`),
      );
      await recusa("sobrecarga do diagnostico", () =>
        C.query(
          "CREATE FUNCTION public.registrar_diagnostico_do_estorno(uuid) RETURNS int LANGUAGE sql AS $x$ SELECT 1 $x$",
        ),
      );
      await recusa("tabela de diagnostico com outras colunas", async () => {
        await C.query(ROLLBACK);
        await C.query(
          "CREATE TABLE public.order_refund_diagnostico (refund_id uuid, extra text)",
        );
      });
      await recusa(
        "coluna que a funcao le ausente (devolucoes.concluida_em)",
        () =>
          C.query(
            "ALTER TABLE public.devolucoes DROP COLUMN concluida_em CASCADE",
          ),
      );
      await recusa(
        "coluna que a funcao le ausente (order_refunds.mp_chargeback_id)",
        () =>
          C.query(
            "ALTER TABLE public.order_refunds DROP COLUMN mp_chargeback_id CASCADE",
          ),
      );
      // o estado ANTES conhecido APLICA (nao e' falso-positivo)
      await C.query(ROLLBACK);
      assert.equal(await aplicar(MIGRATION), null);
    }),
);

prova(
  "MIGRATION: a conferencia final RECUSA estado ruim — rodada sozinha sobre ACL aberta (anon, authenticated, PUBLIC), tabela com policy/grant/sem RLS, corpo trocado",
  () =>
    emTransacao(async () => {
      const i = MIGRATION.indexOf("DO $conferencia_20261226$");
      const conferencia = MIGRATION.slice(i);
      assert.equal(
        await aplicar(conferencia),
        null,
        "a conferencia passa no estado certo",
      );
      const ruim = async (rotulo, preparar) => {
        await C.query("SAVEPOINT estado_ruim");
        try {
          await preparar();
          const e = await aplicar(conferencia);
          assert.ok(e, `${rotulo}: devia recusar`);
          assert.match(e.erro, /CONFERENCIA_20261226/, rotulo);
        } finally {
          await C.query("ROLLBACK TO SAVEPOINT estado_ruim");
        }
      };
      await ruim("authenticated executa a reemissao", () =>
        C.query(
          `GRANT EXECUTE ON FUNCTION ${FUNCOES.reemitir.sig} TO authenticated`,
        ),
      );
      await ruim("anon executa o diagnostico", () =>
        C.query(`GRANT EXECUTE ON FUNCTION ${FUNCOES.diagnostico.sig} TO anon`),
      );
      await ruim("PUBLIC executa a reemissao", () =>
        C.query(`GRANT EXECUTE ON FUNCTION ${FUNCOES.reemitir.sig} TO PUBLIC`),
      );
      await ruim("PUBLIC executa o 'por fora'", () =>
        C.query(`GRANT EXECUTE ON FUNCTION ${FUNCOES.porFora.sig} TO PUBLIC`),
      );
      await ruim("anon executa o 'por fora'", () =>
        C.query(`GRANT EXECUTE ON FUNCTION ${FUNCOES.porFora.sig} TO anon`),
      );
      await ruim("authenticated perdeu o 'por fora'", () =>
        C.query(
          `REVOKE EXECUTE ON FUNCTION ${FUNCOES.porFora.sig} FROM authenticated`,
        ),
      );
      await ruim("tabela com policy", () =>
        C.query(
          "CREATE POLICY p ON public.order_refund_diagnostico FOR SELECT TO authenticated USING (true)",
        ),
      );
      await ruim("tabela com SELECT para authenticated", () =>
        C.query(
          "GRANT SELECT ON public.order_refund_diagnostico TO authenticated",
        ),
      );
      await ruim("tabela sem RLS", () =>
        C.query(
          "ALTER TABLE public.order_refund_diagnostico DISABLE ROW LEVEL SECURITY",
        ),
      );
      await ruim("corpo da reemissao trocado", () =>
        C.query(`CREATE OR REPLACE FUNCTION public.reemitir_reembolso_da_devolucao(p_devolucao_id uuid, p_ator uuid, p_refund_esperado uuid, p_consulta jsonb)
                 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $x$ BEGIN RETURN '{}'::jsonb; END; $x$`),
      );
      await ruim("SECURITY INVOKER no diagnostico", () =>
        C.query(`ALTER FUNCTION ${FUNCOES.diagnostico.sig} SECURITY INVOKER`),
      );
    }),
);

prova(
  "ARQUIVO: os hashes que o pre-voo, a conferencia e o rollback declaram sao os dos corpos que o arquivo carrega; sem BEGIN/COMMIT de nivel superior; a funcao antiga de reemissao nao foi redefinida",
  async () => {
    for (const [k, f] of Object.entries(FUNCOES)) {
      assert.equal(
        MIGRATION.split(`('${f.nome}', '${H[k]}')`).length - 1,
        2,
        `${k}: o hash no pre-voo e na conferencia`,
      );
      assert.equal(
        ROLLBACK.split(`('${f.nome}', '${H[k]}')`).length - 1,
        1,
        `${k}: o hash no rollback`,
      );
    }
    assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(MIGRATION));
    assert.ok(!/^\s*(BEGIN|COMMIT)\s*;/im.test(ROLLBACK));
    const semComentarios = MIGRATION.replace(/^\s*--.*$/gm, "");
    for (const intocada of [
      "admin_devolucao_reemitir_reembolso",
      "solicitar_estorno",
      "concluir_estorno",
      "admin_devolucao_concluir",
      "pedido__saldo_a_estornar",
    ]) {
      assert.ok(
        !semComentarios.includes(`FUNCTION public.${intocada}(`),
        `${intocada} nao e' redefinida aqui`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// MUTANTES: o comportamento esperado, sobre corpos sabotados, FICA VERMELHO
// ---------------------------------------------------------------------------

/** Aplica o `CREATE OR REPLACE` de uma funcao com UMA troca de texto (que tem de existir) e roda o cenario. */
async function mutante(rotulo, tagDaFuncao, de, para, comportamento) {
  await comecarSem1241();
  try {
    await C.query(MIGRATION24);
    await C.query(MIGRATION);
    if (de !== null) {
      let sql = statementDe(tagDaFuncao);
      assert.ok(
        sql.includes(de),
        `${rotulo}: o texto a sabotar nao existe (${de.slice(0, 50)})`,
      );
      sql = sql.replace(de, para);
      assert.notEqual(sql, statementDe(tagDaFuncao));
      await C.query(sql);
    }
    let passou = true;
    try {
      await comportamento();
    } catch (e) {
      passou = false;
      if (process.env.MUTANTE_VERBOSE)
        console.log(
          `    morto: ${rotulo}\n      => ${String(e.message).split("\n")[0].slice(0, 160)}`,
        );
    }
    assert.equal(passou, false, `MUTANTE SOBREVIVEU: ${rotulo}`);
  } finally {
    await C.query("ROLLBACK");
  }
}

prova(
  "MUTANTES: cada guarda tirada deixa o cenario NOMEADO vermelho",
  async () => {
    const roteiro = [
      [
        "D1: toda 'falhou' e' tratada como 'nada saiu' (cria chave nova sem prova)",
        "reemitir",
        "IF v_sem_post THEN",
        "IF true THEN",
        S.legadoSemDiagnosticoNuncaGanhaChaveNova,
      ],
      [
        "D1: o carimbo de incerteza deixa de contar",
        "reemitir",
        "AND v_diag.post_incerto_em IS NULL",
        "AND true",
        S.incertaNuncaGanhaChaveNova,
      ],
      [
        "D7: reembolso sem dono no MP nao barra a criacao (paga de novo)",
        "reemitir",
        "    IF v_consulta = 'achou' THEN\n      RETURN jsonb_build_object('resultado', 'indeterminado', 'detalhe', 'reembolso_do_mp_sem_dono');\n    END IF;\n",
        "",
        S.recusadoEAchouNaoAdota,
      ],
      [
        "D3: a devolucao pelo painel do MP nao bloqueia a criacao",
        "reemitir",
        "IF EXISTS (SELECT 1 FROM public.order_refunds s",
        "IF false AND EXISTS (SELECT 1 FROM public.order_refunds s",
        S.devolucaoPeloPainelDoMpBloqueiaACriacao,
      ],
      [
        "D3: a contestacao (chargeback) passa a bloquear",
        "reemitir",
        "AND s.mp_chargeback_id IS NULL",
        "AND true",
        S.devolucaoPeloPainelDoMpBloqueiaACriacao,
      ],
      [
        "D7: adota sem comparar o valor",
        "reemitir",
        "IF v_valor <> v_r.amount THEN",
        "IF false THEN",
        S.adotarTemGuardas,
      ],
      [
        "D7: adota mesmo com outra linha pendente do mesmo valor sem id",
        "reemitir",
        "AND x.amount = v_r.amount\n                  AND x.status IN ('solicitado', 'em_processamento', 'falhou')) THEN",
        "AND false\n                  AND x.status IN ('solicitado', 'em_processamento', 'falhou')) THEN",
        S.adotarTemGuardas,
      ],
      [
        "D8: sem a checagem explicita nem a captura do 23505, o indice unico estoura para o chamador",
        "reemitir",
        null,
        null,
        async () => {
          const sql = statementDe("reemitir")
            .replace("WHEN unique_violation THEN", "WHEN no_data_found THEN")
            .replace(
              "AND x.mp_refund_id = v_mp_refund) THEN",
              "AND false) THEN",
            );
          await C.query(sql);
          await S.adotarTemGuardas();
        },
      ],
      [
        "D8: so a checagem explicita sai (a captura do 23505 ainda barra): o comportamento NAO muda — defesa em profundidade",
        "reemitir",
        "AND x.mp_refund_id = v_mp_refund) THEN",
        "AND false) THEN",
        "SOBREVIVE",
      ],
      [
        "D8: a passagem do total do pedido nao e' capturada",
        "reemitir",
        "IF SQLERRM LIKE 'estorno_acima_do_total%' THEN",
        "IF false THEN",
        S.adotarTemGuardas,
      ],
      [
        "D11: o saldo vem de uma conta propria que esquece 'concluido' sem concluido_em",
        "reemitir",
        "v_saldo := public.pedido__saldo_a_estornar(v_o.id);",
        "v_saldo := v_o.total - COALESCE(v_o.valor_estornado, 0) - COALESCE((SELECT sum(r.amount) FROM public.order_refunds r WHERE r.order_id = v_o.id AND r.status IN ('solicitado', 'em_processamento')), 0);",
        S.saldoVemDaFuncaoUnica,
      ],
      [
        "D8: a linha esperada nao e' conferida (duplo clique cria 2 linhas)",
        "reemitir",
        "IF v_d.refund_id IS DISTINCT FROM p_refund_esperado THEN",
        "IF false THEN",
        S.duploCliqueNaoCriaDuasLinhas,
      ],
      [
        "D9: o ator nao e' conferido em profiles",
        "reemitir",
        "AND EXISTS (SELECT 1 FROM public.profiles pr\n                    WHERE pr.id = p_ator AND pr.role = 'admin')",
        "AND true",
        S.oAtorEAdminAtualNasDuasFontes,
      ],
      [
        "D9: o ator nao e' conferido em auth.users",
        "reemitir",
        "EXISTS (SELECT 1 FROM auth.users u\n                WHERE u.id = p_ator AND (u.raw_app_meta_data ->> 'role') = 'admin')\n       AND",
        "true\n       AND",
        S.oAtorEAdminAtualNasDuasFontes,
      ],
      [
        "D9: o corpo da reemissao nao recusa papel de API",
        "reemitir",
        "IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN",
        "IF false THEN",
        S.ACorpoRecusaPapelDeApiMesmoComGrant,
      ],
      [
        "D9: o corpo do diagnostico nao recusa papel de API",
        "registrar_diagnostico",
        "IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN",
        "IF false THEN",
        S.ACorpoRecusaPapelDeApiMesmoComGrant,
      ],
      [
        "diagnostico: o contador nao soma (so guarda o maior)",
        "registrar_diagnostico",
        "transitorios = d.transitorios + EXCLUDED.transitorios,",
        "transitorios = GREATEST(d.transitorios, EXCLUDED.transitorios),",
        S.diagnosticoIncrementaECarimboNaoSai,
      ],
      [
        "diagnostico: o carimbo de incerteza pode sair (sobrescrito pelo ultimo)",
        "registrar_diagnostico",
        "post_incerto_em = COALESCE(d.post_incerto_em, EXCLUDED.post_incerto_em),",
        "post_incerto_em = EXCLUDED.post_incerto_em,",
        S.diagnosticoIncrementaECarimboNaoSai,
      ],
      [
        "por fora: nao confere o admin ATUAL (so o JWT)",
        "por_fora",
        "IF NOT public.is_admin_atual() THEN",
        "IF false THEN",
        S.porForaSoParaOAdminAtual,
      ],
      [
        "por fora: resolve linha que ja foi paga (pagaria 2x)",
        "por_fora",
        "  IF v_r.status = 'concluido' THEN\n    RETURN jsonb_build_object('resultado', 'ja_concluido', 'detalhe', 'dinheiro_ja_saiu', 'refund_id', v_r.id);\n  END IF;\n",
        "",
        S.porForaRespeitaOEstadoDaLinha,
      ],
      [
        "por fora: nao avisa a cliente",
        "por_fora",
        "PERFORM public.devolucao__avisar_reembolso(p_devolucao_id, 'reembolso_combinado'",
        "PERFORM public.devolucao__avisar_reembolso(p_devolucao_id, 'reembolso_nao_dito'",
        S.porForaResolveFalhouERecusado,
      ],
      [
        "por fora: nao sinaliza o risco quando a linha e' incerta",
        "por_fora",
        "v_risco := NOT (",
        "v_risco := false AND NOT (",
        S.porForaResolveFalhouERecusado,
      ],
      [
        "por fora: exige pedido entregue como a funcao antiga (pedido cancelado fica sem saida)",
        "por_fora",
        "  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;",
        "  IF (SELECT status FROM public.marketplace_orders WHERE id = v_d.order_id) <> 'delivered' THEN\n    RAISE EXCEPTION 'pedido nao entregue' USING ERRCODE = '22023';\n  END IF;\n  SELECT * INTO v_r FROM public.order_refunds WHERE id = v_d.refund_id;",
        S.porForaResolveFalhouERecusado,
      ],
    ];
    for (const [rotulo, tag, de, para, comp] of roteiro) {
      if (comp === "SOBREVIVE") {
        // redundancia deliberada: este mutante NAO pode ficar vermelho; se ficar, a defesa em profundidade sumiu
        await comecarSem1241();
        try {
          await C.query(MIGRATION24);
          await C.query(MIGRATION);
          await C.query(statementDe(tag).replace(de, para));
          await S.adotarTemGuardas();
        } finally {
          await C.query("ROLLBACK");
        }
        continue;
      }
      await mutante(rotulo, tag, de, para, comp);
    }

    // D9: EXECUTE aberto para authenticated na reemissao: a prova de ACL fica vermelha
    for (const [rotulo, sig] of [
      ["EXECUTE da reemissao para authenticated", FUNCOES.reemitir.sig],
      ["EXECUTE do diagnostico para authenticated", FUNCOES.diagnostico.sig],
    ]) {
      await comecarSem1241();
      try {
        await C.query(MIGRATION24);
        await C.query(MIGRATION);
        await C.query(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated`);
        let passou = true;
        try {
          await S.aPortaDeServidorEstaFechada();
        } catch {
          passou = false;
        }
        assert.equal(passou, false, `MUTANTE SOBREVIVEU: ${rotulo}`);
      } finally {
        await C.query("ROLLBACK");
      }
    }
    // a tabela de diagnostico aberta para authenticated: a prova de RLS/grant fica vermelha
    await comecarSem1241();
    try {
      await C.query(MIGRATION24);
      await C.query(MIGRATION);
      await C.query(
        "GRANT SELECT ON public.order_refund_diagnostico TO authenticated",
      );
      await C.query(
        "ALTER TABLE public.order_refund_diagnostico DISABLE ROW LEVEL SECURITY",
      );
      let passou = true;
      try {
        await S.aTabelaDeDiagnosticoNaoELidaPorPapelDeApi();
      } catch {
        passou = false;
      }
      assert.equal(
        passou,
        false,
        "MUTANTE SOBREVIVEU: tabela de diagnostico aberta",
      );
    } finally {
      await C.query("ROLLBACK");
    }
  },
);

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  const falhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`  ok  ${nome}`);
      } catch (e) {
        falhas.push(nome);
        console.log(
          `  FALHOU  ${nome}\n    ${String(e.stack || e.message)
            .split("\n")
            .join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  if (falhas.length) {
    falhar(
      "FALHOU",
      `${falhas.length} de ${PROVAS.length} provas da reemissao do reembolso falharam.`,
    );
  }
  console.log(
    `\n[reemissao-do-reembolso] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
}

main().catch((e) => falhar("INDETERMINADO", e.message));
