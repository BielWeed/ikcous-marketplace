// @ts-nocheck
/**
 * A MATRIZ "caminho x efeito" do pagamento confirmado (04/10/2026, FASE 2 da
 * confirmação). Existe para uma pergunta só: quando o pedido é confirmado,
 * QUAIS avisos saem, e QUANTAS vezes — pelo webhook e pela reconciliação (o
 * cron), os dois caminhos que confirmam pagamento FORA do clique do cliente.
 *
 * Os dois handlers rodam de verdade (`webhook-mercadopago/index.ts` e
 * `reconciliar-pagamentos/index.ts`), com a MESMA RPC dublê, e os efeitos
 * entram como dublês (nenhum push, SMTP ou MP real): o que se mede é QUEM
 * chama QUAL efeito, nos nove retornos da RPC `confirmar_pagamento`.
 *
 * MEDIÇÃO DE ANTES (a primeira versão deste arquivo, em 04/10/2026, passava
 * com a coluna "cron" assim): venda 'pago' confirmada pelo cron NÃO mandava o
 * push "Pedido pago" ao lojista (só o comprovante ao cliente) — o comentário
 * do cron dizia "pago continua sem push daqui". O pedido c35ce4dd foi
 * fechado por esse caminho.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler as handlerDoWebhook } from "../webhook-mercadopago/index.ts";
import { handler as handlerDoCron } from "../reconciliar-pagamentos/index.ts";

const SEGREDO_WEBHOOK = "segredo-webhook-matriz";
const SEGREDO_CRON = "segredo-cron-matriz";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const ORDER_MP = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";

Deno.env.set("MP_WEBHOOK_SECRET", SEGREDO_WEBHOOK);
Deno.env.set("RECONCILIACAO_SECRET", SEGREDO_CRON);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

const NOVE_RETORNOS = [
  "pago",
  "pago_apos_expirar",
  "ja_pago",
  "recusado",
  "estornado",
  "ja_estornado",
  "divergente",
  "inexistente",
  "ignorado",
];

/** [push ao lojista, comprovante ao cliente, aviso de pagamento atrasado]. */
type Efeitos = [number, number, number];
const NADA: Efeitos = [0, 0, 0];

/** O que o WEBHOOK dispara, por retorno da RPC (medido antes e depois: igual). */
const ESPERADO_DO_WEBHOOK = (resultado: string): Efeitos =>
  resultado === "pago" ? [1, 1, 0] : resultado === "pago_apos_expirar" ? [1, 0, 1] : NADA;

/** O que o CRON dispara, por retorno da RPC — a coluna que mudou na FASE 2. */
const ESPERADO_DO_CRON = (resultado: string): Efeitos =>
  resultado === "pago" ? [0, 1, 0] : resultado === "pago_apos_expirar" ? [1, 0, 1] : NADA;

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

async function requisicaoDoWebhook(): Promise<Request> {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = await assinar(ORDER_MP, ts, "req-matriz");
  return new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-matriz" },
    body: JSON.stringify({ type: "order", data: { id: ORDER_MP } }),
  });
}

const requisicaoDoCron = () =>
  new Request("http://localhost/reconciliar-pagamentos", {
    method: "POST",
    headers: { "x-reconciliacao-secret": SEGREDO_CRON },
  });

const orderPixPaga = () => ({
  id: ORDER_MP,
  status: "processed",
  status_detail: "accredited",
  external_reference: PEDIDO,
  total_amount: "149.90",
  transactions: {
    payments: [{
      id: "PAY1",
      amount: "149.90",
      status: "processed",
      status_detail: "accredited",
      payment_method: { id: "pix", type: "bank_transfer" },
    }],
  },
});

const fetchDoMp = async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(orderPixPaga()), { status: 200 });

/**
 * Supabase dublê dos dois handlers: `confirmar_pagamento` devolve o que o
 * `decidir` mandar (por padrão, o resultado fixo); `pagamentos_a_reconciliar`
 * entrega UM candidato; toda leitura de `marketplace_orders` devolve o mesmo
 * pedido (a projeção por coluna não importa aqui).
 */
