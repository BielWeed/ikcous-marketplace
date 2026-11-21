// @vitest-environment jsdom
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type { ReciboDaVendaRegistrada } from "@/hooks/useVendaPresencial";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

it.each([
  { nome: "", variacao: null, rotulo: "Produto" },
  { nome: "   ", variacao: null, rotulo: "Produto" },
  { nome: undefined, variacao: null, rotulo: "Produto" },
  { nome: "", variacao: "Tamanho M", rotulo: "Produto" },
  { nome: "Camiseta", variacao: "Tamanho M", rotulo: "Camiseta" },
])(
  "mostra $rotulo na tela e no papel (nome: $nome, variação: $variacao)",
  async ({ nome, variacao, rotulo }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const tela = document.createElement("div");
    const raiz = createRoot(tela);
    const recibo: ReciboDaVendaRegistrada = {
      orderId: "venda-teste",
      numero: "TESTE",
      criadoEm: "2026-11-21T10:00:00Z",
      cliente: { tipo: "sem_cliente" },
      itens: [
        {
          chave: "produto-teste::",
          productId: "produto-teste",
          variantId: null,
          nome: nome as string,
          variacao,
          quantidade: 1,
          preco: 10,
          estoque: 1,
          imagem: "",
        },
      ],
      total: 10,
      subtotal: 10,
      desconto: 0,
      pagamento: "cash",
      jaExistia: false,
    };

    try {
      await act(async () =>
        raiz.render(
          <ReciboDaVenda
            recibo={recibo}
            despachar={vi.fn()}
            limparCupom={vi.fn()}
          />,
        ),
      );
      expect
        .soft(tela.querySelector(".pdv-receipt-line .block")?.textContent)
        .toBe(rotulo);
      if (variacao) {
        expect
          .soft(tela.querySelector(".pdv-receipt-line .pdv-muted")?.textContent)
          .toContain(variacao);
      }
      const nomeImpresso = variacao ? `${rotulo} - ${variacao}` : rotulo;
      expect(document.querySelector("[data-tema-fixo]")?.textContent).toContain(
        `1x ${nomeImpresso}`,
      );
    } finally {
      await act(async () => raiz.unmount());
      vi.unstubAllGlobals();
    }
  },
);
