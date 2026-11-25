// @ts-nocheck
/**
 * Três pontos cegos da ação `cancelar` (cancelar-pedido.ts) achados por
 * mutação — cada um é "anular no MP uma cobrança que não devia ser anulada":
 *
 *  1. CARTÃO IDENTIFICADO SÓ PELO PEDIDO: a resposta do MP pode vir sem o tipo
 *     do pagamento; o segundo sinal é `metodo_online` (credito/debito) gravado
 *     no pedido. Cartão em análise (`processing`/`action_required`) NÃO se
 *     anula — o cliente pode ter sido cobrado. Com o sinal do pedido ignorado,
 *     o POST de cancelamento saía com a cobrança viva.
 *  2. DINHEIRO JÁ ESTORNADO num pedido ainda aguardando (`refunded` /
 *     `charged_back`) é situação de conferência humana: recuperável, nada de
 *     POST de cancelamento nem de RPC.
 *  3. VAGA EM BRANCO ('' em `gateway_payment_id`) é "sem cobrança": cancela no
 *     banco SEM tentar consultar uma order de id vazio no MP.
 *
 * Mesmo dublê da suíte vizinha (`cancelar-pedido_test.ts`), copiado do mínimo:
 * MP falso por "MÉTODO caminho", banco falso que conta RPC e escrita.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { cancelarPedidoPelaEdge } from "./cancelar-pedido.ts";

const PEDIDO = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const ORDER = "ORD01JABCDEFGHJKMNPQRSTVWXYZ";
const CREDENCIAIS = { origem: "lojista", token: "TOKEN-FALSO", segredoWebhook: "s", publicKey: "p" };

function montarToken(sub: string): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `Bearer ${b64({ alg: "HS256" })}.${b64({ sub })}.assinatura`;
}

function pedidoBase(extra: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    user_id: CLIENTE,
    status: "pending",
    payment_status: "aguardando",
    gateway_payment_id: ORDER,
    metodo_online: "pix",
    created_at: "2026-10-04T10:00:00.000Z",
    ...extra,
  };
}

function bancoFalso(linha: Record<string, unknown>) {
  const registro = { rpcs: [] as Array<{ nome: string; args: Record<string, unknown> }>, escritas: 0 };
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: () => Promise.resolve({ data: linha, error: null }),
    update: () => {
      registro.escritas += 1;
      return consulta;
    },
    insert: () => {
      registro.escritas += 1;
      return consulta;
    },
  };
  const supabase = {
    from: (tabela: string) => {
      assertEquals(tabela, "marketplace_orders");
      return consulta;
    },
    rpc: (nome: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ nome, args });
      return Promise.resolve({
        data: { cancelado: true, ja_estava: false, pedido: { status: "cancelled", payment_status: linha.payment_status } },
        error: null,
      });
    },
  };
  return { supabase, registro };
}

const jsonResp = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const json = (corpo: unknown, status: number) => jsonResp(corpo, status);

/** MP falso: aceita só o GET da order e registra TODA chamada (inclusive as não previstas). */
function mpFalso(order: Record<string, unknown>) {
  const chamadas: string[] = [];
  const fetchImpl = (url: string, init: RequestInit = {}) => {
    const metodo = (init.method ?? "GET").toUpperCase();
    chamadas.push(`${metodo} ${new URL(url).pathname}`);
    if (metodo === "GET") return Promise.resolve(jsonResp(order));
    // Qualquer POST (cancelamento) devolveria 'canceled' — se saísse, o banco cancelaria.
    return Promise.resolve(jsonResp({ ...order, status: "canceled", status_detail: "canceled" }));
  };
  return { fetchImpl, chamadas };
}

/** Order SEM o tipo do pagamento legível (a resposta do MP pode omitir). */
const orderSemTipo = (status: string) => ({
  id: ORDER,
  external_reference: PEDIDO,
  status,
  status_detail: status,
  transactions: { payments: [{ status, status_detail: status }] },
});

async function cancelar(linha: Record<string, unknown>, mp: ReturnType<typeof mpFalso>) {
  const banco = bancoFalso(linha);
  const resposta = await cancelarPedidoPelaEdge({
    supabase: banco.supabase,
    pedidoId: PEDIDO,
    sub: CLIENTE,
    authorization: montarToken(CLIENTE),
    json,
    obterCredenciais: () => Promise.resolve(CREDENCIAIS),
    verificarAdminAtual: () => Promise.resolve(null),
    fetchImpl: mp.fetchImpl,
  });
  return { status: resposta.status, corpo: await resposta.json(), banco: banco.registro, mp };
}

// ── 1. cartão identificado só pelo pedido ────────────────────────────────────

for (const metodo of ["credito", "debito"]) {
  for (const statusDoMp of ["processing", "action_required"]) {
    Deno.test(`order '${statusDoMp}' sem tipo legível e pedido de ${metodo}: 'em_analise' — NÃO anula no MP e NÃO cancela no banco`, async () => {
      const mp = mpFalso(orderSemTipo(statusDoMp));
      const r = await cancelar(pedidoBase({ metodo_online: metodo }), mp);
      assertEquals(r.corpo.cancelamento, "em_analise");
      assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`], "nenhum POST de cancelamento");
      assertEquals(r.banco.rpcs, []);
      assertEquals(r.banco.escritas, 0);
    });
  }
}

Deno.test("CONTROLE: a mesma order 'processing' sem tipo legível num pedido PIX NÃO é cartão em análise — segue para a anulação", async () => {
  const mp = mpFalso(orderSemTipo("processing"));
  const r = await cancelar(pedidoBase({ metodo_online: "pix" }), mp);
  assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`, `POST /v1/orders/${ORDER}/cancel`]);
  assertEquals(r.corpo.cancelamento, "cancelado");
});

// ── 2. dinheiro já estornado num pedido que ainda aguarda ────────────────────

for (const statusDoMp of ["refunded", "charged_back"]) {
  Deno.test(`order '${statusDoMp}' num pedido ainda aguardando: 'recuperavel' (conferência humana) — nenhum POST ao MP, nenhuma RPC`, async () => {
    const mp = mpFalso({ ...orderSemTipo(statusDoMp), status_detail: statusDoMp });
    const r = await cancelar(pedidoBase(), mp);
    assertEquals(r.corpo.cancelamento, "recuperavel");
    assertEquals(mp.chamadas, [`GET /v1/orders/${ORDER}`]);
    assertEquals(r.banco.rpcs, []);
    assertEquals(r.banco.escritas, 0);
  });
}

// ── 3. vaga em branco = sem cobrança ─────────────────────────────────────────

Deno.test("vaga em BRANCO ('') no pedido: cancela no banco SEM consultar o MP, com p_vaga_esperada null", async () => {
  const mp = mpFalso(orderSemTipo("processing"));
  const r = await cancelar(pedidoBase({ gateway_payment_id: "" }), mp);
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(mp.chamadas, [], "id vazio nunca vai ao MP");
  assertEquals(r.banco.rpcs.length, 1);
  assertEquals(r.banco.rpcs[0].args.p_vaga_esperada, null);
});
