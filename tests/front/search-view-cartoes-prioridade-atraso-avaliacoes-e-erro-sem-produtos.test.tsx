// @vitest-environment jsdom
//
// Caça por mutação na tela de busca da cliente: quatro detalhes que nenhum teste
// vizinho prendia.
//   - só os 4 primeiros cartões da lista pedem a foto com pressa (`priority`);
//     do 5º em diante a foto espera a rolagem;
//   - os cartões entram um depois do outro: atraso de 50 ms por posição, e a
//     cada 8 cartões a contagem recomeça (a 9ª posição volta a 0 ms);
//   - a estrela de avaliação do cartão segue a configuração da loja
//     (`enableReviews`), na lista e nas sugestões do "nenhum resultado";
//   - catálogo que falhou SEM nenhum produto guardado: o texto manda checar a
//     conexão, e não fala de "produtos novos" (que só existem se há cópia salva).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Product } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(p: Partial<Product> & Pick<Product, "id">): Product {
  return {
    name: p.id,
    description: "",
    price: 100,
    images: [],
    category: "Vestidos",
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...p,
  };
}

let catalogo: Product[] = [];
let catalogoErro = false;
let avaliacoesLigadas = false;
const fetchProducts = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: avaliacoesLigadas,
      shippingFee: 10,
      freeShippingMin: 0,
    },
    catalogoErro,
    loadingProducts: false,
    fetchProducts,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
// O cartão vira uma marca que expõe só o que esta prova lê.
vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({
    product,
    priority,
    showRating,
  }: {
    product: { id: string };
    priority?: boolean;
    showRating?: boolean;
  }) => (
    <span
      data-testid="cartao"
      data-id={product.id}
      data-priority={String(priority === true)}
      data-avaliacao={String(showRating)}
    >
      {product.id}
    </span>
  ),
}));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetContent: () => null,
  SheetHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("SearchView — pressa da foto, atraso de entrada, avaliações e erro sem produtos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    catalogoErro = false;
    avaliacoesLigadas = false;
    fetchProducts.mockReset();
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

  async function renderizarBusca(initialQuery = "") {
    const { SearchView } = await import("@/views/customer/SearchView");
    await act(async () => {
      raiz.render(
        <SearchView
          initialQuery={initialQuery}
          onNavigate={() => {}}
          onBack={() => {}}
        />,
      );
    });
    return hospedeiro;
  }

  const cartoes = (host: HTMLElement) =>
    Array.from(host.querySelectorAll<HTMLElement>('[data-testid="cartao"]'));

  // Mais novo primeiro: createdTime maior vem antes. Dez produtos com a data
  // crescendo no sentido contrário do id deixam a ordem da tela previsível.
  const dezProdutos = () =>
    Array.from({ length: 10 }, (_, i) =>
      produto({ id: `p${i}`, createdTime: 1000 - i }),
    );

  it("só os 4 primeiros cartões pedem a foto com pressa", async () => {
    catalogo = dezProdutos();
    const host = await renderizarBusca();

    const lista = cartoes(host);
    expect(lista.map((c) => c.dataset.id)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
      "p8",
      "p9",
    ]);
    expect(lista.map((c) => c.dataset.priority)).toEqual([
      "true",
      "true",
      "true",
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
  });

  it("os cartões entram 50 ms depois um do outro e a contagem recomeça a cada 8", async () => {
    catalogo = dezProdutos();
    const host = await renderizarBusca();

    const atrasos = cartoes(host).map(
      (c) => (c.parentElement as HTMLElement).style.animationDelay,
    );
    expect(atrasos).toEqual([
      "0ms",
      "50ms",
      "100ms",
      "150ms",
      "200ms",
      "250ms",
      "300ms",
      "350ms",
      "0ms",
      "50ms",
    ]);
  });

  it("a estrela de avaliação do cartão segue a configuração da loja", async () => {
    catalogo = [produto({ id: "vestido" })];
    avaliacoesLigadas = true;
    const ligada = await renderizarBusca("vestido");
    expect(cartoes(ligada).map((c) => c.dataset.avaliacao)).toEqual(["true"]);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    avaliacoesLigadas = false;
    const desligada = await renderizarBusca("vestido");
    expect(cartoes(desligada).map((c) => c.dataset.avaliacao)).toEqual([
      "false",
    ]);
  });

  it("as sugestões do 'nenhum resultado' também seguem a configuração das avaliações", async () => {
    catalogo = [produto({ id: "vestido" })];
    avaliacoesLigadas = true;
    const ligada = await renderizarBusca("bolsa");
    expect(ligada.textContent).toContain("Ué, nenhum resultado?");
    expect(cartoes(ligada).map((c) => c.dataset.avaliacao)).toEqual(["true"]);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    avaliacoesLigadas = false;
    const desligada = await renderizarBusca("bolsa");
    expect(cartoes(desligada).map((c) => c.dataset.avaliacao)).toEqual([
      "false",
    ]);
  });

  it("catálogo que falhou sem nenhum produto guardado manda checar a conexão", async () => {
    catalogo = [];
    catalogoErro = true;
    const host = await renderizarBusca("bolsa");

    const alerta = host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alerta).toContain("Não conseguimos carregar a busca agora");
    expect(alerta).toContain("Verifique sua conexão e tente de novo.");
    expect(alerta).not.toContain("Pode haver produtos novos");
    expect(alerta).not.toContain("Não conseguimos atualizar a loja agora");
  });

  it("controle: com cópia salva o texto fala de produtos novos, não de conexão", async () => {
    catalogo = [produto({ id: "vestido" })];
    catalogoErro = true;
    const host = await renderizarBusca("bolsa");

    const alerta = host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alerta).toContain("Não conseguimos atualizar a loja agora");
    expect(alerta).toContain("Pode haver produtos novos");
    expect(alerta).not.toContain("Verifique sua conexão");
  });
});
