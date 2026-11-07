// @vitest-environment jsdom
//
// Caixinha de sugestoes do topo: (1) o produto com estoque vem ANTES do
// esgotado, como na lista da Home, mesmo que o esgotado tenha o nome mais
// parecido com o que se digitou; (2) o esgotado leva o selo "Esgotado", o mesmo
// texto do card; (3) o preco diz "A partir de" quando as opcoes a venda custam
// coisas diferentes; (4) a cor e o tamanho das variacoes tambem acham o produto.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const base = {
  description: "",
  images: [],
  category: "Joias",
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

const catalogo: Product[] = [
  // Nome IGUAL ao termo (100 pontos) e esgotado: antes passava na frente.
  { ...base, id: "p1", name: "Anel", price: 80, stock: 0 },
  { ...base, id: "p2", name: "Anel Fino", price: 40, stock: 5 },
  {
    ...base,
    id: "p3",
    name: "Anel Trançado",
    price: 50,
    stock: 5,
    variants: [
      {
        id: "v-a",
        productId: "p3",
        name: "Tamanho",
        value: "14",
        stockIncrement: 5,
        active: true,
      },
      {
        id: "v-b",
        productId: "p3",
        name: "Tamanho",
        value: "16",
        stockIncrement: 5,
        priceOverride: 90,
        active: true,
      },
    ],
  },
  {
    ...base,
    id: "p4",
    name: "Camiseta Básica",
    category: "Roupas",
    price: 30,
    stock: 5,
    variants: [
      {
        id: "v-c",
        productId: "p4",
        name: "Cor",
        value: "Azul",
        stockIncrement: 5,
        active: true,
      },
    ],
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

describe("SearchBar — ordem, selo Esgotado e 'A partir de' na sugestão", () => {
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

  /** As sugestoes de produto, na ordem da tela (cada uma e' um botao com o nome). */
  function sugestoes(nomes: string[]): string[] {
    return [...hospedeiro.querySelectorAll("button")]
      .filter((botao) =>
        nomes.some((nome) => botao.querySelector("img")?.alt === nome),
      )
      .map((botao) => botao.querySelector("img")?.alt ?? "");
  }

  function botaoDa(nome: string): HTMLButtonElement {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.querySelector("img")?.alt === nome,
    );
    expect(botao).toBeTruthy();
    return botao as HTMLButtonElement;
  }

  it("o disponivel vem antes do esgotado, mesmo com o nome mais parecido", async () => {
    await digitar("anel");

    expect(sugestoes(["Anel", "Anel Fino", "Anel Trançado"])).toEqual([
      "Anel Fino",
      "Anel Trançado",
      "Anel",
    ]);
  });

  it("so o produto esgotado leva o selo 'Esgotado'", async () => {
    await digitar("anel");

    expect(botaoDa("Anel").textContent).toContain("Esgotado");
    expect(botaoDa("Anel Fino").textContent).not.toContain("Esgotado");
  });

  it("preco diz 'A partir de' quando as opcoes custam coisas diferentes", async () => {
    await digitar("anel");

    expect(botaoDa("Anel Trançado").textContent).toMatch(/A partir de/i);
    expect(botaoDa("Anel Fino").textContent).not.toMatch(/A partir de/i);
  });

  it("a cor da variacao acha o produto na caixinha: azul acha Camiseta Basica", async () => {
    await digitar("azul");

    expect(sugestoes(["Camiseta Básica", "Anel"])).toEqual(["Camiseta Básica"]);
  });
});
