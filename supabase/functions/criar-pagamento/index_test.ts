// @ts-nocheck
/**
 * Testes da criar-pagamento (CHECKOUT-010, #109).
 *
 * Prova a parte que decide SE pode cobrar e DE QUEM — que é onde erro custa
 * caro: cobrar duas vezes o mesmo pedido, cobrar pedido já expirado, ou deixar
 * um estranho disparar cobrança do pedido de outra pessoa.
 *
 * A chamada ao MP em si já é coberta pelos testes de _shared/mercadopago.ts.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  descricaoDoPedido,
  donoConfere,
  handler,
  pareceUuid,
  podeCobrar,
  subDoToken,
} from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const AGORA = new Date("2026-08-06T12:00:00.000Z");

// Payload {"sub":"3f2a1b8c-...","nome":"José Ítalo Ução","cidade":"Zoé Núñez"}
// codificado em base64url. Escolhido porque nomes brasileiros acentuados
// empurram bytes >= 0x80 para os índices 62/63 do alfabeto base64, que em
// base64url viram '-' e '_' — o caractere que o `atob` puro rejeita. Gerado e
// conferido com round-trip por script, não escrito à mão.
const PAYLOAD_COM_TRACO_E_SUBLINHADO_B64URL =
  "eyJzdWIiOiIzZjJhMWI4Yy00ZDVlLTRmNjAtOWE3Yi0xYzJkM2U0ZjVhNmIiLCJub21lIjoiSm9z6SDNdGFsbyBV5-NvIiwiY2lkYWRlIjoiWm_pIE768WV6In0";

/**
 * Monta um JWT falso só com o campo que `subDoToken` lê. Não assina — a
 * function também não valida assinatura (o gateway do Supabase já validou).
 */
function montarToken(sub: string | null): string {
  const payload = sub === null ? {} : { sub };
  const base64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `cabecalho.${base64}.assinatura`;
}

/**
 * Cliente Supabase falso que reproduz só as duas cadeias de chamada que
 * `index.ts` realmente usa:
 *   - leitura do pedido:        .from().select().eq().maybeSingle()
 *   - gravação da cobrança:     .from().update().eq().eq().is().select().maybeSingle()
 * A primeira `select()` devolve `pedido`; qualquer `select()` seguinte (a
 * releitura pós-UPDATE-falho) devolve `releitura` — se não for informado, cai
 * de volta em `pedido`, o que já basta para os testes que não mexem no
 * caminho de corrida.
 */
