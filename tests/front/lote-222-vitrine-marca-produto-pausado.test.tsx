// @vitest-environment jsdom
// Lote 222 (M1): na escolha manual da vitrine, produto pausado leva o aviso
// "Pausado — não aparece na loja"; o ativo não.
import type { Product } from "@/types";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { FolhaEditarVitrine } = await import(
  "@/components/admin/vitrines/FolhaEditarVitrine"
);

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

const produto = (id: string, isActive: boolean) =>
  ({
    id,
    name: `Produto ${id}`,
    price: 10,
    category: "",
    images: [],
    isActive,
  }) as unknown as Product;

describe("lote 222 — vitrine marca produto pausado", () => {
  it("só o pausado ganha o aviso", async () => {
    await act(async () => {
      raiz.render(
        createElement(FolhaEditarVitrine, {
          secao: { id: "x", title: "X", active: true, productIds: ["a", "b"] },
          posicao: 1,
          produtos: [produto("a", true), produto("b", false)],
          idsEmExibicao: ["a", "b"],
          aoFechar: () => {},
          aoRenomear: async () => true,
          aoMudarQuantidade: () => {},
          aoAlternarProduto: () => {},
          aoVoltarAoAutomatico: () => {},
          aoEscolherManualmente: () => {},
        }),
      );
    });
    const linhaA = document.querySelector('[data-produto-id="a"]');
    const linhaB = document.querySelector('[data-produto-id="b"]');
    expect(linhaA?.textContent).not.toContain("Pausado");
    expect(linhaB?.textContent).toContain("Pausado — não aparece na loja");
  });
});
