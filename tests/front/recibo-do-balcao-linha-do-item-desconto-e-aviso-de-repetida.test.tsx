// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026) no recibo de tela do balcão: três coisas que
// o dinheiro da lojista lê ali e nenhum teste prendia —
//  - a linha de cada item mostra o valor da LINHA (preço x quantidade), não o
//    preço de uma peça (3 camisetas de R$ 19,90 são R$ 59,70, não R$ 19,90);
//  - "Desconto" só aparece quando houve desconto (nunca "- R$ 0,00");
//  - o aviso "esta venda já tinha sido registrada" só aparece na repetição
//    (`jaExistia`), para a lojista conferir o recibo antes de cobrar de novo.
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type {
  ItemDoCupom,
  ReciboDaVendaRegistrada,
} from "@/hooks/useVendaPresencial";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function item(
  numero: number,
  nome: string,
  preco: number,
  quantidade: number,
): ItemDoCupom {
  return {
    chave: `produto-${numero}::`,
    productId: `produto-${numero}`,
    variantId: null,
    nome,
    variacao: null,
    preco,
    quantidade,
    estoque: 20,
    imagem: "",
  };
}

/** Texto como a lojista lê: cada pedaço de texto separado por espaço. */
function textoLegivel(el: Element): string {
  const pedacos: string[] = [];
  const andador = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = andador.nextNode(); n; n = andador.nextNode()) {
    pedacos.push(n.textContent ?? "");
  }
  return pedacos.join(" ").replace(/\s+/g, " ").trim();
}

function reciboDe(
  parcial: Partial<ReciboDaVendaRegistrada>,
): ReciboDaVendaRegistrada {
  return {
    orderId: "pedido-do-recibo-de-teste",
    numero: "ABC123",
    criadoEm: "2026-11-24T15:00:00Z",
    cliente: { tipo: "sem_cliente" },
    itens: [item(1, "Camiseta Lisa", 19.9, 3)],
    total: 59.7,
    subtotal: 59.7,
    desconto: 0,
    pagamento: "cash",
    jaExistia: false,
    ...parcial,
  };
}

describe("ReciboDaVenda — linha do item, desconto e venda repetida", () => {
  let tela: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    tela.remove();
    vi.unstubAllGlobals();
  });

  async function montar(recibo: ReciboDaVendaRegistrada): Promise<void> {
    await act(async () =>
      raiz.render(
        <ReciboDaVenda
          recibo={recibo}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
        />,
      ),
    );
  }

  function linhasDosItens(): string[] {
    return [
      ...tela.querySelectorAll(".pdv-receipt-lines .pdv-receipt-line"),
    ].map((l) => textoLegivel(l));
  }

  function totais(): string[] {
    return [...tela.querySelectorAll(".pdv-card .pdv-total")].map((l) =>
      textoLegivel(l),
    );
  }

  it("a linha de cada item vale preço x quantidade (3 x R$ 19,90 = R$ 59,70) e mostra a conta", async () => {
    await montar(
      reciboDe({
        itens: [item(1, "Camiseta Lisa", 19.9, 3), item(2, "Meia", 7.5, 2)],
        subtotal: 74.7,
        total: 74.7,
      }),
    );

    const linhas = linhasDosItens();
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toBe("Camiseta Lisa 3 un. × R$ 19,90 R$ 59,70");
    expect(linhas[1]).toBe("Meia 2 un. × R$ 7,50 R$ 15,00");
  });

  it("sem desconto: Subtotal e Total, e NENHUMA linha de Desconto", async () => {
    await montar(reciboDe({}));

    expect(totais()).toEqual(["Subtotal R$ 59,70", "Total R$ 59,70"]);
  });

  it("com desconto: a linha de Desconto traz o valor negativo e o Total já descontado", async () => {
    await montar(reciboDe({ desconto: 5, total: 54.7 }));

    expect(totais()).toEqual([
      "Subtotal R$ 59,70",
      "Desconto - R$ 5,00",
      "Total R$ 54,70",
    ]);
  });

  it("o botão 'Anular venda' só existe enquanto a venda vale: com o recibo já anulado (sem a anulação ter sido feita nesta tela) ele some", async () => {
    const aoAnular = vi.fn();
    async function montarComAnular(
      recibo: ReciboDaVendaRegistrada,
    ): Promise<void> {
      await act(async () =>
        raiz.render(
          <ReciboDaVenda
            recibo={recibo}
            despachar={vi.fn()}
            limparCupom={vi.fn()}
            aoAnular={aoAnular}
          />,
        ),
      );
    }
    const botaoAnular = () =>
      [...tela.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Anular venda"),
      );

    await montarComAnular(reciboDe({}));
    expect(botaoAnular()).toBeTruthy();

    await montarComAnular(reciboDe({ anulada: true }));
    expect(tela.textContent).toContain("Venda anulada");
    expect(botaoAnular()).toBeUndefined();
    expect(tela.textContent).not.toContain("Confirmar anulação");
    expect(aoAnular).not.toHaveBeenCalled();
  });

  it("venda repetida (jaExistia) avisa para conferir o recibo; venda nova não avisa", async () => {
    const aviso = "Esta venda já tinha sido registrada";

    await montar(reciboDe({ jaExistia: true }));
    const status = [...tela.querySelectorAll('[role="status"]')].find((p) =>
      p.textContent?.includes(aviso),
    );
    expect(status?.textContent).toContain("confira o que saiu no recibo.");

    await montar(reciboDe({ jaExistia: false }));
    expect(tela.textContent).not.toContain(aviso);
  });
});
