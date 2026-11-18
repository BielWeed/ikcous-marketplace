// @vitest-environment jsdom
// O jsdom não pagina: esta prova confere a proteção exclusiva de impressão,
// mantendo as classes de tela. Não substitui uma impressão física.
import { OrderReceipt } from "@/components/admin/orders/OrderReceipt";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import type { ReciboDaVendaRegistrada } from "@/hooks/useVendaPresencial";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const nome = "Vestido com nome longo para ocupar várias linhas no papel";
const variacao = "Cor Azul marinho · Tamanho extra grande";
const pedido: Order = {
  id: "pedido-1234567890",
  customer: { name: "Cliente Teste", whatsapp: "" },
  items: Array.from({ length: 60 }, (_, i) => ({
    productId: `produto-${i}`,
    variantId: "variacao-1",
    name: nome,
    price: 10,
    quantity: 1,
    image: "",
  })),
  subtotal: 600,
  shipping: 10,
  discount: 20,
  total: 590,
  paymentMethod: "pix",
  status: "pending",
  createdAt: "2026-11-18T10:00:00Z",
  updatedAt: "2026-11-18T10:00:00Z",
  cancelledAfterShipping: false,
};

describe("recibo impresso — não parte item nem fechamento entre folhas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function conferirProtecao(quantidade: number) {
    const papel = document.querySelector("[data-tema-fixo]")!;
    const itens = [...papel.querySelectorAll("span.min-w-0")];
    expect(itens).toHaveLength(quantidade);
    expect
      .soft(
        itens.every((item) =>
          item.parentElement!.classList.contains("print:break-inside-avoid"),
        ),
      )
      .toBe(true);
    const subtotal = [...papel.querySelectorAll("span")].find(
      (span) => span.textContent === "Subtotal",
    )!;
    const totais = subtotal.parentElement!.parentElement!;
    expect(totais.classList.contains("print:break-inside-avoid")).toBe(true);
    expect(totais.textContent).toContain("Desconto");
    expect(totais.textContent).toContain("TOTAL");
    return { papel, itens, totais };
  }

  it("protege cada item com sua variação e mantém subtotal, desconto e TOTAL juntos", async () => {
    await act(async () => {
      raiz.render(
        <OrderReceipt order={pedido} variacoes={{ "variacao-1": variacao }} />,
      );
    });
    const { itens } = conferirProtecao(60);
    for (const item of itens) {
      expect(item.textContent).toContain(nome);
      expect(item.textContent).toContain(variacao);
    }
  });

  it("não altera classes de tamanho, espaçamento ou disposição na tela", async () => {
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} />);
    });
    const { papel, itens, totais } = conferirProtecao(60);
    const classesDeTela = (elemento: Element) =>
      [...elemento.classList]
        .filter((classe) => !classe.startsWith("print:"))
        .join(" ");
    expect(classesDeTela(papel)).toBe(
      "mx-auto hidden max-w-[80mm] border border-gray-200 bg-white p-8 font-mono text-sm text-black [overflow-wrap:anywhere]",
    );
    for (const item of itens) {
      expect(classesDeTela(item.parentElement!)).toBe("flex justify-between");
    }
    expect(classesDeTela(totais)).toBe(
      "mb-4 border-t border-dashed border-black pt-4",
    );
  });

  it("o papel montado pelo balcão herda as mesmas proteções", async () => {
    const recibo: ReciboDaVendaRegistrada = {
      orderId: pedido.id,
      numero: "567890",
      criadoEm: pedido.createdAt,
      itens: [
        {
          chave: "p1::v1",
          productId: "p1",
          variantId: "v1",
          nome,
          variacao,
          preco: 100,
          quantidade: 1,
          estoque: 5,
          imagem: "",
        },
      ],
      subtotal: 100,
      desconto: 10,
      total: 90,
      pagamento: "card",
      cliente: { tipo: "sem_cliente" },
      jaExistia: false,
    };
    await act(async () => {
      raiz.render(
        <ReciboDaVenda
          recibo={recibo}
          despachar={vi.fn()}
          limparCupom={vi.fn()}
          storeName="Loja Teste"
        />,
      );
    });
    const { itens } = conferirProtecao(1);
    expect(itens[0].textContent).toContain(nome);
    expect(itens[0].textContent).toContain(variacao);
  });
});
