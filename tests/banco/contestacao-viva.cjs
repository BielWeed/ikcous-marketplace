"use strict";

/**
 * PROVA VIVA da migration 20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql
 * (Lote A, 04/10/2026 — bloqueios 1, 2, 3, 5 e 6 da revisão) contra o Postgres
 * EFÊMERO com as migrations aplicadas do zero. As corridas são REAIS: duas
 * conexões, a segunda comprovadamente PARADA na trava do pedido
 * (pg_stat_activity.wait_event_type = 'Lock') até a primeira terminar.
 *
 *   (a) privilégios: só a service_role executa as duas funções.
 *   (b) bloqueio 1: estimativa só RESERVA — contra a loja sem valor do caso
 *       não conclui nada; valor parcial confirmado conclui só o parcial.
 *   (c) bloqueio 6: pedido de 100, dois casos de 60 em conexões paralelas ->
 *       a soma das reservas nunca passa de 100 (60 + 40, aviso de saldo).
 *   (d) bloqueio 5: A reserva 100 ESTIMADO e segura a trava; B (mesmo CBK,
 *       caso final 30) espera -> termina 30 concluído uma vez; replays estáveis.
 *   (e) bloqueio 3: multicaso — a liberação do CBK1 libera saldo para o CBK2
 *       na mesma sequência (estado canônico devolvido a cada chamada).
 *   (f) bloqueio 2: refund REGULAR (REF) numa order contestada entra inteiro
 *       se cabe; não cabendo, não entra nem recorta (aviso); replay = já
 *       registrado.
 *   (g) vínculo: mesmo CBK com outro case_id, valor confirmado diferente,
 *       linha antiga ambígua, pedido não pago, decisão revertida -> nada
 *       muda, aviso; linha antiga única é adotada.
 *   (h) migration: reaplicar é no-op; preflight recusa sem a 20261192000000;
 *       rollback + reaplicar dentro de BEGIN/ROLLBACK.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/contestacao-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os únicos arquivos lidos são as migrations deste repositório, por nome
 * fixo (constantes abaixo), nunca entrada de rede nem de terceiro. */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_CLIENTE = "61111111-1111-1111-1111-111111111111";
const O = (n) => `6ccccccc-0000-0000-0000-${String(n).padStart(12, "0")}`;
const MIGRATION = "20261196000000_a_contestacao_decide_sob_a_trava_do_pedido.sql";
const FN_CONTESTACAO =
  "public.registrar_contestacao_no_ledger(uuid, text, text, text, numeric, numeric, integer)";
const FN_EXTERNO =
  "public.registrar_estorno_externo_do_mp(uuid, text, numeric, text, text)";

const num = (v) => Math.round(Number(v) * 100) / 100;

function lerMigration(nome) {
  return fs.readFileSync(
    path.join(__dirname, "..", "..", "supabase", "migrations", nome),
    "utf8",
  );
}

