// @vitest-environment jsdom
//
// Caça por mutação na Home da cliente: o que a tela diz e quando se desenha,
// em pontos que nenhum teste vizinho prendia.
//   - título da aba e texto de compartilhamento: "Loja | Cidade, UF" (só a
//     cidade quando não há estado; só o nome quando não há cidade); nome da loja
//     em branco cai no nome do app;
//   - o bloco de frete grátis NÃO nasce como esqueleto antes de a configuração
//     chegar (a loja que o desligou veria 172 px aparecerem e sumirem);
//   - a barra de filtros ganha sombra só depois de 20 de rolagem (20 ainda não);
//   - catálogo vazio: o texto de ajuda muda com a causa (busca, categoria sem
//     produto, categoria que o painel escondeu e a rede falhou);
//   - durante uma busca os banners do topo e do pé ficam escondidos.
//
// Monta a HomeView de verdade; só os filhos pesados viram marcas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { branding } from "@/config/branding";
import { lerMemoriaDaHome } from "@/hooks/useMemoriaDaHome";
import type { Product } from "@/types";
import { HomeView } from "@/views/customer/HomeView";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cenario = vi.hoisted(() => ({
  config: { freeShippingMin: 0 } as Record<string, unknown>,
  isLoaded: true,
  catalogoErro: false,
  bannersLoaded: true,
  banners: {} as Record<string, unknown[]>,
  categorias: [] as { id: string; name: string; isActive: boolean }[],
  categoriasCarregando: false,
  metas: [] as Record<string, unknown>[],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: cenario.config,
    isLoaded: cenario.isLoaded,
    catalogoErro: cenario.catalogoErro,
    fetchProducts: vi.fn(async () => {}),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    getBannersByPosition: (posicao: string) =>
      // eslint-disable-next-line security/detect-object-injection -- posição vem de um literal da própria tela
      cenario.banners[posicao] ?? [],
    isLoaded: cenario.bannersLoaded,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: cenario.categorias,
    isLoading: cenario.categoriasCarregando,
  }),
}));
vi.mock("@/hooks/useDocumentMeta", () => ({
  useDocumentMeta: (meta: Record<string, unknown>) => {
    cenario.metas.push(meta);
    return {};
  },
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => <div data-testid="bloco-frete" />,
}));
vi.mock("@/components/ui/custom/InfoBlockCarousel", () => ({
  InfoBlockCarousel: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/ui/custom/BannerCarousel", () => ({
  BannerCarousel: ({ banners }: { banners: { id: string }[] }) => (
    <div data-testid="banner" data-ids={banners.map((b) => b.id).join(",")} />
  ),
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: () => null,
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: ({ products }: { products: Product[] }) => (
    <div data-testid="grade" data-total={products.length} />
  ),
}));

