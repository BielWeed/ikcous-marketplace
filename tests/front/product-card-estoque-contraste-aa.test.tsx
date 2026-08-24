// @vitest-environment jsdom
//
// Defeito: o rótulo de estoque saudável ("Estoque: N") do ProductCard --
// usado em toda grade de produtos da loja -- usava `text-emerald-600`, que
// mede 3,58-3,77:1 contra o mínimo AA (4,5:1) de texto normal do WCAG.
// `text-emerald-700` sobre os mesmos fundos mede 5,21:1 e passa.
//
// Escopo: só o rótulo de texto (ProductCard.tsx:280). NÃO é o ponto do
// indicador (o `span` do "dot" pulsante, `bg-emerald-500`) nem qualquer
// ícone -- ambos são componente gráfico (WCAG 1.4.11, mínimo 3:1) e já
// passam, fora do escopo desta tarefa.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// product-card-gate-avaliacoes.test.tsx, cujo fixture este arquivo reusa --
// a classe de cor vive no elemento renderizado, não em dado estático.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProductCard } from "@/components/ui/custom/ProductCard";
import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const produtoEmEstoque: Product = {
  id: "prod-contraste-1",
  name: "Produto Em Estoque",
  description: "",
  price: 100,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
};

describe("ProductCard — rótulo 'Estoque: N' usa text-emerald-700 (contraste AA), não mais text-emerald-600", () => {
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

  it("estoque saudável (>5 unidades): o rótulo troca de tom", async () => {
    await act(async () => {
      raiz.render(
        <ProductCard
          product={produtoEmEstoque}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onClick={() => {}}
          priority
          showRating={false}
        />,
      );
    });

    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const rotulo = spans.find((el) => el.textContent === "Estoque: 10");
    expect(rotulo).not.toBeUndefined();
    expect(rotulo?.classList.contains("text-emerald-700")).toBe(true);
    expect(rotulo?.classList.contains("text-emerald-600")).toBe(false);
  });
});
