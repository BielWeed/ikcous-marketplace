// @ts-nocheck
/**
 * C-D (02/10/2026) — o que a edge acrescenta à fila nova da reconciliação
 * (migration 20261190000000): o carimbo do rodízio e da cobrança terminal
 * (`marcar_visitas_da_reconciliacao`, NÃO FATAL) e o push ao admin SÓ para o
 * literal `pago_apos_expirar` (falha aberto). Nada toca rede nem banco: o
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
        return { select: () => ({ in: () => ({ neq: () => ({ lt: () => ({ order: () => ({ order: () => fim }) }) }) }) }) };
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
}) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const pushes: Array<{ title: string; body: string; url: string }> = [];
  const erros: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => erros.push(a.map(String).join(" "));
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    const r = await handler(requisicao(), {
      supabase: supabaseFalso({ ...opts, chamadas }),
      fetchImpl: mpFalso(opts.orders),
      enviarComprovante: async () => {},
      enviarAvisoAtrasado: async () => {},
      enviarPush: opts.enviarPush ??
        (({ aviso }) => {
          pushes.push(aviso);
          return Promise.resolve();
        }),
    });
    return { status: r.status, corpo: await r.json(), chamadas, pushes, erros };
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

for (const resultado of ["pago", "ja_pago", "ignorado", "divergente", "ja_estornado"]) {
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
  assert(r.erros.some((e) => e.includes("push de pagamento fora do fluxo falhou")), r.erros.join("\n"));
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
