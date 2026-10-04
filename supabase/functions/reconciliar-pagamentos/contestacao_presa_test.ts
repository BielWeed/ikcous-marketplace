// @ts-nocheck
/**
 * A reconsulta de contestação presa DENTRO do cron (FASE 2, R3 do Lote A,
 * 04/10/2026): como o handler a liga, o que ela NÃO pode estragar e como o
 * aviso ao admin sai. A regra da reconsulta em si (quem, quando, o que o MP
 * responde) está em `_shared/reconsulta-de-contestacao_test.ts`.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-reconciliacao-teste";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ORDER = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const HORA = 60 * 60 * 1000;

Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

const requisicao = () =>
  new Request("http://localhost/reconciliar-pagamentos", { method: "POST", headers: { "x-reconciliacao-secret": SEGREDO } });

const orderMp = (status: string, detalhe: string, chargebacks = [{ id: "CBK1", case_id: "CASE1", transaction_id: "PAY1", status: "" }]) => ({
  id: ORDER,
  status,
  status_detail: detalhe,
  external_reference: PEDIDO,
  total_amount: "149.90",
  transactions: {
    payments: [{ id: "PAY1", amount: "149.90", status, status_detail: detalhe, payment_method: { id: "pix", type: "bank_transfer" } }],
    chargebacks,
  },
});

function mpFalso(order: unknown, caso: unknown = { id: "CASE1", amount: 149.9, currency: "BRL", coverage_applied: null }) {
  const chamadas: string[] = [];
  return {
    chamadas,
    fetchImpl: (url: string | URL | Request) => {
      const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      chamadas.push(u);
      if (/\/v1\/orders\//.test(u)) return Promise.resolve(new Response(JSON.stringify(order), { status: 200 }));
      if (/\/v1\/chargebacks\//.test(u)) return Promise.resolve(new Response(JSON.stringify(caso), { status: 200 }));
      return Promise.resolve(new Response("{}", { status: 404 }));
    },
  };
}

function cadeia(dados: unknown[], erro: unknown = null) {
  const q = {
    eq: () => q,
    lt: () => q,
    order: () => q,
    limit: () => q,
    then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => Promise.resolve({ data: erro ? null : dados, error: erro }).then(res, rej),
  };
  return q;
}

function supabaseFalso(opts: {
  candidatos?: Array<{ order_id: string; gateway_payment_id: string }>;
  linhaPresa?: boolean;
  erroNaLista?: unknown;
  /** o que `reservar_aviso_ao_lojista` devolve, em ordem. */
  reservas?: string[];
}) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const reservas = [...(opts.reservas ?? [])];
  const velha = new Date(Date.now() - 7 * HORA).toISOString();
  const linha = { id: "L1", order_id: PEDIDO, updated_at: velha };
  return {
    rpcs,
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "pagamentos_a_reconciliar") return Promise.resolve({ data: opts.candidatos ?? [], error: null });
      if (nome === "confirmar_pagamento") return Promise.resolve({ data: "pago", error: null });
      if (nome === "marcar_visitas_da_reconciliacao") return Promise.resolve({ data: 1, error: null });
      if (nome === "reservar_aviso_ao_lojista") return Promise.resolve({ data: reservas.shift() ?? "reservado", error: null });
      if (nome === "registrar_contestacao_no_ledger") {
        return Promise.resolve({ data: { resultado: "ja_reservado", aviso: null, valor_estornado: 0 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(tabela: string) {
      if (tabela === "marketplace_orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: PEDIDO, gateway_payment_id: ORDER, total: 149.9, total_amount: null, valor_estornado: 0, payment_status: "pago", paid_at: "x", status: "paid" },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (tabela === "app_settings") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      if (tabela === "order_refunds") {
        return {
          select: (colunas: string) => {
            if (colunas.trim() === "id, order_id, updated_at") return cadeia(opts.linhaPresa ? [linha] : [], opts.erroNaLista ?? null);
            if (colunas.trim() === "id") return cadeia(opts.linhaPresa ? [{ id: "L1" }] : []);
            // a fila de estornos do cron: vazia
            return { in: () => ({ neq: () => ({ lt: () => ({ order: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }) };
          },
          update: () => cadeia([]),
        };
      }
      throw new Error(`from inesperado: ${tabela}`);
    },
  };
}

async function rodar(supabase: unknown, mp: { fetchImpl: unknown }, extra: Record<string, unknown> = {}) {
  const erros: string[] = [];
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = (...a: unknown[]) => erros.push(a.map(String).join(" "));
  console.warn = () => {};
  console.log = () => {};
  try {
    const r = await handler(requisicao(), {
      supabase,
      fetchImpl: mp.fetchImpl,
      enviarComprovante: async () => {},
      enviarAvisoAtrasado: async () => {},
      enviarPush: async () => {},
      ...extra,
    });
    return { status: r.status, corpo: await r.json(), erros };
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

Deno.test("FASE 2 R3 — o ciclo do cron reconsulta a contestação presa e responde o resumo em `contestacoes`", async () => {
  const supabase = supabaseFalso({ linhaPresa: true });
  const mp = mpFalso(orderMp("charged_back", "in_process"));
  const r = await rodar(supabase, mp);
  assertEquals(r.status, 200);
  assertEquals(r.corpo.contestacoes, { vistas: 1, reconsultadas: 1, resolvidasAntes: 0, conservadas: 0, falhas: 0 });
  assertEquals(supabase.rpcs.filter((x) => x.nome === "registrar_contestacao_no_ledger").length, 1);
});

Deno.test("FASE 2 R3 — SEM reserva presa o passo não chama o MP nem a RPC da contestação", async () => {
  const supabase = supabaseFalso({ linhaPresa: false });
  const mp = mpFalso(orderMp("charged_back", "in_process"));
  const r = await rodar(supabase, mp);
  assertEquals(r.corpo.contestacoes.vistas, 0);
  assertEquals(mp.chamadas, []);
  assertEquals(supabase.rpcs.filter((x) => x.nome === "registrar_contestacao_no_ledger"), []);
});

Deno.test("FASE 2 R3 — a lista de reservas FALHA: o resultado dos PAGAMENTOS já dado não muda (confirmados 1), o erro só vai ao log", async () => {
  const supabase = supabaseFalso({
    candidatos: [{ order_id: PEDIDO, gateway_payment_id: ORDER }],
    linhaPresa: true,
    erroNaLista: { message: "statement timeout" },
  });
  const mp = mpFalso(orderMp("processed", "accredited"));
  const r = await rodar(supabase, mp);
  assertEquals(r.status, 200);
  assertEquals([r.corpo.verificados, r.corpo.confirmados, r.corpo.falhas], [1, 1, 0]);
  assertEquals(r.corpo.contestacoes, { vistas: 0, reconsultadas: 0, resolvidasAntes: 0, conservadas: 0, falhas: 0 });
  assert(r.erros.some((e) => e.includes("reconsulta de contestações presas falhou")), r.erros.join("\n"));
});

Deno.test("FASE 2 R3 — sem credencial do MP (ambiente sem token) o passo NÃO consulta o MP com chave nenhuma", async () => {
  const guardado = Deno.env.get("MP_ACCESS_TOKEN");
  Deno.env.delete("MP_ACCESS_TOKEN");
  try {
    const supabase = supabaseFalso({ linhaPresa: true });
    const mp = mpFalso(orderMp("charged_back", "in_process"));
    const r = await rodar(supabase, mp);
    assertEquals(mp.chamadas, []);
    assertEquals(r.corpo.contestacoes.vistas, 0);
  } finally {
    if (guardado !== undefined) Deno.env.set("MP_ACCESS_TOKEN", guardado);
  }
});

Deno.test("FASE 2 R3 — o aviso ao admin (order fora de charged_back) sai UMA vez: reserva -> push contado -> confirma; reserva 'enviado' na repetição -> nenhum push", async () => {
  const pushes: unknown[] = [];
  const enviarPushContado = async ({ aviso }) => {
    pushes.push(aviso);
    return 2;
  };
  const primeiro = supabaseFalso({ linhaPresa: true, reservas: ["reservado"] });
  const r1 = await rodar(primeiro, mpFalso(orderMp("refunded", "refunded")), { enviarPushContado });
  assertEquals(r1.corpo.contestacoes.conservadas, 1);
  assertEquals(pushes.length, 1);
  assertEquals(pushes[0].title, "Contestação de pagamento para conferir");
  assertEquals(
    primeiro.rpcs.filter((x) => x.nome.endsWith("_aviso_ao_lojista")).map((x) => [x.nome, x.args.p_chave]),
    [
      ["reservar_aviso_ao_lojista", `contestacao_indefinida:${PEDIDO}:order_refunded`],
      ["confirmar_aviso_ao_lojista", `contestacao_indefinida:${PEDIDO}:order_refunded`],
    ],
  );

  const segundo = supabaseFalso({ linhaPresa: true, reservas: ["enviado"] });
  await rodar(segundo, mpFalso(orderMp("refunded", "refunded")), { enviarPushContado });
  assertEquals(pushes.length, 1, "o aviso já entregue não se repete a cada 6 horas");
});

Deno.test("FASE 2 R3 — push do aviso que NÃO chega a ninguém (0 entregues): a reserva é LIBERADA para a próxima tentativa", async () => {
  const supabase = supabaseFalso({ linhaPresa: true, reservas: ["reservado"] });
  await rodar(supabase, mpFalso(orderMp("refunded", "refunded")), { enviarPushContado: async () => 0 });
  assertEquals(
    supabase.rpcs.filter((x) => x.nome.endsWith("_aviso_ao_lojista")).map((x) => x.nome),
    ["reservar_aviso_ao_lojista", "liberar_aviso_ao_lojista"],
  );
});
