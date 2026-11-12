// @vitest-environment jsdom
//
// A caixinha do topo compara o nome da CATEGORIA com o que a cliente digitou. O
// produto ja era achado com "d'agua"/"d’agua" (apostrofo reto ou curvo do teclado
// do iPhone), mas a categoria "Caixa d'água" ficava de fora das sugestoes porque
// o nome dela era normalizado sem tirar o apostrofo.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const produto = (nome: string, category: string): Product =>
  ({
    id: nome,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category,
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  }) as Product;

const catalogo = [
  produto("Reservatório 500L", "Caixa d'água"),
  produto("Blusa Azul", "Roupas"),
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

describe("caixinha de busca — categoria com apóstrofo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function digitar(texto: string) {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
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
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const categoriasSugeridas = (): string[] => {
    const bloco = [...hospedeiro.querySelectorAll("span")].find(
      (t) => t.textContent === "Categorias Encontradas",
    )?.parentElement?.parentElement;
    return [...(bloco?.querySelectorAll("button") ?? [])].map(
      (b) => b.textContent?.trim() ?? "",
    );
  };

  it.each([["Caixa d'água"], ["caixa d’agua"], ["caixa dagua"]])(
    "digitar %s sugere a categoria Caixa d'água",
    async (busca) => {
      await digitar(busca);
      expect(categoriasSugeridas()).toContain("Caixa d'água");
    },
  );

  it.each([["caixa d'ag"], ["caixa d’ag"]])(
    "digitar %s (autocompletar) sugere o termo Caixa d'água",
    async (busca) => {
      await digitar(busca);
      const bloco = [...hospedeiro.querySelectorAll("span")].find(
        (t) => t.textContent === "Sugestões de Busca",
      )?.parentElement?.parentElement;
      const termos = [...(bloco?.querySelectorAll("button") ?? [])].map(
        (b) => b.textContent?.trim() ?? "",
      );
      expect(termos).toContain("Caixa d'água");
    },
  );

  it("a âncora: outra busca não sugere essa categoria", async () => {
    await digitar("blusa");
    expect(categoriasSugeridas()).not.toContain("Caixa d'água");
  });

  it.each([["'"], ["''"], ["’"]])(
    "busca só de apóstrofo (%s) não mostra produto nem categoria",
    async (busca) => {
      await digitar(busca);
      expect(categoriasSugeridas()).toEqual([]);
      expect(hospedeiro.textContent).not.toContain("Reservatório 500L");
      expect(hospedeiro.textContent).not.toContain("Blusa Azul");
    },
  );
});
