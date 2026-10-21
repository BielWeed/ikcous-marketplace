"use strict";

/**
 * Prova VIVA da migration 20261241000000 (o reembolso em dúvida prende o saldo; lote R1 do plano reembolso-ab,
 * 15/10/2026) num Postgres EFÊMERO local, sem rede, com os papéis de verdade (anon, authenticated, service_role) e
 * com o fluxo REAL do painel (`admin_devolucao_concluir`, `admin_devolucao_reembolso_por_fora`).
 *
 *  SEM DÚVIDA   pedido sem linha em dúvida: o saldo é o MESMO antes e depois da migration (em cinco formas de
 *               pedido), e o contrato do painel tem EXATAMENTE os campos combinados, sem código do Mercado Pago.
 *  LEGADO       linha falhou nascida antes da autorização e marcada mais de uma vez PRENDE o saldo, mesmo com o
 *               diagnóstico "nada saiu"; a mesma linha marcada uma vez só, não (o controle).
 *  SUBSTITUÍDA  linha falhou sem diagnóstico prende o saldo; resolvida "por fora", ela sai da conta (o manual a
 *               substitui) e o saldo não desconta duas vezes.
 *  7 DIAS       devolução e pedido cancelado: antes de 7 dias a saída responde "aguarde" e o painel diz false;
 *               com exatamente 7 dias e depois, o painel diz true e a saída passa (com a frase), marca a linha e
 *               responde risco_de_dobro; com a marca, o painel diz false e a saída não se usa duas vezes.
 *  AUTORIZAR    linha com por_fora_liberado_em: o autorizar_post_do_estorno recusa (linha_mudou), sem a marca autoriza.
 *  CORRIDA      duas conexões reais: a saída e o autorizar sobre a MESMA linha, nas duas ordens — quem chega depois
 *               espera a trava e lê o que o outro gravou (nunca as duas coisas juntas).
 *  PARCIAL      (rodada de correção, 15/10/2026) a saída do pedido cancelado só estorna o pedido quando a linha
 *               cobre TODO o saldo ainda a devolver (centavos exatos); a parcial só marca por fora, não recusa as
 *               outras linhas e o valor dela segue no saldo como "por fora" mesmo depois que a linha fecha; duas
 *               parciais somam. O painel nunca devolve disponível negativo, diz se a linha foi substituída, e a
 *               reemissão (corpo novo) recusa a linha que pode ter saído e reemite a que provadamente não saiu.
 *  MARCAS (R2)  (dívida do #890) registro em order_refund_prova com as duas marcas NULL não tira a falhou da conta
 *               em dúvida nem reserva a linha viva; a 'concluido' com concluido_em NULL e a marca por fora fica
 *               reservada, a já somada não.
 *  CORRIDA B    linha nova nasce enquanto a saída do pedido cancelado espera o pedido: a re-trava das linhas faz
 *               a marca da edge esperar e achar 0 linha (sem ela, um em_processamento fantasma num estornado).
 *  ACL          o painel e as saídas: anon sem EXECUTE, logado comum recusado (42501); as duas regras só do servidor.
 *  MIGRATION    reaplicar (2x) e CRLF = mesmo estado; o rollback devolve os corpos de antes e recusa com marca; o
 *               pré-voo recusa corpo divergente SEM escrever.
 *  MUTANTES     o mesmo comportamento esperado, rodado sobre corpos sabotados, FICA VERMELHO: sem a regra do legado,
 *               sem o filtro da substituída (nos dois lugares, e só na regra), sem a marca no autorizar, sem os 7
 *               dias na espera, sem a marca na espera, o reservado sem o filtro da marca ou sem o ramo da concluída
 *               não somada, o em dúvida (painel e saldo) tirando a linha só por ter registro de marcas.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/reembolso-em-duvida-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-non-literal-regexp --
 * Os caminhos vêm do próprio repositório (as migrations), nunca de entrada de rede; os índices
 * vêm de contadores e de listas fechadas deste arquivo; a RegExp é montada de assinaturas fixas daqui (escapadas). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");
const {
  desfazerPagamentoAdiantadoNaTransacao,
} = require("./pagamento-adiantado-posterior.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ARQ = "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

const SIG = {
  pode: "public.order_refund__pode_ter_saido(uuid)",
  espera: "public.order_refund__liberavel_apos_espera(uuid)",
  saldo: "public.pedido__saldo_a_estornar(uuid)",
  autorizar: "public.autorizar_post_do_estorno(uuid,numeric)",
  painel: "public.pedido_reembolsos_e_saldo(uuid)",
  saidaDev:
    "public.admin_devolucao_reembolso_por_fora_apos_espera(uuid,uuid,text)",
  saidaPed: "public.registrar_estorno_manual_apos_espera(uuid,uuid,text)",
  solicitar: "public.solicitar_estorno(uuid,numeric,text)",
  reemitir: "public.reemitir_reembolso_da_devolucao(uuid,uuid,uuid,jsonb)",
};
/** md5 de cada função, lido da CONFERÊNCIA FINAL do arquivo ('sig', 'lingua', 'vol', 'md5'). */
const hashDoArquivo = (sig) => {
  const m = new RegExp(
    `\\('${sig.replace(/[().]/g, "\\$&")}', '[a-z]+', '[a-z]', '([0-9a-f]{32})'\\)`,
  ).exec(MIGRATION);
  assert.ok(m, `conferência final sem ${sig}`);
  return m[1];
};

const U = {
  cliente: "7e7e2410-0000-4000-8000-0000000000c1",
  admin: "7e7e2410-0000-4000-8000-0000000000a1",
};
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});
const JWT_CLIENTE = JSON.stringify({ role: "authenticated", app_metadata: {} });
let SEQ = 0;
const idDe = (prefixo) =>
  `7e7e2410-${prefixo}-4000-8000-${String(++SEQ).padStart(12, "0")}`;

let C;
let D; // a segunda conexão das corridas
let E; // a terceira: a marca da edge e quem olha a espera das outras (achado B)
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });
const FRASE = "devolvi por fora "; // maiúsculas e espaço não importam

async function hashDe(sig, c = C) {
  return (
    (
      await c.query(
        "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
        [sig],
      )
    ).rows[0]?.h ?? null
  );
}

/** Roda `sql` como `papel`, com o JWT e o auth.uid() pedidos (dentro de uma transação aberta). */
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
const ADMIN = { uid: U.admin, claims: JWT_ADMIN };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
async function semearPessoas(c = C) {
  for (const [id, meta] of [
    [U.cliente, "{}"],
    [U.admin, '{"role":"admin"}'],
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@41.teste', $2::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, meta],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Cliente 41', 'customer'), ($2, 'Admin 41', 'admin')
     ON CONFLICT (id) DO NOTHING`,
    [U.cliente, U.admin],
  );
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1::uuid',
    [U.admin],
  );
}

/** Pedido pago pelo app. */
async function pedido(o = {}, c = C) {
  const id = o.id ?? idDe("0001");
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal,
        payment_method, payment_status, paid_at, pagamento_recebido_em, gateway_payment_id, valor_estornado)
     VALUES ($1, $2, 'Cliente 41', '{"whatsapp":"5534999990000"}'::jsonb, $3, $3, 0, $4, 'online',
             'online', $5, now() - interval '3 days', now() - interval '3 days', $6, $7)`,
    [
      id,
      U.cliente,
      o.total ?? 300,
      o.status ?? "delivered",
      o.pagamento ?? "pago",
      `ORD41-${SEQ}`,
      o.valorEstornado ?? 0,
    ],
  );
  return id;
}

/** Linha de order_refunds gravada direto (o estado que a edge e o cron teriam deixado). */
async function linha(orderId, o = {}, c = C) {
  const r = await c.query(
    `INSERT INTO public.order_refunds
       (order_id, amount, solicitado_por, status, tentativas, criada_sob_autorizacao, post_autorizado_em,
        concluido_em, mp_refund_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now()))
     RETURNING id`,
    [
      orderId,
      o.valor ?? 100,
      o.por ?? "lojista",
      o.status ?? "falhou",
      o.tentativas ?? 1,
      o.sobAutorizacao === undefined ? true : o.sobAutorizacao,
      o.postEm ?? null,
      o.concluidoEm ?? null,
      o.mp ?? null,
      o.criadaEm ?? null,
    ],
  );
  return r.rows[0].id;
}
const nadaSaiu = (refund, c = C) =>
  c.query(
    "INSERT INTO public.order_refund_diagnostico (refund_id, mp_codigo) VALUES ($1, 'insufficient_money_for_refund')",
    [refund],
  );

