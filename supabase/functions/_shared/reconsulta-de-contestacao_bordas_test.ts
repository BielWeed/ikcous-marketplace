// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `reconsulta-de-contestacao.ts` (o cron e o
 * tópico do webhook que reconsultam, no Mercado Pago, uma contestação que
 * travou o saldo de um pedido). 27 mutantes sobreviviam às suítes de
 * `reconsulta-de-contestacao_test.ts` e `reconsulta-caso-conhecido_test.ts`;
 * metade era `??`/`||` sem efeito. Os que mudavam o comportamento viram os
 * casos abaixo:
 *
 *   * a order devolvida só vale se `id` E `external_reference` batem — o id
 *     sozinho diferente já é "outra cobrança": nada se decide sobre ela;
 *   * linha com só UMA metade do vínculo (CBK sem case_id, case_id sem CBK, ou
 *     texto vazio) é linha SEM vínculo: conserva e avisa, nunca consulta o caso
 *     "null" no MP;
 *   * order em `charged_back` com a lista de casos ilegível e linha sem vínculo:
 *     quem conserva é o caminho da order (aviso com o id da cobrança);
 *   * caso vinculado que a order já cobriu NÃO é entregue duas vezes;
 *   * uma reserva conservada vence uma em aberto no desfecho do pedido;
 *   * falha 500 do MP na order é transitória (o carimbo volta ao corte, e não a
 *     "agora"), e o corpo da recusa (que traz e-mail e CPF do pagador) NUNCA vai
 *     para o log;
 *   * `limitePedidos: 0` não vira o teto padrão; `order_id` vazio não é vínculo.
 *
 * Fixtures inventadas; nenhuma chamada de rede, nenhum banco.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  PRAZO_DA_RECONSULTA_MS,
  reconsultarContestacoesPresas,
  recuperarContestacaoPeloCaso,
} from "./reconsulta-de-contestacao.ts";

const VENDEDOR = "1234567";
const AGORA = Date.parse("2026-10-04T12:00:00.000Z");
const HORA = 60 * 60 * 1000;
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ORDER_MP = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const OUTRA_ORDER_MP = "ORDTST01KZZ4D94WC79335A68CZ5NZ7Z";
const PAGAMENTO = "PAY01J67CQQH5904WDBVZEM4JMEP3";

const ha = (horas: number) => new Date(AGORA - horas * HORA).toISOString();

function linha(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    order_id: PEDIDO,
    updated_at: ha(7),
    status: "em_processamento",
    solicitado_por: "sistema",
    mp_status: "charged_back",
    mp_chargeback_id: null,
    mp_chargeback_case_id: null,
    ...extra,
  };
}

/** Banco dublê: filtros `eq`/`lt`/`neq` SIMULADOS de verdade; as escritas ficam registradas. */
function banco(linhas: Array<Record<string, unknown>>, orderRowId: string | null = PEDIDO) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const toques: Array<{ id: unknown; valores: Record<string, unknown> }> = [];
  const construtor = () => {
    const filtros: Array<[string, string, unknown]> = [];
    let teto = Infinity;
    const q = {
      eq(c: string, v: unknown) {
        filtros.push(["eq", c, v]);
        return q;
      },
      neq(c: string, v: unknown) {
        filtros.push(["neq", c, v]);
        return q;
      },
      lt(c: string, v: unknown) {
        filtros.push(["lt", c, v]);
        return q;
      },
      order() {
        return q;
      },
      limit(n: number) {
        teto = n;
        return q;
      },
      then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
        const r = linhas.filter((l) =>
          filtros.every(([op, c, v]) =>
            op === "eq" ? Reflect.get(l, c) === v : op === "neq" ? Reflect.get(l, c) !== v : String(Reflect.get(l, c)) < String(v)
          )
        );
        return Promise.resolve({ data: r.slice(0, teto).map((l) => ({ ...l })), error: null }).then(res, rej);
      },
    };
    return q;
  };
  return {
    rpcs,
    toques,
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select: () => construtor(),
          update(valores: Record<string, unknown>) {
            const filtros: Array<[string, unknown]> = [];
            const q = {
              eq(c: string, v: unknown) {
                filtros.push([c, v]);
                return q;
              },
              lt() {
                return q;
              },
              then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
                toques.push({ id: filtros.find(([c]) => c === "id")?.[1], valores });
                return Promise.resolve({ data: null, error: null }).then(res, rej);
              },
            };
            return q;
          },
        };
      }
      if (tabela === "marketplace_orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: orderRowId === null ? null : {
                    id: orderRowId,
                    gateway_payment_id: ORDER_MP,
                    total: 149.9,
                    valor_estornado: 0,
                    payment_status: "pago",
                    paid_at: "2026-10-01T00:00:00Z",
                    status: "paid",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`from inesperado no dublê: ${tabela}`);
    },
    rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      return Promise.resolve({ data: { resultado: "registrada", aviso: null, valor_estornado: 0 }, error: null });
    },
  };
}

