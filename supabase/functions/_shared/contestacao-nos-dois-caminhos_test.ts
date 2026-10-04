// @ts-nocheck
/**
 * A contestação (chargeback) chega ao banco PELO MESMO CAMINHO, seja pela
 * notificação do webhook ou pela reconsulta periódica do cron (FASE 2, R3 do
 * Lote A, 04/10/2026). Os dois handlers rodam de verdade, com o MESMO MP
 * dublê, e a RPC `registrar_contestacao_no_ledger` recebe os MESMOS
 * argumentos — a regra de dinheiro mora uma vez só (`contestacao.ts` + RPC).
 *
 * Também prende o GATILHO: só `status = 'charged_back'` leva ao ledger, nos
 * dois caminhos; o tópico `topic_chargebacks_wh` não é porta de entrada em
 * nenhum deles.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler as handlerDoWebhook } from "../webhook-mercadopago/index.ts";
import { handler as handlerDoCron } from "../reconciliar-pagamentos/index.ts";

const SEGREDO_WEBHOOK = "segredo-webhook-contestacao";
const SEGREDO_CRON = "segredo-cron-contestacao";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ORDER_MP = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
const HORA = 60 * 60 * 1000;

Deno.env.set("MP_WEBHOOK_SECRET", SEGREDO_WEBHOOK);
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO_CRON);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

async function assinar(dataId: string, ts: number, xRequestId: string): Promise<string> {
  const manifesto = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SEGREDO_WEBHOOK),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto));
  return Array.from(new Uint8Array(assinado)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notificacaoDoWebhook(tipo: string): Promise<Request> {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = await assinar(ORDER_MP, ts, "req-contestacao");
  return new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-contestacao" },
    body: JSON.stringify({ type: tipo, data: { id: ORDER_MP } }),
  });
}

const requisicaoDoCron = () =>
  new Request("http://localhost/reconciliar-pagamentos", {
    method: "POST",
    headers: { "x-reconciliacao-secret": SEGREDO_CRON },
  });

const orderDoMp = (status: string, detalhePagamento = "reimbursed") => ({
  id: ORDER_MP,
  status,
  status_detail: detalhePagamento,
  external_reference: PEDIDO,
  total_amount: "149.90",
  transactions: {
    payments: [{
      id: "PAY1",
      amount: "149.90",
      status,
      status_detail: detalhePagamento,
      payment_method: { id: "visa", type: "credit_card" },
    }],
    chargebacks: [{ id: "CBK1", case_id: "CASE1", transaction_id: "PAY1", status: "" }],
  },
});

function mpDuble(status: string, detalhePagamento = "reimbursed") {
  const chamadas: string[] = [];
  const fetchImpl = (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    chamadas.push(u);
    if (/\/v1\/orders\/[^/?]+$/.test(u)) return Promise.resolve(new Response(JSON.stringify(orderDoMp(status, detalhePagamento)), { status: 200 }));
    if (/\/v1\/chargebacks\/CASE1$/.test(u)) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: "CASE1", amount: 149.9, currency: "BRL", coverage_applied: true }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  return { fetchImpl, chamadas };
}

/** Banco dublê com o que os DOIS caminhos leem; grava as RPCs do ledger. */
function banco(opts: { linhaPresa: boolean }) {
  const pedido = {
    id: PEDIDO,
    gateway_payment_id: ORDER_MP,
    total: 149.9,
    total_amount: null,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: "2026-10-01T00:00:00Z",
    status: "paid",
    customer_name: "Maria",
  };
  const velha = new Date(Date.now() - 7 * HORA).toISOString();
  const linhaPresa = { id: "L1", order_id: PEDIDO, status: "em_processamento", solicitado_por: "sistema", mp_status: "charged_back", updated_at: velha };
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const cadeia = (dados: unknown[]) => {
    const q = {
      eq: () => q,
      lt: () => q,
      order: () => q,
      limit: () => q,
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
        Promise.resolve({ data: dados, error: null }).then(res, rej),
    };
    return q;
  };
  return {
    rpcs,
    rpc: (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome === "pagamentos_a_reconciliar") return Promise.resolve({ data: [], error: null });
      if (nome === "registrar_contestacao_no_ledger") {
        return Promise.resolve({ data: { resultado: "liberado", aviso: null, valor_estornado: 0 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(tabela: string) {
      if (tabela === "marketplace_orders") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: pedido, error: null }) }) }) };
      }
      if (tabela === "app_settings") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      }
      if (tabela === "order_refunds") {
        return {
          select: (colunas: string) => {
            // lista do cron e releitura do cron (`id`); o webhook lê as linhas do pedido inteiras.
            if (colunas.trim() === "id, order_id, updated_at" || colunas.trim() === "id") {
              return cadeia(opts.linhaPresa ? [linhaPresa] : []);
            }
            return cadeia([]);
          },
          update: () => cadeia([]),
        };
      }
      throw new Error(`from inesperado: ${tabela}`);
    },
  };
}

