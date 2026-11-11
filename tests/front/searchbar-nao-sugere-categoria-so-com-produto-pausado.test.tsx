// @vitest-environment jsdom
//
// A caixinha de busca do topo só sugere, em "Categorias Encontradas", categoria
// que tenha ao menos um produto À VENDA. Se a lojista pausa a coleção inteira de
// uma categoria (todos os produtos com isActive:false) e a categoria segue
// ativa em `categories`, sugerir o nome levaria a cliente a uma vitrine vazia
// ("Nenhum produto agora"). A guarda é o `p.isActive &&` do bloco
// `matchingCategories` — os vizinhos só tinham produto pausado numa categoria
// que TAMBÉM tinha produto ativo, então apagar a guarda não ficava vermelho.
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

const produto = (nome: string, category: string, isActive = true): Product =>
  ({
    id: nome,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category,
    stock: 5,
    sold: 0,
    isActive,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  }) as Product;
const categoria = (name: string, isActive: boolean): Category =>
  ({ id: name, name, slug: name, isActive, createdAt: "" }) as Category;

describe("busca do topo — categoria sem produto à venda não é sugerida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // 'Capas' é categoria ATIVA (não escondida) e todo o seu estoque está
    // pausado; 'Acessórios' é a categoria normal, com produto à venda.
    estado.produtos = [
      produto("Bolsa Preta", "Acessórios"),
      produto("Capa Rígida", "Capas", false),
    ];
    estado.categorias = [
      categoria("Acessórios", true),
      categoria("Capas", true),
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function buscarPor(termo: string) {
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
      setter?.call(campo, termo);
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

  it.each(["capas", "capa"])(
    "'%s': a categoria cujo único produto está pausado NÃO aparece em 'Categorias Encontradas'",
    async (termo) => {
      await buscarPor(termo);

      expect(botoesDoBloco("Categorias Encontradas")).not.toContain("Capas");
      expect(botoesDoBloco("Categorias Encontradas")).toEqual([]);
    },
  );

  it("a caixinha está de pé: a categoria com produto à venda aparece (a ausência acima não é bloco quebrado)", async () => {
    await buscarPor("acess");

    expect(botoesDoBloco("Categorias Encontradas")).toEqual(["Acessórios"]);
  });

  it.each(["capas", "capa"])(
    "controle '%s': com um segundo produto ATIVO em 'Capas', a categoria aparece",
    async (termo) => {
      estado.produtos = [
        produto("Bolsa Preta", "Acessórios"),
        produto("Capa Rígida", "Capas", false),
        produto("Capa Flex", "Capas", true),
      ];
      await buscarPor(termo);

      expect(botoesDoBloco("Categorias Encontradas")).toEqual(["Capas"]);
    },
  );
});
