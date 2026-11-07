// @vitest-environment jsdom
//
// Tela /search: com termo digitado e a ordenacao no padrao, os resultados vem
// por RELEVANCIA (a mesma pontuacao da caixinha do topo e da Home), nao do mais
// novo ao mais antigo. Sem termo continua "mais novos primeiro". Quem escolhe
// preco ou nome continua sendo obedecido, e esgotado nunca vem na frente.
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
    category: "Geral",
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
  // O mais NOVO só cita "bolsa" na descrição.
  produto("novo", "Carteira", 3000, {
    description: "combina com bolsa",
    price: 10,
  }),
  // O nome é IGUAL ao termo, mas é o mais antigo.
  produto("exato", "Bolsa", 1000, { price: 300 }),
  produto("comeca", "Bolsa Grande", 2000, { price: 200 }),
  // Mesma pontuação ("começa com"): decide a data, o mais novo na frente.
  produto("tras", "Bolsa Preta", 500, { price: 250 }),
  produto("frente", "Bolsa Branca", 2500, { price: 150 }),
  // Esgotado com nome igual: não pode ir para a frente de quem tem estoque.
  produto("esgotado", "Bolsa", 4000, { stock: 0 }),
];

type Api = ReturnType<typeof useSearch>;

describe("useSearch — relevância quando há termo", () => {
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

  it("sem termo: continua do mais novo ao mais antigo (esgotado por último)", () => {
    expect(api.sort).toBe("newest");
    expect(ids()).toEqual([
      "novo",
      "frente",
      "comeca",
      "exato",
      "tras",
      "esgotado",
    ]);
  });

  it("com termo e ordenação padrão: nome igual vem antes de nome que começa e de só descrição", () => {
    digitar("bolsa");
    expect(ids()).toEqual([
      "exato",
      "frente",
      "comeca",
      "tras",
      "novo",
      "esgotado",
    ]);
  });

  it("quem escolhe menor preço continua sendo obedecido, mesmo com termo", () => {
    act(() => {
      api.setSort("price_asc");
    });
    digitar("bolsa");
    expect(ids()).toEqual([
      "novo",
      "frente",
      "comeca",
      "tras",
      "exato",
      "esgotado",
    ]);
  });
});