async function pedido(cliente, id, { total, paymentStatus = "pago", valorEstornado = 0 }) {
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, valor_estornado, updated_at)
     VALUES ($1, $2, 'Cliente Contestação', '{}'::jsonb, $3, $3, 'delivered', 'online',
             'online', $4, CASE WHEN $4 = 'aguardando' THEN NULL ELSE now() END, $5, now())`,
    [id, U_CLIENTE, total, paymentStatus, valorEstornado],
  );
}

async function contestacao(cliente, o) {
  const r = await cliente.query(
    "SELECT public.registrar_contestacao_no_ledger($1, $2, $3, $4, $5, $6, $7) AS r",
    [
      o.pedido,
      o.cbk,
      o.caseId ?? "1234567890",
      o.decisao,
      o.valorCaso ?? null,
      o.estimado ?? null,
      o.casos ?? 1,
    ],
  );
  return r.rows[0].r;
}

async function externo(cliente, o) {
  const r = await cliente.query(
    `SELECT public.registrar_estorno_externo_do_mp($1, $2, $3, 'processed', 'partially_refunded') AS r`,
    [o.pedido, o.ref, o.valor],
  );
  return r.rows[0].r;
}

async function estado(cliente, pedidoId) {
  const p = (
    await cliente.query(
      "SELECT valor_estornado, payment_status FROM public.marketplace_orders WHERE id = $1",
      [pedidoId],
    )
  ).rows[0];
  const linhas = (
    await cliente.query(
      `SELECT id, amount, status, mp_chargeback_id, mp_chargeback_case_id, mp_chargeback_valor_do_caso,
              mp_refund_id, concluido_em, motivo
         FROM public.order_refunds WHERE order_id = $1 ORDER BY created_at, id`,
      [pedidoId],
    )
  ).rows;
  return { valorEstornado: num(p.valor_estornado), paymentStatus: p.payment_status, linhas };
}

/** Espera até a conexão `pid` estar PARADA numa trava (prova que a 2ª
 * conexão chegou ao FOR UPDATE e não passou). */
async function esperarTrava(observador, pid) {
  for (let i = 0; i < 100; i++) {
    const r = await observador.query(
      "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1",
      [pid],
    );
    if (r.rows[0]?.wait_event_type === "Lock") return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function novaConexao(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function corrida(url, primeira, segunda) {
  const a = await novaConexao(url);
  const b = await novaConexao(url);
  const obs = await novaConexao(url);
  try {
    const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await a.query("BEGIN");
    const ra = await primeira(a);
    await b.query("BEGIN");
    const promessaB = segunda(b);
    const parou = await esperarTrava(obs, pidB);
    await a.query("COMMIT");
    const rb = await promessaB;
    await b.query("COMMIT");
    return { ra, rb, parou };
  } finally {
    await a.end().catch(() => {});
    await b.end().catch(() => {});
    await obs.end().catch(() => {});
  }
}

const PROVAS = [];

PROVAS.push({
  nome: "(a) privilégios: só a service_role executa as duas funções",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'cliente@contestacao.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_CLIENTE],
    );
    for (const fn of [FN_CONTESTACAO, FN_EXTERNO]) {
      for (const papel of ["anon", "authenticated", "public"]) {
        const r = await cliente.query(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS pode`,
          [papel, fn],
        );
        assert.equal(r.rows[0].pode, false, `${papel} não executa ${fn}`);
      }
      const sr = await cliente.query(
        "SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS pode",
        [fn],
      );
      assert.equal(sr.rows[0].pode, true, `service_role executa ${fn}`);
    }
    for (const papel of ["anon", "authenticated"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const r = await cliente.query(
          "SELECT has_table_privilege($1, 'public.contestacoes_decisao_final', $2) AS pode",
          [papel, priv],
        );
        assert.equal(r.rows[0].pode, false, `${papel} sem ${priv} na decisão final`);
      }
    }
  },
});

PROVAS.push({
  nome: "(b) bloqueio 1: estimativa só reserva; contra a loja sem valor do caso não conclui; parcial confirmado conclui só o parcial",
  corpo: async (cliente) => {
    // Sem linha, contra a loja, caso sem valor em reais -> reserva ESTIMADA, nada somado.
    await pedido(cliente, O(1), { total: 100 });
    const r1 = await contestacao(cliente, { pedido: O(1), cbk: "CBK-B1", decisao: "contra_a_loja", estimado: 100 });
    assert.equal(r1.resultado, "reservado_sem_valor_do_caso");
    assert.equal(r1.aviso, "conferir");
    let e = await estado(cliente, O(1));
    assert.equal(e.valorEstornado, 0, "nada concluído com estimativa");
    assert.equal(e.paymentStatus, "pago");
    assert.equal(e.linhas.length, 1);
    assert.equal(e.linhas[0].status, "em_processamento");
    assert.equal(num(e.linhas[0].amount), 100);
    assert.equal(e.linhas[0].mp_chargeback_valor_do_caso, null, "a linha diz que é estimativa");

    // De novo sem valor: conserva (a reserva fica), nada concluído.
    const r2 = await contestacao(cliente, { pedido: O(1), cbk: "CBK-B1", decisao: "contra_a_loja", estimado: 100 });
    assert.equal(r2.resultado, "conservado_sem_valor_do_caso");
    e = await estado(cliente, O(1));
    assert.equal(e.valorEstornado, 0);
    assert.equal(e.linhas[0].status, "em_processamento");

    // Valor do caso confirmado PARCIAL (30): a reserva cai para 30 e conclui 30.
    const r3 = await contestacao(cliente, { pedido: O(1), cbk: "CBK-B1", decisao: "contra_a_loja", valorCaso: 30, estimado: 100 });
    assert.equal(r3.resultado, "concluido");
    e = await estado(cliente, O(1));
    assert.equal(e.valorEstornado, 30);
    assert.equal(e.paymentStatus, "pago", "parcial não marca o pedido como estornado");
    assert.equal(e.linhas.length, 1);
    assert.equal(num(e.linhas[0].amount), 30);
    assert.equal(e.linhas[0].status, "concluido");
    assert.equal(num(e.linhas[0].mp_chargeback_valor_do_caso), 30);
    assert.equal(num(r3.valor_estornado), 30, "o retorno é o estado canônico");
    assert.equal(num(r3.disponivel), 70);

    // Em análise sem valor do caso: reserva ESTIMADA (conservador), nunca conclui.
    await pedido(cliente, O(2), { total: 100 });
    const r4 = await contestacao(cliente, { pedido: O(2), cbk: "CBK-B1b", decisao: "em_analise", estimado: 100 });
    assert.equal(r4.resultado, "reservado");
    e = await estado(cliente, O(2));
    assert.equal(e.valorEstornado, 0);
    assert.match(e.linhas[0].motivo, /ESTIMADO/);

    // Sem valor nenhum (nem caso nem estimativa): nada, aviso.
    await pedido(cliente, O(3), { total: 100 });
    const r5 = await contestacao(cliente, { pedido: O(3), cbk: "CBK-B1c", decisao: "contra_a_loja" });
    assert.equal(r5.resultado, "sem_valor");
    assert.equal((await estado(cliente, O(3))).linhas.length, 0);
  },
});

