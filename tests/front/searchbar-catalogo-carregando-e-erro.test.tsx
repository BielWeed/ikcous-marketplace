// @vitest-environment jsdom
//
// Tres defeitos da caixinha de sugestoes do topo (SearchBar):
//  1. Enquanto o catalogo ainda carregava (ou quando falhou de vez) ela dizia
//     'Nenhum produto encontrado': a tela /search ja dizia 'Carregando busca…'
//     e 'Não conseguimos carregar a busca agora' + 'Tentar de novo'.
//  2. Um termo longo sem espaco (link colado) estourava a caixinha.
//  3. Quem digitava o singular ('anel') nao via a categoria 'Anéis'.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

function produto(
  nome: string,
  id: string,
  extras: Partial<Product> = {},
): Product {
  return {
    id,
    name: nome,
    description: "",
    price: 100,
    images: [],
    category: "Geral",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...extras,
  };
}

const estado = vi.hoisted(() => ({
  catalogo: [] as unknown[],
  loading: false,
  erro: false,
  fetchProducts: undefined as unknown as ReturnType<typeof vi.fn>,
}));
estado.fetchProducts = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: estado.catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    loadingProducts: estado.loading,
    catalogoErro: estado.erro,
    fetchProducts: estado.fetchProducts,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ cart: [] }) }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar — catálogo carregando, falha, termo longo e plural", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.catalogo = [];
    estado.loading = false;
    estado.erro = false;
    estado.fetchProducts.mockReset();
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
    await act(async () => {
      raiz.render(<SearchBar value="" onChange={() => {}} />);
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
    return campo;
  }

  it("enquanto o catálogo carrega, diz 'Carregando busca…' e não 'Nenhum produto'", async () => {
    estado.loading = true;
    await digitar("bolsa");

    expect(hospedeiro.textContent).toContain("Carregando busca");
    expect(hospedeiro.textContent).not.toContain("Nenhum produto encontrado");
  });

  it("com a carga falha e sem catálogo, avisa e oferece 'Tentar de novo'", async () => {
    estado.erro = true;
    estado.fetchProducts.mockResolvedValue(undefined);
    await digitar("bolsa");

    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar a busca agora",
    );
    expect(hospedeiro.textContent).not.toContain("Nenhum produto encontrado");
    const tentar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Tentar de novo",
    );
    expect(tentar).toBeTruthy();
    await act(async () => {
      tentar?.click();
    });
    expect(estado.fetchProducts).toHaveBeenCalledTimes(1);
  });

  it("com o catálogo salvo no aparelho, a falha em segundo plano não esconde os resultados", async () => {
    estado.catalogo = [produto("Bolsa Preta", "p1")];
    estado.erro = true;
    await digitar("bolsa");

    expect(hospedeiro.textContent).not.toContain(
      "Não conseguimos carregar a busca agora",
    );
    expect(hospedeiro.querySelector("img")?.getAttribute("alt")).toBe(
      "Bolsa Preta",
    );
  });

  it("catálogo que respondeu e não tem o termo continua dizendo 'Nenhum produto encontrado'", async () => {
    estado.catalogo = [produto("Bolsa Preta", "p1")];
    await digitar("vestido");

    expect(hospedeiro.textContent).toContain(
      'Nenhum produto encontrado para "vestido"',
    );
    expect(hospedeiro.textContent).not.toContain("Carregando busca");
  });

  it("termo longo sem espaço quebra a linha e o botão corta em vez de estourar a caixinha", async () => {
    estado.catalogo = [produto("Bolsa Preta", "p1")];
    const longo = "x".repeat(300);
    await digitar(longo);

    const aviso = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Nenhum produto encontrado"),
    );
    expect(aviso?.className).toContain("break-words");
    expect(aviso?.className).toContain("[overflow-wrap:anywhere]");

    const verTodos = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver todos os resultados"),
    );
    const texto = verTodos?.querySelector("span");
    expect(texto?.className).toContain("truncate");
    expect(texto?.className).toContain("min-w-0");
  });

  it("o campo limita o tamanho do que se digita", async () => {
    const campo = await digitar("bolsa");
    expect(campo.maxLength).toBe(100);
  });

  it("quem digita 'anel' vê a categoria 'Anéis' na caixinha", async () => {
    estado.catalogo = [produto("Solitário Prata", "p1", { category: "Anéis" })];
    await digitar("anel");

    const titulo = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Categorias Encontradas",
    );
    expect(titulo).toBeTruthy();
    const categorias = [
      ...(titulo?.parentElement?.parentElement?.querySelectorAll(
        "button span",
      ) ?? []),
    ].map((s) => s.textContent);
    expect(categorias).toContain("Anéis");
  });

  const termosSugeridos = () => {
    const bloco = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Sugestões de Busca",
    );
    return [
      ...(bloco?.parentElement?.parentElement?.querySelectorAll(
        "button span",
      ) ?? []),
    ].map((s) => s.textContent);
  };

  it("'anel' também sugere o termo 'Anéis' ao autocompletar", async () => {
    estado.catalogo = [produto("Solitário Prata", "p1", { category: "Anéis" })];
    await digitar("anel");

    expect(termosSugeridos()).toContain("Anéis");
  });

  it("o plural de 3 letras não vira começo de outra categoria ('cases' não sugere 'Casa')", async () => {
    estado.catalogo = [
      produto("Case iPhone", "p1", { category: "Acessórios" }),
      produto("Tapete", "p2", { category: "Casa" }),
    ];
    await digitar("cases");

    expect(termosSugeridos()).not.toContain("Casa");
  });
});
