// @ts-nocheck
/**
 * C-D (02/10/2026) — o que a edge acrescenta à fila nova da reconciliação
 * (migration 20261190000000): o carimbo do rodízio e da cobrança terminal
 * (`marcar_visitas_da_reconciliacao`, NÃO FATAL) e o push ao admin quando o
 * cron confirma ('pago' desde a FASE 2, 04/10/2026; 'pago_apos_expirar' desde
 * a C-D; falha aberto, sempre pelo módulo `_shared/efeitos-do-pagamento.ts`). Nada toca rede nem banco: o
 * cliente Supabase, o MP e o push são dublês. O comportamento contra o SQL
 * real (PGlite, com a migration aplicada do arquivo) foi provado à parte.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-reconciliacao-teste";
const PEDIDO_1 = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const PEDIDO_2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORDER_1 = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const ORDER_2 = "ORDTST01KZZ4D94WC79335A68CZ5NZ7Y";

Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

const requisicao = () =>
  new Request("http://localhost/reconciliar-pagamentos", {
    method: "POST",
    headers: { "x-reconciliacao-secret": SEGREDO },
  });

function orderMp(id: string, status: string, detalhe: string, tipo = "credit_card") {
  return {
    id,
    status,
    status_detail: detalhe,
    total_amount: "149.90",
    transactions: {
      payments: [{ id: `PAY${id}`, amount: "149.90", status, status_detail: detalhe, payment_method: { id: "visa", type: tipo } }],
    },
  };
}

/**
 * A lista de contestações presas (FASE 2, `reconsulta-de-contestacao.ts`) lê
 * `order_refunds` com `.eq().lt().order().limit()`: estes testes não têm
 * contestação nenhuma, então a cadeia devolve vazio (e a reconsulta não faz
 * nada, sem ruído de TypeError engolido).
 */
function cadeiaVazia() {
  const q = {
    eq: () => q,
    lt: () => q,
    order: () => q,
    limit: () => q,
    then: (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
      Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return q;
}
const ehLeituraDeContestacao = (colunas: string) => colunas.trim() === "id" || colunas.trim() === "id, order_id, updated_at";

/** MP falso: GET /v1/orders/{id} devolve a order configurada para o id. */
function mpFalso(orders: Record<string, unknown>) {
  return (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const m = u.match(/\/v1\/orders\/([^/?]+)$/);
    const corpo = m ? orders[m[1]] : undefined;
    return Promise.resolve(
      corpo
        ? new Response(JSON.stringify(corpo), { status: 200 })
        : new Response(JSON.stringify({ errors: [{ code: "order_not_found" }] }), { status: 404 }),
    );
  };
}

/** Supabase falso: as RPCs pelo nome; `confirmar` decide o texto por pedido. */
function supabaseFalso(opts: {
  candidatos: Array<{ order_id: string; gateway_payment_id: string }>;
  confirmar?: (args: Record<string, unknown>) => string;
  erroMarcar?: boolean;
  chamadas: Array<{ nome: string; args: Record<string, unknown> }>;
}) {
  const vazio = { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  const responder = (nome: string, args: Record<string, unknown>) => {
    if (nome === "pagamentos_a_reconciliar") return { data: opts.candidatos, error: null };
    if (nome === "confirmar_pagamento") return { data: opts.confirmar?.(args) ?? "ignorado", error: null };
    if (nome === "liberar_cobranca_do_pedido") return { data: false, error: null };
    if (nome === "marcar_visitas_da_reconciliacao") {
      return opts.erroMarcar ? { data: null, error: { message: "function does not exist" } } : { data: 1, error: null };
    }
    return { data: null, error: null };
  };
  return {
    rpc: (nome: string, args: Record<string, unknown>) => {
      opts.chamadas.push({ nome, args });
      return Promise.resolve(responder(nome, args));
    },
    from(tabela: string) {
      if (tabela === "marketplace_orders") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { total: 149.9, total_amount: null }, error: null }) }),
          }),
        };
      }
      if (tabela === "app_settings") return { select: () => ({ eq: () => vazio }) };
      if (tabela === "order_refunds") {
        const fim = { limit: () => Promise.resolve({ data: [], error: null }) };
        return {
          select: (colunas: string) => {
            if (ehLeituraDeContestacao(colunas)) return cadeiaVazia();
            // Marca que a etapa de reembolsos (fila de `order_refunds`) foi alcançada.
            opts.chamadas.push({ nome: "fila_de_reembolsos", args: {} });
            return { in: () => ({ neq: () => ({ lt: () => ({ order: () => ({ order: () => fim }) }) }) }) };
          },
        };
      }
      throw new Error(`from inesperado no dublê: ${tabela}`);
    },
  };
}

