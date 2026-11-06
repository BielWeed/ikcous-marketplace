// @vitest-environment jsdom
//
// A busca do topo sugeria, em "Categorias Encontradas" e em "Sugestões de
// Busca", uma categoria que a lojista escondeu da vitrine (a tela /search e a
// Home já a tiravam). Agora a caixinha usa a mesma régua: nome em minúscula e
// sem espaço nas pontas; se a lista de categorias ainda não chegou, não tira
// nada (só tira o que sabe estar escondido).
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Product } from "@/types";

const estado = vi.hoisted(() => ({
  produtos: [] as unknown[],
  categorias: [] as unknown[],
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.produtos }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: estado.categorias, isLoading: false }),
  categoriasEmMemoria: () => estado.categorias,
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: { init: async () => ({ getAll: async () => [] }) },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

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
const categoria = (name: string, isActive: boolean): Category =>
  ({ id: name, name, slug: name, isActive, createdAt: "" }) as Category;

describe("busca do topo — categoria escondida não é sugerida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.produtos = [
      produto("Camisa Azul", "Vestidos"),
      produto("Blusa Verde", "Vestuário"),
    ];
    estado.categorias = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function buscarPorVest() {
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
      await Promise.resolve();
    });
    // o desenho da categoria é um pedaço carregado sob demanda
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  // Os botões de um bloco da caixinha, pelo título dele.
  const botoesDoBloco = (titulo: string) => {
    const bloco = [...hospedeiro.querySelectorAll("span")].find(
      (t) => t.textContent === titulo,
    )?.parentElement?.parentElement;
    return [...(bloco?.querySelectorAll("button") ?? [])].map((b) =>
      b.textContent?.trim(),
    );
  };

  it("sem nenhuma escondida, as duas categorias aparecem nos dois blocos", async () => {
    estado.categorias = [
      categoria("Vestidos", true),
      categoria("Vestuário", true),
    ];
    await buscarPorVest();

    expect(botoesDoBloco("Categorias Encontradas")).toEqual([
      "Vestidos",
      "Vestuário",
    ]);
    expect(botoesDoBloco("Sugestões de Busca")).toEqual([
      "Vestidos",
      "Vestuário",
    ]);
  });

  it("a categoria escondida some de 'Categorias Encontradas' e das sugestões; a outra fica", async () => {
    estado.categorias = [
      categoria("Vestidos", false),
      categoria("Vestuário", true),
    ];
    await buscarPorVest();

    expect(botoesDoBloco("Categorias Encontradas")).toEqual(["Vestuário"]);
    expect(botoesDoBloco("Sugestões de Busca")).toEqual(["Vestuário"]);
  });

  it("a régua é a da vitrine: maiúscula e espaço nas pontas não escapam", async () => {
    estado.categorias = [
      categoria("  VESTIDOS ", false),
      categoria("Vestuário", true),
    ];
    await buscarPorVest();

    expect(botoesDoBloco("Categorias Encontradas")).toEqual(["Vestuário"]);
    expect(botoesDoBloco("Sugestões de Busca")).toEqual(["Vestuário"]);
  });

  it("lista de categorias que ainda não chegou: não tira nada", async () => {
    estado.categorias = [];
    await buscarPorVest();

    expect(botoesDoBloco("Categorias Encontradas")).toEqual([
      "Vestidos",
      "Vestuário",
    ]);
  });
});