PROVAS.push({
  nome: "(c) bloqueio 6: pedido de 100, dois casos de 60 em conexões paralelas -> reservas somam 100, nunca 120",
  corpo: async (cliente, url) => {
    await pedido(cliente, O(10), { total: 100 });
    const { ra, rb, parou } = await corrida(
      url,
      (c) => contestacao(c, { pedido: O(10), cbk: "CBK-C1", decisao: "em_analise", valorCaso: 60, casos: 2 }),
      (c) => contestacao(c, { pedido: O(10), cbk: "CBK-C2", decisao: "em_analise", valorCaso: 60, casos: 2 }),
    );
    assert.equal(parou, true, "a 2ª conexão PAROU na trava do pedido");
    assert.equal(ra.resultado, "reservado");
    assert.equal(num(ra.linha_amount), 60);
    assert.equal(rb.resultado, "reservado");
    assert.equal(num(rb.linha_amount), 40, "só cabe o que sobra");
    assert.equal(rb.aviso, "saldo");
    const e = await estado(cliente, O(10));
    const reservado = e.linhas.reduce((s, l) => s + num(l.amount), 0);
    assert.equal(reservado, 100);
    assert.equal(num(rb.disponivel), 0);
  },
});

PROVAS.push({
  nome: "(d) bloqueio 5: A reserva 100 estimado com a trava; B (mesmo CBK, caso final 30) espera -> 30 concluído uma vez; replays estáveis",
  corpo: async (cliente, url) => {
    await pedido(cliente, O(20), { total: 100 });
    const { ra, rb, parou } = await corrida(
      url,
      (c) => contestacao(c, { pedido: O(20), cbk: "CBK-D", decisao: "em_analise", estimado: 100 }),
      (c) => contestacao(c, { pedido: O(20), cbk: "CBK-D", decisao: "contra_a_loja", valorCaso: 30, estimado: 100 }),
    );
    assert.equal(parou, true, "B parou na trava do pedido");
    assert.equal(ra.resultado, "reservado");
    assert.equal(num(ra.linha_amount), 100);
    assert.equal(rb.resultado, "concluido");
    let e = await estado(cliente, O(20));
    assert.equal(e.linhas.length, 1, "uma linha por caso");
    assert.equal(num(e.linhas[0].amount), 30);
    assert.equal(e.linhas[0].status, "concluido");
    assert.equal(e.valorEstornado, 30, "a estimada nunca é concluída às cegas");

    const replayB = await contestacao(cliente, { pedido: O(20), cbk: "CBK-D", decisao: "contra_a_loja", valorCaso: 30, estimado: 100 });
    assert.equal(replayB.resultado, "ja_concluido");
    const replayA = await contestacao(cliente, { pedido: O(20), cbk: "CBK-D", decisao: "em_analise", estimado: 100 });
    assert.equal(replayA.resultado, "ja_decidido");
    e = await estado(cliente, O(20));
    assert.equal(e.valorEstornado, 30);
    assert.equal(e.linhas.length, 1);

    // Ordem inversa: B (30) primeiro, A (estimado) depois -> A não cria nada.
    await pedido(cliente, O(21), { total: 100 });
    const inv = await corrida(
      url,
      (c) => contestacao(c, { pedido: O(21), cbk: "CBK-D2", decisao: "contra_a_loja", valorCaso: 30, estimado: 100 }),
      (c) => contestacao(c, { pedido: O(21), cbk: "CBK-D2", decisao: "em_analise", estimado: 100 }),
    );
    assert.equal(inv.parou, true);
    assert.equal(inv.ra.resultado, "concluido");
    assert.equal(inv.rb.resultado, "ja_decidido");
    e = await estado(cliente, O(21));
    assert.equal(e.valorEstornado, 30);
    assert.equal(e.linhas.length, 1);
  },
});

