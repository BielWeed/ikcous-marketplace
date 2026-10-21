// @vitest-environment jsdom
//
// Na caixinha de busca do topo, a categoria encontrada passa a mostrar o ícone que a própria categoria guarda
// (forma do catálogo, depois a chave das 14) e cai na etiqueta de sempre. Só lê o que já está em memória ou no
// cofre do aparelho: nunca pede nada ao servidor.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category, Product } from "@/types";

const estado = vi.hoisted(() => ({
  produtos: [] as unknown[],
  memoria: null as unknown[] | null,
  cofre: [] as unknown[],
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.produtos }),
}));
vi.mock("@/hooks/useCategories", () => ({
  categoriasEmMemoria: () => estado.memoria,
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({ getAll: async () => estado.cofre }),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FORMA = "M3 3h18v18H3zM8 12h8";
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
const categoria = (name: string, extra: Partial<Category> = {}): Category =>
  ({
    id: name,
    name,
    slug: name,
    isActive: true,
    createdAt: "",
    ...extra,
  }) as Category;

describe("ícone da categoria na caixinha de busca", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.produtos = [produto("Vestido Azul", "Vestidos")];
    estado.memoria = null;
    estado.cofre = [];
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

  const etiquetaDaCategoria = () => {
    const bloco = [...hospedeiro.querySelectorAll("span")].find(
      (t) => t.textContent === "Categorias Encontradas",
    )?.parentElement?.parentElement;
    const botao = [...(bloco?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent?.trim() === "Vestidos",
    );
    expect(botao, "categoria na caixinha").toBeTruthy();
    return botao?.querySelector("svg") as SVGSVGElement;
  };

  it("desenha a forma gravada na categoria", async () => {
    estado.memoria = [
      categoria("Vestidos", { iconeForma: FORMA, icone: "casa" }),
    ];
    await buscarPorVest();
    const svg = etiquetaDaCategoria();
    expect(svg.getAttribute("data-icone")).toBe("forma");
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(FORMA);
  });

  it("sem forma, desenha a chave das 14; sem nada, a etiqueta de sempre", async () => {
    estado.memoria = [categoria("Vestidos", { icone: "moda" })];
    await buscarPorVest();
    expect(etiquetaDaCategoria().getAttribute("data-icone")).toBe("moda");
    act(() => raiz.render(null));
    estado.memoria = [categoria("Vestidos")];
    await buscarPorVest();
    const svg = etiquetaDaCategoria();
    expect(svg.getAttribute("data-icone")).toBeNull(); // a etiqueta do lucide
    expect(svg.getAttribute("class")).toContain("lucide-tag");
  });

  it("forma que não é geometria de path nunca é desenhada", async () => {
    estado.memoria = [
      categoria("Vestidos", { iconeForma: "<script>alert(1)</script>" }),
    ];
    await buscarPorVest();
    expect(etiquetaDaCategoria().getAttribute("class")).toContain("lucide-tag");
    expect(hospedeiro.innerHTML).not.toContain("<script");
  });

  it("sem lista em memória, lê o cofre do aparelho; cache antigo sem a coluna cai na etiqueta", async () => {
    estado.cofre = [categoria("Vestidos", { iconeForma: FORMA })];
    await buscarPorVest();
    expect(etiquetaDaCategoria().getAttribute("data-icone")).toBe("forma");
    act(() => raiz.render(null));
    estado.cofre = [categoria("Vestidos")]; // cache de antes da migration: sem iconeForma
    await buscarPorVest();
    expect(etiquetaDaCategoria().getAttribute("class")).toContain("lucide-tag");
  });

  it("memória e cofre vazios (primeira visita): etiqueta de sempre, sem erro na tela", async () => {
    await buscarPorVest();
    expect(etiquetaDaCategoria().getAttribute("class")).toContain("lucide-tag");
  });
});
