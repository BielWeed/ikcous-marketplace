// @vitest-environment jsdom
//
// Provas que faltavam no gancho `useSearch` (caça por mutação, 24/11/2026):
//  - A categoria escolhida pode vir com espaço nas pontas ("Roupas ", grafia que
//    o cadastro guardou): o filtro compara SEM espaço dos DOIS lados, senão a
//    cliente escolhe a categoria e a lista fica vazia.
//  - Teto de preço ZERO e um teto como outro qualquer ("até R$ 0"): nao some
//    com o filtro. Quem confundisse 0 com "campo vazio" mostraria a loja inteira
//    por baixo de um filtro que a tela diz estar ligado.
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

describe("useSearch — categoria com espaço nas pontas, teto zero e termo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;

  function Sonda(props: {
    readonly produtos: Product[];
    readonly iniciais?: FiltrosDaBusca;
    readonly termoInicial?: string;
  }) {
    const resultado = useSearch(props.produtos, {
      iniciais: props.iniciais,
      termoInicial: props.termoInicial,
    });
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
  const ids = () => api.filteredProducts.map((p) => p.id);
  const filtros = (extra: Partial<FiltrosDaBusca>): FiltrosDaBusca => ({
    category: "Todas",
    minPrice: "",
    maxPrice: "",
    sort: "newest",
    ...extra,
  });

  it("categoria guardada COM espaço no fim acha o produto cadastrado com o mesmo espaço", () => {
    montar({
      produtos: [
        produto("a", "Alfa", 10, { category: "Roupas " }),
        produto("b", "Beta", 10, { category: "Calçados" }),
      ],
      iniciais: filtros({ category: "Roupas " }),
    });
    expect(api.category).toBe("Roupas ");
    expect(ids()).toEqual(["a"]);
  });

  it("categoria SEM espaço acha o produto cadastrado com espaço no fim", () => {
    montar({
      produtos: [
        produto("a", "Alfa", 10, { category: "Roupas " }),
        produto("b", "Beta", 10, { category: "Calçados" }),
      ],
      iniciais: filtros({ category: "Roupas" }),
    });
    expect(ids()).toEqual(["a"]);
  });

  it("teto 0 não é 'sem teto': só entra o que custa zero", () => {
    montar({
      produtos: [
        produto("a", "Alfa", 50),
        produto("b", "Brinde", 0),
        produto("c", "Gama", 1),
      ],
      iniciais: filtros({ maxPrice: 0 }),
    });
    expect(ids()).toEqual(["b"]);
  });

  it("teto 0 com a loja toda paga: lista vazia, não a loja inteira", () => {
    montar({
      produtos: [produto("a", "Alfa", 50), produto("c", "Gama", 1)],
      iniciais: filtros({ maxPrice: 0 }),
    });
    expect(ids()).toEqual([]);
    expect(api.totalResults).toBe(0);
  });

  it("o termo guardado fora da tela já filtra no primeiro desenho, sem esperar o debounce", () => {
    montar({
      produtos: [produto("a", "Bolsa Grande", 50), produto("b", "Camisa", 30)],
      termoInicial: "bolsa",
    });
    // Nenhum timer avançou: a lista não pode aparecer inteira por 300 ms.
    expect(api.query).toBe("bolsa");
    expect(ids()).toEqual(["a"]);
    expect(api.totalResults).toBe(1);
  });

  it("mudar a categoria com o termo ainda no debounce NÃO adianta o termo", () => {
    montar({
      produtos: [
        produto("a", "Bolsa Grande", 50),
        produto("b", "Camisa", 30),
        produto("c", "Tênis", 90, { category: "Calçados" }),
      ],
    });
    act(() => {
      api.setQuery("camisa");
    });
    act(() => {
      api.setCategory("Roupas");
    });
    // Os 300 ms do termo ainda não passaram: a categoria vale, o termo não.
    expect(ids().sort()).toEqual(["a", "b"]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(ids()).toEqual(["b"]);
  });

  it("ancora: sem termo guardado a loja inteira aparece", () => {
    montar({
      produtos: [produto("a", "Bolsa Grande", 50), produto("b", "Camisa", 30)],
    });
    expect(api.query).toBe("");
    expect(ids().sort()).toEqual(["a", "b"]);
  });

  it("ancora: sem teto (campo vazio) a loja inteira aparece", () => {
    montar({
      produtos: [produto("a", "Alfa", 50), produto("c", "Gama", 1)],
      iniciais: filtros({ maxPrice: "" }),
    });
    expect(ids().sort()).toEqual(["a", "c"]);
  });
});