PROVAS.push({
  nome: "(e) bloqueio 3: multicaso — liberar o CBK1 devolve o saldo ao CBK2 na mesma sequência",
  corpo: async (cliente) => {
    await pedido(cliente, O(30), { total: 100 });
    const r1 = await contestacao(cliente, { pedido: O(30), cbk: "CBK-E1", decisao: "em_analise", valorCaso: 100, casos: 2 });
    assert.equal(r1.resultado, "reservado");
    assert.equal(num(r1.disponivel), 0);
    const r2 = await contestacao(cliente, { pedido: O(30), cbk: "CBK-E1", caseId: "1234567890", decisao: "a_favor_da_loja", valorCaso: 100, casos: 2 });
    assert.equal(r2.resultado, "liberado");
    assert.equal(num(r2.disponivel), 100, "o estado canônico já enxerga a liberação");
    const r3 = await contestacao(cliente, { pedido: O(30), cbk: "CBK-E2", caseId: "222", decisao: "em_analise", valorCaso: 100, casos: 2 });
    assert.equal(r3.resultado, "reservado");
    assert.equal(num(r3.linha_amount), 100);
    const e = await estado(cliente, O(30));
    assert.equal(e.valorEstornado, 0, "liberar nunca soma");
    assert.deepEqual(
      e.linhas.map((l) => [l.mp_chargeback_id, l.status, num(l.amount)]),
      [
        ["CBK-E1", "recusado", 100],
        ["CBK-E2", "em_processamento", 100],
      ],
    );
  },
});

PROVAS.push({
  nome: "(f) bloqueio 2: REF regular numa order contestada entra inteiro se cabe; senão não entra nem recorta; replay = já registrado",
  corpo: async (cliente) => {
    // Pedido de 100 com reserva de contestação de 100: REF de 100 não cabe.
    await pedido(cliente, O(40), { total: 100 });
    await contestacao(cliente, { pedido: O(40), cbk: "CBK-F", decisao: "em_analise", valorCaso: 100 });
    const r1 = await externo(cliente, { pedido: O(40), ref: "REF-F1", valor: 100 });
    assert.equal(r1.resultado, "nao_cabe");
    assert.equal(r1.aviso, "saldo");
    let e = await estado(cliente, O(40));
    assert.equal(e.valorEstornado, 0);
    assert.equal(e.linhas.filter((l) => l.mp_refund_id === "REF-F1").length, 0, "nada recortado para caber");

    // Pedido de 200, reserva de 100: REF de 100 cabe, entra INTEIRO e concluído.
    await pedido(cliente, O(41), { total: 200 });
    await contestacao(cliente, { pedido: O(41), cbk: "CBK-F2", decisao: "em_analise", valorCaso: 100 });
    const r2 = await externo(cliente, { pedido: O(41), ref: "REF-F2", valor: 100 });
    assert.equal(r2.resultado, "inserido");
    e = await estado(cliente, O(41));
    assert.equal(e.valorEstornado, 100);
    const ref = e.linhas.filter((l) => l.mp_refund_id === "REF-F2");
    assert.equal(ref.length, 1);
    assert.equal(ref[0].status, "concluido");
    assert.equal(num(ref[0].amount), 100);
    assert.equal(num(r2.disponivel), 0, "a reserva continua bloqueando o resto");

    const r3 = await externo(cliente, { pedido: O(41), ref: "REF-F2", valor: 100 });
    assert.equal(r3.resultado, "ja_registrado");
    assert.equal((await estado(cliente, O(41))).valorEstornado, 100);

    // Contestação contra a loja que NÃO cabe depois do REF: conserva, aviso.
    const r4 = await contestacao(cliente, { pedido: O(41), cbk: "CBK-F2", decisao: "contra_a_loja", valorCaso: 150 });
    assert.equal(r4.resultado, "valor_divergente", "o valor confirmado gravado (100) não muda em silêncio");
    await pedido(cliente, O(42), { total: 100 });
    await externo(cliente, { pedido: O(42), ref: "REF-F3", valor: 70 });
    const r5 = await contestacao(cliente, { pedido: O(42), cbk: "CBK-F3", decisao: "contra_a_loja", valorCaso: 100 });
    assert.equal(r5.resultado, "saldo_incoerente");
    assert.equal(r5.aviso, "saldo");
    e = await estado(cliente, O(42));
    assert.equal(e.valorEstornado, 70, "nada concluído além do REF");
    const bloqueio = e.linhas.find((l) => l.mp_chargeback_id === "CBK-F3");
    assert.equal(bloqueio.status, "em_processamento", "o que sobra fica reservado (bloqueia novas devoluções)");
    assert.equal(num(bloqueio.amount), 30);
    assert.equal(num(r5.disponivel), 0);
  },
});

