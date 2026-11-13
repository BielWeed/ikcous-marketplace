// @vitest-environment jsdom
//
// DEFEITO (caçador, 13/11/2026): a consulta das avaliações RESPONDIA vazia (a
// lista mostrava "Ainda sem avaliações"), mas o resumo em cima seguia dizendo
// "1 opinião dos consumidores", vindo da contagem velha do produto. Depois de
// uma consulta que respondeu, a contagem vem da lista lida; a contagem do
// produto só vale enquanto a consulta não respondeu (carregando ou falhou).
//
// Harness copiado de avaliacoes-erro-da-consulta-do-produto.test.tsx.
import { esvaziarAvaliacoesEmMemoria } from "@/lib/cache-de-avaliacoes";
import type { Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
  return {
    ler: vi.fn(),
    recomendar: vi.fn().mockResolvedValue([]),
    rastrear: vi.fn(),
  };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: h.ler }) }) }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    fetchRecommendations: h.recomendar,
    trackRecommendationClick: h.rastrear,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ isFavorite: () => false, toggleFavorite: vi.fn() }),
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({ ProductQA: () => null }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true }, isLoaded: true }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const produto: Product = {
  id: "produto-a",
  name: "Produto",
  description: "",
  price: 10,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-10-01T12:00:00Z",
  rating: 4,
  reviewCount: 1,
};
let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  h.ler.mockReset();
  esvaziarAvaliacoesEmMemoria();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => {
      dados.set(k, v);
    },
    removeItem: (k: string) => {
      dados.delete(k);
    },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  document.getElementById("product-structured-data")?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mostrar() {
  const { ProductView } = await import("@/views/customer/ProductView");
  await act(async () => {
    raiz.render(
      <ProductView
        product={produto}
        isFavorite={false}
        onToggleFavorite={vi.fn()}
        onAddToCart={vi.fn()}
        onBack={vi.fn()}
      />,
    );
  });
}

it("consulta que respondeu VAZIA: o resumo para de usar a contagem velha do produto", async () => {
  h.ler.mockResolvedValue({ data: [], error: null });
  await mostrar();
  const secao = host.querySelector("#reviews-section")!;
  expect(secao.textContent).toContain("Ainda sem avaliações");
  expect(secao.textContent).toContain("Sem avaliações ainda");
  expect(secao.textContent).not.toContain("opinião");
  expect(host.textContent).not.toContain("(1)");
});

it("enquanto a consulta não respondeu, vale a contagem do produto", async () => {
  h.ler.mockImplementation(() => new Promise(() => {}));
  await mostrar();
  const secao = host.querySelector("#reviews-section")!;
  expect(secao.textContent).toContain("1 opinião dos consumidores");
});

it("consulta que FALHOU: a contagem do produto segue valendo", async () => {
  h.ler.mockResolvedValue({ data: null, error: { message: "sem rede" } });
  await mostrar();
  const secao = host.querySelector("#reviews-section")!;
  expect(secao.querySelector('[role="alert"]')).not.toBeNull();
  expect(secao.textContent).toContain("1 opinião dos consumidores");
});

it("consulta que respondeu com avaliações: a contagem é a da lista lida", async () => {
  const linha = (id: string) => ({
    id,
    product_id: produto.id,
    author_name: "Cliente",
    rating: 5,
    comment: "Muito bom",
    verified: true,
    helpful: 0,
    created_at: "2026-10-01T12:00:00Z",
  });
  h.ler.mockResolvedValue({ data: [linha("r1"), linha("r2")], error: null });
  await mostrar();
  const secao = host.querySelector("#reviews-section")!;
  expect(secao.textContent).toContain("2 opiniões dos consumidores");
});