async function rodar(opts: {
  candidatos: Array<{ order_id: string; gateway_payment_id: string }>;
  orders: Record<string, unknown>;
  confirmar?: (args: Record<string, unknown>) => string;
  erroMarcar?: boolean;
  enviarPush?: (a: { aviso: { title: string; body: string; url: string } }) => Promise<void>;
  // Costuras do orçamento de tempo do ciclo e do MP (EST-EDGE-DIN-2).
  deps?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const pushes: Array<{ title: string; body: string; url: string }> = [];
  const erros: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => erros.push(a.map(String).join(" "));
  const origWarn = console.warn;
  const origLog = console.log;
  const avisos: string[] = [];
  console.warn = (...a: unknown[]) => { avisos.push(a.map(String).join(" ")); };
  console.log = () => {};
  try {
    const r = await handler(requisicao(), {
      supabase: supabaseFalso({ ...opts, chamadas }),
      fetchImpl: opts.fetchImpl ?? mpFalso(opts.orders),
      ...(opts.deps ?? {}),
      enviarComprovante: async () => {},
      enviarAvisoAtrasado: async () => {},
      enviarPush: opts.enviarPush ??
        (({ aviso }) => {
          pushes.push(aviso);
          return Promise.resolve();
        }),
    });
    return { status: r.status, corpo: await r.json(), chamadas, pushes, erros, avisos };
  } finally {
    console.error = original;
    console.warn = origWarn;
    console.log = origLog;
  }
}

const marcar = (chamadas) => chamadas.filter((c) => c.nome === "marcar_visitas_da_reconciliacao");

Deno.test("C-D - 'pago_apos_expirar' -> UM push ao admin ('Pagamento fora do fluxo', #pedido, valor) e o carimbo do visitado", async () => {
  const r = await rodar({
    candidatos: [{ order_id: PEDIDO_1, gateway_payment_id: ORDER_1 }],
    orders: { [ORDER_1]: orderMp(ORDER_1, "processed", "accredited") },
    confirmar: () => "pago_apos_expirar",
  });
  assertEquals(r.status, 200);
  assertEquals(r.pushes.length, 1);
  assertEquals(r.pushes[0], { title: "Pagamento fora do fluxo", body: "#4F5A6B · R$ 149,90 · estoque já devolvido", url: "/admin-orders" });
  assertEquals(marcar(r.chamadas).map((c) => c.args), [{ p_visitados: [PEDIDO_1], p_terminais: [], p_cobrancas_terminais: [] }]);
});

Deno.test("FASE 2 - 'pago' -> UM push ao lojista ('Pedido pago', #pedido, valor); até 04/10 o cron vendia em silêncio (pedido c35ce4dd)", async () => {
  const r = await rodar({
    candidatos: [{ order_id: PEDIDO_1, gateway_payment_id: ORDER_1 }],
    orders: { [ORDER_1]: orderMp(ORDER_1, "processed", "accredited") },
    confirmar: () => "pago",
  });
  assertEquals(r.status, 200);
  assertEquals(r.pushes, [{ title: "Pedido pago", body: "#4F5A6B · R$ 149,90", url: "/admin-orders" }]);
});

for (const resultado of ["ja_pago", "ignorado", "divergente", "ja_estornado"]) {
  Deno.test(`C-D - '${resultado}' -> NENHUM push ao admin desta porta`, async () => {
    const r = await rodar({
      candidatos: [{ order_id: PEDIDO_1, gateway_payment_id: ORDER_1 }],
      orders: { [ORDER_1]: orderMp(ORDER_1, "processed", "accredited") },
      confirmar: () => resultado,
    });
    assertEquals(r.pushes.length, 0);
  });
}

Deno.test("C-D - push que LANÇA nao para a reconciliacao: os dois candidatos sao confirmados, 0 falhas, carimbo gravado, erro so no log", async () => {
  const r = await rodar({
    candidatos: [
      { order_id: PEDIDO_1, gateway_payment_id: ORDER_1 },
      { order_id: PEDIDO_2, gateway_payment_id: ORDER_2 },
    ],
    orders: { [ORDER_1]: orderMp(ORDER_1, "processed", "accredited"), [ORDER_2]: orderMp(ORDER_2, "processed", "accredited") },
    confirmar: () => "pago_apos_expirar",
    enviarPush: () => Promise.reject(new Error("push fora do ar")),
  });
  assertEquals(r.status, 200);
  assertEquals([r.corpo.verificados, r.corpo.confirmados, r.corpo.falhas], [2, 2, 0]);
  assertEquals(r.chamadas.filter((c) => c.nome === "confirmar_pagamento").length, 2);
  assertEquals(marcar(r.chamadas)[0].args.p_visitados, [PEDIDO_1, PEDIDO_2]);
  assert(r.erros.some((e) => e.includes("push ao lojista falhou")), r.erros.join("\n"));
});

Deno.test("C-D - push que NUNCA responde: o handler segue depois do teto de 5 s", async () => {
  const inicio = Date.now();
  const r = await rodar({
    candidatos: [{ order_id: PEDIDO_1, gateway_payment_id: ORDER_1 }],
    orders: { [ORDER_1]: orderMp(ORDER_1, "processed", "accredited") },
    confirmar: () => "pago_apos_expirar",
    enviarPush: () => new Promise(() => {}),
  });
  assertEquals([r.status, r.corpo.confirmados, r.corpo.falhas], [200, 1, 0]);
  assert(Date.now() - inicio < 9000);
});

Deno.test("C-D - o carimbo FALHA: so log, contagens e resposta iguais", async () => {
  const r = await rodar({
    candidatos: [{ order_id: PEDIDO_1, gateway_payment_id: ORDER_1 }],
    orders: { [ORDER_1]: orderMp(ORDER_1, "processed", "accredited") },
    confirmar: () => "pago",
    erroMarcar: true,
  });
  assertEquals(r.status, 200);
  assertEquals([r.corpo.verificados, r.corpo.confirmados, r.corpo.falhas, r.corpo.ignorados], [1, 1, 0, 0]);
  assert(r.erros.some((e) => e.includes("marcar_visitas_da_reconciliacao falhou")), r.erros.join("\n"));
});

Deno.test("C-D - cobranca TERMINAL no MP (cartao recusado/cancelado/expirado, PIX expirado) vai para p_terminais com o ID da cobranca; viva e paga nao vao", async () => {
  const casos: Array<[string, Record<string, unknown>, boolean]> = [
    ["cartao failed", orderMp(ORDER_1, "failed", "rejected_by_issuer"), true],
    ["cartao canceled", orderMp(ORDER_1, "canceled", "canceled"), true],
    ["cartao expired", orderMp(ORDER_1, "expired", "expired"), true],
    ["pix expired", orderMp(ORDER_1, "expired", "expired", "bank_transfer"), true],
    ["cartao em analise", orderMp(ORDER_1, "processing", "pending_review_manual"), false],
    ["pix aguardando", orderMp(ORDER_1, "action_required", "waiting_transfer", "bank_transfer"), false],
    ["pago", orderMp(ORDER_1, "processed", "accredited"), false],
  ];
  for (const [rotulo, order, terminal] of casos) {
    const r = await rodar({
      candidatos: [{ order_id: PEDIDO_1, gateway_payment_id: ORDER_1 }],
      orders: { [ORDER_1]: order },
      confirmar: () => "ignorado",
    });
    const args = marcar(r.chamadas)[0]?.args;
    assertEquals(args?.p_visitados, [PEDIDO_1], rotulo);
    assertEquals(
      [args?.p_terminais, args?.p_cobrancas_terminais],
      terminal ? [[PEDIDO_1], [ORDER_1]] : [[], []],
      rotulo,
    );
  }
});

Deno.test("C-D - consulta ao MP que FALHA (404) nao e terminal: o pedido so ganha a visita", async () => {
  const r = await rodar({ candidatos: [{ order_id: PEDIDO_1, gateway_payment_id: ORDER_1 }], orders: {} });
  assertEquals(r.corpo.falhas, 1);
  assertEquals(marcar(r.chamadas)[0].args, { p_visitados: [PEDIDO_1], p_terminais: [], p_cobrancas_terminais: [] });
});

Deno.test("C-D - fila vazia: nenhum carimbo", async () => {
  const r = await rodar({ candidatos: [], orders: {} });
  assertEquals(marcar(r.chamadas).length, 0);
  assertStringIncludes(JSON.stringify(r.corpo), '"verificados":0');
});

// ─── EST-EDGE-DIN-2 (16/10/2026): orçamento de tempo do ciclo ───────────────
// A RPC entrega até 100 cobranças e o laço consulta uma por vez (15 s cada).
// Todas expirando = 1.500 s, muito acima do limite da Edge Function: o
// processo morria SEM carimbar o rodízio, e o ciclo seguinte repetia as mesmas
// cobranças e nunca chegava aos reembolsos.

const PEDIDOS_DO_LOTE = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
const ORDERS_DO_LOTE = Array.from({ length: 5 }, (_, i) => `ORDTST01KZZ4D94WC79335A68CZ5NZ7${i}`);

/** Relógio falso: cada consulta ao MP consome `msPorConsulta` do orçamento. */
function relogioQueAvancaComOMp(msPorConsulta: number, inicio = 0) {
  const estado = { agora: inicio, consultas: [] as string[] };
  const orders = Object.fromEntries(ORDERS_DO_LOTE.map((id) => [id, orderMp(id, "processed", "accredited")]));
  const mp = mpFalso(orders);
  return {
    estado,
    agora: () => estado.agora,
    fetchImpl: (url: string | URL | Request) => {
      estado.consultas.push(String(url));
      estado.agora += msPorConsulta;
      return mp(url);
    },
  };
}

const candidatosDoLote = () => Array.from({ length: 5 }, (_, i) => ({
  order_id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  gateway_payment_id: `ORDTST01KZZ4D94WC79335A68CZ5NZ7${i}`,
}));

Deno.test("EST-EDGE-DIN-2 - orçamento estourado no meio do lote: para de consultar, carimba SÓ os consultados, chega aos reembolsos e conta os adiados", async () => {
  const relogio = relogioQueAvancaComOMp(40_000);
  const r = await rodar({
    candidatos: candidatosDoLote(),
    orders: {},
    fetchImpl: relogio.fetchImpl,
    deps: { agora: relogio.agora, orcamentoDoCicloMs: 100_000 },
    confirmar: () => "pago",
  });
  assertEquals(r.status, 200);
  // 0 s, 40 s e 80 s ainda cabem; no 120 s o orçamento acabou.
  assertEquals(relogio.estado.consultas.length, 3);
  assertEquals([r.corpo.verificados, r.corpo.confirmados, r.corpo.falhas, r.corpo.ignorados], [3, 3, 0, 0]);
  assertEquals(r.corpo.adiadosPorTempo, 2);
  // Só quem foi consultado ganha a visita: os 2 restantes seguem NULLS FIRST no rodízio.
  assertEquals(marcar(r.chamadas).map((c) => c.args.p_visitados), [PEDIDOS_DO_LOTE.slice(0, 3)]);
  // A etapa de reembolsos foi alcançada com o ciclo já estourado.
  assertEquals(r.chamadas.some((c) => c.nome === "fila_de_reembolsos"), true);
  assert(r.corpo.estornos !== undefined);
  assert(r.avisos.some((a) => a.includes("orçamento de tempo") && a.includes("2")), r.avisos.join(" | "));
});

Deno.test("EST-EDGE-DIN-2 - lote que cabe no orçamento: nada é adiado e todos são carimbados (controle)", async () => {
  const relogio = relogioQueAvancaComOMp(1_000);
  const r = await rodar({
    candidatos: candidatosDoLote(),
    orders: {},
    fetchImpl: relogio.fetchImpl,
    deps: { agora: relogio.agora, orcamentoDoCicloMs: 100_000 },
    confirmar: () => "pago",
  });
  assertEquals(r.corpo.verificados, 5);
  assertEquals(r.corpo.adiadosPorTempo, 0);
  assertEquals(marcar(r.chamadas)[0].args.p_visitados, PEDIDOS_DO_LOTE);
  assertEquals(r.avisos.some((a) => a.includes("orçamento de tempo")), false);
});

Deno.test("EST-EDGE-DIN-2 - orçamento JÁ estourado antes da 1ª cobrança: consulta ao menos UMA (o rodízio nunca fica parado) e adia o resto", async () => {
  const relogio = relogioQueAvancaComOMp(1_000, 500_000);
  const r = await rodar({
    candidatos: candidatosDoLote(),
    orders: {},
    fetchImpl: relogio.fetchImpl,
    // O relógio nasce em 500 s e o ciclo começa nele; o orçamento é 0: estoura já.
    deps: { agora: relogio.agora, orcamentoDoCicloMs: 0 },
    confirmar: () => "pago",
  });
  assertEquals(relogio.estado.consultas.length, 1);
  assertEquals([r.corpo.verificados, r.corpo.adiadosPorTempo], [1, 4]);
  assertEquals(marcar(r.chamadas)[0].args.p_visitados, [PEDIDOS_DO_LOTE[0]]);
});
