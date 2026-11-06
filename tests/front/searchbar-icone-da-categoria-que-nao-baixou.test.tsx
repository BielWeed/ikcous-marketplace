// @vitest-environment jsdom
//
// O desenho da categoria na caixinha de busca vem de um arquivo baixado sob
// demanda. Se ele não baixa (sinal fraco, versão nova no ar), o app inteiro
// NÃO pode cair por causa de um ícone: a categoria continua na lista, com a
// etiqueta de sempre no lugar do desenho, e o que foi digitado fica.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Product } from "@/types";

const estado = vi.hoisted(() => ({ produtos: [] as unknown[] }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.produtos }),
}));
vi.mock("@/hooks/useCategories", () => ({
  categoriasEmMemoria: () =>
    [
      { id: "v", name: "Vestidos", slug: "v", isActive: true, createdAt: "" },
    ] as Category[],
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: { init: async () => ({ getAll: async () => [] }) },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/components/ui/custom/IconeDaCategoriaBuscada", () => ({
  get IconeDaCategoriaBuscada() {
    throw new TypeError(
      "Failed to fetch dynamically imported module: http://x/assets/IconeDaCategoriaBuscada-abc.js",
    );
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

describe("ícone da categoria que não baixou, na caixinha de busca", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.produtos = [produto("Vestido Azul", "Vestidos")];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("a categoria segue na lista com a etiqueta de sempre, a busca digitada fica e nada cai", async () => {
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
      setter?.call(campo, "vest");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });

    expect((hospedeiro.querySelector("input") as HTMLInputElement).value).toBe(
      "vest",
    );
    // O botão da seção "Categorias Encontradas" (a lista tem outros botões
    // com o mesmo nome, ex.: a sugestão de busca com a lupa).
    const bloco = [...hospedeiro.querySelectorAll("span")].find(
      (t) => t.textContent === "Categorias Encontradas",
    )?.parentElement?.parentElement;
    const botaoDaCategoria = [
      ...(bloco?.querySelectorAll("button") ?? []),
    ].find((b) => b.textContent?.trim() === "Vestidos");
    expect(botaoDaCategoria, "categoria na caixinha").toBeTruthy();
    expect(
      botaoDaCategoria?.querySelector("svg")?.getAttribute("class"),
    ).toContain("lucide-tag");
  });
});
