// @vitest-environment jsdom
//
// Na caixinha de busca do topo, produto SEM foto aparecia com uma imagem de
// site de terceiros (placehold.co, ou uma foto de banco de imagens quando a
// lista de fotos vinha vazia). Sem internet o pedido falhava e a miniatura
// ficava quebrada. O resto da loja já desenha um quadrado cinza "Sem foto"
// no aparelho, sem pedir nada à rede; a busca passa a fazer o mesmo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

const FOTO_REAL = "https://loja.example.com/fotos/vestido-azul.jpg";
const MARCADOR = "https://placehold.co/600x600?text=Sem+Imagem";

function produto(id: string, images: string[]): Product {
  return {
    id,
    name: `Vestido ${id}`,
    description: "",
    price: 100,
    images,
    category: "Vestidos",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

let catalogo: Product[] = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    loadingProducts: false,
    catalogoErro: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn() },
}));

// @ts-expect-error flag de teste interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchBar — produto sem foto usa o quadrado local 'Sem foto'", () => {
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

  async function abrirSugestoes() {
    const { SearchBar } = await import("@/components/ui/custom/SearchBar");
    await act(async () => {
      raiz.render(<SearchBar value="vestido" onChange={() => {}} />);
    });
    const campo = hospedeiro.querySelector("input")!;
    await act(async () => {
      campo.focus();
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
  }

  const fontesDeImagem = () =>
    Array.from(hospedeiro.querySelectorAll("img")).map(
      (img) => img.getAttribute("src") ?? "",
    );

  it("lista de fotos vazia: sem <img> e com o texto 'Sem foto'", async () => {
    catalogo = [produto("sem-lista", [])];
    await abrirSugestoes();
    expect(hospedeiro.textContent).toContain("Vestido sem-lista");
    expect(fontesDeImagem()).toEqual([]);
    expect(hospedeiro.textContent).toContain("Sem foto");
  });

  it("foto de reserva do mapper (placehold.co): não pede a imagem de fora", async () => {
    catalogo = [produto("com-marcador", [MARCADOR])];
    await abrirSugestoes();
    expect(hospedeiro.textContent).toContain("Vestido com-marcador");
    expect(fontesDeImagem().filter((s) => s.includes("placehold.co"))).toEqual(
      [],
    );
    expect(fontesDeImagem()).toEqual([]);
    expect(hospedeiro.textContent).toContain("Sem foto");
  });

  it("nenhuma imagem de site de terceiros nas sugestões", async () => {
    catalogo = [produto("a", []), produto("b", [MARCADOR])];
    await abrirSugestoes();
    expect(
      fontesDeImagem().filter((s) => /unsplash|placehold/.test(s)),
    ).toEqual([]);
  });

  it("controle: produto COM foto continua mostrando a foto", async () => {
    catalogo = [produto("com-foto", [FOTO_REAL])];
    await abrirSugestoes();
    const fontes = fontesDeImagem();
    expect(fontes).toHaveLength(1);
    expect(fontes[0]).toContain("vestido-azul.jpg");
    expect(hospedeiro.textContent).not.toContain("Sem foto");
  });
});
