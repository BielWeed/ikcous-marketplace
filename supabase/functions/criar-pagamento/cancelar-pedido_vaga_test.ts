/**
 * A order morta de OUTRA tentativa do mesmo pedido não prova a morte da vaga.
 * Apagar a comparação do id no GET inicial não pode autorizar cancelar no banco.
 * Dublês mínimos de cancelar-pedido_test.ts; nenhum acesso real ao MP ou banco.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { cancelarPedidoPelaEdge } from "./cancelar-pedido.ts";

const PEDIDO = "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const VAGA = "ORD01JABCDEFGHJKMNPQRSTVWXYZ";
const OUTRA_ORDER = "ORD01JOUTRATENTATIVADOPEDIDO";

const jsonResp = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

async function cancelarComOrderMorta(idDevolvido: string) {
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const chamadasMp: string[] = [];
  let escritas = 0;
  const linha = {
    id: PEDIDO,
    user_id: CLIENTE,
    status: "pending",
    payment_status: "aguardando",
    gateway_payment_id: VAGA,
    metodo_online: "pix",
    created_at: "2026-10-04T10:00:00.000Z",
  };
  const consulta = {
    select: () => consulta,
    eq: (campo: string, valor: string) => {
      assertEquals([campo, valor], ["id", PEDIDO]);
      return consulta;
    },
    maybeSingle: () => Promise.resolve({ data: linha, error: null }),
    update: () => {
      escritas += 1;
      return consulta;
    },
    insert: () => {
      escritas += 1;
      return consulta;
    },
  };
  const resposta = await cancelarPedidoPelaEdge({
    supabase: {
      from: (tabela: string) => {
        assertEquals(tabela, "marketplace_orders");
        return consulta;
      },
      rpc: (nome: string, args: Record<string, unknown>) => {
        rpcs.push({ nome, args });
        return Promise.resolve({
          data: { cancelado: true, pedido: { status: "cancelled", payment_status: "aguardando" } },
          error: null,
        });
      },
    },
    pedidoId: PEDIDO,
    sub: CLIENTE,
    authorization: null,
    json: jsonResp,
    obterCredenciais: () =>
      Promise.resolve({ origem: "lojista", token: "TOKEN-FALSO", segredoWebhook: "s", publicKey: "p" }),
    verificarAdminAtual: () => Promise.resolve(null),
    fetchImpl: (input, init = {}) => {
      const chamada = `${init.method ?? "GET"} ${new URL(String(input)).pathname}`;
      chamadasMp.push(chamada);
      if (chamada !== `GET /v1/orders/${VAGA}`) {
        throw new Error(`rota não esperada no MP falso: ${chamada}`);
      }
      return Promise.resolve(jsonResp({
        id: idDevolvido,
        external_reference: PEDIDO,
        status: "canceled",
        status_detail: "canceled",
        transactions: { payments: [{ payment_method: { type: "bank_transfer", id: "pix" } }] },
      }));
    },
  });
  return { status: resposta.status, corpo: await resposta.json(), rpcs, chamadasMp, escritas };
}

Deno.test("GET da vaga devolve outra order cancelada do MESMO pedido → recuperável, nenhuma RPC nem POST", async () => {
  const r = await cancelarComOrderMorta(OUTRA_ORDER);
  assertEquals(r.status, 200);
  assertEquals(r.corpo.cancelamento, "recuperavel");
  assertEquals(r.rpcs, [], "a morte de B não autoriza cancelar o pedido cuja vaga ainda é A");
  assertEquals(r.escritas, 0, "nenhuma escrita direta no banco");
  assertEquals(r.chamadasMp, [`GET /v1/orders/${VAGA}`], "somente o GET inicial, nenhum POST de cancelamento");
});

Deno.test("controle: GET devolve a própria order da vaga cancelada → cancela no banco sem POST", async () => {
  const r = await cancelarComOrderMorta(VAGA);
  assertEquals(r.status, 200);
  assertEquals(r.corpo.cancelamento, "cancelado");
  assertEquals(r.rpcs, [{
    nome: "cancelar_pedido_com_cobranca",
    args: {
      p_order_id: PEDIDO,
      p_ator: CLIENTE,
      p_vaga_esperada: VAGA,
      p_pagamento_esperado: "aguardando",
      p_notes: null,
    },
  }]);
  assertEquals(r.escritas, 0);
  assertEquals(r.chamadasMp, [`GET /v1/orders/${VAGA}`]);
});
