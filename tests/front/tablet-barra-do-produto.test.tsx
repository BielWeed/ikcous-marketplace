// @vitest-environment jsdom
//
// Loja do cliente em TABLET (768–1023 px). Defeito medido num Chromium de
// verdade, que não aparece no celular (390) nem no computador (>= 1024):
//
// (A) Produto, 768 e 820 px, depois de rolar: a barra flutuante "Adicionar"
//     saía pela direita. O `motion.div` anima `y`, e o framer-motion escreve
//     `transform` INLINE -- isso sobrescreve o `md:-translate-x-1/2` do
//     Tailwind, e a barra ficava com a borda esquerda no meio da tela
//     (768 px: x=384, 448 px de largura, 64 px além da borda). A barra agora
//     se centraliza SEM transform: `fixed` com left/right e largura limitada,
//     centrada por `mx-auto`.
//
// Abaixo de 768 px o className renderizado é o mesmo de antes: os literais
// abaixo são a lista congelada do celular, escrita à mão (nunca lida do
// histórico do git -- o CI clona só o último commit).
import type { Product } from "@/types";
import { ProductView } from "@/views/customer/ProductView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: vi.fn(),
    markHelpful: vi.fn(),
    subscribeToReviews: () => () => {},
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo,
    trackRecommendationClick: vi.fn(),
    fetchRecommendations: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: () => false,
    toggleFavorite: vi.fn(),
    loading: false,
    erro: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: [],
    carregando: true,
    consultado: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    error: null,
    getQuestionsByProduct: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      shippingFee: 10,
      freeShippingMin: 0,
      storeName: "Loja de teste",
    },
    isLoaded: true,
    products: catalogo,
    catalogoErro: false,
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function umProduto(id: string): Product {
  return {
    id,
    name: `Blusa ${id}`,
    description: "Descrição",
    price: 100,
    images: ["/foto-1.png"],
    category: "Roupas",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-09-28T12:00:00Z",
  };
}
const catalogo: Product[] = ["a", "b", "c", "d"].map(umProduto);

/** Classes que valem ABAIXO de 768 px: tira tudo que liga em md/lg/xl/2xl. */
function abaixoDe768(className: string): string {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !["md", "lg", "xl", "2xl"].includes(t.split(":")[0]))
    .join(" ");
}
const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

describe("Tablet — barra flutuante do produto centrada sem transform", () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("matchMedia", undefined);
    host = document.createElement("main");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.getElementById("product-structured-data")?.remove();
    vi.unstubAllGlobals();
  });

  async function barra(): Promise<HTMLElement> {
    await act(async () =>
      root.render(
        <ProductView
          product={umProduto("produto-tablet")}
          isFavorite={false}
          onToggleFavorite={() => {}}
          onAddToCart={() => {}}
          onBack={() => {}}
        />,
      ),
    );
    const el = document.querySelector<HTMLElement>(".bottom-docked-navigation");
    expect(el).not.toBeNull();
    return el!;
  }

  it("abaixo de 768 px a barra é a mesma de antes", async () => {
    const el = await barra();
    expect(abaixoDe768(el.className)).toBe(
      "bottom-docked-navigation fixed inset-x-4 z-50 mb-3 flex flex-wrap items-center gap-2 rounded-[40px] border border-border bg-background p-3 shadow-[0_10px_28px_rgba(11,11,12,0.15)]",
    );
  });

  it("de 768 a 1023 px centraliza com margem automática, sem translate", async () => {
    const t = tokens((await barra()).className);
    expect(t).toContain("md:inset-x-0");
    expect(t).toContain("md:mx-auto");
    expect(t).toContain("md:w-[calc(100%-32px)]");
    expect(t).toContain("md:max-w-md");
    // O framer-motion escreve `transform` inline neste elemento (anima `y`):
    // qualquer translate-x de classe é sobrescrito e some em silêncio.
    expect(t.filter((c) => c.includes("translate"))).toEqual([]);
    expect(t).not.toContain("md:left-1/2");
    expect(t).not.toContain("md:right-auto");
  });

  it("no computador continua escondida", async () => {
    expect(tokens((await barra()).className)).toContain("lg:hidden");
  });
});
