// RETIRADA NA LOJA pronta e CANCELADA: o painel e o sino do lojista não falam
// de "saiu para entrega" nem de "avise o transporte" (04/11/2026).
//
// Defeito medido: pedido de retirada pronta é gravado como `shipping` (+
// `retiradaNaLoja`). O texto de confirmar o cancelamento e o aviso do sino só
// conheciam o caso "saiu para entrega": mandavam combinar a volta do produto
// com a cliente e "avisar o transporte", quando a cliente nunca levou nada e
// não existe transporte.
//
// A VERDADE DO SERVIDOR (migration 20261198000000, `update_order_status_atomic`
// e `confirmar_retorno_do_produto`): cancelar em `shipping` carimba
// `cancelled_after_shipping` SEM olhar se é retirada, NÃO devolve o estoque e
// NÃO abre a devolução do dinheiro. `solicitar_estorno` recusa ("A devolução
// espera o produto") até a loja tocar em "O produto voltou". Então o texto
// honesto NÃO manda a retirada pronta direto para "Devolver agora": diz que o
// produto não saiu da loja E que a loja ainda precisa tocar em "O produto
// voltou" para repor o estoque e liberar a devolução do dinheiro.
//
// SÓ TEXTO: pedido de ENTREGA fica idêntico (controle em cada bloco).
import { describe, expect, it } from "vitest";

import { textoCancelamentoDoPainel } from "@/lib/texto-cancelamento-do-painel";
import {
  type EntradaDeAvisos,
  type LinhaDeCancelamento,
  montarAvisos,
  selecionarCancelamentosDoCliente,
} from "@/utils/avisos-do-lojista";

const FALA_DE_ENTREGA = /saiu para entrega|transporte|combine com o cliente/i;

describe("textoCancelamentoDoPainel — retirada pronta", () => {
  it("PAGO + shipping + retirada: não fala de entrega nem de transporte, diz que o produto não saiu e o que fazer", () => {
    const texto = textoCancelamentoDoPainel({
      status: "shipping",
      payment_status: "pago",
      retiradaNaLoja: true,
    });
    expect(texto).not.toMatch(FALA_DE_ENTREGA);
    expect(texto).toContain("pronto para retirar");
    expect(texto).toContain("não levou");
    // O servidor só libera a devolução depois de "O produto voltou": o texto
    // não pode prometer a devolução do dinheiro sem esse passo.
    expect(texto).toContain('"O produto voltou"');
    expect(texto).toContain("estoque");
    expect(texto.endsWith("Cancelar mesmo assim?")).toBe(true);
  });

  it("PAGO + retirada reativada depois de pronta (cancelledAfterShipping, status voltou): o mesmo texto de retirada", () => {
    const texto = textoCancelamentoDoPainel({
      status: "processing",
      payment_status: "pago",
      cancelledAfterShipping: true,
      retiradaNaLoja: true,
    });
    expect(texto).not.toMatch(FALA_DE_ENTREGA);
    expect(texto).toContain("não levou");
  });

  it("SEM pagamento + shipping + retirada: também não fala de entrega", () => {
    const texto = textoCancelamentoDoPainel({
      status: "shipping",
      payment_status: null,
      retiradaNaLoja: true,
    });
    expect(texto).not.toMatch(FALA_DE_ENTREGA);
    expect(texto).toContain("pronto para retirar");
    expect(texto).toContain('"O produto voltou"');
    expect(texto.endsWith("Cancelar mesmo assim?")).toBe(true);
  });

  it("aviso da etiqueta paga continua entrando antes da pergunta", () => {
    const texto = textoCancelamentoDoPainel({
      status: "shipping",
      payment_status: "pago",
      retiradaNaLoja: true,
      shipping_label_id: "etq-1",
    });
    expect(texto).toContain("etiqueta de envio já foi paga");
    expect(texto.endsWith("Cancelar mesmo assim?")).toBe(true);
  });

  it("ENTREGA em shipping (controle): o texto de sempre, com ou sem o campo", () => {
    for (const retiradaNaLoja of [undefined, null, false]) {
      const texto = textoCancelamentoDoPainel({
        status: "shipping",
        payment_status: "pago",
        retiradaNaLoja,
      });
      expect(texto).toContain("já saiu para entrega");
      expect(texto).toContain('"Esperando o produto voltar"');
    }
    expect(
      textoCancelamentoDoPainel({
        status: "shipping",
        payment_status: null,
        retiradaNaLoja: false,
      }),
    ).toContain("já saiu para entrega");
  });

  it("retirada AINDA em separação (processing, nunca pronta): segue o texto de pedido que não saiu", () => {
    const texto = textoCancelamentoDoPainel({
      status: "processing",
      payment_status: "pago",
      cancelledAfterShipping: false,
      retiradaNaLoja: true,
    });
    expect(texto).toContain("ainda não saiu para entrega");
    expect(texto).toContain("Mercado Pago");
  });

  it("retirada pronta cujo produto JÁ voltou e foi reativada: o texto de 'já voltou' de sempre", () => {
    const texto = textoCancelamentoDoPainel({
      status: "processing",
      payment_status: "pago",
      cancelledAfterShipping: true,
      returnedToSellerAt: "2026-11-01T10:00:00Z",
      retiradaNaLoja: true,
    });
    expect(texto).toContain("já voltou para a loja");
  });
});

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";

