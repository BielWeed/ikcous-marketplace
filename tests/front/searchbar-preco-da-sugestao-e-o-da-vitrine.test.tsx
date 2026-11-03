// @vitest-environment jsdom
//
// Caça (rodada 1, achado b0, parte da busca): a sugestão da caixa de busca
// mostrava `item.price` (o preço BASE). Produto a 50 com o tamanho P esgotado
// e G a 90 em estoque: o card anuncia R$ 90 e a sugestão dizia R$ 50. Agora a
// sugestão mostra o preço de vitrine, o mesmo do card.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const catalogo: Product[] = [
  {
    id: "p1",
    name: "Vestido Floral",
    description: "",
    price: 50,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    variants: [
      {
        id: "v-p",
        productId: "p1",
        name: "Tamanho",
        value: "P",
        stockIncrement: 0,
        active: true,
      },
      {
        id: "v-g",
        productId: "p1",
        name: "Tamanho",
        value: "G",
        stockIncrement: 5,
        priceOverride: 90,
        active: true,
      },
    ],
  },
  {
    id: "p2",
    name: "Vestido Liso",
    description: "",
    price: 30,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  },
];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar — o preço da sugestão é o da vitrine", () => {
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

  async function digitar(texto: string) {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");

    function Involucro() {
      const [valor, setValor] = useState("");
      return <SearchBar value={valor} onChange={setValor} />;
    }

    await act(async () => {
      raiz.render(<Involucro />);
    });

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo.focus();
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function textoDaSugestao(nome: string): string {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    );
    expect(botao).toBeTruthy();
    return botao?.textContent ?? "";
  }

  it("com variação: mostra R$ 90 (o que o card anuncia), não o preço base R$ 50", async () => {
    await digitar("vestido");

    const sugestao = textoDaSugestao("Vestido Floral");
    expect(sugestao).toMatch(/R\$\s?90,00/);
    expect(sugestao).not.toMatch(/50,00/);
  });

  it("sem variação: continua o preço do produto", async () => {
    await digitar("vestido");

    expect(textoDaSugestao("Vestido Liso")).toMatch(/R\$\s?30,00/);
  });
});
