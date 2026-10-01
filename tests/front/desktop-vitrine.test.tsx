import {
  CONTAINER_DO_COMPUTADOR,
  GAVETA_NO_COMPUTADOR,
  GRADE_DE_PRODUTOS_NO_COMPUTADOR,
} from "@/components/desktop/medidas";
import { CategoryFilter } from "@/components/ui/custom/CategoryFilter";
import { PremiumOffers } from "@/components/ui/custom/PremiumOffers";
import { ProductCard } from "@/components/ui/custom/ProductCard";
import { ProductCarousel } from "@/components/ui/custom/ProductCarousel";
import { ProductList } from "@/components/ui/custom/ProductList";
import { CONSULTA_TELA_DE_COMPUTADOR } from "@/hooks/useTelaDeComputador";
import type { Product } from "@/types";
import { HomeView } from "@/views/customer/HomeView";
// @vitest-environment jsdom
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// @ts-expect-error flag interna do React, padrão da suíte.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let computador = false;
let carregado = true;
const config = {
  enableReviews: false,
  businessHours: "Segunda a sexta, 9h às 18h",
  freeShippingMin: 0,
};
const banner = {
  id: "banner",
  imageUrl: "https://example.com/banner.png",
  title: "Novidades",
  showTextOverlay: false,
};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config, isLoaded: carregado }),
}));
vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn(), prefetchImage: vi.fn() }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    isLoaded: carregado,
    getBannersByPosition: () => (carregado ? [banner] : []),
  }),
}));
vi.mock("@/hooks/useDocumentMeta", () => ({ useDocumentMeta: vi.fn() }));
vi.mock("@/hooks/useMemoriaDaHome", () => ({
  useMemoriaDaHome: () => null,
  gravarMemoriaDaHome: vi.fn(),
}));
vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: vi.fn(),
}));
const embla = vi.hoisted(() => ({ montar: vi.fn(() => [vi.fn(), undefined]) }));
vi.mock("embla-carousel-react", () => ({ default: embla.montar }));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const produto: Product = {
  id: "produto",
  name: "Caderno Bom",
  description: "Caderno",
  price: 50,
  images: ["https://example.com/produto.png"],
  category: "Papelaria",
  stock: 10,
  sold: 1,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-09-28T12:00:00Z",
  rating: 0,
  reviewCount: 0,
};
const lista = {
  products: [produto],
  favorites: [],
  onToggleFavorite: vi.fn(),
  onProductClick: vi.fn(),
};
let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  computador = false;
  carregado = true;
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: computador && q === CONSULTA_TELA_DE_COMPUTADOR,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function montar(no: ReactNode) {
  act(() => raiz.render(no));
}
function alvo(seletor: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(seletor);
  expect(el, seletor).not.toBeNull();
  return el!;
}
function classes(el: HTMLElement, celular: string, desktop: string) {
  expect(classesDoCelular(el.className)).toBe(classesDoCelular(celular));
  for (const token of desktop.split(" "))
    expect(el.classList.contains(token), token).toBe(true);
}
function home(loading = false) {
  montar(
    <HomeView
      {...lista}
      onNavigate={vi.fn()}
      searchQuery=""
      selectedCategory="Todas"
      onCategoryChange={vi.fn()}
      sortBy="price-asc"
      onSortByChange={vi.fn()}
      isLoading={loading}
    />,
  );
}
function card(variantes = false) {
  montar(
    <ProductCard
      product={
        variantes
          ? {
              ...produto,
              variants: [
                {
                  id: "m",
                  productId: produto.id,
                  name: "Tamanho",
                  value: "M",
                  stockIncrement: 5,
                  active: true,
                },
              ],
            }
          : produto
      }
      isFavorite={false}
      onToggleFavorite={vi.fn()}
      onClick={vi.fn()}
      onAddToCartWithVariants={vi.fn()}
      showRating={false}
      priority
    />,
  );
}

