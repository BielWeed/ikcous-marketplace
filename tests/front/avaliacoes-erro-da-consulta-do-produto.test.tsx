// @vitest-environment jsdom
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
  reviewCount: 0,
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

const navegar = vi.fn();
async function mostrar(id = produto.id) {
  const { ProductView } = await import("@/views/customer/ProductView");
  await act(async () => {
    raiz.render(
      <ProductView
        product={{ ...produto, id }}
        isFavorite={false}
        onToggleFavorite={navegar}
        onAddToCart={navegar}
        onBack={navegar}
      />,
    );
  });
}

it("falha não afirma ausência de avaliações e permite tentar de novo", async () => {
  h.ler
    .mockResolvedValueOnce({ data: null, error: { message: "falha interna" } })
    .mockResolvedValue({ data: [], error: null });
  await mostrar();
  const secao = host.querySelector("#reviews-section")!;
  expect(secao.querySelector('[role="alert"]')).not.toBeNull();
  expect(secao.textContent).not.toContain("Ainda sem avaliações");
  expect(secao.textContent).not.toContain("falha interna");
  const repetir = [...secao.querySelectorAll<HTMLButtonElement>("button")].find(
    (botao) => botao.textContent?.trim() === "Tentar de novo",
  );
  expect(repetir).toBeDefined();
  await act(async () => {
    repetir!.click();
  });
  expect(secao.querySelector('[role="alert"]')).toBeNull();
  expect(secao.textContent).toContain("Ainda sem avaliações");
  expect(h.ler).toHaveBeenCalledTimes(2);
});

it("erro atrasado do produto anterior não contamina a consulta atual", async () => {
  let concluir!: (valor: { data: null; error: { message: string } }) => void;
  h.ler
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          concluir = resolve;
        }),
    )
    .mockResolvedValue({ data: [], error: null });
  await mostrar();
  await mostrar("produto-b");
  await act(async () => {
    concluir({ data: null, error: { message: "falha antiga" } });
  });
  const secao = host.querySelector("#reviews-section")!;
  expect(secao.querySelector('[role="alert"]')).toBeNull();
  expect(secao.textContent).toContain("Ainda sem avaliações");
});