function linha(
  extra: Partial<LinhaDeCancelamento> = {},
  pedido: Record<string, unknown> = {},
): LinhaDeCancelamento {
  return {
    id: "h1",
    order_id: PEDIDO,
    old_status: "shipping",
    created_by: CLIENTE,
    created_at: "2026-11-04T11:57:00.000Z",
    marketplace_orders: {
      id: PEDIDO,
      user_id: CLIENTE,
      customer_name: "Maria Silva",
      total: 149.9,
      payment_status: "pago",
      status: "cancelled",
      cancelled_after_shipping: true,
      ...pedido,
    },
    ...extra,
  };
}

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

describe("aviso do sino — cliente cancelou retirada pronta", () => {
  it("pago + saiu de shipping + retirada: situação própria, sem 'avise o transporte'", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [linha({}, { pickup_address: "Rua da Loja, 10" })],
      new Set(),
    );
    expect(c.situacao).toBe("retirada_pronta");
    const [aviso] = montarAvisos({ ...VAZIO, cancelamentosDoCliente: [c] });
    expect(aviso.detalhe).not.toMatch(/transporte|já saiu/i);
    expect(aviso.detalhe).toContain("não saiu da loja");
    expect(aviso.detalhe).toContain("O produto voltou");
  });

  it("pago_apos_expirar e estornado também ficam com a situação de retirada", () => {
    for (const pagamento of ["pago_apos_expirar", "estornado"]) {
      const [c] = selecionarCancelamentosDoCliente(
        [linha({}, { payment_status: pagamento, pickup_address: "Rua A, 1" })],
        new Set(),
      );
      expect(c.situacao, pagamento).toBe("retirada_pronta");
    }
  });

  it("ENTREGA (sem endereço de retirada, vazio ou só espaços): continua 'ja_saiu' (controle)", () => {
    for (const pickup_address of [undefined, null, "", "   "]) {
      const [c] = selecionarCancelamentosDoCliente(
        [linha({}, { pickup_address })],
        new Set(),
      );
      expect(c.situacao, String(pickup_address)).toBe("ja_saiu");
    }
    const [c] = selecionarCancelamentosDoCliente([linha()], new Set());
    const [aviso] = montarAvisos({ ...VAZIO, cancelamentosDoCliente: [c] });
    expect(aviso.detalhe).toContain("avise o transporte");
  });

  it("retirada cancelada ANTES de ficar pronta e paga: segue 'reembolso_automatico'", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [
        linha(
          { old_status: "processing" },
          { cancelled_after_shipping: false, pickup_address: "Rua A, 1" },
        ),
      ],
      new Set(),
    );
    expect(c.situacao).toBe("reembolso_automatico");
  });

  it("retirada pronta SEM pagamento online: continua fora do aviso (produto já saiu, outro assunto)", () => {
    const escolhidos = selecionarCancelamentosDoCliente(
      [linha({}, { payment_status: null, pickup_address: "Rua A, 1" })],
      new Set(),
    );
    expect(escolhidos).toEqual([]);
  });
});