describe("F2.1 — grade", () => {
  it.each([true, false])("preserva celular, carregando=%s", (isLoading) => {
    montar(<ProductList {...lista} isLoading={isLoading} />);
    classes(
      alvo(".grid"),
      "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
      GRADE_DE_PRODUTOS_NO_COMPUTADOR,
    );
  });
});
describe("F2.2 — card", () => {
  it("escala nome, preço e CTA só no desktop", () => {
    card();
    classes(
      alvo("h3 button"),
      "line-clamp-2 w-full text-left text-[13px] font-black leading-tight text-slate-900 transition-colors duration-300 group-hover:text-primary sm:text-[14px]",
      "lg:text-base",
    );
    classes(
      alvo("span.text-\\[15px\\]"),
      "text-[15px] font-black leading-none tracking-tight text-slate-900",
      "lg:text-lg",
    );
    expect(alvo('[data-testid="product-card-action"]').className).toContain(
      "lg:h-12",
    );
    expect(alvo('[data-testid="product-card-action"]').className).toContain(
      "lg:text-xs",
    );
    expect(alvo("img").getAttribute("sizes")).toBe(
      "(min-width: 1024px) 260px, (min-width: 640px) 280px, 50vw",
    );
  });
  it("revela o favorito com foco de teclado", () => {
    card();
    expect(alvo(".absolute.right-3").className).toContain(
      "lg:hover-hover:group-focus-within:opacity-100",
    );
    expect(alvo(".absolute.right-3").className).toContain(
      "lg:hover-hover:group-focus-within:translate-x-0",
    );
  });
});
describe("F2.3 — gaveta", () => {
  it.each([false, true])("folha preserva alça e CTA, desktop=%s", (desktop) => {
    computador = desktop;
    card(true);
    act(() => alvo('[data-testid="product-card-action"]').click());
    const folha = alvo('[data-testid="product-card-options-sheet"]');
    expect(folha.className).toContain(
      desktop ? "slide-in-from-right" : "slide-in-from-bottom",
    );
    if (desktop)
      for (const token of GAVETA_NO_COMPUTADOR.split(" "))
        expect(folha.classList.contains(token)).toBe(true);
    else expect(folha.className).toContain("max-h-[88dvh]");
    expect(alvo('[data-testid="product-card-options-add"]')).toBeTruthy();
    act(() => alvo('[data-testid="product-card-options-handle"]').click());
    expect(
      document.querySelector('[data-testid="product-card-options-sheet"]'),
    ).toBeNull();
  });
});
describe("F2.4 — container e banners", () => {
  it("contém toda a home sem mudar as classes do celular", () => {
    home();
    classes(
      host.firstElementChild as HTMLElement,
      "pb-customer min-h-full",
      CONTAINER_DO_COMPUTADOR,
    );
    for (const el of document.querySelectorAll<HTMLElement>(
      '[aria-roledescription="carousel"]',
    ))
      classes(
        el,
        "premium-shadow relative aspect-[2/1] w-full touch-pan-y overflow-hidden bg-zinc-100 md:aspect-[4/1]",
        "lg:rounded-3xl",
      );
  });
  it("espelha a borda do banner e o frete durante a carga", () => {
    carregado = false;
    home(true);
    expect(
      alvo('[data-testid="esqueleto-banner"] [role="status"]').className,
    ).toContain("lg:rounded-3xl");
    expect(
      alvo('[data-testid="esqueleto-banner"] [role="status"]').style.minHeight,
    ).toBe("200px");
    expect(alvo(".relative.mt-2").className).toContain("lg:px-0");
  });
});
describe("F2.5 — prateleiras", () => {
  it("celular não monta setas", () => {
    montar(<ProductCarousel {...lista} title="Novidades" />);
    expect(host.querySelector('[aria-label="Ver próximos"]')).toBeNull();
  });
  it("setas rolam uma largura visível, com relação acessível à faixa", () => {
    computador = true;
    montar(<ProductCarousel {...lista} title="Novidades" />);
    const proximo = alvo('[aria-label="Ver próximos"]');
    const anterior = alvo('[aria-label="Ver anteriores"]');
    const faixa = document.getElementById(
      proximo.getAttribute("aria-controls")!,
    )!;
    expect(faixa).toBeTruthy();
    expect(anterior.getAttribute("aria-controls")).toBe(faixa.id);
    Object.defineProperty(faixa, "clientWidth", { value: 960 });
    faixa.scrollBy = vi.fn();
    act(() => proximo.click());
    expect(faixa.scrollBy).toHaveBeenLastCalledWith({
      left: 960,
      behavior: "smooth",
    });
    act(() => anterior.click());
    expect(faixa.scrollBy).toHaveBeenLastCalledWith({
      left: -960,
      behavior: "smooth",
    });
    expect(faixa.className).toContain("lg:!px-0");
    expect(faixa.firstElementChild?.className).toContain(
      "lg:w-[calc((100%-60px)/4)]",
    );
    expect(faixa.firstElementChild?.className).toContain(
      "xl:w-[calc((100%-80px)/5)]",
    );
  });
});
describe("F2.6 — ofertas", () => {
  it('mantém o alinhamento "center" do Embla no celular', () => {
    montar(<PremiumOffers {...lista} />);
    expect(embla.montar).toHaveBeenLastCalledWith(
      expect.objectContaining({ align: "center" }),
    );
  });
  it("alinha as duas ofertas pela borda no desktop, sem metades nas pontas", () => {
    computador = true;
    montar(<PremiumOffers {...lista} />);
    expect(embla.montar).toHaveBeenLastCalledWith(
      expect.objectContaining({ align: "start" }),
    );
  });
  it("duas por vista mantendo a largura de celular", () => {
    montar(
      <PremiumOffers
        {...lista}
        products={[{ ...produto, originalPrice: 80 }]}
      />,
    );
    classes(
      alvo(".min-w-0"),
      "flex min-w-0 flex-[0_0_100%] flex-col p-1.5",
      "lg:flex-[0_0_50%]",
    );
  });
  it("esqueletos acompanham as larguras de prateleira e oferta", () => {
    carregado = false;
    home(true);
    expect(
      alvo('[data-testid="esqueleto-carrossel"] .flex-shrink-0').className,
    ).toContain("lg:w-[calc((100%-60px)/4)]");
    expect(
      alvo('[data-testid="esqueleto-ofertas"] .min-w-0').className,
    ).toContain("lg:flex-[0_0_50%]");
  });
});
describe("F2.7 — barra do catálogo", () => {
  it.each([true, false])(
    "chips quebram linha só no desktop, carregando=%s",
    (isLoading) => {
      montar(
        <CategoryFilter
          categories={[]}
          selectedCategory="Todas"
          onCategoryChange={vi.fn()}
          isLoading={isLoading}
        />,
      );
      classes(
        alvo(".scrollbar-hide"),
        "scrollbar-hide flex w-full gap-2 overflow-x-auto px-1 py-0.5",
        "lg:flex-wrap lg:overflow-visible",
      );
    },
  );
  it.each([false, true])("rótulo de ordenar só no desktop=%s", (desktop) => {
    computador = desktop;
    home();
    const botao = alvo('[title="Filtrar e Ordenar"]');
    expect(botao.textContent).toBe(desktop ? "Ordenar: Menor Preço" : "");
    const titulo = [...host.querySelectorAll("h2")].find(
      (h2) => h2.textContent === "Catálogo",
    )!;
    const barraSticky = titulo.closest(".sticky");
    if (desktop) {
      // Spec §3.6: barra sticky com "Catálogo" em text-3xl (30px).
      expect(barraSticky).not.toBeNull();
      expect(titulo.className).toContain("text-3xl");
      expect(titulo.className).not.toContain("lg:text-4xl");
    } else {
      expect(barraSticky).toBeNull();
      expect(titulo.className).toBe(
        "mb-8 text-3xl font-black leading-none tracking-tighter text-zinc-900",
      );
    }
  });
});
it("F2.8 — horário preservado no celular e oculto no computador", () => {
  home();
  const texto = [...host.querySelectorAll("p")].find((p) =>
    p.textContent?.includes("Horário de atendimento"),
  )!;
  classes(
    texto.parentElement!,
    "relative z-10 mt-8 rounded-[2rem] border border-zinc-100 bg-zinc-50/50 p-6 text-center",
    "lg:hidden",
  );
});