async function mudo<T>(fn: () => Promise<T>): Promise<T> {
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

const doLedger = (b: { rpcs: Array<{ nome: string; args: Record<string, unknown> }> }) =>
  b.rpcs.filter((r) => r.nome === "registrar_contestacao_no_ledger").map((r) => r.args);

Deno.test("o MESMO caso, a MESMA order: o webhook e o cron entregam à RPC do ledger EXATAMENTE os mesmos argumentos", async () => {
  const doWebhook = banco({ linhaPresa: false });
  const mpWeb = mpDuble("charged_back");
  const respostaWeb = await mudo(async () =>
    handlerDoWebhook(await notificacaoDoWebhook("order"), { supabase: doWebhook, fetchImpl: mpWeb.fetchImpl })
  );
  assertEquals((await respostaWeb.json()).resultado, "contestacao_no_ledger");

  const doCron = banco({ linhaPresa: true });
  const mpCron = mpDuble("charged_back");
  const respostaCron = await mudo(() => handlerDoCron(requisicaoDoCron(), { supabase: doCron, fetchImpl: mpCron.fetchImpl }));
  assertEquals((await respostaCron.json()).contestacoes.reconsultadas, 1);

  assertEquals(doLedger(doWebhook).length, 1);
  assertEquals(doLedger(doCron), doLedger(doWebhook));
  assertEquals(doLedger(doCron)[0], {
    p_order_id: PEDIDO,
    p_mp_chargeback_id: "CBK1",
    p_case_id: "CASE1",
    p_decisao: "a_favor_da_loja",
    p_valor_caso: 149.9,
    p_valor_estimado: 149.9,
    p_casos_na_order: 1,
  });
});

for (const status of ["charged_back", "processed", "refunded", "canceled", "failed", "expired", "action_required"]) {
  Deno.test(`o GATILHO é o mesmo nos dois caminhos: order '${status}' ${status === "charged_back" ? "VAI" : "NÃO vai"} à RPC da contestação`, async () => {
    const doWebhook = banco({ linhaPresa: false });
    await mudo(async () =>
      handlerDoWebhook(await notificacaoDoWebhook("order"), { supabase: doWebhook, fetchImpl: mpDuble(status).fetchImpl })
    );
    const doCron = banco({ linhaPresa: true });
    await mudo(() => handlerDoCron(requisicaoDoCron(), { supabase: doCron, fetchImpl: mpDuble(status).fetchImpl }));
    const esperado = status === "charged_back" ? 1 : 0;
    assertEquals(doLedger(doWebhook).length, esperado, `webhook, ${status}`);
    assertEquals(doLedger(doCron).length, esperado, `cron, ${status}`);
  });
}

Deno.test("o tópico 'topic_chargebacks_wh' não é porta do ledger no webhook (ignorado sem consultar o MP) — e o cron não depende de tópico nenhum", async () => {
  const b = banco({ linhaPresa: false });
  const mp = mpDuble("charged_back");
  const resposta = await mudo(async () =>
    handlerDoWebhook(await notificacaoDoWebhook("topic_chargebacks_wh"), { supabase: b, fetchImpl: mp.fetchImpl })
  );
  assertEquals(resposta.status, 200);
  assertEquals(mp.chamadas, []);
  assertEquals(doLedger(b), []);

  // O cron chega ao MESMO ledger sem notificação nenhuma: pela reserva presa.
  const c = banco({ linhaPresa: true });
  await mudo(() => handlerDoCron(requisicaoDoCron(), { supabase: c, fetchImpl: mpDuble("charged_back").fetchImpl }));
  assertEquals(doLedger(c).length, 1);
});
