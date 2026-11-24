// @vitest-environment jsdom
//
// Provas que faltavam no gancho `useSearch` (caça por mutação, 24/11/2026):
// o teto de preço guardado fora da tela, a ordem A-Z (esgotado no fim, número
// "natural", acento e caixa sem peso) e o instante exato em que o termo e a
// faixa de preço passam a valer (300 ms e 500 ms).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type FiltrosDaBusca, useSearch } from "@/hooks/useSearch";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(
  id: string,
  nome: string,
  preco: number,
  extra: Partial<Product> = {},
): Product {
  return {
    id,
    name: nome,
    description: "",
    price: preco,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    createdTime: 0,
    ...extra,
  } as Product;
}

type Api = ReturnType<typeof useSearch>;

describe("useSearch — fronteiras da faixa, do nome e do debounce", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  function Sonda(props: {
    readonly produtos: Product[];
    readonly iniciais?: FiltrosDaBusca;
  }) {
    const resultado = useSearch(props.produtos, { iniciais: props.iniciais });
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

  const montar = (props: Parameters<typeof Sonda>[0]) => {
    act(() => {
      raiz.render(<Sonda {...props} />);
    });
  };
  const passar = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  const ids = () => api.filteredProducts.map((p) => p.id);

  it("o teto de preço guardado fora da tela já vale no primeiro desenho (e o preço igual ao teto entra)", () => {
    montar({
      produtos: [
        produto("a", "Alfa", 300),
        produto("b", "Beta", 100),
        produto("c", "Gama", 50),
      ],
      iniciais: {
        category: "Todas",
        minPrice: "",
        maxPrice: 100,
        sort: "price_desc",
      },
    });
    passar(600);
    expect(api.maxPrice).toBe(100);
    expect(ids()).toEqual(["b", "c"]);
  });

  describe("ordem A-Z", () => {
    it("trata o número como número (Vestido 2 antes de Vestido 10) e ignora caixa e acento", () => {
      montar({
        produtos: [
          produto("1", "Vestido 10", 10),
          produto("2", "vestido 2", 10),
          produto("3", "Bolsa", 10),
          produto("4", "Álbum", 10),
        ],
      });
      act(() => {
        api.setSort("name_asc");
      });
      // "Álbum" vem antes de "Bolsa" (acento sem peso) e "2" antes de "10".
      expect(ids()).toEqual(["4", "3", "2", "1"]);
    });

    it("o produto esgotado vai para o fim mesmo sendo o primeiro da ordem alfabética", () => {
      montar({
        produtos: [
          produto("a", "Aaa", 10, { stock: 0 }),
          produto("b", "Bbb", 10),
          produto("c", "Ccc", 10),
        ],
      });
      act(() => {
        api.setSort("name_asc");
      });
      expect(ids()).toEqual(["b", "c", "a"]);
    });
  });

  describe("o instante em que o filtro passa a valer", () => {
    const produtos = [
      produto("a", "Camisa azul", 40),
      produto("b", "Saia preta", 90),
    ];

    it("o termo só filtra a lista aos 300 ms, não antes", () => {
      montar({ produtos });
      act(() => {
        api.setQuery("saia");
      });
      passar(299);
      expect(ids()).toHaveLength(2);
      passar(1);
      expect(ids()).toEqual(["b"]);
    });

    it("a faixa de preço só filtra a lista aos 500 ms, nos dois campos", () => {
      montar({ produtos });
      act(() => {
        api.setMinPrice(50);
      });
      passar(499);
      expect(ids()).toHaveLength(2);
      passar(1);
      expect(ids()).toEqual(["b"]);

      act(() => {
        api.setMinPrice("");
        api.setMaxPrice(50);
      });
      passar(499);
      expect(ids()).toEqual(["b"]);
      passar(1);
      expect(ids()).toEqual(["a"]);
    });
  });
});
