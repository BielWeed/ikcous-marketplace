import { describe, expect, it } from "vitest";
import { textoCancelamentoDoPainel } from "../../src/lib/texto-cancelamento-do-painel";

// L3e (lacunas de pagamento, 02/10/2026): cancelar um pedido PAGO e que
// ainda NÃO SAIU grava a linha de devolução em `order_refunds` na MESMA
// transação (`update_order_status_atomic`, migration 20261180000000) e o
// cron `reconciliar-pagamentos` pede o estorno ao Mercado Pago sozinho.
// A frase antiga ("não devolve o dinheiro automaticamente… combinar a
// devolução com o cliente") mandava o lojista devolver POR FORA — e o
// cliente recebia duas vezes. As condições abaixo espelham as do servidor:
// status antigo pending/processing, payment_status pago/pago_apos_expirar,
// e nunca cancelado depois de enviado.
const FRASE_ANTIGA = "não devolve o dinheiro automaticamente";

describe("textoCancelamentoDoPainel — pago e ainda não saiu: o app devolve sozinho (L3e)", () => {
  it("pago/pago_apos_expirar em pending/processing: diz que o app pede a devolução ao Mercado Pago e proíbe devolver por fora", () => {
    for (const payment_status of ["pago", "pago_apos_expirar"]) {
      for (const status of ["pending", "processing"]) {
        const texto = textoCancelamentoDoPainel({
          status,
          payment_status,
          cancelledAfterShipping: false,
        });
        expect(texto, `${payment_status}/${status}`).not.toContain(
          FRASE_ANTIGA,
        );
        expect(texto).not.toContain("combinar a devolução com o cliente");
        expect(texto).toContain("Mercado Pago");
        expect(texto).toContain("sozinho");
        expect(texto).toContain("em alguns minutos");
        expect(texto).toContain("NÃO devolva");
        expect(texto).toContain("duas vezes");
        expect(texto).toContain("Já estornei no Mercado Pago");
        expect(texto.endsWith("?")).toBe(true);
      }
    }
  });

  it("não promete prazo que o código não garante (o cron roda a cada 10 min, depois de 2 min)", () => {
    const texto = textoCancelamentoDoPainel({
      status: "pending",
      payment_status: "pago",
      cancelledAfterShipping: false,
    });
    expect(texto).not.toMatch(/\b\d+\s*(minuto|min\b|segundo|hora)/i);
    expect(texto).not.toMatch(/na hora|imediatamente|agora mesmo/i);
  });

  it("campo de envio ausente (cache antigo sem o mapper) conta como 'não enviado' — o erro barato é o lado seguro", () => {
    const texto = textoCancelamentoDoPainel({
      status: "processing",
      payment_status: "pago",
    });
    expect(texto).toContain("NÃO devolva");
    expect(texto).not.toContain(FRASE_ANTIGA);
  });
});

describe("textoCancelamentoDoPainel — devolução anterior já concluída (G4, rodada 2)", () => {
  // O servidor só grava a linha automática se NÃO existir linha `concluido`
  // no pedido (NOT EXISTS ... 'concluido', 20261180:352-371), e
  // `valor_estornado` só cresce por `concluir_estorno`. Pedido pago com
  // parte já devolvida pelo Mercado Pago, cancelado agora: nenhuma linha
  // nova, então o texto não pode prometer devolução automática.
  it("pago, não enviado, mas com valorEstornado > 0: NÃO diz que o app devolve sozinho", () => {
    const texto = textoCancelamentoDoPainel({
      status: "processing",
      payment_status: "pago",
      cancelledAfterShipping: false,
      valorEstornado: 10,
    });
    expect(texto).toContain(FRASE_ANTIGA);
    expect(texto).not.toContain("sozinho");
  });

  it("valorEstornado 0 (ou ausente) não muda nada: continua o texto automático", () => {
    for (const valorEstornado of [0, null, undefined]) {
      const texto = textoCancelamentoDoPainel({
        status: "processing",
        payment_status: "pago",
        cancelledAfterShipping: false,
        valorEstornado,
      });
      expect(texto, String(valorEstornado)).toContain("sozinho");
    }
  });
});

describe("textoCancelamentoDoPainel — casos SEM linha automática continuam com o texto antigo, que é verdade para eles", () => {
  const casosSemLinhaAutomatica = [
    // Já saiu para entrega: o servidor não grava linha (v_old_status fora
    // de pending/processing) — estorno manual depois do retorno.
    {
      status: "shipping",
      payment_status: "pago",
      cancelledAfterShipping: false,
    },
    {
      status: "shipping",
      payment_status: "pago_apos_expirar",
      cancelledAfterShipping: false,
    },
    // Enviado, cancelado e REATIVADO para processing: a peça está com o
    // cliente; o servidor exige NOT cancelled_after_shipping.
    {
      status: "processing",
      payment_status: "pago",
      cancelledAfterShipping: true,
    },
    {
      status: "pending",
      payment_status: "pago_apos_expirar",
      cancelledAfterShipping: true,
    },
    // Pago na entrega: nunca passou pelo Mercado Pago.
    {
      status: "pending",
      payment_status: "recebido_na_entrega",
      cancelledAfterShipping: false,
    },
    {
      status: "processing",
      payment_status: "recebido_na_entrega",
      cancelledAfterShipping: false,
    },
    {
      status: "shipping",
      payment_status: "recebido_na_entrega",
      cancelledAfterShipping: false,
    },
    // Entregue (o botão não aparece, mas a função não pode mentir).
    {
      status: "delivered",
      payment_status: "pago",
      cancelledAfterShipping: false,
    },
  ];

  it("pedido pago que já saiu / reativado / pago na entrega: NÃO diz que o app devolve sozinho", () => {
    for (const pedido of casosSemLinhaAutomatica) {
      const texto = textoCancelamentoDoPainel(pedido);
      const rotulo = JSON.stringify(pedido);
      expect(texto, rotulo).toContain("PAGO");
      expect(texto, rotulo).toContain(FRASE_ANTIGA);
      expect(texto, rotulo).toContain("Devolver agora");
      expect(texto, rotulo).not.toContain("sozinho");
      expect(texto, rotulo).not.toMatch(/o app (pede|devolve|estorna)/i);
    }
  });
});

describe("textoCancelamentoDoPainel — a pergunta muda com o dinheiro e a rota (laudo #2, L-1)", () => {
  it("pedido em rota: avisa que a mercadoria não volta sozinha", () => {
    const texto = textoCancelamentoDoPainel({
      status: "shipping",
      payment_status: "aguardando",
    });
    expect(texto).toContain("saiu para entrega");
    expect(texto).toContain("fale com o cliente");
  });

  it("pedido novo sem dinheiro: fala do estoque e do aviso ao cliente", () => {
    const texto = textoCancelamentoDoPainel({
      status: "pending",
      payment_status: "aguardando",
    });
    expect(texto).toContain("O estoque volta");
    expect(texto).toContain("o cliente é avisado");
  });

  it("nenhum texto dispensa a pergunta — todos terminam perguntando", () => {
    for (const pedido of [
      { status: "pending", payment_status: "aguardando" },
      { status: "processing", payment_status: "pago" },
      { status: "shipping", payment_status: "pago" },
      { status: "shipping", payment_status: "aguardando" },
      {},
    ]) {
      expect(textoCancelamentoDoPainel(pedido).endsWith("?")).toBe(true);
    }
  });
});
