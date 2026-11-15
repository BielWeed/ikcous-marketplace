import { lerMemoriaDaHome } from "@/hooks/useMemoriaDaHome";
import type { Product } from "@/types";
// @vitest-environment jsdom
import { HomeView } from "@/views/customer/HomeView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const loja = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  isLoaded: true,
}));
vi.mock("@/contexts/StoreContext", () => ({ useStore: () => loja }));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView() {}, prefetchImage() {} }),
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => null,
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: () => null,
}));
vi.mock("@/components/politicas/RodapeDasPoliticas", () => ({
  RodapeDasPoliticas: () => null,
}));
vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation() {},
  pontoDeSaidaVisivel() {},
}));
const embla = vi.hoisted(() => ({
  selectedScrollSnap: () => 0,
  on() {},
  off() {},
  scrollNext: vi.fn(),
}));
vi.mock("embla-carousel-react", () => ({ default: () => [() => {}, embla] }));

await import("@/components/ui/custom/OfertasCompactas");
await import("@/components/ui/custom/OfertasLateral");
await import("@/components/ui/custom/OfertasLateralDuplo");

const produto = (id: string, extras: Partial<Product> = {}): Product => ({
  id,
  name: `Produto ${id}`,
  price: 50,
  images: ["/foto-fixture.jpg"],
  description: "",
  category: "Roupas",
  stock: 20,
  sold: 0,
  isActive: true,
  isBestseller: true,
  freeShipping: false,
  createdAt: "",
  createdTime: 1,
  ...extras,
});
const produtos = [
  produto("novo", { createdTime: 3 }),
  produto("meio", { createdTime: 2, stock: 0 }),
  produto("antigo", { originalPrice: 100 }),
];
const layouts = ["compacto", "lateral", "lateral-duplo"] as const;
const ids = ["new_arrivals", "bestsellers", "curada"];
const titulos = [
  "Últimos Lançamentos",
  "Destaques em Alta",
  "Seleção da lojista",
];
let host: HTMLDivElement;
let root: Root;
let dados: Map<string, string>;
beforeEach(() => {
  loja.config = {};
  loja.isLoaded = true;
  dados = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => dados.set(k, v),
    removeItem: (k: string) => dados.delete(k),
  });
  class Observador {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("ResizeObserver", Observador);
  vi.stubGlobal("CSS", { escape: (v: string) => v });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function montar(lista = produtos, carregando = false) {
  await act(async () => {
    root.render(
      <HomeView
        products={lista}
        favorites={[]}
        onToggleFavorite={() => {}}
        onProductClick={() => {}}
        onNavigate={() => {}}
        searchQuery=""
        selectedCategory="Todas"
        onCategoryChange={() => {}}
        sortBy="default"
        onSortByChange={() => {}}
        isLoading={carregando}
      />,
    );
  });
}
function secao(id: string, layout?: unknown, title = titulos[ids.indexOf(id)]) {
  return {
    id,
    layout,
    title,
    active: true,
    productIds: id === "curada" ? ["novo", "meio", "antigo"] : undefined,
  };
}
function semear(vitrines?: unknown, antigo: Record<string, unknown> = {}) {
  dados.set(
    "ikcous_home_memoria",
    JSON.stringify({
      temBanner: false,
      temOfertas: true,
      temBestsellers: true,
      temLancamentos: true,
      gravadoEm: Date.now(),
      vitrines,
      ...antigo,
    }),
  );
}
const sequencia = (atributo: string) =>
  Array.from(host.querySelectorAll(`[${atributo}]`)).map((el) =>
    el.getAttribute(atributo),
  );
const faixaCarrossel = (titulo: string) =>
  Array.from(host.querySelectorAll("h2")).find(
    (el) => el.textContent === titulo,
  )?.parentElement?.parentElement;

describe("HomeView — layouts independentes e compatibilidade da vitrine viva", () => {
  it.each([undefined, null, "desconhecido", "padrao"])(
    "config antiga (%s): Lançamentos/Destaques/personalizada continuam o carrossel real",
    async (layout) => {
      loja.config = {
        homeSections: [
          ...ids.map((id) => secao(id, layout)),
          { id: "offers", title: "Ofertas Imperdíveis", active: true },
        ],
      };
      await montar();
      // Contrato observado ANTES da implementação: carrossel nativo de 260px
      // nas três vitrines, cabeçalho 3xl e fundo cinza só em Destaques.
      for (const titulo of titulos) {
        const faixa = faixaCarrossel(titulo)!;
        expect(faixa.querySelector(".snap-x")).not.toBeNull();
        expect(faixa.querySelector("h2")?.className).toContain("text-3xl");
        expect(faixa.querySelectorAll(".w-\\[260px\\]")).toHaveLength(
          titulo === titulos[2] ? 3 : 2,
        );
      }
      expect(faixaCarrossel(titulos[1])?.className).toContain("bg-zinc-50/50");
      expect(host.querySelectorAll(".cursor-grab")).toHaveLength(1);
      expect(host.querySelector('[data-testid^="ofertas-"]')).toBeNull();
    },
  );

  it.each([undefined, null, "desconhecido", "padrao"])(
    "Padrão antigo (%s) mantém também a ausência de cabeçalho quando não havia nome",
    async (layout) => {
      loja.config = { homeSections: [secao("new_arrivals", layout, " ​ ")] };
      await montar();
      expect(host.querySelector(".snap-x")).not.toBeNull();
      expect(
        Array.from(host.querySelectorAll("h2")).map((el) => el.textContent),
      ).toEqual(["Catálogo"]);
    },
  );

  it("config só com offers.layout mantém os demais carrosséis intactos", async () => {
    loja.config = {
      homeSections: [
        ...ids.map((id) => secao(id)),
        {
          id: "offers",
          title: "Ofertas Imperdíveis",
          layout: "compacto",
          active: true,
        },
      ],
    };
    await montar();
    expect(host.querySelectorAll(".snap-x")).toHaveLength(3);
    expect(
      host.querySelectorAll('[data-testid="ofertas-compactas"]'),
    ).toHaveLength(1);
  });

  it("sem homeSections continua com os três desenhos de antes", async () => {
    await montar();
    expect(host.querySelectorAll(".snap-x")).toHaveLength(2);
    expect(host.querySelector(".cursor-grab")).not.toBeNull();
  });

  it.each(layouts)(
    "%s: curada mantém esgotado no meio, sem ordenar por desconto",
    async (layout) => {
      loja.config = { homeSections: [secao("curada", layout)] };
      await montar();
      const atributo =
        layout === "compacto"
          ? "data-oferta-compacta"
          : `data-oferta-${layout}`;
      expect(sequencia(atributo)).toEqual(["novo", "meio", "antigo"]);
    },
  );

  it("Lançamentos em lateral mantém mais novo antes do maior desconto", async () => {
    loja.config = { homeSections: [secao("new_arrivals", "lateral")] };
    await montar();
    expect(sequencia("data-oferta-lateral")).toEqual(["novo", "antigo"]);
  });

  it.each(layouts)(
    "%s: sem desconto não fabrica oferta nem rótulo promocional",
    async (layout) => {
      loja.config = { homeSections: [secao("new_arrivals", layout)] };
      await montar([
        produto("sem-desconto"),
        produto("outro"),
        produto("terceiro"),
      ]);
      expect(host.textContent).not.toMatch(/OFF|Economiz|Super Descontos/);
      expect(host.querySelector(".lucide-flame")).toBeNull();
      expect(
        host.querySelector(".line-through")?.textContent?.trim() ?? "",
      ).toBe("");
      const rotulos = Array.from(host.querySelectorAll("[aria-label]")).map(
        (el) => el.getAttribute("aria-label"),
      );
      expect(rotulos.join(" ")).not.toMatch(/oferta/i);
    },
  );

  it.each(layouts)(
    "%s: desconto real continua mostrando o preço antigo e OFF",
    async (layout) => {
      loja.config = { homeSections: [secao("new_arrivals", layout)] };
      await montar([produto("promocional", { originalPrice: 100 })]);
      expect(host.textContent).toContain("50% OFF");
      expect(host.querySelector(".line-through")?.textContent).toContain("100");
      expect(host.querySelector(".lucide-flame")).toBeNull();
    },
  );

  it.each(ids)(
    "vitrine %s sem nome usa o título da seção, nunca Super Descontos",
    async (id) => {
      loja.config = { homeSections: [secao(id, "lateral", " ​ ")] };
      await montar();
      expect(host.querySelector("h2")?.textContent).toBe(
        id === "curada" ? "Produtos selecionados" : titulos[ids.indexOf(id)],
      );
    },
  );

  it("Lateral sem desconto aproveita a linha vazia com a categoria verdadeira, só fora de Ofertas", async () => {
    loja.config = { homeSections: [secao("new_arrivals", "lateral")] };
    await montar([produto("simples")]);
    expect(host.querySelector("[data-categoria-vitrine]")?.textContent).toBe(
      "Roupas",
    );
    loja.config = {
      homeSections: [
        {
          id: "offers",
          title: "Ofertas",
          layout: "lateral",
          active: true,
          productIds: ["simples"],
        },
      ],
    };
    await montar([produto("simples")]);
    expect(host.querySelector("[data-categoria-vitrine]")).toBeNull();
  });

  it("Compacto fora de Ofertas limita o nome a duas linhas para não saltar a 320px", async () => {
    loja.config = { homeSections: [secao("new_arrivals", "compacto")] };
    await montar([produto("nome-longo"), produto("segundo")]);
    expect(
      host.querySelector("[data-oferta-compacta] h3")?.className,
    ).toContain("line-clamp-2");
    loja.config = {
      homeSections: [
        {
          id: "offers",
          title: "Ofertas",
          layout: "compacto",
          active: true,
          productIds: ["nome-longo", "segundo"],
        },
      ],
    };
    await montar([produto("nome-longo"), produto("segundo")]);
    expect(
      host.querySelector("[data-oferta-compacta] h3")?.className,
    ).not.toContain("line-clamp");
  });

  it.each(layouts)(
    "%s: Destaques mantém o fundo suave da faixa",
    async (layout) => {
      loja.config = { homeSections: [secao("bestsellers", layout)] };
      await montar();
      expect(host.querySelector("section")?.className).toContain(
        "bg-zinc-50/50",
      );
    },
  );

  it.each(layouts)("%s: não gira sozinho", async (layout) => {
    vi.useFakeTimers();
    loja.config = { homeSections: [secao("new_arrivals", layout)] };
    await montar();
    await act(async () => vi.advanceTimersByTime(18000));
    expect(embla.scrollNext).not.toHaveBeenCalled();
  });

  it("cada seção escolhe o próprio desenho, sem herdar o layout de Ofertas", async () => {
    loja.config = {
      homeSections: [
        secao("new_arrivals", "lateral"),
        secao("bestsellers", "compacto"),
        secao("curada", "lateral-duplo"),
        { id: "offers", title: "Ofertas", layout: "padrao", active: true },
      ],
    };
    await montar();
    for (const id of [
      "ofertas-compactas",
      "ofertas-lateral",
      "ofertas-lateral-duplo",
    ])
      expect(host.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    expect(host.querySelector(".cursor-grab")).not.toBeNull();
  });
});

describe("HomeView — memória por vitrine e alturas antes dos dados", () => {
  it("grava layout e quantidade por id, contando só escolhidos à venda e maxItems", async () => {
    loja.config = {
      homeSections: [
        { ...secao("new_arrivals", "lateral"), maxItems: 1 },
        { ...secao("bestsellers", "compacto"), maxItems: 2 },
        {
          ...secao("curada", "lateral-duplo"),
          productIds: ["pausado", "novo", "sumiu", "meio", "antigo"],
          maxItems: 2,
        },
      ],
    };
    await montar([...produtos, produto("pausado", { isActive: false })]);
    expect(lerMemoriaDaHome()?.vitrines).toEqual({
      new_arrivals: { layout: "lateral", qtd: 1 },
      bestsellers: { layout: "compacto", qtd: 2 },
      curada: { layout: "lateral-duplo", qtd: 2 },
    });
  });

  it.each([
    [1, 206],
    [2, 318],
  ])(
    "memória com %i item(s): duplo reserva %ipx sem confundir com Ofertas",
    async (qtd, altura) => {
      semear(
        {
          new_arrivals: { layout: "lateral-duplo", qtd },
          bestsellers: { layout: "padrao", qtd: 2 },
        },
        { layoutOfertas: "compacto", qtdOfertas: 5 },
      );
      loja.isLoaded = false;
      await montar([], true);
      const esq = host.querySelector<HTMLElement>(
        '[data-testid="esqueleto-vitrine"]',
      );
      expect(esq?.style.minHeight).toBe(`${altura}px`);
      expect(
        host.querySelector('[data-testid="esqueleto-carrossel"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[data-testid="esqueleto-ofertas"]')?.className,
      ).toContain("392px");
    },
  );

  it("config carregada vence memória e padrão continua reservando carrossel", async () => {
    semear({ new_arrivals: { layout: "lateral-duplo", qtd: 1 } });
    loja.config = { homeSections: [secao("new_arrivals", "padrao")] };
    await montar([], true);
    expect(
      host.querySelector('[data-testid="esqueleto-carrossel"]'),
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="esqueleto-vitrine"]')).toBeNull();
  });

  it("memória antiga mantém Ofertas lateral e carrossel nas outras vitrines", async () => {
    semear(undefined, { layoutOfertas: "lateral", qtdOfertas: 1 });
    loja.isLoaded = false;
    await montar([], true);
    expect(
      host.querySelectorAll('[data-testid="esqueleto-carrossel"]'),
    ).toHaveLength(2);
    expect(
      host.querySelector<HTMLElement>('[data-testid="esqueleto-ofertas"]')
        ?.style.minHeight,
    ).toBe("226px");
  });
});