const casoDoMp = (id: string, coverage: boolean | null, amount = 149.9) => ({
  id,
  amount,
  currency: "BRL",
  coverage_applied: coverage,
  payments: [86439942806],
});

function order(over: Record<string, unknown> = {}) {
  const {
    id = ORDER_MP,
    ref = PEDIDO,
    status = "charged_back",
    detalhePagamento = "in_process",
    chargebacks = [{ id: "CBK1", case_id: "CASE1", transaction_id: PAGAMENTO, status: "" }],
  } = over as Record<string, unknown>;
  return {
    id,
    status,
    status_detail: detalhePagamento,
    external_reference: ref,
    total_amount: "149.90",
    transactions: {
      payments: [{ id: PAGAMENTO, amount: "149.90", status, status_detail: detalhePagamento }],
      chargebacks,
    },
  };
}

function mp(opts: {
  ordem?: { status: number; corpo?: unknown };
  casos?: Record<string, { status: number; corpo?: unknown }>;
}) {
  const chamadas: string[] = [];
  const fetchImpl = (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    chamadas.push(u);
    if (u.includes("/v1/chargebacks/") && (init?.headers as Record<string, string>)?.["X-Caller-Id"] !== VENDEDOR) {
      return Promise.resolve(new Response("{}", { status: 403 }));
    }
    if (/\/v1\/orders\/[^/?]+$/.test(u)) {
      const o = opts.ordem ?? { status: 404 };
      return Promise.resolve(new Response(JSON.stringify(o.corpo ?? {}), { status: o.status }));
    }
    const c = u.match(/\/v1\/chargebacks\/([^/?]+)$/);
    const alvo = c ? Reflect.get(opts.casos ?? {}, c[1]) : undefined;
    if (!alvo) return Promise.resolve(new Response("{}", { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(alvo.corpo ?? {}), { status: alvo.status }));
  };
  return {
    fetchImpl,
    chamadas,
    casosLidos: () => chamadas.filter((u) => u.includes("/v1/chargebacks/")),
  };
}

async function mudo<T>(f: () => Promise<T>) {
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return await f();
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

async function cron(b: ReturnType<typeof banco>, m: ReturnType<typeof mp>, extra: Record<string, unknown> = {}) {
  const avisos: string[] = [];
  const resumo = await mudo(() =>
    reconsultarContestacoesPresas({
      supabase: b,
      token: "token-do-lojista",
      vendedorId: VENDEDOR,
      fetchImpl: m.fetchImpl,
      avisar: (chave: string) => {
        avisos.push(chave);
        return Promise.resolve();
      },
      agora: () => AGORA,
      ...extra,
    })
  );
  return { resumo, avisos };
}

const doLedger = (b: ReturnType<typeof banco>) => b.rpcs.filter((r) => r.nome === "registrar_contestacao_no_ledger");

// ─── a order tem de SER a cobrança gravada ───────────────────────────────────

Deno.test("order com o MESMO external_reference mas OUTRO id: order_divergente — nenhuma RPC, nenhum GET de caso, admin avisado", async () => {
  const b = banco([linha("L1")]);
  const m = mp({
    ordem: { status: 200, corpo: order({ id: OUTRA_ORDER_MP }) },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", true) } },
  });
  const r = await cron(b, m);
  assertEquals(doLedger(b), []);
  assertEquals(m.casosLidos(), []);
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:order_divergente`]);
  assertEquals(r.resumo.conservadas, 1);
});

Deno.test("controle: a order com id E external_reference certos entrega a decisão (a guarda não bloqueia o legítimo)", async () => {
  const b = banco([linha("L1")]);
  const m = mp({
    // O pagamento 'reimbursed' CONCORDA com o caso a favor da loja (senão conserva).
    ordem: { status: 200, corpo: order({ detalhePagamento: "reimbursed" }) },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", true) } },
  });
  const r = await cron(b, m);
  assertEquals(doLedger(b).length, 1);
  assertEquals(r.resumo.reconsultadas, 1);
});

// ─── vínculo pela metade não é vínculo ───────────────────────────────────────

Deno.test("linha com só UMA metade do vínculo (ou texto vazio) é linha SEM vínculo: conserva e avisa, e o caso 'null' nunca é consultado", async () => {
  const metades = [
    { mp_chargeback_id: "CBK1", mp_chargeback_case_id: null },
    { mp_chargeback_id: null, mp_chargeback_case_id: "CASE1" },
    { mp_chargeback_id: "", mp_chargeback_case_id: "CASE1" },
    { mp_chargeback_id: "CBK1", mp_chargeback_case_id: "" },
  ];
  for (const metade of metades) {
    const b = banco([linha("L1", metade)]);
    const m = mp({
      ordem: { status: 200, corpo: order({ status: "processed", chargebacks: [] }) },
      casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", true) } },
    });
    const r = await cron(b, m);
    const nome = JSON.stringify(metade);
    assertEquals(m.casosLidos(), [], nome);
    assertEquals(doLedger(b), [], nome);
    assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:order_processed`], nome);
    assertEquals(r.resumo.conservadas, 1, nome);
  }
});

