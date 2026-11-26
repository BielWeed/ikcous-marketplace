// @vitest-environment jsdom
//
// Tela /search: um termo feito só de espaços é termo VAZIO. A lista não pode
// entrar no modo "relevância" por causa dele -- a pontuação de uma busca vazia
// dá ponto a quem tem a categoria em branco (igual ao "nada" digitado), e o
// produto mais antigo passaria na frente do mais novo só por não ter categoria.
// Sem termo (ou com só espaços) vale "mais novos primeiro".
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearch } from "@/hooks/useSearch";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(
  id: string,
  name: string,
  criadoEm: number,
  extra: Partial<Product> = {},
): Product {
  return {
    id,
    name,
    description: "",
    price: 100,
    images: [],
    category: "Roupas",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(criadoEm).toISOString(),
    createdTime: criadoEm,
    ...extra,
  } as Product;
}

const PRODUTOS = [
  produto("novo", "Camisa", 3000),
  // O mais antigo é o único sem categoria.
  produto("velho", "Camiseta", 1000, { category: "" }),
  produto("meio", "Calça", 2000),
];

type Api = ReturnType<typeof useSearch>;

describe("useSearch — termo só com espaços não vira relevância", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  function Sonda() {
    const resultado = useSearch(PRODUTOS);
    useEffect(() => {
      api = resultado;
    });
    return null;
  }

  const ids = () => api.filteredProducts.map((p) => p.id);
  const digitar = (texto: string) => {
    act(() => {
      api.setQuery(texto);
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(<Sonda />);
    });
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    vi.useRealTimers();
  });

  it("sem termo: do mais novo ao mais antigo", () => {
    expect(ids()).toEqual(["novo", "meio", "velho"]);
  });

  it.each(["   ", " ", "\t", "\n  \n"])(
    "termo só com espaços %j: lista completa, do mais novo ao mais antigo",
    (espacos) => {
      digitar(espacos);
      expect(ids()).toEqual(["novo", "meio", "velho"]);
    },
  );

  it("controle: com termo de verdade a relevância volta a mandar", () => {
    digitar("camis");
    // "Camisa" e "Camiseta" começam com o termo; o mais novo vem na frente.
    expect(ids()).toEqual(["novo", "velho"]);
  });
});
