// @ts-nocheck
/**
 * Dois pedidos do MESMO comprador: donoConfere não distingue um do outro.
 * A leitura precisa aplicar o id solicitado, não devolver sempre a mesma linha.
 * Banco e Mercado Pago são locais e falsos; nenhuma cobrança real é criada.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const COMPRADOR = "c1111111-1111-4111-8111-111111111111";
const PEDIDO_A = "a1111111-1111-4111-8111-111111111111";
const PEDIDO_B = "b2222222-2222-4222-8222-222222222222";

function pedido(id: string, total: number): Record<string, unknown> {
  return {
    id,
    total,
    user_id: COMPRADOR,
    status: "pending",
    payment_status: "aguardando",
    payment_method: "online",
    gateway_payment_id: null,
    tentativas_de_pagamento: 0,
    expires_at: "2099-01-01T00:00:00.000Z",
    customer_data: { email: "comprador@example.com" },
  };
}

/** Aplica os filtros tanto na leitura quanto na gravação, sobre as duas linhas. */
function bancoComDoisPedidos(linhas: Array<Record<string, unknown>>) {
  return {
    from(tabela: string) {
      assertEquals(
        tabela,
        "marketplace_orders",
        "nenhuma outra tabela é necessária para criar estes PIX",
      );
      const filtros: Array<(linha: Record<string, unknown>) => boolean> = [];
      let colunas = "";
      let valores: Record<string, unknown> | undefined;
      const consulta = {
        select(selecao: string) {
          colunas = selecao;
          return consulta;
        },
        update(mudancas: Record<string, unknown>) {
          valores = mudancas;
          return consulta;
        },
        eq(campo: string, valor: unknown) {
          filtros.push((linha) => Reflect.get(linha, campo) === valor);
          return consulta;
        },
        neq(campo: string, valor: unknown) {
          filtros.push((linha) => Reflect.get(linha, campo) !== valor);
          return consulta;
        },
        is(campo: string, valor: unknown) {
          filtros.push((linha) => Reflect.get(linha, campo) === valor);
          return consulta;
        },
        maybeSingle() {
          const encontradas = linhas.filter((linha) =>
            filtros.every((filtro) => filtro(linha))
          );
          if (encontradas.length > 1) {
            return Promise.resolve({
              data: null,
              error: { message: "maybeSingle encontrou mais de um pedido" },
            });
          }
          const linha = encontradas[0];
          if (!linha) return Promise.resolve({ data: null, error: null });
          if (valores) Object.assign(linha, valores);
          const selecionadas = new Set(
            colunas.split(",").map((coluna) => coluna.trim()),
          );
          return Promise.resolve({
            data: Object.fromEntries(
              Object.entries(linha).filter(([coluna]) =>
                selecionadas.has(coluna)
              ),
            ),
            error: null,
          });
        },
      };
      return consulta;
    },
  };
}

Deno.test("PIX cobra o pedido solicitado entre dois pedidos do mesmo comprador: A e depois B", async () => {
  const linhas = [pedido(PEDIDO_A, 149.9), pedido(PEDIDO_B, 287.35)];
  const supabase = bancoComDoisPedidos(linhas);
  const enviadas: Array<Record<string, unknown>> = [];
  // Respostas distintas e fixas por referência, não pelo número da chamada:
  // ler B quando se pediu A precisa devolver a cobrança de B, nunca a de A.
  const cobrancas = new Map([
    [PEDIDO_A, { id: "ORDPEDIDOA", qr: "QR-PEDIDO-A" }],
    [PEDIDO_B, { id: "ORDPEDIDOB", qr: "QR-PEDIDO-B" }],
  ]);
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    assertEquals(String(input), "https://api.mercadopago.com/v1/orders");
    assertEquals(
      init?.method,
      "POST",
      "somente criação de cobrança, sem reconsulta",
    );
    const corpo = JSON.parse(String(init?.body));
    enviadas.push(corpo);
    const cobranca = cobrancas.get(corpo.external_reference);
    assertEquals(
      cobranca !== undefined,
      true,
      "a referência enviada deve identificar um dos dois pedidos",
    );
    return new Response(
      JSON.stringify({
        id: cobranca.id,
        external_reference: corpo.external_reference,
        total_amount: corpo.total_amount,
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [{
            id: `PAY-${cobranca.id}`,
            payment_method: {
              id: "pix",
              type: "bank_transfer",
              qr_code: cobranca.qr,
            },
          }],
        },
      }),
      { status: 201 },
    );
  };
  const token = `cabecalho.${
    btoa(JSON.stringify({ sub: COMPRADOR }))
  }.assinatura`;
  const cenarios = [
    {
      id: PEDIDO_A,
      valor: "149.90",
      cobranca: "ORDPEDIDOA",
      qr: "QR-PEDIDO-A",
      outro: linhas[1],
    },
    {
      id: PEDIDO_B,
      valor: "287.35",
      cobranca: "ORDPEDIDOB",
      qr: "QR-PEDIDO-B",
      outro: linhas[0],
    },
  ];

  for (const [indice, cenario] of cenarios.entries()) {
    const outraCobrancaAntes = cenario.outro.gateway_payment_id;
    const resposta = await handler(
      new Request("http://localhost/criar-pagamento", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token },
        body: JSON.stringify({ orderId: cenario.id, metodo: "pix" }),
      }),
      {
        supabase,
        fetchImpl,
        credenciaisMp: {
          origem: "lojista",
          token: "TOKEN-FALSO",
          segredoWebhook: "WEBHOOK-FALSO",
          publicKey: "PUBLICA-FALSA",
        },
      },
    );
    const corpo = await resposta.json();

    assertEquals(
      resposta.status,
      200,
      `o PIX do pedido solicitado ${cenario.id} deve ser criado`,
    );
    assertEquals(
      enviadas.length,
      indice + 1,
      "cada pedido cria exatamente uma cobrança",
    );
    const enviada = enviadas.at(indice);
    assertEquals(
      enviada.total_amount,
      cenario.valor,
      "o valor cobrado deve ser o do pedido solicitado, não o do outro pedido",
    );
    assertEquals(
      enviada.transactions.payments[0].amount,
      cenario.valor,
      "a transação deve cobrar o total do pedido solicitado",
    );
    assertEquals(
      enviada.external_reference,
      cenario.id,
      "a referência deve ser a do pedido solicitado",
    );
    assertEquals(
      corpo.paymentId,
      cenario.cobranca,
      "a cobrança retornada deve pertencer ao pedido solicitado",
    );
    assertEquals(
      corpo.qrCode,
      cenario.qr,
      "o QR retornado deve ser o do pedido solicitado",
    );
    assertEquals(corpo.statusPagamento, "aguardando");
    assertEquals(
      linhas.at(indice).gateway_payment_id,
      cenario.cobranca,
      "a cobrança deve ser gravada no pedido solicitado",
    );
    assertEquals(
      cenario.outro.gateway_payment_id,
      outraCobrancaAntes,
      "a cobrança do outro pedido deve permanecer intacta",
    );
  }
});