const produto = (id: string, category = "Roupas"): Product =>
  ({
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: ["https://cdn.exemplo/foto.jpg"],
    category,
    stock: 5,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as Product;

describe("HomeView — título, esqueleto do frete, sombra do filtro e textos do catálogo vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLElement;

  beforeEach(() => {
    cenario.config = { freeShippingMin: 0 };
    cenario.isLoaded = true;
    cenario.catalogoErro = false;
    cenario.bannersLoaded = true;
    cenario.banners = {};
    cenario.categorias = [];
    cenario.categoriasCarregando = false;
    cenario.metas = [];
    const dados = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => dados.set(k, v),
      removeItem: (k: string) => dados.delete(k),
    });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    hospedeiro = document.createElement("main");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  function montaHome(
    products: Product[],
    extras: Partial<Parameters<typeof HomeView>[0]> = {},
  ) {
    act(() =>
      raiz.render(
        <HomeView
          products={products}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          searchQuery=""
          selectedCategory="Todas"
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
          isLoading={false}
          {...extras}
        />,
      ),
    );
  }
  const ultimaMeta = () => cenario.metas[cenario.metas.length - 1];
  const titulo = () => ultimaMeta().title;
  const descricao = () =>
    (ultimaMeta().names as Record<string, string>).description;
  const texto = () => hospedeiro.textContent?.replace(/\s+/g, " ");

  describe("título da aba e descrição", () => {
    it("com cidade e estado: 'Loja | Cidade, UF'", () => {
      cenario.config = {
        freeShippingMin: 0,
        storeName: "Loja Azul",
        storeCity: "Campinas",
        storeState: "SP",
      };
      montaHome([produto("a")]);
      expect(titulo()).toBe("Loja Azul | Campinas, SP");
      expect(descricao()).toBe(
        "O marketplace online de Campinas, SP - Loja Azul",
      );
    });

    it("só com a cidade: sem vírgula nem estado solto", () => {
      cenario.config = {
        freeShippingMin: 0,
        storeName: "Loja Azul",
        storeCity: "Campinas",
      };
      montaHome([produto("a")]);
      expect(titulo()).toBe("Loja Azul | Campinas");
      expect(descricao()).toBe("O marketplace online de Campinas - Loja Azul");
    });

    it("sem cidade (mesmo com estado): só o nome da loja", () => {
      cenario.config = {
        freeShippingMin: 0,
        storeName: "Loja Azul",
        storeState: "SP",
      };
      montaHome([produto("a")]);
      expect(titulo()).toBe("Loja Azul");
      expect(descricao()).toBe("O marketplace online - Loja Azul");
    });

    it("nome da loja só com espaços cai no nome do app, no título e no h1", () => {
      cenario.config = { freeShippingMin: 0, storeName: "   " };
      montaHome([produto("a")]);
      expect(titulo()).toBe(branding.appName);
      expect(hospedeiro.querySelector("h1")?.textContent).toBe(
        branding.appName,
      );
    });

    it("nome da loja com espaços nas pontas é aparado", () => {
      cenario.config = { freeShippingMin: 0, storeName: "  Loja Azul  " };
      montaHome([produto("a")]);
      expect(titulo()).toBe("Loja Azul");
      expect(hospedeiro.querySelector("h1")?.textContent).toBe("Loja Azul");
    });
  });

  describe("bloco de frete grátis de uma loja sem banner no topo", () => {
    it("configuração ainda não chegou: nenhum esqueleto (nada nasce nem some depois)", () => {
      cenario.isLoaded = false;
      cenario.config = { freeShippingMin: 350 };
      montaHome([produto("a")]);
      expect(hospedeiro.querySelector(".animate-pulse")).toBeNull();
      expect(
        hospedeiro.querySelector('[data-testid="bloco-frete"]'),
      ).toBeNull();
    });

    it("configuração chegou com frete grátis ligado: o bloco aparece", () => {
      cenario.config = { freeShippingMin: 350 };
      montaHome([produto("a")]);
      expect(
        hospedeiro.querySelector('[data-testid="bloco-frete"]'),
      ).not.toBeNull();
    });

    it("configuração chegou com frete grátis desligado: nada de bloco", () => {
      cenario.config = { freeShippingMin: 0 };
      montaHome([produto("a")]);
      expect(
        hospedeiro.querySelector('[data-testid="bloco-frete"]'),
      ).toBeNull();
    });
  });

  describe("sombra da barra de filtros", () => {
    const barra = () =>
      hospedeiro.querySelector('[data-testid="resultado-categoria"]')
        ?.parentElement as HTMLElement;

    it.each([0, 20])("rolagem %i: sem sombra", (rolagem) => {
      montaHome([produto("a")], { scrollProgress: rolagem });
      expect(barra().className).not.toContain("shadow-sm");
      expect(barra().className).toContain("border-transparent");
    });

    it.each([21, 80])("rolagem %i: com sombra", (rolagem) => {
      montaHome([produto("a")], { scrollProgress: rolagem });
      expect(barra().className).toContain("shadow-sm");
    });
  });

  describe("catálogo vazio: o texto de ajuda segue a causa", () => {
    it("rede falhou sem nenhum produto guardado: manda conferir a internet", () => {
      cenario.catalogoErro = true;
      montaHome([]);
      const alerta = hospedeiro.querySelector('[role="alert"]')?.textContent;
      expect(alerta).toContain("Não conseguimos carregar os produtos");
      expect(alerta).toContain("Confira sua internet e tente de novo.");
      expect(alerta).not.toContain("Pode haver produtos novos");
    });

    it("rede falhou com cópia guardada: avisa que pode haver produtos novos", () => {
      cenario.catalogoErro = true;
      montaHome([produto("a", "Calçados")], { selectedCategory: "Roupas" });
      const alerta = hospedeiro.querySelector('[role="alert"]')?.textContent;
      expect(alerta).toContain("Não conseguimos atualizar a loja agora");
      expect(alerta).toContain("Pode haver produtos novos");
      expect(alerta).not.toContain("Confira sua internet");
    });

    it("categoria da loja, ativa e sem produto: diz que ainda não há produtos nela", () => {
      cenario.categorias = [{ id: "c1", name: "Roupas", isActive: true }];
      montaHome([produto("a", "Calçados")], { selectedCategory: "Roupas" });
      expect(texto()).toContain("Nenhum produto agora");
      expect(texto()).toContain("Ainda não há produtos nesta categoria.");
      expect(texto()).not.toContain("Tente buscar por outro termo");
    });

    it("busca sem resultado, mesmo numa categoria ativa: manda mudar o termo", () => {
      cenario.categorias = [{ id: "c1", name: "Roupas", isActive: true }];
      montaHome([produto("a", "Roupas")], {
        selectedCategory: "Roupas",
        searchQuery: "zzzz",
      });
      expect(texto()).toContain(
        "Tente buscar por outro termo ou mudar a categoria.",
      );
      expect(texto()).not.toContain("Ainda não há produtos nesta categoria.");
    });

    it("categoria escondida pela lojista (lista ainda carregando): não é 'sem produtos'", () => {
      cenario.categorias = [{ id: "c9", name: "Antigas", isActive: false }];
      cenario.categoriasCarregando = true;
      montaHome([produto("a", "Roupas")], { selectedCategory: "Antigas" });
      expect(texto()).toContain(
        "Tente buscar por outro termo ou mudar a categoria.",
      );
      expect(texto()).not.toContain("Ainda não há produtos nesta categoria.");
    });

    it("loja sem filtro nenhum e sem produtos: sem texto de ajuda", () => {
      montaHome([]);
      expect(texto()).toContain("Nenhum produto disponível agora");
      expect(texto()).not.toContain("Tente buscar por outro termo");
      expect(texto()).not.toContain("Ainda não há produtos nesta categoria.");
    });
  });

  describe("durante uma busca", () => {
    const comBanners = () => {
      cenario.banners = {
        home_top: [{ id: "topo" }],
        home_bottom: [{ id: "pe" }],
      };
    };
    const banners = () =>
      Array.from(hospedeiro.querySelectorAll('[data-testid="banner"]'), (b) =>
        b.getAttribute("data-ids"),
      );

    it("sem busca: banner do topo e do pé aparecem", () => {
      comBanners();
      montaHome([produto("a")]);
      expect(banners()).toEqual(["topo", "pe"]);
    });

    it("com busca: banner do topo e do pé ficam escondidos", () => {
      comBanners();
      montaHome([produto("a")], { searchQuery: "produto" });
      expect(banners()).toEqual([]);
    });
  });

  describe("memória da última visita só é gravada com tudo resolvido", () => {
    const gravada = () => lerMemoriaDaHome() !== null;

    it("controle: dados, banners e configuração prontos gravam", () => {
      montaHome([produto("a")]);
      expect(gravada()).toBe(true);
    });

    it("catálogo que falhou não apaga a memória da última visita boa", () => {
      cenario.catalogoErro = true;
      montaHome([]);
      expect(gravada()).toBe(false);
    });

    it("produtos ainda carregando: não grava", () => {
      montaHome([], { isLoading: true });
      expect(gravada()).toBe(false);
    });

    it("banners ainda carregando: não grava", () => {
      cenario.bannersLoaded = false;
      montaHome([produto("a")]);
      expect(gravada()).toBe(false);
    });

    it("configuração ainda carregando: não grava", () => {
      cenario.isLoaded = false;
      montaHome([produto("a")]);
      expect(gravada()).toBe(false);
    });
  });
});
