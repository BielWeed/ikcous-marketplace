// @vitest-environment jsdom
//
// Lote 223 (caça 10): o filtro de preço da busca comparava com o preço BASE;
// o card mostra o menor preço entre as opções à venda (precoDeVitrine).
// Produto base R$ 50 com única opção "G" a R$ 90: o card diz R$ 90.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSearch } from "@/hooks/useSearch";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produto = {
  id: "p1",
  name: "Camiseta",
  description: "",
  price: 50,
  images: [],
  category: "geral",
  stock: 5,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: [
    {
      id: "v1",
      productId: "p1",
      name: "Tamanho",
      value: "G",
      stockIncrement: 3,
      priceOverride: 90,
      active: true,
    },
  ],
} as Product;

describe("useSearch — faixa de preço usa o preço que o card anuncia", () => {
  let raiz: Root;
  let host: HTMLElement;
  let ultimo: ReturnType<typeof useSearch>;

  function Sonda() {
    const retorno = useSearch([produto]);
    useEffect(() => {
      ultimo = retorno;
    });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => raiz.render(<Sonda />));
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function definir(min: number | "", max: number | "") {
    // Dois atos: o debounce só arma o relógio depois do render com o valor novo.
    await act(async () => {
      ultimo.setMinPrice(min);
      ultimo.setMaxPrice(max);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  }

  it("máximo R$ 60: o produto de R$ 90 não aparece", async () => {
    await definir("", 60);
    expect(ultimo.filteredProducts).toHaveLength(0);
  });

  it("mínimo R$ 80: o produto de R$ 90 aparece", async () => {
    await definir(80, "");
    expect(ultimo.filteredProducts).toHaveLength(1);
  });
});