function supabaseDuble(decidir: () => string, chamadas: string[] = []) {
  const pedido = {
    id: PEDIDO,
    customer_name: "Maria",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: ORDER_MP,
  };
  const vazio = { maybeSingle: () => Promise.resolve({ data: null, error: null }) };
  return {
    rpc: (nome: string, _args?: Record<string, unknown>) => {
      chamadas.push(nome);
      if (nome === "pagamentos_a_reconciliar") {
        return Promise.resolve({ data: [{ order_id: PEDIDO, gateway_payment_id: ORDER_MP }], error: null });
      }
      if (nome === "confirmar_pagamento") return Promise.resolve({ data: decidir(), error: null });
      if (nome === "marcar_visitas_da_reconciliacao") return Promise.resolve({ data: 1, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(tabela: string) {
      if (tabela === "marketplace_orders") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: pedido, error: null }) }) }),
        };
      }
      if (tabela === "app_settings") return { select: () => ({ eq: () => vazio }) };
      if (tabela === "order_refunds") {
        const fim = { limit: () => Promise.resolve({ data: [], error: null }) };
        return {
          select: () => ({
            in: () => ({ neq: () => ({ lt: () => ({ order: () => ({ order: () => fim }) }) }) }),
          }),
        };
      }
      throw new Error(`from inesperado no dublê: ${tabela}`);
    },
  };
}

function contadorDeEfeitos() {
  const contagem: Efeitos = [0, 0, 0];
  const ordem: string[] = [];
  return {
    contagem,
    ordem,
    deps: {
      enviarPush: async (_args: unknown) => {
        contagem[0]++;
        ordem.push("push");
      },
      enviarComprovante: async (_args: unknown) => {
        contagem[1]++;
        ordem.push("comprovante");
      },
      enviarAvisoAtrasado: async (_args: unknown) => {
        contagem[2]++;
        ordem.push("aviso-atrasado");
      },
    },
  };
}

/** Roda `fn` com o console mudo (os handlers logam de propósito). */
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

Deno.test("MATRIZ — WEBHOOK: efeitos por retorno da RPC (push / comprovante / aviso atrasado)", async () => {
  for (const resultado of NOVE_RETORNOS) {
    const { contagem, deps } = contadorDeEfeitos();
    const resposta = await mudo(async () =>
      handlerDoWebhook(await requisicaoDoWebhook(), {
        supabase: supabaseDuble(() => resultado),
        fetchImpl: fetchDoMp,
        ...deps,
      })
    );
    assertEquals(resposta.status, 200, resultado);
    assertEquals(contagem, ESPERADO_DO_WEBHOOK(resultado), `webhook, retorno "${resultado}"`);
  }
});

Deno.test("MATRIZ — CRON (reconciliação): efeitos por retorno da RPC (push / comprovante / aviso atrasado)", async () => {
  for (const resultado of NOVE_RETORNOS) {
    const { contagem, deps } = contadorDeEfeitos();
    const resposta = await mudo(() =>
      handlerDoCron(requisicaoDoCron(), {
        supabase: supabaseDuble(() => resultado),
        fetchImpl: fetchDoMp,
        ...deps,
      })
    );
    assertEquals(resposta.status, 200, resultado);
    assertEquals(contagem, ESPERADO_DO_CRON(resultado), `cron, retorno "${resultado}"`);
  }
});

Deno.test("MATRIZ — a RPC dublê é de fato chamada uma vez por caminho (a matriz mede o caminho de confirmação, não um atalho)", async () => {
  for (const [nome, rodar] of [
    ["webhook", async (supabase: unknown) => handlerDoWebhook(await requisicaoDoWebhook(), { supabase, fetchImpl: fetchDoMp, ...contadorDeEfeitos().deps })],
    ["cron", async (supabase: unknown) => handlerDoCron(requisicaoDoCron(), { supabase, fetchImpl: fetchDoMp, ...contadorDeEfeitos().deps })],
  ] as const) {
    const chamadas: string[] = [];
    await mudo(() => rodar(supabaseDuble(() => "pago", chamadas)));
    assertEquals(chamadas.filter((n) => n === "confirmar_pagamento").length, 1, nome);
  }
  assert(true);
});