PROVAS.push({
  nome: "(g) vínculo e estados: case_id/valor divergentes, legado ambíguo, pedido não pago, revertida -> nada muda; legado único é adotado",
  corpo: async (cliente) => {
    await pedido(cliente, O(50), { total: 100 });
    await contestacao(cliente, { pedido: O(50), cbk: "CBK-G", caseId: "111", decisao: "em_analise", valorCaso: 50 });
    const r1 = await contestacao(cliente, { pedido: O(50), cbk: "CBK-G", caseId: "999", decisao: "contra_a_loja", valorCaso: 50 });
    assert.equal(r1.resultado, "vinculo_divergente");
    assert.equal(r1.aviso, "conferir");
    const r2 = await contestacao(cliente, { pedido: O(50), cbk: "CBK-G", caseId: "111", decisao: "contra_a_loja", valorCaso: 40 });
    assert.equal(r2.resultado, "valor_divergente");
    let e = await estado(cliente, O(50));
    assert.equal(e.valorEstornado, 0);
    assert.equal(e.linhas[0].status, "em_processamento");
    assert.equal(num(e.linhas[0].amount), 50);

    // Decisão revertida: concluída e agora a favor da loja -> nada reaberto.
    await contestacao(cliente, { pedido: O(50), cbk: "CBK-G", caseId: "111", decisao: "contra_a_loja", valorCaso: 50 });
    const r3 = await contestacao(cliente, { pedido: O(50), cbk: "CBK-G", caseId: "111", decisao: "a_favor_da_loja", valorCaso: 50 });
    assert.equal(r3.resultado, "revertido");
    assert.equal(r3.aviso, "revertida");
    e = await estado(cliente, O(50));
    assert.equal(e.valorEstornado, 50);
    assert.equal(e.linhas[0].status, "concluido");

    // Pedido não pago: nada.
    await pedido(cliente, O(51), { total: 100, paymentStatus: "aguardando" });
    const r4 = await contestacao(cliente, { pedido: O(51), cbk: "CBK-G2", decisao: "em_analise", valorCaso: 50 });
    assert.equal(r4.resultado, "pedido_nao_pago");
    assert.equal((await estado(cliente, O(51))).linhas.length, 0);

    // Linha ANTIGA (sem CBK) única + um caso só: adotada, nunca duplicada.
    await pedido(cliente, O(52), { total: 100 });
    await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, motivo, mp_status, mp_status_detail)
       VALUES ($1, 100, 'sistema', 'em_processamento', 'reserva antiga', 'charged_back', 'in_process')`,
      [O(52)],
    );
    const r5 = await contestacao(cliente, { pedido: O(52), cbk: "CBK-G3", decisao: "contra_a_loja", valorCaso: 100 });
    assert.equal(r5.resultado, "concluido");
    e = await estado(cliente, O(52));
    assert.equal(e.linhas.length, 1);
    assert.equal(e.linhas[0].mp_chargeback_id, "CBK-G3");
    assert.equal(e.linhas[0].mp_chargeback_case_id, "1234567890");
    assert.equal(e.valorEstornado, 100);
    assert.equal(e.paymentStatus, "estornado", "total coberto -> estornado (pela concluir_estorno)");

    // Linha antiga + DOIS casos na order: ambígua, nada.
    await pedido(cliente, O(53), { total: 100 });
    await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, motivo, mp_status, mp_status_detail)
       VALUES ($1, 100, 'sistema', 'em_processamento', 'reserva antiga', 'charged_back', 'in_process')`,
      [O(53)],
    );
    const r6 = await contestacao(cliente, { pedido: O(53), cbk: "CBK-G4", decisao: "contra_a_loja", valorCaso: 100, casos: 2 });
    assert.equal(r6.resultado, "legado_ambiguo");
    e = await estado(cliente, O(53));
    assert.equal(e.linhas[0].mp_chargeback_id, null);
    assert.equal(e.valorEstornado, 0);
  },
});

PROVAS.push({
  nome: "(i) decisão FINAL persistida sem reserva: a favor da loja primeiro -> o pendente atrasado não reserva; virada depois é 'revertida'",
  corpo: async (cliente) => {
    await pedido(cliente, O(60), { total: 100 });
    const r1 = await contestacao(cliente, { pedido: O(60), cbk: "CBK-I", caseId: "601", decisao: "a_favor_da_loja", valorCaso: 100 });
    assert.equal(r1.resultado, "nada_a_liberar");
    const final = (
      await cliente.query(
        `SELECT mp_chargeback_case_id, decisao, num_nonnulls(origem, decidido_em) AS proc, valor_do_caso
           FROM public.contestacoes_decisao_final WHERE order_id = $1 AND mp_chargeback_id = 'CBK-I'`,
        [O(60)],
      )
    ).rows;
    assert.equal(final.length, 1, "a decisão final fica gravada mesmo sem reserva");
    assert.deepEqual(
      [final[0].mp_chargeback_case_id, final[0].decisao, final[0].proc, num(final[0].valor_do_caso)],
      ["601", "a_favor_da_loja", 2, 100],
    );

    const atrasado = await contestacao(cliente, { pedido: O(60), cbk: "CBK-I", caseId: "601", decisao: "em_analise", valorCaso: 100, estimado: 100 });
    assert.equal(atrasado.resultado, "ja_decidido");
    assert.equal((await estado(cliente, O(60))).linhas.length, 0, "nenhuma reserva depois da decisão final");

    const virada = await contestacao(cliente, { pedido: O(60), cbk: "CBK-I", caseId: "601", decisao: "contra_a_loja", valorCaso: 100 });
    assert.equal(virada.resultado, "revertido");
    assert.equal(virada.aviso, "revertida");
    const e = await estado(cliente, O(60));
    assert.equal(e.linhas.length, 0);
    assert.equal(e.valorEstornado, 0);

    // A decisão final repetida é idempotente (uma linha só de procedência).
    const repetida = await contestacao(cliente, { pedido: O(60), cbk: "CBK-I", caseId: "601", decisao: "a_favor_da_loja", valorCaso: 100 });
    assert.equal(repetida.resultado, "nada_a_liberar");
    const n = await cliente.query(
      "SELECT count(*)::int AS n FROM public.contestacoes_decisao_final WHERE order_id = $1",
      [O(60)],
    );
    assert.equal(n.rows[0].n, 1);
  },
});

