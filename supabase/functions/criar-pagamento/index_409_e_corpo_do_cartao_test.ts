// @ts-nocheck
/**
 * Dois pontos cegos da criar-pagamento achados por mutação (caça "só testes"):
 *
 *  1. SÓ O 409 DE IDEMPOTÊNCIA aciona a recuperação da order PIX pela busca.
 *     Um 409 qualquer (ou um 5xx cujo corpo cite a chave) não pode virar
 *     "achei a order viva, devolvo o QR dela": o cliente receberia o QR de uma
 *     cobrança que esta chamada não criou. Qualquer um dos dois sinais sozinho
 *     tem de cair no 502 de sempre, SEM a busca.
 *  2. O CORPO DO CARTÃO (`validarCorpoDoCartao`, função pura exportada): débito
 *     sem parcelas informadas (`null`) vale 1 parcela; parcelas que não são nem
 *     número nem string de 1-2 dígitos (uma lista `[3]` vira "3" quando
 *     coagida) são RECUSADAS, nunca aceitas como 3 parcelas.
 *
 * Banco e Mercado Pago são locais e falsos (mínimo copiado de
 * `index_pedido_cobrado_e_o_solicitado_test.ts`); nenhuma cobrança real nasce.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler, validarCorpoDoCartao } from "./index.ts";

const COMPRADOR = "c1111111-1111-4111-8111-111111111111";
const PEDIDO = "a1111111-1111-4111-8111-111111111111";

function bancoComUmPedido() {
  const linha: Record<string, unknown> = {
    id: PEDIDO,
    total: 149.9,
    user_id: COMPRADOR,
    status: "pending",
    payment_status: "aguardando",
    payment_method: "online",
    gateway_payment_id: null,
    tentativas_de_pagamento: 0,
    created_at: "2026-11-24T10:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    customer_data: { email: "comprador@example.com" },
  };
  return {
    linha,
    supabase: {
      from(tabela: string) {
        assertEquals(tabela, "marketplace_orders");
        const filtros: Array<(l: Record<string, unknown>) => boolean> = [];
        let colunas = "";
        let valores: Record<string, unknown> | undefined;
        const consulta = {
          select(s: string) {
            colunas = s;
            return consulta;
          },
          update(m: Record<string, unknown>) {
            valores = m;
            return consulta;
          },
          eq(c: string, v: unknown) {
            filtros.push((l) => Reflect.get(l, c) === v);
            return consulta;
          },
          neq(c: string, v: unknown) {
            filtros.push((l) => Reflect.get(l, c) !== v);
            return consulta;
          },
          is(c: string, v: unknown) {
            filtros.push((l) => Reflect.get(l, c) === v);
            return consulta;
          },
          maybeSingle() {
            if (!filtros.every((f) => f(linha))) return Promise.resolve({ data: null, error: null });
            if (valores) Object.assign(linha, valores);
            const sel = new Set(colunas.split(",").map((c) => c.trim()));
            return Promise.resolve({
              data: Object.fromEntries(Object.entries(linha).filter(([c]) => sel.has(c))),
              error: null,
            });
          },
        };
        return consulta;
      },
      rpc() {
        return Promise.resolve({ data: true, error: null });
      },
    },
  };
}

async function criarPix(respostaDoPost: () => Response) {
  const banco = bancoComUmPedido();
  const chamadas: string[] = [];
  const fetchImpl = (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    const metodo = (init?.method ?? "GET").toUpperCase();
    chamadas.push(`${metodo} ${new URL(url).pathname}`);
    if (metodo === "POST") return Promise.resolve(respostaDoPost());
    // A BUSCA de orders do pedido (recuperação): nada vivo.
    return Promise.resolve(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
  };
  const token = `cabecalho.${btoa(JSON.stringify({ sub: COMPRADOR }))}.assinatura`;
  const consolePrev = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    const resposta = await handler(
      new Request("http://localhost/criar-pagamento", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ orderId: PEDIDO, metodo: "pix" }),
      }),
      {
        supabase: banco.supabase,
        fetchImpl,
        credenciaisMp: { origem: "lojista", token: "TOKEN-FALSO", segredoWebhook: "WEBHOOK-FALSO", publicKey: "PUBLICA-FALSA" },
      },
    );
    return { status: resposta.status, corpo: await resposta.json(), chamadas, banco };
  } finally {
    console.log = consolePrev.log;
    console.warn = consolePrev.warn;
    console.error = consolePrev.error;
  }
}

const resp = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status });

Deno.test("PIX: 409 que NÃO é de idempotência -> 502, nenhuma busca de order e nenhuma vaga ocupada", async () => {
  const r = await criarPix(() => resp(409, { errors: [{ code: "outro_conflito_qualquer" }] }));
  assertEquals(r.status, 502);
  assertEquals(r.chamadas.filter((c) => c.startsWith("GET")), [], "a busca de recuperação não pode rodar");
  assertEquals(r.banco.linha.gateway_payment_id, null);
});

Deno.test("PIX: 500 cujo corpo cita a chave de idempotência (não é 409) -> 502, nenhuma busca de order", async () => {
  const r = await criarPix(() => resp(500, { errors: [{ code: "idempotency_key_already_used" }] }));
  assertEquals(r.status, 502);
  assertEquals(r.chamadas.filter((c) => c.startsWith("GET")), []);
});

Deno.test("PIX CONTROLE: 409 de idempotência -> tenta recuperar a order pela busca (1 GET) e, sem order viva, cai no 502 sem ocupar a vaga", async () => {
  const r = await criarPix(() => resp(409, { errors: [{ code: "idempotency_key_already_used" }] }));
  assertEquals(r.status, 502);
  assertEquals(r.chamadas.filter((c) => c.startsWith("GET")).length >= 1, true, "a recuperação tem de buscar");
  assertEquals(r.banco.linha.gateway_payment_id, null);
});

// ── PIX: pagar a si mesma (26/11/2026) ──────────────────────────────────────
// A lojista testa comprando dela mesma, com o e-mail da conta do MP que
// recebe. O MP recusa; o app tem de dizer o porquê, no MESMO 502 de hoje. Todo
// outro erro continua byte a byte como era.

const FRASE_PAGAR_A_SI_MESMA =
  "O Mercado Pago não deixa a mesma conta pagar e receber. Para testar, entre na loja com outro e-mail e pague com outra conta.";
const FRASE_GENERICA_DA_CRIACAO = "Não foi possível gerar a cobrança.";

for (
  const [rotulo, corpo] of [
    ["'Invalid users involved' (Orders)", { errors: [{ code: "invalid_users", message: "Invalid users involved" }] }],
    ["collector + customer (Payments)", { message: "bad request", cause: [{ code: 2034, description: "customer can't be equal to the collector" }] }],
  ] as const
) {
  Deno.test(`PIX: 400 ${rotulo} -> 502 com a frase de pagar a si mesma, sem terminal e sem ocupar a vaga`, async () => {
    const r = await criarPix(() => resp(400, corpo));
    assertEquals(r.status, 502);
    assertEquals(r.corpo.error, FRASE_PAGAR_A_SI_MESMA);
    assertEquals(r.corpo.terminal, undefined);
    assertEquals(r.chamadas.filter((c) => c.startsWith("POST")).length, 1, "uma criação só");
    assertEquals(r.banco.linha.gateway_payment_id, null);
  });
}

Deno.test("PIX CONTROLE: outro 400 qualquer (payer.email recusado) -> 502 com a frase genérica de hoje", async () => {
  const r = await criarPix(() =>
    resp(400, { errors: [{ code: "property_value", message: "The domain provided in payer.email is not allowed" }] })
  );
  assertEquals(r.status, 502);
  assertEquals(r.corpo.error, FRASE_GENERICA_DA_CRIACAO);
  assertEquals(r.corpo.terminal, undefined);
});

Deno.test("PIX CONTROLE: 2062 'Invalid card token' NÃO vira pagar a si mesma (a doc do MP diz que é token)", async () => {
  const r = await criarPix(() => resp(400, { message: "Invalid card token", cause: [{ code: 2062, description: "Invalid card token" }] }));
  assertEquals(r.status, 502);
  assertEquals(r.corpo.error, FRASE_GENERICA_DA_CRIACAO);
});

for (
  const caso of [
    { status: 401, esperado: 503, terminal: true },
    { status: 403, esperado: 503, terminal: true },
    { status: 409, esperado: 502, terminal: undefined },
    { status: 500, esperado: 502, terminal: undefined },
  ]
) {
  Deno.test(`PIX CONTROLE: ${caso.status} com 'Invalid users involved' no corpo -> ${caso.esperado} como hoje, nunca a frase nova`, async () => {
    const r = await criarPix(() => resp(caso.status, { errors: [{ code: "invalid_users", message: "Invalid users involved" }] }));
    assertEquals(r.status, caso.esperado);
    assertEquals(r.corpo.terminal, caso.terminal);
    assertEquals(r.corpo.error === FRASE_PAGAR_A_SI_MESMA, false);
    if (caso.status === 409 || caso.status === 500) assertEquals(r.corpo.error, FRASE_GENERICA_DA_CRIACAO);
    assertEquals(r.banco.linha.gateway_payment_id, null);
  });
}

// ── validarCorpoDoCartao ─────────────────────────────────────────────────────

const CARTAO_OK = {
  token: "ff8080814c11e237014c1ff593b57b4d",
  paymentMethodId: "master",
  documento: { type: "CPF", number: "12345678909" },
};

Deno.test("cartão de DÉBITO com parcelas null: vale 1 parcela (não recusa)", () => {
  const r = validarCorpoDoCartao({ ...CARTAO_OK, paymentTypeId: "debit_card", parcelas: null });
  assertEquals(r.ok, true);
  assertEquals(r.ok && r.dados.parcelas, 1);
});

Deno.test("cartão de DÉBITO sem o campo parcelas e com parcelas=6: vale sempre 1 parcela", () => {
  for (const extra of [{}, { parcelas: 6 }, { parcelas: "6" }]) {
    const r = validarCorpoDoCartao({ ...CARTAO_OK, paymentTypeId: "debit_card", ...extra });
    assertEquals(r.ok && r.dados.parcelas, 1, JSON.stringify(extra));
  }
});

Deno.test("cartão de CRÉDITO: parcelas em lista ([3]) ou objeto são RECUSADAS; número e texto de 1-2 dígitos valem", () => {
  for (const ruim of [[3], { 0: 3 }, "x", "123", 0, 13, 2.5, null, undefined]) {
    const r = validarCorpoDoCartao({ ...CARTAO_OK, paymentTypeId: "credit_card", parcelas: ruim });
    assertEquals(r.ok, false, `parcelas ${JSON.stringify(ruim)} não pode ser aceita`);
    assertEquals(!r.ok && r.erro, "Número de parcelas inválido.");
  }
  for (const [bom, esperado] of [[3, 3], ["3", 3], ["12", 12], [1, 1]] as const) {
    const r = validarCorpoDoCartao({ ...CARTAO_OK, paymentTypeId: "credit_card", parcelas: bom });
    assertEquals(r.ok && r.dados.parcelas, esperado);
  }
});
