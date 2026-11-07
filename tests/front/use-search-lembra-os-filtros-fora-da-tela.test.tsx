// @vitest-environment jsdom
//
// Achado 1 do lote r56-d (06/11/2026), lado do gancho `useSearch`: categoria,
// faixa de preço e ordenação podem nascer de um valor guardado fora da tela e
// avisam cada mudança — é assim que a /search os mantém ao abrir um produto e
// voltar. Sem o parâmetro novo o gancho se comporta como sempre.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FiltrosDaBusca, useSearch } from "@/hooks/useSearch";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(id: string, categoria: string, preco: number): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: preco,
    images: [],
    category: categoria,
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  } as Product;
}

const PRODUTOS = [
  produto("a", "Vestidos", 300),
  produto("b", "Vestidos", 100),
  produto("c", "Sandálias", 50),
];

type Api = ReturnType<typeof useSearch>;

describe("useSearch — filtros guardados fora da tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  function Sonda(props: {
    readonly iniciais?: FiltrosDaBusca;
    readonly aoMudar?: (f: FiltrosDaBusca) => void;
  }) {
    const resultado = useSearch(PRODUTOS, {
      iniciais: props.iniciais,
      aoMudar: props.aoMudar,
    });
    // Fora do render: o teste lê o resultado mais recente depois do `act`.
    useEffect(() => {
      api = resultado;
    });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    vi.useRealTimers();
  });

  const montar = (props: Parameters<typeof Sonda>[0] = {}) => {
    act(() => {
      raiz.render(<Sonda {...props} />);
    });
  };
  const esperarDebounce = () => {
    act(() => {
      vi.advanceTimersByTime(600);
    });
  };

  it("sem parâmetro: abre no padrão e funciona como sempre", () => {
    montar();
    expect(api.category).toBe("Todas");
    expect(api.sort).toBe("newest");
    expect(api.minPrice).toBe("");
    expect(api.maxPrice).toBe("");
    expect(api.totalResults).toBe(3);
  });

  it("nasce dos valores guardados — inclusive a faixa de preço — e a lista já vem refinada", () => {
    montar({
      iniciais: {
        category: "Vestidos",
        minPrice: 150,
        maxPrice: "",
        sort: "price_desc",
      },
    });
    esperarDebounce();
    expect(api.category).toBe("Vestidos");
    expect(api.minPrice).toBe(150);
    expect(api.sort).toBe("price_desc");
    expect(api.filteredProducts.map((p) => p.id)).toEqual(["a"]);
  });

  it("cada mudança avisa o conjunto inteiro, e o primeiro aviso é o próprio ponto de partida", () => {
    const aoMudar = vi.fn();
    montar({ aoMudar });
    expect(aoMudar).toHaveBeenLastCalledWith({
      category: "Todas",
      minPrice: "",
      maxPrice: "",
      sort: "newest",
    });

    act(() => {
      api.setCategory("Sandálias");
    });
    act(() => {
      api.setMinPrice(80);
    });
    act(() => {
      api.setMaxPrice(500);
    });
    act(() => {
      api.setSort("name_asc");
    });
    expect(aoMudar).toHaveBeenLastCalledWith({
      category: "Sandálias",
      minPrice: 80,
      maxPrice: 500,
      sort: "name_asc",
    });
  });

  it("aviso trocado a cada render (função nova) não faz o gancho avisar de novo sem mudança", () => {
    const chamadas: FiltrosDaBusca[] = [];
    montar({ aoMudar: (f) => chamadas.push(f) });
    const antes = chamadas.length;
    montar({ aoMudar: (f) => chamadas.push(f) });
    montar({ aoMudar: (f) => chamadas.push(f) });
    expect(chamadas.length).toBe(antes);
  });
});
