// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearch } from "@/hooks/useSearch";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(category: string): Product {
  return {
    id: "capa",
    name: "Capa azul",
    description: "",
    price: 10,
    images: [],
    category,
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

describe("busca após renomear categoria", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoMudar = vi.fn();
  const desenhos: string[] = [];

  function Sonda({ produtos }: { produtos: Product[] }) {
    const busca = useSearch(produtos, {
      iniciais: {
        category: "Capas",
        minPrice: "",
        maxPrice: "",
        sort: "newest",
      },
      aoMudar,
    });
    useEffect(() => {
      desenhos.push(
        `${busca.category}:${busca.filteredProducts.map((p) => p.id).join(",")}`,
      );
    });
    return (
      <div>
        <output>{busca.category}</output>
        {busca.filteredProducts.map((p) => (
          <p key={p.id}>{p.name}</p>
        ))}
      </div>
    );
  }

  beforeEach(() => {
    aoMudar.mockClear();
    desenhos.length = 0;
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => act(() => raiz.unmount()));

  it("cai em Todas, mostra os produtos e atualiza a memória sem desenhar vazio", () => {
    act(() => raiz.render(<Sonda produtos={[produto("Capas")]} />));
    expect(hospedeiro.querySelector("output")?.textContent).toBe("Capas");
    expect(hospedeiro.querySelector("p")?.textContent).toBe("Capa azul");

    act(() => raiz.render(<Sonda produtos={[produto("Proteções")]} />));

    expect(hospedeiro.querySelector("output")?.textContent).toBe("Todas");
    expect(hospedeiro.querySelector("p")?.textContent).toBe("Capa azul");
    expect(aoMudar).toHaveBeenLastCalledWith({
      category: "Todas",
      minPrice: "",
      maxPrice: "",
      sort: "newest",
    });
    expect(desenhos[0]).toBe("Capas:capa");
    expect(desenhos.slice(1).every((d) => d === "Todas:capa")).toBe(true);

    // A reconciliação também ficou no estado, não só no resultado derivado.
    act(() => raiz.render(<Sonda produtos={[produto("Capas")]} />));
    expect(hospedeiro.querySelector("output")?.textContent).toBe("Todas");
  });

  it("não perde o filtro durante uma lista temporariamente vazia", () => {
    act(() => raiz.render(<Sonda produtos={[]} />));
    expect(hospedeiro.querySelector("output")?.textContent).toBe("Capas");
    act(() => raiz.render(<Sonda produtos={[produto(" CAPAS ")]} />));
    expect(hospedeiro.querySelector("output")?.textContent).toBe("Capas");
    expect(hospedeiro.querySelector("p")?.textContent).toBe("Capa azul");
  });
});
