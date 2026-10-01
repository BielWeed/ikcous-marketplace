// @vitest-environment jsdom
import type { CartItem } from "@/types";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const modulos = import.meta.glob<
  typeof import("@/components/checkout/ConteudoDoResumoDoPedido")
>("/src/components/checkout/ConteudoDoResumoDoPedido.tsx");

async function resumo(overrides = {}) {
  const carregar =
    modulos["/src/components/checkout/ConteudoDoResumoDoPedido.tsx"];
  expect(
    carregar,
    "o conteúdo deve ser reutilizável fora do painel",
  ).toBeDefined();
  const { ConteudoDoResumoDoPedido } = await carregar();
  const cart: CartItem[] = [
    {
      product: {
        id: "p1",
        name: "Camiseta",
        price: 25,
        images: [],
        description: "",
        category: "geral",
        stock: 10,
        sold: 0,
        isActive: true,
        isBestseller: false,
        freeShipping: false,
        createdAt: "2026-09-28",
        variants: [
          {
            id: "v1",
            productId: "p1",
            name: "Tamanho",
            value: "M",
            stockIncrement: 10,
            active: true,
            priceOverride: 0,
          },
        ],
      },
      variantId: "v1",
      variantNames: "M",
      quantity: 2,
    },
  ];
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <ConteudoDoResumoDoPedido
      cart={cart}
      subtotal={50}
      shipping={10}
      discount={5}
      economiaDoFrete={0}
      semFreteSelecionado={false}
      totalExibido={55}
      {...overrides}
    />,
  );
  return container;
}

describe("conteúdo compartilhado do resumo", () => {
  it("mantém itens, variante de preço zero e totais recebidos", async () => {
    const el = await resumo();
    expect(el.querySelector("li")?.textContent).toBe("CamisetaM2 × R$ 0,00");
    expect(el.textContent).toContain(
      "SubtotalR$ 50,00EntregaR$ 10,00Desconto-R$ 5,00TotalR$ 55,00",
    );
  });
  it("não apresenta frete nem total fechado sem cotação", async () => {
    const el = await resumo({
      semFreteSelecionado: true,
      totalExibido: null,
      discount: 0,
    });
    expect(el.textContent).toContain("Entregaa calcularTotala calcular");
    expect(el.textContent).not.toContain("Desconto");
  });
  it.each([
    [0, 15, "R$ 15,00Grátis"],
    [10, 5, "R$ 15,00R$ 10,00"],
  ])(
    "mostra economia do frete %s/%s",
    async (shipping, economiaDoFrete, texto) => {
      const el = await resumo({ shipping, economiaDoFrete });
      expect(el.textContent).toContain(`Entrega${texto}`);
      expect(el.querySelector(".line-through")?.textContent).toBe("R$ 15,00");
    },
  );
});