function clienteFalso(opts: {
  pedido: Record<string, unknown> | null;
  gravado: Record<string, unknown> | null;
  releitura?: Record<string, unknown> | null;
}) {
  let chamadasSelect = 0;
  return {
    from(_tabela: string) {
      return {
        select(_cols: string) {
          chamadasSelect++;
          const dados = chamadasSelect === 1 ? opts.pedido : opts.releitura ?? opts.pedido;
          return {
            eq(_col: string, _val: unknown) {
              return { maybeSingle: async () => ({ data: dados, error: null }) };
            },
          };
        },
        update(_valores: Record<string, unknown>) {
          return {
            eq(_c1: string, _v1: unknown) {
              return {
                eq(_c2: string, _v2: unknown) {
                  return {
                    is(_c3: string, _v3: unknown) {
                      return {
                        select(_cols: string) {
                          return {
                            maybeSingle: async () => ({ data: opts.gravado, error: null }),
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

/** `fetch` falso que nunca toca rede: devolve um pagamento 2xx válido e
 * guarda o corpo que a function mandou, para o teste conferir
 * `external_reference` sem depender dos testes da Task 1. */
function fetchFalsoMP(capturado: { corpo?: Record<string, unknown> }) {
  return async (_url: string, init?: RequestInit) => {
    capturado.corpo = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: 999, status: "pending" }), { status: 201 });
  };
}

function pedidoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    user_id: null,
    total: 100,
    payment_status: "aguardando",
    expires_at: "2099-01-01T00:00:00.000Z",
    gateway_payment_id: null,
    customer_data: { email: "cliente@exemplo.com" },
    ...overrides,
  };
}

function requisicao(corpo: Record<string, unknown>, authorization?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  return new Request("http://localhost/criar-pagamento", {
    method: "POST",
    headers,
    body: JSON.stringify(corpo),
  });
}

Deno.test("aceita UUID e recusa o que não é", () => {
  assertEquals(pareceUuid(UUID), true);
  assertEquals(pareceUuid(UUID.toUpperCase()), true);
  for (const ruim of ["", null, undefined, 42, "1; DROP TABLE marketplace_orders", `${UUID} `]) {
    assertEquals(pareceUuid(ruim), false, `deveria recusar: ${String(ruim)}`);
  }
});

Deno.test("podeCobrar aceita pedido aguardando e dentro do prazo", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.ok, true);
});

Deno.test("podeCobrar recusa pedido que já tem cobrança", () => {
  // Sem isto, um duplo clique gera dois PIX para o mesmo pedido e o cliente
  // pode pagar os dois.
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: "1234567890",
    },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("podeCobrar recusa pedido fora do prazo", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T11:59:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("podeCobrar recusa qualquer payment_status que não seja aguardando", () => {
  for (const st of ["pago", "recusado", "expirado", "estornado", "pago_apos_expirar", null]) {
    const r = podeCobrar(
      { payment_status: st, expires_at: "2026-08-06T12:20:00.000Z", gateway_payment_id: null },
      AGORA,
    );
    assertEquals(r.ok, false, `deveria recusar payment_status=${String(st)}`);
  }
});

Deno.test("podeCobrar recusa pedido sem prazo carimbado", () => {
  // Pedido criado pela v23 (flag desligada) não tem expires_at. Cobrar um
  // desses criaria cobrança que a expiração nunca varre.
  const r = podeCobrar(
    { payment_status: "aguardando", expires_at: null, gateway_payment_id: null },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("donoConfere: pedido de usuário logado exige o mesmo usuário", () => {
  assertEquals(donoConfere({ user_id: UUID }, UUID), true);
  assertEquals(donoConfere({ user_id: UUID }, "outro-sub"), false);
  assertEquals(donoConfere({ user_id: UUID }, null), false);
});

Deno.test("donoConfere: pedido de convidado passa sem sessão", () => {
  // Checkout de convidado é suportado (v24 grava user_id NULL). A proteção
  // dele não é a sessão — é a janela de 30 min do expires_at, checada em
  // podeCobrar.
  assertEquals(donoConfere({ user_id: null }, null), true);
  assertEquals(donoConfere({ user_id: null }, UUID), true);
});

Deno.test("descricaoDoPedido não vaza o id inteiro", () => {
  const d = descricaoDoPedido(UUID);
  assertEquals(d.includes(UUID), false);
  assertEquals(d.includes("3f2a1b8c"), true);
});

// --- subDoToken: JWT usa base64url, não base64 puro -------------------

Deno.test("subDoToken decodifica payload em base64url, com '-' e '_' no meio", () => {
  // Achado da revisão: 0,18% dos tokens do GoTrue com nome acentuado batem
  // '-'/'_' na posição certa para o `atob` puro rejeitar com DOMException.
  const token = `cabecalho.${PAYLOAD_COM_TRACO_E_SUBLINHADO_B64URL}.assinatura`;
  assertEquals(subDoToken(token), UUID);
});

Deno.test("subDoToken: lixo devolve null, não estoura", () => {
  assertEquals(subDoToken("lixo-nao-jwt"), null);
  assertEquals(subDoToken(null), null);
  assertEquals(subDoToken(""), null);
});

// --- handler: a fiação onde autorização e dinheiro de fato acontecem --

Deno.test("handler: pedido de outro usuário devolve 404, não o pedido de ninguém", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const donoDoPedido = "9f9f9f9f-1111-2222-3333-444455556666";
  const pedido = pedidoBase({ user_id: donoDoPedido });
  const supabase = clienteFalso({ pedido, gravado: null });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken("outro-sub-qualquer")),
    { supabase },
  );

  assertEquals(resposta.status, 404);
});

Deno.test("handler: pedido de convidado passa sem sessão e devolve 200", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });

  assertEquals(resposta.status, 200);
});

Deno.test("handler: o corpo enviado ao Mercado Pago leva external_reference", async () => {
  // Garantido pelo caminho REAL do handler, não só pelos testes da Task 1.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(requisicao({ orderId: UUID, metodo: "pix" }), { supabase, fetchImpl });

  assertEquals(capturado.corpo?.external_reference, UUID);
});

Deno.test("handler: pedido expirado pelo pg_cron no meio da corrida NÃO devolve 200, e a mensagem é a de prazo", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  // A releitura pós-UPDATE-falho mostra o que o pg_cron já gravou: 'expirado'.
  const releitura = { payment_status: "expirado", gateway_payment_id: null };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status !== 200, true);
  assertEquals(corpo.error, "O prazo para pagar este pedido acabou.");
});

Deno.test("handler: duas chamadas concorrentes — a que perde o UPDATE NÃO devolve 200, e a mensagem é a de cobrança já gerada", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  // A releitura mostra que a OUTRA chamada já gravou gateway_payment_id
  // enquanto esta ainda estava esperando o Mercado Pago responder.
  const releitura = { payment_status: "aguardando", gateway_payment_id: "outro-pagamento" };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status !== 200, true);
  assertEquals(corpo.error, "Este pedido já tem uma cobrança gerada.");
});