// ─── order em charged_back com lista ilegível ────────────────────────────────

Deno.test("order em charged_back com a lista de casos ilegível e linha SEM vínculo: conserva pelo caminho da order (aviso com o id da cobrança), nada decidido", async () => {
  const b = banco([linha("L1")]);
  const m = mp({
    ordem: { status: 200, corpo: order({ chargebacks: "ilegivel" }) },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", true) } },
  });
  const r = await cron(b, m);
  assertEquals(doLedger(b), []);
  assertEquals(m.casosLidos(), []);
  assertEquals(r.avisos, [`contestacao_indefinida:${PEDIDO}:${ORDER_MP}`]);
  assertEquals(r.resumo.conservadas, 1);
});

// ─── o caso que a order cobriu não é entregue de novo ───────────────────────

Deno.test("caso vinculado que a order JÁ cobriu (CBK na lista): UMA consulta ao MP e UMA RPC, nunca duas", async () => {
  const b = banco([linha("L1", { mp_chargeback_id: "CBK1", mp_chargeback_case_id: "CASE1" })]);
  const m = mp({
    ordem: { status: 200, corpo: order({ detalhePagamento: "reimbursed" }) },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", true) } },
  });
  const r = await cron(b, m);
  assertEquals(m.casosLidos().length, 1);
  assertEquals(doLedger(b).length, 1);
  assertEquals(doLedger(b)[0].args.p_mp_chargeback_id, "CBK1");
  assertEquals(r.resumo.reconsultadas, 1);
});

// ─── o desfecho do pedido ────────────────────────────────────────────────────

Deno.test("duas reservas no pedido, uma EM ANÁLISE e outra CONSERVADA: o desfecho é 'conservada' (nunca 'em aberto'), para o admin ser avisado", async () => {
  const b = banco([
    linha("L1", { mp_chargeback_id: "CBK1", mp_chargeback_case_id: "CASE1" }),
    linha("L2", { mp_chargeback_id: "CBK2", mp_chargeback_case_id: "CASE2" }),
  ]);
  const m = mp({
    ordem: { status: 200, corpo: order({ status: "processed", chargebacks: [] }) },
    casos: {
      CASE1: { status: 200, corpo: casoDoMp("CASE1", null) },
      // contra a loja, sem o pagamento da order corroborar: só conserva.
      CASE2: { status: 200, corpo: casoDoMp("CASE2", false) },
    },
  });
  const r = await cron(b, m);
  assertEquals([r.resumo.conservadas, r.resumo.emAberto], [1, 0]);
  assertEquals(m.casosLidos().length, 2);
});

Deno.test("uma só reserva EM ANÁLISE vinculada: o desfecho é 'em aberto' (e conta em emAberto)", async () => {
  const b = banco([linha("L1", { mp_chargeback_id: "CBK1", mp_chargeback_case_id: "CASE1" })]);
  const m = mp({
    ordem: { status: 200, corpo: order({ status: "processed", chargebacks: [] }) },
    casos: { CASE1: { status: 200, corpo: casoDoMp("CASE1", null) } },
  });
  const r = await cron(b, m);
  assertEquals([r.resumo.conservadas, r.resumo.emAberto], [0, 1]);
});