PROVAS.push({
  nome: "(j) corrida causal: a decisão final (sem reserva) segura a trava; o pendente ATRASADO espera e depois não reserva nada",
  corpo: async (cliente, url) => {
    await pedido(cliente, O(70), { total: 100 });
    const { ra, rb, parou } = await corrida(
      url,
      (c) => contestacao(c, { pedido: O(70), cbk: "CBK-J", caseId: "701", decisao: "a_favor_da_loja", valorCaso: 100 }),
      (c) => contestacao(c, { pedido: O(70), cbk: "CBK-J", caseId: "701", decisao: "em_analise", estimado: 100 }),
    );
    assert.equal(parou, true, "o pendente parou na trava do pedido");
    assert.equal(ra.resultado, "nada_a_liberar");
    assert.equal(rb.resultado, "ja_decidido");
    const e = await estado(cliente, O(70));
    assert.equal(e.linhas.length, 0, "nenhuma reserva");
    assert.equal(num(rb.disponivel), 100);
  },
});

PROVAS.push({
  nome: "(k) REF que não cabia por causa da reserva cabe depois da liberação (mesmo saldo, sem contar duas vezes)",
  corpo: async (cliente) => {
    await pedido(cliente, O(80), { total: 100 });
    await contestacao(cliente, { pedido: O(80), cbk: "CBK-K", caseId: "801", decisao: "em_analise", valorCaso: 100 });
    const antes = await externo(cliente, { pedido: O(80), ref: "REF-K", valor: 100 });
    assert.equal(antes.resultado, "nao_cabe");
    const lib = await contestacao(cliente, { pedido: O(80), cbk: "CBK-K", caseId: "801", decisao: "a_favor_da_loja", valorCaso: 100 });
    assert.equal(lib.resultado, "liberado");
    const depois = await externo(cliente, { pedido: O(80), ref: "REF-K", valor: 100 });
    assert.equal(depois.resultado, "inserido");
    const replay = await externo(cliente, { pedido: O(80), ref: "REF-K", valor: 100 });
    assert.equal(replay.resultado, "ja_registrado");
    const e = await estado(cliente, O(80));
    assert.equal(e.valorEstornado, 100, "a devolução real conta uma vez");
    assert.equal(e.paymentStatus, "estornado");
  },
});