async function devolucaoRecebida(orderId, valor = 100, c = C) {
  const id = idDe("0002");
  await c.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade, metodo_retorno,
        status, valor_itens, valor_frete_ida, prazo_ate, politica)
     VALUES ($1::uuid, 'DEV-41-' || substr($1::text, 31), $2::uuid, $3::uuid, 'arrependimento', 'desisti', 'reembolso',
             'nacional', 'envio_proprio', 'recebida', $4, 0, current_date + 7, '{}'::jsonb)`,
    [id, orderId, U.cliente, valor],
  );
  return id;
}
/** Pedido + devolução concluída pelo painel (RPC real): a linha nasce 'solicitado'. */
async function devolucaoConcluida({ total = 300, valor = 100 } = {}) {
  await semearPessoas();
  const orderId = await pedido({ total });
  const dev = await devolucaoRecebida(orderId, valor);
  const r = await como(
    "authenticated",
    "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', '[]'::jsonb, $2::numeric, NULL) AS r",
    [dev, valor],
    ADMIN,
  );
  const refund = r[0].r.refund_id;
  assert.ok(refund, "a conclusão pelo painel não criou a linha");
  return { orderId, dev, refund };
}

const saldo = async (orderId, c = C) =>
  Number(
    (
      await c.query("SELECT public.pedido__saldo_a_estornar($1) AS s", [
        orderId,
      ])
    ).rows[0].s,
  );
const pode = async (refund) =>
  (
    await C.query("SELECT public.order_refund__pode_ter_saido($1) AS p", [
      refund,
    ])
  ).rows[0].p;
const painel = async (orderId) =>
  (
    await como(
      "authenticated",
      "SELECT public.pedido_reembolsos_e_saldo($1) AS r",
      [orderId],
      ADMIN,
    )
  )[0].r;
const linhaDoPainel = async (orderId, refund) =>
  (await painel(orderId)).linhas.find((l) => l.id === refund);
const marcas = async (refund) =>
  (
    await C.query(
      "SELECT substituida_por_manual_em, por_fora_liberado_em FROM public.order_refund_prova WHERE refund_id = $1",
      [refund],
    )
  ).rows[0] ?? null;
const saidaDev = async (dev, refund, frase = FRASE) =>
  (
    await como(
      "authenticated",
      "SELECT public.admin_devolucao_reembolso_por_fora_apos_espera($1, $2, $3) AS r",
      [dev, refund, frase],
      ADMIN,
    )
  )[0].r;
const saidaPed = async (orderId, refund, frase = FRASE) =>
  (
    await como(
      "authenticated",
      "SELECT public.registrar_estorno_manual_apos_espera($1, $2, $3) AS r",
      [orderId, refund, frase],
      ADMIN,
    )
  )[0].r;
const autorizar = async (refund, valor, c = C) =>
  (
    await como(
      "service_role",
      "SELECT public.autorizar_post_do_estorno($1, $2) AS r",
      [refund, valor],
      {},
      c,
    )
  )[0].r;

/** Uma transação por caso, sempre desfeita; a migration tem de estar no ar (a árvore migrada). */
async function emTransacao(fn) {
  await C.query("BEGIN");
  try {
    assert.equal(
      await hashDe(SIG.pode),
      hashDoArquivo(SIG.pode),
      "o clone não está com a 20261241000000 no ar",
    );
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

// ---------------------------------------------------------------------------
// Os comportamentos (cada um roda também sob os mutantes)
// ---------------------------------------------------------------------------

/** Pedidos SEM linha em dúvida: o saldo de cada um, antes e depois da migration, tem de ser igual. */
async function semDuvidaSaldoIgual() {
  await semearPessoas();
  const pedidos = [];
  pedidos.push(await pedido({ total: 300 })); // sem linha nenhuma
  {
    const o = await pedido({ total: 300, valorEstornado: 20 });
    await linha(o, { status: "solicitado", valor: 50 });
    await linha(o, {
      status: "em_processamento",
      valor: 30,
      postEm: new Date(),
    });
    await linha(o, {
      status: "concluido",
      valor: 20,
      concluidoEm: new Date(),
      mp: "MP-41-A",
    });
    await linha(o, {
      status: "concluido",
      valor: 10,
      concluidoEm: null,
      mp: "MP-41-B",
    });
    pedidos.push(o);
  }
  {
    const o = await pedido({ total: 300 });
    const dev = await devolucaoRecebida(o, 40);
    await C.query(
      "UPDATE public.devolucoes SET status = 'concluida', resolucao_final = 'reembolso', reembolso_manual = true, valor_reembolso = 40 WHERE id = $1",
      [dev],
    );
    pedidos.push(o);
  }
  {
    // linhas mortas em que NADA saiu: falhou com o diagnóstico da lista fechada; recusado sem POST
    const o = await pedido({ total: 300 });
    const f = await linha(o, { status: "falhou", valor: 25, tentativas: 3 });
    await nadaSaiu(f);
    await linha(o, { status: "recusado", valor: 15, tentativas: 2 });
    pedidos.push(o);
  }
  {
    // a linha do sistema (devolução feita no painel do MP) já somada
    const o = await pedido({ total: 300, valorEstornado: 60 });
    await linha(o, {
      por: "sistema",
      status: "concluido",
      valor: 60,
      concluidoEm: new Date(),
      mp: "SYS-41",
    });
    pedidos.push(o);
  }
  const depois = [];
  for (const o of pedidos) depois.push(await saldo(o));
  assert.deepEqual(depois, [300, 190, 260, 300, 240], "saldo depois");
  for (const o of pedidos) {
    const p = await painel(o);
    assert.equal(Number(p.em_duvida), 0, "nada em dúvida");
    assert.equal(Number(p.disponivel), await saldo(o), "o painel é o saldo");
  }
  // ANTES: o rollback na MESMA transação (nenhuma marca: ele pode desfazer). A 20261343000000 redefine
  // admin_devolucao_concluir depois da 241 e o pré-voo do rollback recusa com o corpo dela no ar: desfaz-se
  // a 343 (a mais nova) primeiro, como nas demais provas que desfazem uma ancestral (o saldo medido acima
  // já foi com a 343 no ar; as funções de saldo não são as dela).
  await require("./reembolso-manual-reserva-posterior.cjs").desfazerReembolsoManualReservaNaTransacao(
    C,
  );
  assert.equal(await aplicar(ROLLBACK), null, "o rollback não aplicou");
  const antes = [];
  for (const o of pedidos) antes.push(await saldo(o));
  assert.deepEqual(
    antes,
    depois,
    "o saldo de pedido sem linha em dúvida mudou com a migration",
  );
}

/** O contrato do painel: os NOMES combinados, nada a mais, nenhum código do MP. */
async function contratoDoPainel() {
  await semearPessoas();
  const o = await pedido({ total: 200 });
  const f = await linha(o, { status: "falhou", valor: 70, tentativas: 1 });
  await nadaSaiu(f);
  await linha(o, { status: "em_processamento", valor: 30, postEm: new Date() });
  const p = await painel(o);
  assert.deepEqual(Object.keys(p).sort(), [
    "disponivel",
    "em_duvida",
    "em_voo",
    "linhas",
    "manual",
    "reservado_por_fora",
    "total",
    "valor_estornado",
  ]);
  assert.equal(Number(p.reservado_por_fora), 0, "nada resolvido por fora");
  assert.equal(p.linhas.length, 2);
  for (const l of p.linhas)
    assert.deepEqual(Object.keys(l).sort(), [
      "amount",
      "eh_pix",
      "id",
      "pode_ter_saido",
      "por_fora_apos_espera_liberado",
      "por_fora_liberado_em",
      "status",
      "substituida_por_manual",
    ]);
  const txt = JSON.stringify(p);
  assert.ok(
    !/insufficient|mp_codigo|order_payment_not_yet/.test(txt),
    "código do MP vazou",
  );
  assert.equal(Number(p.total), 200);
  assert.equal(Number(p.em_voo), 30);
  assert.equal(Number(p.em_duvida), 0);
  assert.equal(Number(p.disponivel), 170);
  assert.equal(p.linhas.find((l) => l.id === f).pode_ter_saido, false);
  assert.equal(p.linhas[0].eh_pix, true, "metodo_online NULL conta como PIX");
}

/** LEGADO: falhou nascida antes da autorização, marcada 2x, PRENDE o saldo mesmo com "nada saiu". */
async function legadoPrende() {
  await semearPessoas();
  const o = await pedido({ total: 100, status: "cancelled" });
  const l = await linha(o, {
    status: "falhou",
    valor: 100,
    tentativas: 2,
    sobAutorizacao: null,
  });
  await nadaSaiu(l);
  assert.equal(await pode(l), true, "a linha legada marcada 2x PODE ter saído");
  assert.equal(await saldo(o), 0, "a linha legada prende o saldo inteiro");
  assert.equal(Number((await painel(o)).em_duvida), 100);
  const r = await tentar(
    "authenticated",
    "SELECT public.solicitar_estorno($1, 100, 'de novo') AS r",
    [o],
    ADMIN,
  );
  assert.match(
    r.erro ?? "",
    /maior que o valor disponível/,
    "pediu de novo o que pode já ter saído",
  );
  // controle: a mesma linha marcada UMA vez só (o diagnóstico vale) não prende
  const o2 = await pedido({ total: 100, status: "cancelled" });
  const l2 = await linha(o2, {
    status: "falhou",
    valor: 100,
    tentativas: 1,
    sobAutorizacao: null,
  });
  await nadaSaiu(l2);
  assert.equal(await pode(l2), false);
  assert.equal(await saldo(o2), 100);
}

/** SUBSTITUÍDA: falhou sem diagnóstico prende; resolvida por fora, sai da conta (o manual a substitui). */
async function substituidaSolta() {
  const { orderId, dev, refund } = await devolucaoConcluida({
    total: 300,
    valor: 100,
  });
  await C.query(
    "UPDATE public.order_refunds SET status = 'falhou', ultimo_erro = 'x', tentativas = 1 WHERE id = $1",
    [refund],
  );
  assert.equal(
    await pode(refund),
    true,
    "falhou sem diagnóstico pode ter saído",
  );
  assert.equal(await saldo(orderId), 200, "a linha em dúvida prende 100");
  const r = (
    await como(
      "authenticated",
      "SELECT public.admin_devolucao_reembolso_por_fora($1, $2) AS r",
      [dev, refund],
      ADMIN,
    )
  )[0].r;
  assert.equal(r.risco_de_dobro, true, "o risco é lido ANTES da marca");
  assert.ok(
    (await marcas(refund))?.substituida_por_manual_em,
    "a linha não foi marcada substituída",
  );
  assert.equal(
    (await linhaDoPainel(orderId, refund)).pode_ter_saido,
    false,
    "substituída não pode ter saído",
  );
  // (achado D) o painel DIZ que a linha foi substituída: o false acima é "não conta como dúvida",
  // não "o dinheiro não saiu" — a tela não oferece "Tentar de novo" nela
  assert.equal(
    (await linhaDoPainel(orderId, refund)).substituida_por_manual,
    true,
    "o painel não diz que a linha foi substituída",
  );
  const p = await painel(orderId);
  assert.equal(Number(p.manual), 100);
  assert.equal(Number(p.em_duvida), 0, "a substituída saiu da conta em dúvida");
  assert.equal(
    await saldo(orderId),
    200,
    "descontou duas vezes o mesmo reembolso",
  );
}

/** 7 DIAS na devolução: aguarde antes, passa com exatamente 7 e depois, marca e não se usa duas vezes. */
async function seteDiasDevolucao() {
  const { orderId, dev, refund } = await devolucaoConcluida({
    total: 300,
    valor: 100,
  });
  const posta = (expr) =>
    C.query(
      `UPDATE public.order_refunds SET status = 'em_processamento', post_autorizado_em = now() - (${expr}) WHERE id = $1`,
      [refund],
    );
  await posta("interval '3 days'");
  assert.equal(
    (await linhaDoPainel(orderId, refund)).por_fora_apos_espera_liberado,
    false,
    "3 dias: o botão não aparece",
  );
  let r = await saidaDev(dev, refund);
  assert.equal(r.resultado, "aguarde");
  assert.equal(r.detalhe, "antes_de_7_dias");
  assert.ok(r.liberado_a_partir_de);
  assert.equal(await marcas(refund), null, "aguarde não marca");
  await posta("interval '7 days' - interval '1 second'");
  assert.equal(
    (await linhaDoPainel(orderId, refund)).por_fora_apos_espera_liberado,
    false,
    "1 s antes dos 7 dias",
  );
  assert.equal((await saidaDev(dev, refund)).resultado, "aguarde");
  await posta("interval '7 days'");
  assert.equal(
    (await linhaDoPainel(orderId, refund)).por_fora_apos_espera_liberado,
    true,
    "com exatamente 7 dias o botão aparece",
  );
  // sem a frase, nada acontece
  const semFrase = await tentar(
    "authenticated",
    "SELECT public.admin_devolucao_reembolso_por_fora_apos_espera($1, $2, 'sim') AS r",
    [dev, refund],
    ADMIN,
  );
  assert.equal(semFrase.codigo, "22023");
  assert.equal(await marcas(refund), null);
  // linha errada: a tela via outra
  r = await saidaDev(dev, idDe("0009"));
  assert.equal(r.resultado, "reembolso_mudou");
  r = await saidaDev(dev, refund);
  assert.equal(r.resultado, "combinado");
  assert.equal(r.risco_de_dobro, true);
  const m = await marcas(refund);
  assert.ok(
    m?.por_fora_liberado_em && m?.substituida_por_manual_em,
    "as duas marcas",
  );
  const d = (
    await C.query(
      "SELECT refund_id, reembolso_manual FROM public.devolucoes WHERE id = $1",
      [dev],
    )
  ).rows[0];
  assert.equal(d.refund_id, null);
  assert.equal(d.reembolso_manual, true);
  const l = await linhaDoPainel(orderId, refund);
  assert.ok(l.por_fora_liberado_em, "o painel mostra a marca");
  assert.equal(
    l.por_fora_apos_espera_liberado,
    false,
    "com a marca o botão some",
  );
  assert.equal(
    (await saidaDev(dev, refund)).resultado,
    "ja_concluido",
    "a saída não se usa duas vezes",
  );
  assert.equal(
    (await autorizar(refund, 100)).decisao,
    "linha_mudou",
    "o robô não envia a linha liberada por fora",
  );
  // a linha segue em_processamento (o robô ainda consulta o MP): o saldo desconta a linha E o manual — o lado seguro
  assert.equal(await saldo(orderId), 100);
}

/** A espera respeita a marca por_fora_liberado_em sozinha (sem a substituída). */
async function esperaRespeitaAMarca() {
  await semearPessoas();
  const o = await pedido({ total: 100, status: "cancelled" });
  const l = await linha(o, {
    status: "em_processamento",
    valor: 100,
    postEm: new Date(Date.now() - 9 * 864e5),
  });
  assert.equal((await linhaDoPainel(o, l)).por_fora_apos_espera_liberado, true);
  await C.query(
    "INSERT INTO public.order_refund_prova (refund_id, por_fora_liberado_em) VALUES ($1, now())",
    [l],
  );
  const lp = await linhaDoPainel(o, l);
  assert.ok(lp.por_fora_liberado_em);
  assert.equal(
    lp.por_fora_apos_espera_liberado,
    false,
    "com a marca preenchida o botão não aparece",
  );
  // e uma falhou que pode ter saído, com 8 dias, também libera; a que nada saiu, não (ela tem a saída de sempre)
  const o2 = await pedido({ total: 100, status: "cancelled" });
  const l2 = await linha(o2, {
    status: "falhou",
    valor: 100,
    postEm: new Date(Date.now() - 8 * 864e5),
  });
  assert.equal(
    (await linhaDoPainel(o2, l2)).por_fora_apos_espera_liberado,
    true,
  );
  await nadaSaiu(l2);
  assert.equal(
    (await linhaDoPainel(o2, l2)).por_fora_apos_espera_liberado,
    false,
  );
}

/** 7 DIAS no pedido cancelado. */
async function seteDiasPedido() {
  await semearPessoas();
  const o = await pedido({ total: 100, status: "cancelled" });
  const l = await linha(o, {
    status: "em_processamento",
    valor: 100,
    postEm: new Date(Date.now() - 3 * 864e5),
  });
  assert.equal(
    (await linhaDoPainel(o, l)).por_fora_apos_espera_liberado,
    false,
  );
  assert.equal((await saidaPed(o, l)).resultado, "aguarde");
  await C.query(
    "UPDATE public.order_refunds SET post_autorizado_em = now() - interval '8 days' WHERE id = $1",
    [l],
  );
  assert.equal((await linhaDoPainel(o, l)).por_fora_apos_espera_liberado, true);
  const r = await saidaPed(o, l);
  assert.equal(r.resultado, "registrado");
  assert.equal(r.risco_de_dobro, true);
  assert.equal(
    (
      await C.query(
        "SELECT payment_status FROM public.marketplace_orders WHERE id = $1",
        [o],
      )
    ).rows[0].payment_status,
    "estornado",
  );
  assert.ok((await marcas(l))?.por_fora_liberado_em);
  assert.equal((await autorizar(l, 100)).decisao, "linha_mudou");
  // a falhou em que NADA saiu não espera: é o "Já estornei" de sempre
  const o2 = await pedido({ total: 100, status: "cancelled" });
  const l2 = await linha(o2, { status: "falhou", valor: 100 });
  await nadaSaiu(l2);
  assert.equal((await saidaPed(o2, l2)).resultado, "sem_espera");
}

/** AUTORIZAR recusa a linha liberada por fora; sem a marca autoriza (o controle). */
async function autorizarRecusaMarcada() {
  await semearPessoas();
  const o = await pedido({ total: 100, status: "cancelled" });
  const l = await linha(o, { status: "em_processamento", valor: 100 });
  await C.query(
    "INSERT INTO public.order_refund_prova (refund_id, por_fora_liberado_em) VALUES ($1, now())",
    [l],
  );
  assert.equal((await autorizar(l, 100)).decisao, "linha_mudou");
  const o2 = await pedido({ total: 100, status: "cancelled" });
  const l2 = await linha(o2, { status: "em_processamento", valor: 100 });
  assert.equal((await autorizar(l2, 100)).decisao, "autorizado");
  // só a substituída (sem a marca por fora) NÃO trava o envio: o robô ainda pode concluir pelo MP
  const o3 = await pedido({ total: 100, status: "cancelled" });
  const l3 = await linha(o3, { status: "em_processamento", valor: 100 });
  await C.query(
    "INSERT INTO public.order_refund_prova (refund_id, substituida_por_manual_em) VALUES ($1, now())",
    [l3],
  );
  assert.equal((await autorizar(l3, 100)).decisao, "autorizado");
}

const oito = () => new Date(Date.now() - 8 * 864e5);
const pedidoDe = async (o) =>
  (
    await C.query(
      "SELECT payment_status, estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
      [o],
    )
  ).rows[0];
const statusDe = async (refund, c = C) =>
  (
    await c.query("SELECT status FROM public.order_refunds WHERE id = $1", [
      refund,
    ])
  ).rows[0].status;

/** PARCIAL (achado A, Codex P1): linha de R$ 100 num pedido de R$ 300 — o pedido NÃO vira estornado. */
async function parcialNaoEstorna() {
  await semearPessoas();
  const o = await pedido({ total: 300, status: "cancelled" });
  const l = await linha(o, {
    status: "em_processamento",
    valor: 100,
    postEm: oito(),
  });
  const s = await linha(o, { status: "solicitado", valor: 50 });
  assert.equal(await saldo(o), 150, "antes: 300 − 100 − 50 em voo");
  const r = await saidaPed(o, l);
  assert.equal(r.resultado, "registrado");
  assert.equal(r.detalhe, "parcial", "100 num pedido de 300 é PARCIAL");
  assert.equal(r.risco_de_dobro, true);
  assert.equal(Number(r.ainda_a_devolver), 200);
  const ped = await pedidoDe(o);
  assert.equal(
    ped.payment_status,
    "pago",
    "a saída parcial marcou o pedido INTEIRO como estornado (esconde os 200 que faltam)",
  );
  assert.equal(ped.estorno_manual_registrado_em, null);
  assert.equal(
    await statusDe(s),
    "solicitado",
    "a saída parcial recusou outra linha",
  );
  const m = await marcas(l);
  assert.ok(m?.por_fora_liberado_em, "a marca por fora");
  assert.equal(m.substituida_por_manual_em, null);
  const lp = await linhaDoPainel(o, l);
  assert.equal(lp.por_fora_apos_espera_liberado, false);
  assert.equal(lp.substituida_por_manual, false);
  assert.equal((await saidaPed(o, l)).resultado, "ja_concluido");
  assert.equal((await autorizar(l, 100)).decisao, "linha_mudou");
  // em voo E por fora (o lado seguro, como a saída da devolução): 300 − 150 em voo − 100 por fora
  assert.equal(await saldo(o), 50);
  // a tela diz que os 100 estão RESERVADOS até o MP responder (nunca "tudo devolvido")
  assert.equal(
    Number((await painel(o)).reservado_por_fora),
    100,
    "o painel não diz quanto está reservado",
  );
  // o robô fecha a linha como falhou e "nada saiu": os 100 pagos por fora SEGUEM descontados
  await C.query(
    "UPDATE public.order_refunds SET status = 'falhou' WHERE id = $1",
    [l],
  );
  await nadaSaiu(l);
  assert.equal(
    await saldo(o),
    150,
    "o por fora parcial voltou ao saldo quando a linha fechou (a loja pagaria de novo)",
  );
  const p = await painel(o);
  assert.equal(Number(p.manual), 100);
  assert.equal(Number(p.em_duvida), 0, "o por fora não conta duas vezes");
  assert.equal(Number(p.disponivel), 150);
  assert.equal(
    Number(p.reservado_por_fora),
    0,
    "a linha fechou: nada mais reservado",
  );
  const de = await tentar(
    "authenticated",
    "SELECT public.solicitar_estorno($1, 200, 'o resto') AS r",
    [o],
    ADMIN,
  );
  assert.match(de.erro ?? "", /maior que o valor disponível/);
}

/** TOTAL (achado A): a linha cobre TODO o saldo ainda a devolver -> estornado; centavos exatos. */
async function totalEstorna() {
  await semearPessoas();
  const o = await pedido({
    total: 300,
    status: "cancelled",
    valorEstornado: 200,
  });
  const l = await linha(o, {
    status: "em_processamento",
    valor: 100,
    postEm: oito(),
  });
  const s = await linha(o, { status: "solicitado", valor: 30 });
  const r = await saidaPed(o, l);
  assert.equal(r.resultado, "registrado");
  assert.equal(r.detalhe, "apos_espera", "100 de 100 que faltavam é TOTAL");
  assert.equal(r.payment_status, "estornado");
  const ped = await pedidoDe(o);
  assert.equal(ped.payment_status, "estornado");
  assert.ok(ped.estorno_manual_registrado_em);
  assert.equal(await statusDe(s), "recusado", "a solicitada sai da fila");
  const m = await marcas(l);
  assert.ok(m?.por_fora_liberado_em && m?.substituida_por_manual_em);
  // um centavo a menos é PARCIAL (numeric, sem float)
  const o2 = await pedido({ total: 100, status: "cancelled" });
  const l2 = await linha(o2, {
    status: "em_processamento",
    valor: 99.99,
    postEm: oito(),
  });
  const r2 = await saidaPed(o2, l2);
  assert.equal(r2.detalhe, "parcial", "99,99 de 100,00 não é o saldo todo");
  assert.equal(r2.ainda_a_devolver, 0.01);
  assert.equal((await pedidoDe(o2)).payment_status, "pago");
}

/** Duas saídas PARCIAIS: a segunda conta o que a primeira já pagou por fora e fecha o pedido. */
async function duasParciaisFecham() {
  await semearPessoas();
  const o = await pedido({ total: 300, status: "cancelled" });
  const l1 = await linha(o, { status: "falhou", valor: 200, postEm: oito() });
  const l2 = await linha(o, { status: "falhou", valor: 100, postEm: oito() });
  assert.equal(await saldo(o), 0, "as duas em dúvida prendem tudo");
  const r1 = await saidaPed(o, l1);
  assert.equal(r1.detalhe, "parcial");
  assert.equal((await pedidoDe(o)).payment_status, "pago");
  assert.equal(await saldo(o), 0, "200 por fora + 100 em dúvida");
  // (R2 da releitura) a parcial ainda 'falhou' e que PODE ter saído conta SÓ como por fora, nunca em dúvida
  const p1 = await painel(o);
  assert.equal(
    Number(p1.em_duvida),
    100,
    "a linha parcial por fora contou também em dúvida",
  );
  assert.equal(Number(p1.manual), 200);
  assert.equal(Number(p1.reservado_por_fora), 0, "falhou não está viva no MP");
  const r2 = await saidaPed(o, l2);
  assert.equal(
    r2.detalhe,
    "apos_espera",
    "a segunda não somou o que a primeira já pagou por fora",
  );
  assert.equal((await pedidoDe(o)).payment_status, "estornado");
}

/**
 * (R2 da releitura) A ÚNICA linha do pedido, 'falhou' e que PODE ter saído, resolvida por fora
 * pela saída PARCIAL: o painel diz em_duvida = 0 (ela conta só como por fora, nunca em dúvida).
 */
async function parcialPorForaNaoFicaEmDuvida() {
  await semearPessoas();
  const o = await pedido({ total: 300, status: "cancelled" });
  const l = await linha(o, { status: "falhou", valor: 200, postEm: oito() });
  const antes = await painel(o);
  assert.equal(Number(antes.em_duvida), 200, "antes da saída: em dúvida");
  const r = await saidaPed(o, l);
  assert.equal(r.detalhe, "parcial");
  assert.equal(await statusDe(l), "falhou", "a linha segue 'falhou'");
  const p = await painel(o);
  assert.equal(
    Number(p.em_duvida),
    0,
    "a linha parcial por fora (falhou, pode ter saído) contou em dúvida",
  );
  assert.equal(Number(p.manual), 200);
  assert.equal(Number(p.disponivel), 100);
  assert.equal(Number(p.reservado_por_fora), 0, "falhou não está viva no MP");
}

/**
 * (R2 do revisor do #890) Registro em order_refund_prova SEM a marca por fora (as duas marcas NULL: nenhuma porta
 * grava esse estado hoje, mas os filtros têm de tratar). Quem decide é a MARCA, não a existência do registro: a
 * linha viva NÃO fica reservada por fora e a falhou que pode ter saído SEGUE em dúvida.
 */
async function registroSemMarcaNaoEPorFora() {
  await semearPessoas();
  const o = await pedido({ total: 300, status: "cancelled" });
  const viva = await linha(o, {
    status: "em_processamento",
    valor: 100,
    postEm: new Date(),
  });
  const duvida = await linha(o, { status: "falhou", valor: 50, tentativas: 1 });
  await C.query(
    "INSERT INTO public.order_refund_prova (refund_id, substituida_por_manual_em, por_fora_liberado_em) VALUES ($1, NULL, NULL), ($2, NULL, NULL)",
    [viva, duvida],
  );
  assert.equal(
    await pode(duvida),
    true,
    "falhou sem diagnóstico pode ter saído",
  );
  const p = await painel(o);
  assert.equal(Number(p.em_voo), 100);
  assert.equal(
    Number(p.em_duvida),
    50,
    "o registro SEM a marca por fora tirou a linha da conta em dúvida",
  );
  assert.equal(
    Number(p.reservado_por_fora),
    0,
    "o registro SEM a marca por fora reservou a linha viva",
  );
  assert.equal(Number(p.manual), 0);
  assert.equal(Number(p.disponivel), 150, "300 − 100 em voo − 50 em dúvida");
  assert.equal(await saldo(o), 150, "o saldo contou diferente do painel");
}

/**
 * (R2 do revisor do #890) A linha 'concluido' com concluido_em NULL (o MP respondeu, o valor ainda não foi somado
 * a valor_estornado) e com a marca por fora segue RESERVADA, como a viva. A concluída JÁ somada (concluido_em
 * preenchido), com a mesma marca, não é reservada (o controle).
 */
async function concluidaNaoSomadaSegueReservada() {
  await semearPessoas();
  const o = await pedido({
    total: 300,
    status: "cancelled",
    valorEstornado: 40,
  });
  const naoSomada = await linha(o, {
    status: "concluido",
    valor: 100,
    concluidoEm: null,
    mp: `MP-41-NS-${SEQ}`,
  });
  const somada = await linha(o, {
    status: "concluido",
    valor: 40,
    concluidoEm: new Date(),
    mp: `MP-41-S-${SEQ}`,
  });
  await C.query(
    "INSERT INTO public.order_refund_prova (refund_id, por_fora_liberado_em) VALUES ($1, now()), ($2, now())",
    [naoSomada, somada],
  );
  const p = await painel(o);
  assert.equal(Number(p.em_voo), 100, "a concluída não somada está em voo");
  assert.equal(
    Number(p.reservado_por_fora),
    100,
    "a concluída AINDA NÃO SOMADA com a marca por fora não ficou reservada (ou a já somada entrou)",
  );
  assert.equal(Number(p.em_duvida), 0);
  assert.equal(Number(p.manual), 140, "o por fora conta em qualquer status");
  assert.equal(Number(p.disponivel), 20, "300 − 40 − 100 em voo − 140 manual");
  assert.equal(await saldo(o), 20, "o saldo contou diferente do painel");
}

/** DISPONÍVEL nunca negativo no painel (achado C): 100 − 100 em voo − 100 manual. */
async function disponivelNuncaNegativo() {
  const { orderId, dev, refund } = await devolucaoConcluida({
    total: 100,
    valor: 100,
  });
  await C.query(
    "UPDATE public.order_refunds SET status = 'em_processamento', post_autorizado_em = now() - interval '8 days' WHERE id = $1",
    [refund],
  );
  assert.equal((await saidaDev(dev, refund)).resultado, "combinado");
  assert.equal(await saldo(orderId), -100, "a conta crua (quem chama decide)");
  const p = await painel(orderId);
  assert.equal(Number(p.em_voo), 100);
  assert.equal(Number(p.manual), 100);
  assert.equal(
    Number(p.disponivel),
    0,
    "o painel devolveu disponível NEGATIVO",
  );
  assert.equal(
    Number(p.reservado_por_fora),
    100,
    "o painel não diz quanto está reservado",
  );
}

const reemitir = async (dev, refund, consulta) =>
  (
    await como(
      "service_role",
      "SELECT public.reemitir_reembolso_da_devolucao($1, $2, $3, $4::jsonb) AS r",
      [dev, U.admin, refund, JSON.stringify(consulta)],
    )
  )[0].r;

/** REEMISSÃO pelo corpo NOVO (achado E): a regra única decide se a linha pode ganhar tentativa nova. */
async function reemissaoPelaRegraUnica() {
  // (1) falhou que PODE ter saído (sem diagnóstico): sem prova de que não saiu, nunca reemite
  const a = await devolucaoConcluida({ total: 300, valor: 100 });
  await C.query(
    "UPDATE public.order_refunds SET status = 'falhou', ultimo_erro = 'x', tentativas = 1 WHERE id = $1",
    [a.refund],
  );
  let r = await reemitir(a.dev, a.refund, { resultado: "nao_achou" });
  assert.equal(
    r.resultado,
    "use_por_fora",
    "reemitiu a linha cujo dinheiro pode ter saído",
  );
  assert.equal(r.detalhe, "sem_prova_de_que_nao_saiu");
  // (2) falhou PROVADAMENTE sem POST (código da lista fechada, sem carimbo de POST incerto): reemite
  const b = await devolucaoConcluida({ total: 300, valor: 100 });
  await C.query(
    "UPDATE public.order_refunds SET status = 'falhou', ultimo_erro = 'x', tentativas = 1 WHERE id = $1",
    [b.refund],
  );
  await nadaSaiu(b.refund);
  r = await reemitir(b.dev, b.refund, { resultado: "nao_achou" });
  assert.equal(
    r.resultado,
    "reemitido",
    "a linha em que nada saiu não reemitiu",
  );
  assert.equal(r.refund_anterior, b.refund);
}

prova(
  "SEM DÚVIDA: o saldo de cinco formas de pedido sem linha em dúvida é o MESMO antes e depois da migration",
  () => emTransacao(semDuvidaSaldoIgual),
);
prova(
  "CONTRATO: o painel devolve exatamente os campos combinados, por linha também, e nenhum código do MP",
  () => emTransacao(contratoDoPainel),
);
prova(
  "LEGADO: a falhou nascida antes da autorização e marcada 2x prende o saldo (e o pedido de novo é recusado); marcada 1x não",
  () => emTransacao(legadoPrende),
);
prova(
  "SUBSTITUÍDA: a falhou sem diagnóstico prende; resolvida por fora sai da conta em dúvida e o saldo não desconta duas vezes",
  () => emTransacao(substituidaSolta),
);
prova(
  "7 DIAS (devolução): aguarde com 3 dias e com 7 dias menos 1 s; com exatamente 7 passa só com a frase, marca, some o botão, não repete, e o autorizar recusa",
  () => emTransacao(seteDiasDevolucao),
);
prova(
  "7 DIAS (botão): a marca por fora sozinha desliga o botão; falhou que pode ter saído libera, a que nada saiu não",
  () => emTransacao(esperaRespeitaAMarca),
);
prova(
  "7 DIAS (pedido cancelado): aguarde antes, registrado depois (estornado, marca, autorizar recusa); nada saiu = sem_espera",
  () => emTransacao(seteDiasPedido),
);
prova(
  "AUTORIZAR: linha com por_fora_liberado_em -> linha_mudou; sem marca, ou só substituída -> autorizado",
  () => emTransacao(autorizarRecusaMarcada),
);
prova(
  "PARCIAL (A): linha de 100 num pedido de 300 -> registrado/parcial, pedido segue pago, a solicitada fica, só a marca por fora; os 100 seguem no saldo mesmo quando a linha fecha",
  () => emTransacao(parcialNaoEstorna),
);
prova(
  "TOTAL (A): a linha que cobre todo o saldo ainda a devolver estorna o pedido e recusa a solicitada; 99,99 de 100,00 é parcial",
  () => emTransacao(totalEstorna),
);
prova(
  "DUAS PARCIAIS (A): 200 e depois 100 num pedido de 300 -> a segunda conta o por fora da primeira e estorna",
  () => emTransacao(duasParciaisFecham),
);
prova(
  "PARCIAL POR FORA (R2): a única linha, falhou e que pode ter saído, resolvida pela saída parcial -> o painel diz em_duvida = 0",
  () => emTransacao(parcialPorForaNaoFicaEmDuvida),
);
prova(
  "REGISTRO SEM MARCA (R2 do #890): order_refund_prova com as duas marcas NULL -> a viva não é reservada, a falhou que pode ter saído segue em dúvida",
  () => emTransacao(registroSemMarcaNaoEPorFora),
);
prova(
  "CONCLUÍDA NÃO SOMADA (R2 do #890): 'concluido' com concluido_em NULL e a marca por fora fica reservada; a já somada não",
  () => emTransacao(concluidaNaoSomadaSegueReservada),
);
prova(
  "DISPONÍVEL (C): 100 − 100 em voo − 100 manual = −100 na conta crua; o painel devolve 0",
  () => emTransacao(disponivelNuncaNegativo),
);
prova(
  "REEMISSÃO (E): corpo novo de reemitir_reembolso_da_devolucao — falhou que pode ter saído recusa; falhou provadamente sem POST reemite",
  () => emTransacao(reemissaoPelaRegraUnica),
);

prova(
  "ACL: anon sem EXECUTE nas três portas; logado comum recusado (42501); as duas regras fechadas até ao service_role",
  () =>
    emTransacao(async () => {
      await semearPessoas();
      const o = await pedido();
      for (const [sql, params] of [
        ["SELECT public.pedido_reembolsos_e_saldo($1)", [o]],
        [
          "SELECT public.admin_devolucao_reembolso_por_fora_apos_espera($1, $1, 'x')",
          [o],
        ],
        [
          "SELECT public.registrar_estorno_manual_apos_espera($1, $1, 'x')",
          [o],
        ],
      ]) {
        const a = await tentar("anon", sql, params);
        assert.equal(a.codigo, "42501", `anon executou: ${sql}`);
        const c = await tentar("authenticated", sql, params, {
          uid: U.cliente,
          claims: JWT_CLIENTE,
        });
        assert.equal(c.codigo, "42501", `logado comum passou: ${sql}`);
      }
      for (const sig of [SIG.pode, SIG.espera]) {
        for (const papel of ["service_role", "authenticated", "anon"]) {
          const r = await tentar(
            papel,
            `SELECT ${sig.replace("(uuid)", "")}($1)`,
            [o],
            ADMIN,
          );
          assert.equal(r.codigo, "42501", `${papel} executou ${sig}`);
        }
      }
      const t = await tentar(
        "authenticated",
        "SELECT * FROM public.order_refund_prova",
        [],
        ADMIN,
      );
      assert.equal(t.codigo, "42501", "o logado leu a tabela de marcas");
    }),
);

prova(
  "MIGRATION: reaplicar 2x e em CRLF = mesmos corpos; rollback devolve os de antes e é idempotente; recusa com marca; pré-voo recusa corpo divergente SEM escrever",
  () =>
    emTransacao(async () => {
      // Só esta prova reaplica a 241; as demais medem o corpo de produção.
      await require("./reembolso-manual-reserva-posterior.cjs").desfazerReembolsoManualReservaNaTransacao(
        C,
      );
      await desfazerPagamentoAdiantadoNaTransacao(C);
      const sigs = Object.values(SIG);
      const antes = {};
      for (const s of sigs) antes[s] = await hashDe(s);
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await aplicar(emCRLF(MIGRATION)), null, "CRLF");
      for (const s of sigs)
        assert.equal(await hashDe(s), antes[s], `reaplicar mudou ${s}`);
      // com marca, o rollback recusa
      await semearPessoas();
      const o = await pedido();
      const l = await linha(o, { status: "em_processamento" });
      await C.query(
        "INSERT INTO public.order_refund_prova (refund_id, por_fora_liberado_em) VALUES ($1, now())",
        [l],
      );
      const recusa = await aplicar(ROLLBACK);
      assert.match(
        recusa?.erro ?? "",
        /MARCA_DE_REEMBOLSO_NAO_SE_APAGA_SEM_QUERER/,
      );
      await C.query("DELETE FROM public.order_refund_prova");
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await hashDe(SIG.pode), null);
      assert.equal(await hashDe(SIG.espera), null);
      assert.equal(await aplicar(ROLLBACK), null, "o rollback é idempotente");
      // pré-voo: corpo vigente divergente recusa sem escrever nada
      const def = (
        await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          SIG.solicitar,
        ])
      ).rows[0].d;
      await C.query(
        def.replace("AS $function$", "AS $function$\n-- divergente"),
      );
      const pv = await aplicar(MIGRATION);
      assert.match(pv?.erro ?? "", /B1_BASELINE_DIVERGENT/);
      assert.equal(await hashDe(SIG.pode), null, "o pré-voo deixou escrever");
      assert.equal(
        (
          await C.query(
            "SELECT to_regclass('public.order_refund_prova') IS NULL AS n",
          )
        ).rows[0].n,
        true,
      );
      // de volta ao vigente, aplicar devolve o estado da migration
      await C.query(def);
      assert.equal(await aplicar(MIGRATION), null);
      for (const s of sigs)
        assert.equal(
          await hashDe(s),
          antes[s],
          `reaplicar depois do rollback mudou ${s}`,
        );
    }),
);

// ---------------------------------------------------------------------------
// CORRIDA: duas conexões reais (gravam de verdade no clone, que o rodar-isolado descarta)
// ---------------------------------------------------------------------------
async function esperandoTrava(pidAlvo) {
  for (let i = 0; i < 100; i++) {
    const r = await C.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pidAlvo],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((res) => setTimeout(res, 50));
  }
  return false;
}
async function prepararCorrida() {
  await semearPessoas();
  const orderId = await pedido({ total: 300 });
  const dev = await devolucaoRecebida(orderId, 100);
  await C.query("BEGIN");
  const r = await como(
    "authenticated",
    "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', '[]'::jsonb, 100, NULL) AS r",
    [dev],
    ADMIN,
  );
  await C.query("COMMIT");
  const refund = r[0].r.refund_id;
  await C.query(
    "UPDATE public.order_refunds SET status = 'em_processamento', post_autorizado_em = now() - interval '8 days' WHERE id = $1",
    [refund],
  );
  return { orderId, dev, refund };
}

prova(
  "CORRIDA: a saída chega primeiro e o autorizar espera a trava da linha -> linha_mudou (nenhum POST depois do por fora)",
  async () => {
    const { dev, refund } = await prepararCorrida();
    const pidD = (await D.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    await C.query("BEGIN");
    try {
      const s = await saidaDev(dev, refund);
      assert.equal(s.resultado, "combinado");
      await D.query("BEGIN");
      const pendente = autorizar(refund, 100, D);
      assert.ok(
        await esperandoTrava(pidD),
        "o autorizar não esperou a trava da linha",
      );
      await C.query("COMMIT");
      const a = await pendente;
      await D.query("COMMIT");
      assert.equal(a.decisao, "linha_mudou");
    } finally {
      await C.query("ROLLBACK").catch(() => {});
      await D.query("ROLLBACK").catch(() => {});
    }
    const pa = (
      await C.query(
        "SELECT post_autorizado_em > now() - interval '1 day' AS novo FROM public.order_refunds WHERE id = $1",
        [refund],
      )
    ).rows[0];
    assert.equal(
      pa.novo,
      false,
      "o carimbo de POST foi gravado depois da saída",
    );
  },
);

prova(
  "CORRIDA: o autorizar chega primeiro (carimba o POST) e a saída espera a trava -> aguarde (a espera recomeça)",
  async () => {
    const { dev, refund } = await prepararCorrida();
    const pidC = (await C.query("SELECT pg_backend_pid() AS p")).rows[0].p;
    await D.query("BEGIN");
    try {
      const a = await autorizar(refund, 100, D);
      assert.equal(a.decisao, "autorizado");
      await C.query("BEGIN");
      const pendente = saidaDev(dev, refund);
      // a espera da saída é na conexão C: medida pela D
      let travou = false;
      for (let i = 0; i < 100 && !travou; i++) {
        const r = await D.query(
          "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
          [pidC],
        );
        travou = r.rows[0]?.wait_event_type === "Lock";
        if (!travou) await new Promise((res) => setTimeout(res, 50));
      }
      assert.ok(travou, "a saída não esperou a trava da linha");
      await D.query("COMMIT");
      const s = await pendente;
      await C.query("COMMIT");
      assert.equal(
        s.resultado,
        "aguarde",
        "a saída usou a espera velha depois de um POST novo",
      );
    } finally {
      await C.query("ROLLBACK").catch(() => {});
      await D.query("ROLLBACK").catch(() => {});
    }
    assert.equal(
      await marcas(refund),
      null,
      "a saída marcou a linha depois de um POST novo",
    );
  },
);

/** Espera (olhando pela conexão E) até a sessão `pid` cumprir `cond` (wait_event_type/wait_event). */
async function esperaDe(pid, cond) {
  for (let i = 0; i < 200; i++) {
    const r = await E.query(
      "SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0] && cond(r.rows[0])) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

/**
 * CORRIDA da LINHA NOVA (achado B, revisor R1): uma linha N nasce (D trava o pedido e a cria) enquanto a saída
 * dos 7 dias do pedido cancelado (C) espera a trava do pedido; um gatilho de atraso na tabela de marcas segura
 * a saída DEPOIS das checagens; nesse meio a marca da edge (E) tenta pôr N em processamento. Com a re-trava
 * das linhas depois do pedido, a marca espera a saída e acha 0 linha (N já 'recusado'); sem ela, a marca
 * passa e N vira um em_processamento fantasma num pedido 'estornado'. Grava de verdade no clone.
 */
async function corridaDaLinhaNova(sabotagem) {
  await semearPessoas();
  const o = await pedido({ total: 100, status: "cancelled" });
  const l = await linha(o, {
    status: "em_processamento",
    valor: 100,
    postEm: oito(),
  });
  await E.query(
    "CREATE OR REPLACE FUNCTION public.zz_atraso_r1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.5); RETURN NEW; END $$",
  );
  await E.query(
    "DROP TRIGGER IF EXISTS zz_atraso_r1 ON public.order_refund_prova",
  );
  await E.query(
    "CREATE TRIGGER zz_atraso_r1 BEFORE INSERT ON public.order_refund_prova FOR EACH ROW EXECUTE FUNCTION public.zz_atraso_r1()",
  );
  const pidC = (await C.query("SELECT pg_backend_pid() AS p")).rows[0].p;
  let pMarca = null;
  try {
    await D.query("BEGIN");
    await D.query(
      "SELECT 1 FROM public.marketplace_orders WHERE id = $1 FOR UPDATE",
      [o],
    );
    const n = await linha(o, { status: "solicitado", valor: 50 }, D);
    await C.query("BEGIN");
    if (sabotagem) await sabotagem();
    const pSaida = saidaPed(o, l);
    assert.ok(
      await esperaDe(pidC, (w) => w.wait_event_type === "Lock"),
      "a saída não esperou a trava do pedido",
    );
    await D.query("COMMIT");
    assert.ok(
      await esperaDe(pidC, (w) => w.wait_event === "PgSleep"),
      "a saída não chegou ao atraso (depois das checagens)",
    );
    pMarca = E.query(
      "UPDATE public.order_refunds SET status = 'em_processamento', tentativas = tentativas + 1, updated_at = now() WHERE id = $1 AND status IN ('solicitado', 'em_processamento') RETURNING id",
      [n],
    );
    let marcou = false;
    pMarca.then(
      () => {
        marcou = true;
      },
      () => {
        marcou = true;
      },
    );
    const s = await pSaida;
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(
      marcou,
      false,
      "a marca da edge passou na linha nova enquanto a saída segurava o pedido (sem a re-trava)",
    );
    assert.equal(s.resultado, "registrado");
    assert.equal(s.detalhe, "apos_espera");
    await C.query("COMMIT");
    const m = await pMarca;
    assert.equal(
      m.rowCount,
      0,
      "a marca da edge achou a linha nova depois do estorno",
    );
    assert.equal(await statusDe(n, E), "recusado");
    assert.equal(
      (
        await E.query(
          "SELECT payment_status FROM public.marketplace_orders WHERE id = $1",
          [o],
        )
      ).rows[0].payment_status,
      "estornado",
    );
  } finally {
    await C.query("ROLLBACK").catch(() => {});
    await D.query("ROLLBACK").catch(() => {});
    if (pMarca) await pMarca.catch(() => {});
    await E.query(
      "DROP TRIGGER IF EXISTS zz_atraso_r1 ON public.order_refund_prova",
    );
    await E.query("DROP FUNCTION IF EXISTS public.zz_atraso_r1()");
  }
}
const SEM_RELOCK = () =>
  sabotar(SIG.saidaPed, [
    [
      "PERFORM 1 FROM public.order_refunds releitura WHERE releitura.order_id = p_order_id ORDER BY releitura.id FOR UPDATE;\n",
      "",
    ],
  ]);

prova(
  "CORRIDA (B): linha nova nasce enquanto a saída do pedido cancelado espera o pedido; a marca da edge espera a saída e acha 0 linha (N 'recusado')",
  () => corridaDaLinhaNova(null),
);
prova(
  "MUTANTE morre: a saída do pedido cancelado SEM a re-trava das linhas -> a corrida da linha nova fica VERMELHA",
  async () => {
    let pego = null;
    try {
      await corridaDaLinhaNova(SEM_RELOCK);
    } catch (e) {
      pego = e;
    }
    assert.ok(pego, "MUTANTE SOBREVIVEU: sem a re-trava");
    assert.ok(
      pego instanceof assert.AssertionError,
      `o mutante quebrou por outro motivo: ${pego?.stack ?? pego}`,
    );
    console.log(`       (caiu em: ${String(pego.message).split("\n")[0]})`);
  },
);

// ---------------------------------------------------------------------------
// MUTANTES: o corpo sabotado (CREATE OR REPLACE na transação) tem de deixar um comportamento VERMELHO
// ---------------------------------------------------------------------------
async function sabotar(sig, trocas) {
  let def = (
    await C.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [sig])
  ).rows[0].d;
  for (const [de, para] of trocas) {
    assert.equal(
      def.split(de).length - 1,
      1,
      `mutante: o trecho não casa 1x em ${sig}: ${de}`,
    );
    def = def.replace(de, () => para);
  }
  await C.query(def);
}
const MUTANTES = [
  {
    nome: "sem a regra do LEGADO (criada_sob_autorizacao IS NOT TRUE AND tentativas > 1)",
    sabotar: () =>
      sabotar(SIG.pode, [
        [
          "WHEN r.criada_sob_autorizacao IS NOT TRUE AND r.tentativas > 1 THEN true\n",
          "",
        ],
      ]),
    morre: [legadoPrende],
  },
  {
    nome: "sem o filtro da SUBSTITUÍDA por manual (na regra e no saldo)",
    sabotar: async () => {
      await sabotar(SIG.pode, [
        ["WHEN pv.substituida_por_manual_em IS NOT NULL THEN false\n", ""],
      ]);
      await sabotar(SIG.saldo, [
        [
          "AND NOT EXISTS (SELECT 1\n                                          FROM public.order_refund_prova pv\n                                         WHERE pv.refund_id = r.id\n                                           AND pv.substituida_por_manual_em IS NOT NULL)\n",
          "",
        ],
      ]);
    },
    morre: [substituidaSolta],
  },
  {
    nome: "sem o filtro da SUBSTITUÍDA só na regra única (o saldo ainda filtra: o painel mostra o defeito)",
    sabotar: () =>
      sabotar(SIG.pode, [
        ["WHEN pv.substituida_por_manual_em IS NOT NULL THEN false\n", ""],
      ]),
    morre: [substituidaSolta],
  },
  {
    nome: "o autorizar sem a marca por_fora_liberado_em",
    sabotar: () =>
      sabotar(SIG.autorizar, [
        ["AND pv.por_fora_liberado_em IS NOT NULL) THEN", "AND false) THEN"],
      ]),
    morre: [autorizarRecusaMarcada, seteDiasDevolucao, seteDiasPedido],
  },
  {
    nome: "a espera sem os 7 DIAS",
    sabotar: () =>
      sabotar(SIG.espera, [
        [
          "AND now() - COALESCE(r.post_autorizado_em, r.created_at) >= interval '7 days'",
          "",
        ],
      ]),
    morre: [seteDiasDevolucao, seteDiasPedido],
  },
  {
    nome: "a espera sem a marca por_fora_liberado_em",
    sabotar: () =>
      sabotar(SIG.espera, [["AND pv.por_fora_liberado_em IS NULL", ""]]),
    morre: [esperaRespeitaAMarca],
  },
  {
    // (A) o comportamento de antes: toda saída do pedido cancelado estorna o pedido inteiro
    nome: "a saída do pedido cancelado estorna o pedido INTEIRO mesmo com a linha parcial",
    sabotar: () =>
      sabotar(SIG.saidaPed, [
        ["IF round(v_r.amount, 2) < round(v_resta, 2) THEN", "IF false THEN"],
      ]),
    morre: [parcialNaoEstorna, totalEstorna, duasParciaisFecham],
  },
  {
    // (A) a parcial "sai da conta" sem deixar o valor em lugar nenhum
    nome: "o saldo sem o POR FORA PARCIAL",
    sabotar: () =>
      sabotar(SIG.saldo, [
        ["AND pf.substituida_por_manual_em IS NULL), 0)", "AND false), 0)"],
      ]),
    morre: [parcialNaoEstorna],
  },
  {
    // (R2 da releitura) o em dúvida do painel volta a contar a linha parcial por fora
    nome: "o em_duvida do painel sem o filtro da linha POR FORA",
    sabotar: () =>
      sabotar(SIG.painel, [
        [
          "     AND NOT EXISTS (SELECT 1\n                       FROM public.order_refund_prova pf\n                      WHERE pf.refund_id = r.id\n                        AND pf.por_fora_liberado_em IS NOT NULL)\n",
          "",
        ],
      ]),
    morre: [duasParciaisFecham, parcialPorForaNaoFicaEmDuvida],
  },
  {
    nome: "o saldo sem o filtro da linha POR FORA no em dúvida (conta duas vezes)",
    sabotar: () =>
      sabotar(SIG.saldo, [
        [
          "                        AND NOT EXISTS (SELECT 1\n                                          FROM public.order_refund_prova pf\n                                         WHERE pf.refund_id = r.id\n                                           AND pf.por_fora_liberado_em IS NOT NULL)\n",
          "",
        ],
      ]),
    morre: [duasParciaisFecham],
  },
  {
    nome: "o painel sem o RESERVADO por fora (sempre 0)",
    sabotar: () =>
      sabotar(SIG.painel, [
        ["'reservado_por_fora', v_reservado,", "'reservado_por_fora', 0,"],
      ]),
    morre: [parcialNaoEstorna, disponivelNuncaNegativo],
  },
  {
    // (R2 do #890) o reservado conta toda linha viva com registro de marcas, com ou sem a marca por fora
    nome: "o RESERVADO do painel sem o filtro da marca por fora",
    sabotar: () =>
      sabotar(SIG.painel, [
        ["     AND pr.por_fora_liberado_em IS NOT NULL\n", ""],
      ]),
    morre: [registroSemMarcaNaoEPorFora],
  },
  {
    // (R2 do #890) o reservado esquece a concluída ainda não somada
    nome: "o RESERVADO do painel sem o ramo 'concluido AND concluido_em IS NULL'",
    sabotar: () =>
      sabotar(SIG.painel, [
        [
          "AND pr.por_fora_liberado_em IS NOT NULL\n     AND (r.status IN ('solicitado', 'em_processamento')\n          OR (r.status = 'concluido' AND r.concluido_em IS NULL));",
          "AND pr.por_fora_liberado_em IS NOT NULL\n     AND (r.status IN ('solicitado', 'em_processamento'));",
        ],
      ]),
    morre: [concluidaNaoSomadaSegueReservada],
  },
  {
    // (R2 do #890) o em dúvida do painel tira a linha só por ter registro de marcas (sem olhar a marca por fora)
    nome: "o em_duvida do painel com o filtro por fora SEM a condição da marca",
    sabotar: () =>
      sabotar(SIG.painel, [
        [
          "                        AND pf.por_fora_liberado_em IS NOT NULL)\n     AND public.order_refund__pode_ter_saido(r.id);",
          ")\n     AND public.order_refund__pode_ter_saido(r.id);",
        ],
      ]),
    morre: [registroSemMarcaNaoEPorFora],
  },
  {
    // (R2 do #890) o mesmo defeito no saldo (a fonte do disponível)
    nome: "o saldo com o filtro por fora do em dúvida SEM a condição da marca",
    sabotar: () =>
      sabotar(SIG.saldo, [
        [
          "                                           AND pf.por_fora_liberado_em IS NOT NULL)\n                        AND public.order_refund__pode_ter_saido(r.id)), 0)",
          ")\n                        AND public.order_refund__pode_ter_saido(r.id)), 0)",
        ],
      ]),
    morre: [registroSemMarcaNaoEPorFora],
  },
  {
    nome: "o painel sem o GREATEST (disponível negativo)",
    sabotar: () =>
      sabotar(SIG.painel, [
        [
          "GREATEST(public.pedido__saldo_a_estornar(p_order_id), 0)",
          "public.pedido__saldo_a_estornar(p_order_id)",
        ],
      ]),
    morre: [disponivelNuncaNegativo],
  },
  {
    nome: "o painel sem o campo substituida_por_manual (sempre false)",
    sabotar: () =>
      sabotar(SIG.painel, [
        [
          "'substituida_por_manual', pv.substituida_por_manual_em IS NOT NULL,",
          "'substituida_por_manual', false,",
        ],
      ]),
    morre: [substituidaSolta],
  },
  {
    nome: "a reemissão com a regra única INVERTIDA",
    sabotar: () =>
      sabotar(SIG.reemitir, [
        [
          "v_sem_post := NOT public.order_refund__pode_ter_saido(v_r.id);",
          "v_sem_post := public.order_refund__pode_ter_saido(v_r.id);",
        ],
      ]),
    morre: [reemissaoPelaRegraUnica],
  },
];
for (const m of MUTANTES) {
  for (const comportamento of m.morre) {
    prova(
      `MUTANTE morre: ${m.nome} -> ${comportamento.name} fica VERMELHO`,
      async () => {
        let pego = null;
        await emTransacao(async () => {
          await m.sabotar();
          try {
            await comportamento();
          } catch (e) {
            pego = e;
          }
        });
        assert.ok(
          pego,
          `MUTANTE SOBREVIVEU: ${m.nome} (${comportamento.name})`,
        );
        assert.ok(
          pego instanceof assert.AssertionError,
          `o mutante quebrou por outro motivo: ${pego?.stack ?? pego}`,
        );
        console.log(`       (caiu em: ${String(pego.message).split("\n")[0]})`);
      },
    );
  }
}

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  D = new Client({ connectionString: url });
  E = new Client({ connectionString: url });
  await C.connect();
  await D.connect();
  await E.connect();
  let falhas = 0;
  try {
    for (const p of PROVAS) {
      try {
        await p.corpo();
        console.log(`  ok   ${p.nome}`);
      } catch (e) {
        falhas += 1;
        console.log(
          `  FALHOU ${p.nome}\n    ${String(e?.stack ?? e)
            .split("\n")
            .slice(0, 6)
            .join("\n    ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
        await D.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
    await D.end().catch(() => {});
    await E.end().catch(() => {});
  }
  console.log(
    `\nreembolso-em-duvida-viva: ${PROVAS.length - falhas}/${PROVAS.length} ok`,
  );
  if (falhas > 0)
    falhar("REEMBOLSO-EM-DUVIDA", `${falhas} prova(s) falharam — ver acima.`);
}

main().catch((erro) =>
  falhar("REEMBOLSO-EM-DUVIDA", erro?.stack ? erro.stack : String(erro)),
);
