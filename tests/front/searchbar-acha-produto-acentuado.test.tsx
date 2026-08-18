// @vitest-environment jsdom
//
// BUSCA-010 (#20), a prova que vale: digitar SEM acento tem que achar o produto
// cadastrado COM acento, na tela de verdade.
//
// `normalize-text-busca-sem-acento.test.ts` prova a função de normalização
// sozinha. Este arquivo prova que ela está ligada no caminho que a pessoa
// percorre — porque a função certa existindo e não sendo chamada é exatamente o
// estado em que este projeto estava: `useCategories.ts` já usava NFD desde
// sempre, para gerar slug, e a busca continuou comparando com `toLowerCase()`
// puro.
//
// O caso do título é literal: o catálogo tem "Aliança Luxo", e teclado de
// celular não põe cedilha sozinho.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

function produto(nome: string, id: string): Product {
  return {
    id,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category: "Joias",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

const catalogo = [
  produto("Aliança Luxo", "p1"),
  produto("Colar Coração", "p2"),
  produto("Blusa Azul", "p3"),
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

describe("SearchBar — busca sem acento acha produto acentuado (#20)", () => {
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

    // A SearchBar e' controlada: quem segura o texto e' quem a usa. O invólucro
    // faz esse papel, como o Header faz no app.
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
    // `useDeferredValue` empurra o resultado para um render seguinte.
    await act(async () => {
      await Promise.resolve();
    });

    return hospedeiro.textContent ?? "";
  }

  it("digitar 'alianca' acha 'Aliança Luxo'", async () => {
    const texto = await digitar("alianca");

    expect(texto).toContain("Aliança Luxo");
  });

  it("digitar 'coracao' acha 'Colar Coração'", async () => {
    const texto = await digitar("coracao");

    expect(texto).toContain("Coração");
  });

  it("digitar COM acento continua achando", async () => {
    // A correção não pode trocar um lado quebrado pelo outro.
    const texto = await digitar("Aliança");

    expect(texto).toContain("Aliança Luxo");
  });

  it("a âncora: busca que não casa com nada não devolve o catálogo inteiro", async () => {
    // Sem isto, um filtro quebrado que devolve tudo faria os três testes acima
    // passarem pelo motivo errado.
    const texto = await digitar("guitarra");

    expect(texto).not.toContain("Aliança Luxo");
    expect(texto).not.toContain("Blusa Azul");
  });
});