PROVAS.push({
  nome: "(n) REF do MP nunca é truncado: pedido 100, REF antigo 20, APP 20 solicitado SEM POST, REF novo 70 -> entra 70 inteiro (90); replay e liberação do APP: 90, resta 10",
  corpo: async (cliente) => {
    await pedido(cliente, O(100), { total: 100 });
    const antigo = await externo(cliente, { pedido: O(100), ref: "REF-N20", valor: 20 });
    assert.equal(antigo.resultado, "inserido");
    // A linha do APP pedida pela loja e ainda sem POST ao MP (solicitado):
    // é intenção, não dinheiro que saiu.
    const app = await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, motivo)
       VALUES ($1, 20, 'lojista', 'solicitado', 'devolução pedida pela loja (prova n)') RETURNING id`,
      [O(100)],
    );
    const novo = await externo(cliente, { pedido: O(100), ref: "REF-N70", valor: 70 });
    assert.equal(novo.resultado, "inserido", "o que o MP já devolveu entra inteiro: 20 + 70 cabe nos 100 pagos");
    let e = await estado(cliente, O(100));
    const r70 = e.linhas.filter((l) => l.mp_refund_id === "REF-N70");
    assert.equal(r70.length, 1);
    assert.equal(num(r70[0].amount), 70, "nunca 60");
    assert.equal(r70[0].status, "concluido");
    assert.equal(e.valorEstornado, 90);
    const linhaApp = e.linhas.find((l) => l.id === app.rows[0].id);
    assert.equal(linhaApp.status, "solicitado", "o APP incerto não é liberado sem prova");

    // Replay do MP: nada novo.
    const replay = await externo(cliente, { pedido: O(100), ref: "REF-N70", valor: 70 });
    assert.equal(replay.resultado, "ja_registrado");
    // O APP sai de cena (o executor o recusa: 20 > 100 - 90) e o MP reenvia.
    await cliente.query("UPDATE public.order_refunds SET status = 'falhou' WHERE id = $1", [app.rows[0].id]);
    const depois = await externo(cliente, { pedido: O(100), ref: "REF-N70", valor: 70 });
    assert.equal(depois.resultado, "ja_registrado");
    assert.equal(num(depois.valor_estornado), 90, "saldo confirmado 90, sem contagem dupla");
    assert.equal(num(depois.disponivel), 10, "remanescente 10");
    e = await estado(cliente, O(100));
    assert.equal(e.linhas.filter((l) => l.mp_refund_id === "REF-N70").length, 1);
    assert.equal(e.valorEstornado, 90);

    // O que NÃO cabe no dinheiro real (90 + 20 > 100): não entra, não é
    // recortado, e a identidade fica livre para a reconciliação.
    const excesso = await externo(cliente, { pedido: O(100), ref: "REF-N-EXCESSO", valor: 20 });
    assert.equal(excesso.resultado, "nao_cabe");
    assert.equal(excesso.aviso, "saldo");
    e = await estado(cliente, O(100));
    assert.equal(e.linhas.filter((l) => l.mp_refund_id === "REF-N-EXCESSO").length, 0);
    assert.equal(e.valorEstornado, 90);
  },
});

PROVAS.push({
  nome: "(o) dois REF diferentes em conexões paralelas (70 e 70 num pedido de 100): o 2º espera a trava e volta nao_cabe; nada truncado",
  corpo: async (cliente, url) => {
    await pedido(cliente, O(110), { total: 100 });
    const { ra, rb, parou } = await corrida(
      url,
      (c) => externo(c, { pedido: O(110), ref: "REF-O1", valor: 70 }),
      (c) => externo(c, { pedido: O(110), ref: "REF-O2", valor: 70 }),
    );
    assert.equal(parou, true, "o 2º REF parou na trava do pedido");
    assert.equal(ra.resultado, "inserido");
    assert.equal(rb.resultado, "nao_cabe");
    const e = await estado(cliente, O(110));
    assert.equal(e.valorEstornado, 70);
    assert.deepEqual(e.linhas.map((l) => [l.mp_refund_id, num(l.amount)]), [["REF-O1", 70]]);
  },
});

PROVAS.push({
  nome: "(p) linha 'sistema' órfã do MESMO refund (concluido sem concluido_em): a RPC responde ja_registrado e a conclui UMA vez",
  corpo: async (cliente) => {
    await pedido(cliente, O(120), { total: 100 });
    await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, motivo, mp_refund_id)
       VALUES ($1, 30, 'sistema', 'concluido', 'estorno feito fora do app (Mercado Pago)', 'REF-P')`,
      [O(120)],
    );
    const r1 = await externo(cliente, { pedido: O(120), ref: "REF-P", valor: 30 });
    assert.equal(r1.resultado, "ja_registrado");
    assert.equal(num(r1.valor_estornado), 30, "a órfã somou agora");
    const r2 = await externo(cliente, { pedido: O(120), ref: "REF-P", valor: 30 });
    assert.equal(r2.resultado, "ja_registrado");
    assert.equal(num(r2.valor_estornado), 30, "e não soma de novo");
    const e = await estado(cliente, O(120));
    assert.equal(e.linhas.length, 1);
    assert.notEqual(e.linhas[0].concluido_em, null);
  },
});

PROVAS.push({
  nome: "(l) teto do AJUSTE: CBK1 reserva 60, CBK2 reserva 40 por estimativa, CBK2 confirma 60 -> fica 40 (saldo), total reservado 100",
  corpo: async (cliente) => {
    await pedido(cliente, O(90), { total: 100 });
    const r1 = await contestacao(cliente, { pedido: O(90), cbk: "CBK-L1", caseId: "901", decisao: "em_analise", valorCaso: 60, casos: 2 });
    assert.equal(r1.resultado, "reservado");
    assert.equal(num(r1.linha_amount), 60);
    const r2 = await contestacao(cliente, { pedido: O(90), cbk: "CBK-L2", caseId: "902", decisao: "em_analise", estimado: 100, casos: 2 });
    assert.equal(r2.resultado, "reservado");
    assert.equal(num(r2.linha_amount), 40, "a estimativa só reserva o que sobra");
    const r3 = await contestacao(cliente, { pedido: O(90), cbk: "CBK-L2", caseId: "902", decisao: "em_analise", valorCaso: 60, estimado: 100, casos: 2 });
    assert.equal(r3.resultado, "reserva_ajustada");
    assert.equal(num(r3.linha_amount), 40, "o ajuste para cima para no disponível");
    assert.equal(r3.aviso, "saldo");
    const e = await estado(cliente, O(90));
    assert.equal(e.linhas.reduce((s, l) => s + num(l.amount), 0), 100, "reservado nunca passa do pago");
    assert.equal(num(r3.disponivel), 0);
    assert.equal(e.valorEstornado, 0);
  },
});

