// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026): a TELA decide o título do aviso de falha pelo
// que está em `estado.erro`, e não só pela dúvida marcada (`talvezGravada`).
// Com a frase de rede na tela, o título TEM de dizer "Não sabemos se a venda
// foi registrada" — dinheiro: dizer "Não foi possível registrar" convida a
// lojista a refazer a venda e cobrar em dobro. Nenhum teste prendia isso
// quando a dúvida NÃO estava marcada (reducer com efeito `fecha`/`mantem`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import type { EstadoDaVenda, ItemDoCupom } from "@/hooks/useVendaPresencial";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import { MENSAGEM_DE_REDE_DA_VENDA } from "@/lib/erro-da-venda-presencial";

const ITEM: ItemDoCupom = {
  chave: "produto-1::",
  productId: "produto-1",
  variantId: null,
  nome: "Camiseta Lisa",
  variacao: null,
  preco: 39.9,
  quantidade: 2,
  estoque: 10,
  imagem: "",
};

function estadoComFalha(parcial: Partial<EstadoDaVenda>): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(() => "chave-fixa-do-teste"),
    itens: [ITEM],
    pagamento: "cash",
    ...parcial,
  };
}

describe("FechamentoDaVenda — título do aviso de falha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(estado: EstadoDaVenda): Promise<void> {
    await act(async () => {
      raiz.render(
        <FechamentoDaVenda
          estado={estado}
          despachar={vi.fn()}
          aoRegistrarVenda={vi.fn().mockResolvedValue(undefined)}
          limparCupom={vi.fn()}
        />,
      );
    });
  }

  function aviso(): string {
    return hospedeiro.querySelector('[role="alert"]')?.textContent ?? "";
  }

  it("a frase de rede na tela diz 'Não sabemos se a venda foi registrada', mesmo com a dúvida ainda não marcada", async () => {
    await montar(
      estadoComFalha({ erro: MENSAGEM_DE_REDE_DA_VENDA, talvezGravada: false }),
    );

    expect(aviso()).toContain("Não sabemos se a venda foi registrada");
    expect(aviso()).not.toContain("Não foi possível registrar a venda");
    expect(aviso()).toContain(MENSAGEM_DE_REDE_DA_VENDA);
    expect(aviso()).toContain("reenviar o mesmo cupom sem limpar a tela");
  });

  it("uma recusa comum (sem dúvida) diz 'Não foi possível registrar a venda' e NÃO manda recuperar recibo", async () => {
    await montar(
      estadoComFalha({ erro: "Estoque insuficiente.", talvezGravada: false }),
    );

    expect(aviso()).toContain("Não foi possível registrar a venda");
    expect(aviso()).not.toContain("Não sabemos se a venda foi registrada");
    expect(aviso()).toContain("Estoque insuficiente.");
    expect(aviso()).not.toContain("reenviar o mesmo cupom sem limpar a tela");
  });

  it("dúvida marcada (resposta perdida antes) vale mesmo com uma recusa comum na tela", async () => {
    await montar(
      estadoComFalha({ erro: "Estoque insuficiente.", talvezGravada: true }),
    );

    expect(aviso()).toContain("Não sabemos se a venda foi registrada");
    expect(aviso()).toContain("reenviar o mesmo cupom sem limpar a tela");
  });
});