Deno.test("order em charged_back SEM nenhum caso na lista e linha sem vínculo: nada a entregar, e o desfecho NÃO é 'em aberto'", async () => {
  const b = banco([linha("L1")]);
  const m = mp({ ordem: { status: 200, corpo: order({ chargebacks: [] }) } });
  const r = await cron(b, m);
  assertEquals(doLedger(b), []);
  assertEquals(r.resumo.emAberto, 0);
});

// ─── falha 500 do MP é transitória ──────────────────────────────────────────

Deno.test("HTTP 500 na order: o carimbo volta ao CORTE (transitória); 499 e 404 não são transitórias", async () => {
  const corte = new Date(AGORA - PRAZO_DA_RECONSULTA_MS).toISOString();
  const b = banco([linha("L1")]);
  const r = await cron(b, mp({ ordem: { status: 500 } }));
  assertEquals(r.resumo.falhas, 1);
  assertEquals(b.toques.length, 1);
  assertEquals(b.toques[0].valores.updated_at, corte);

  // 400 (cliente): não é transitória, o carimbo é "agora" (a linha só volta daqui a 6 h).
  const b2 = banco([linha("L1")]);
  const r2 = await cron(b2, mp({ ordem: { status: 400 } }));
  assertEquals(r2.resumo.falhas, 1);
  assertEquals(b2.toques[0].valores.updated_at, new Date(AGORA).toISOString());
});

Deno.test("recusa do MP na order: o corpo (com e-mail e CPF do pagador) NÃO vai para o log da função", async () => {
  const linhasDeLog: string[] = [];
  const original = console.error;
  const b = banco([linha("L1")]);
  const corpo = {
    message: "falha qualquer",
    payer: { email: "cliente-de-teste@exemplo.invalid", identification: { type: "CPF", number: "11122233344" } },
  };
  const m = mp({ ordem: { status: 500, corpo } });
  const avisos: string[] = [];
  const [w, l] = [console.warn, console.log];
  console.error = (...a: unknown[]) => void linhasDeLog.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.warn = () => {};
  console.log = () => {};
  try {
    await reconsultarContestacoesPresas({
      supabase: b,
      token: "token-do-lojista",
      vendedorId: VENDEDOR,
      fetchImpl: m.fetchImpl,
      avisar: (chave: string) => {
        avisos.push(chave);
        return Promise.resolve();
      },
      agora: () => AGORA,
    });
  } finally {
    [console.error, console.warn, console.log] = [original, w, l];
  }
  const tudo = linhasDeLog.join(" | ");
  assert(linhasDeLog.length > 0, "a falha tem de ser registrada");
  assert(!tudo.includes("cliente-de-teste@exemplo.invalid"), "e-mail do pagador no log");
  assert(!tudo.includes("11122233344"), "CPF do pagador no log");
});

// ─── o lote ──────────────────────────────────────────────────────────────────

Deno.test("limitePedidos 0 reconsulta ZERO pedidos (não vira o teto padrão)", async () => {
  const b = banco([linha("L1")]);
  const m = mp({ ordem: { status: 200, corpo: order() } });
  const r = await cron(b, m, { limitePedidos: 0 });
  assertEquals(r.resumo.vistas, 0);
  assertEquals(m.chamadas, []);
});

Deno.test("tópico do caso: linha cujo order_id é texto vazio NÃO é vínculo ('sem_vinculo'), nada é consultado", async () => {
  const b = banco([linha("L1", { order_id: "", mp_chargeback_id: "CBK1", mp_chargeback_case_id: "CASE1" })]);
  const m = mp({});
  const avisos: string[] = [];
  const r = await mudo(() =>
    recuperarContestacaoPeloCaso({
      supabase: b,
      token: "token-do-lojista",
      vendedorId: VENDEDOR,
      fetchImpl: m.fetchImpl,
      avisar: (chave: string) => {
        avisos.push(chave);
        return Promise.resolve();
      },
      caseId: "CASE1",
      agora: () => AGORA,
    })
  );
  assertEquals(r, "sem_vinculo");
  assertEquals(m.chamadas, []);
  assert(avisos.length === 0);
});