PROVAS.push({
  nome: "(m) corrida REAL contestação × REF: a reserva de 100 segura a trava; o REF de 100 espera e volta nao_cabe; comprometido 100",
  corpo: async (cliente, url) => {
    await pedido(cliente, O(95), { total: 100 });
    const { ra, rb, parou } = await corrida(
      url,
      (c) => contestacao(c, { pedido: O(95), cbk: "CBK-M", caseId: "951", decisao: "em_analise", valorCaso: 100 }),
      (c) => externo(c, { pedido: O(95), ref: "REF-M", valor: 100 }),
    );
    assert.equal(parou, true, "o REF parou na trava do pedido (wait_event_type = Lock)");
    assert.equal(ra.resultado, "reservado");
    assert.equal(rb.resultado, "nao_cabe", "o REF enxergou a reserva commitada");
    assert.equal(rb.aviso, "saldo");
    const e = await estado(cliente, O(95));
    const emVoo = e.linhas
      .filter((l) => l.status === "solicitado" || l.status === "em_processamento")
      .reduce((s, l) => s + num(l.amount), 0);
    assert.equal(e.valorEstornado + emVoo, 100, "comprometido (estornado + em voo) = 100, nunca 200");
    assert.equal(e.linhas.filter((l) => l.mp_refund_id === "REF-M").length, 0);
  },
});

PROVAS.push({
  nome: "(h) migration: reaplicar é no-op; preflight recusa sem a 20261192000000; rollback + reaplicar",
  corpo: async (cliente) => {
    const sql = lerMigration(MIGRATION);
    const rollback = lerMigration(`rollback-manual-${MIGRATION}`);
    await cliente.query("BEGIN");
    try {
      await cliente.query(sql);
      await cliente.query(rollback);
      const sumiu = await cliente.query("SELECT to_regprocedure($1) AS f", [FN_CONTESTACAO]);
      assert.equal(sumiu.rows[0].f, null, "o rollback apaga a função");
      const colunas = await cliente.query(
        `SELECT count(*)::int AS n FROM pg_attribute
          WHERE attrelid = 'public.order_refunds'::regclass
            AND attname IN ('mp_chargeback_case_id', 'mp_chargeback_valor_do_caso') AND NOT attisdropped`,
      );
      assert.equal(colunas.rows[0].n, 2, "as colunas FICAM no rollback");
      const tabela = await cliente.query("SELECT to_regclass('public.contestacoes_decisao_final') AS t");
      assert.notEqual(tabela.rows[0].t, null, "a decisão final (histórico) FICA no rollback");
      await cliente.query(sql);
      const voltou = await cliente.query("SELECT to_regprocedure($1) AS f", [FN_CONTESTACAO]);
      assert.notEqual(voltou.rows[0].f, null);
    } finally {
      await cliente.query("ROLLBACK");
    }

    await cliente.query("BEGIN");
    try {
      await cliente.query("DROP INDEX public.uq_order_refunds_pedido_contestacao");
      let erro = null;
      try {
        await cliente.query(sql);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "o preflight recusa sem a 20261192000000");
      assert.match(erro.message, /B1_BASELINE_DIVERGENT: public\.uq_order_refunds_pedido_contestacao/);
    } finally {
      await cliente.query("ROLLBACK");
    }

    // Tabela da decisão final com OUTRA forma: recusa, nada gravado.
    await cliente.query("BEGIN");
    try {
      await cliente.query("ALTER TABLE public.contestacoes_decisao_final ADD COLUMN intrusa integer");
      let erro = null;
      try {
        await cliente.query(sql);
      } catch (e) {
        erro = e;
      }
      assert.ok(erro, "o preflight recusa a tabela com outra forma");
      assert.match(erro.message, /B1_BASELINE_DIVERGENT: public\.contestacoes_decisao_final/);
    } finally {
      await cliente.query("ROLLBACK");
    }
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
        anexarAoSummary("Prova viva da contestação (rpc-ci)", linhas.join("\n"));
        falhar("FALHOU", "Uma regra de dinheiro da contestação foi quebrada — ver acima qual.");
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(`\n[contestacao] ${PROVAS.length}/${PROVAS.length} provas passaram.`);
  anexarAoSummary(
    "Prova viva da contestação (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
