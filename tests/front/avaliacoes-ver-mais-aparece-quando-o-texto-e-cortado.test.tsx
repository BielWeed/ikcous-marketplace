// @vitest-environment jsdom
//
// No modo compacto o comentário fica em 3 linhas e a resposta da loja em 2. No
// celular isso corta o texto com reticências a partir de uns 100 e uns 70
// caracteres, mas o botão "Ver mais" só existia acima de 180: comentário e
// resposta médios (inclusive as respostas rápidas) ficavam sem como ler o fim.
import type { AdminReview } from "@/hooks/useReviews";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("framer-motion", async (importOriginal) => {
  const modulo = await importOriginal<typeof import("framer-motion")>();
  return {
    ...modulo,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});

const h = vi.hoisted(() => ({
  avaliacoes: [] as AdminReview[],
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: h.avaliacoes,
    loading: false,
    getAllReviews: vi.fn().mockResolvedValue({ reviews: [], total: 1 }),
    addMerchantReply: vi.fn(),
    subscribeToReviews: () => () => {},
    deleteReview: vi.fn(),
    aprovarReview: vi.fn(),
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => ({ count: 0, error: null }),
      }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let raiz: Root;
let host: HTMLDivElement;

function avaliacao(comment: string, merchantReply?: string): AdminReview {
  return {
    id: "a",
    productId: "p",
    userId: "u",
    customerName: "Ana",
    productName: "Produto",
    rating: 5,
    comment,
    verified: true,
    status: "publicada",
    helpful: 0,
    createdAt: "2026-10-01T12:00:00Z",
    merchantReply,
  };
}

beforeEach(() => {
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
  vi.stubGlobal("ResizeObserver", Observador);
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montarCompacto() {
  localStorage.setItem("admin_reviews_view_mode", JSON.stringify("compact"));
  const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
  await act(async () => {
    raiz.render(<AdminReviewsView active onNavigate={vi.fn()} />);
  });
}
function verMais() {
  return host.querySelector<HTMLButtonElement>(
    'button[aria-label^="Ver mais da avaliação de"]',
  );
}

it("comentário de uns 150 caracteres ganha o botão Ver mais", async () => {
  h.avaliacoes = [avaliacao("Gostei muito do produto. ".repeat(6).trim())];
  await montarCompacto();
  expect(verMais()).not.toBeNull();
});

it("resposta da loja de uns 110 caracteres ganha o botão Ver mais", async () => {
  const resposta =
    "Obrigada pelo carinho! Ficamos muito felizes que gostou, volte sempre que precisar de algo novo por aqui.";
  expect(resposta.length).toBeGreaterThan(100);
  h.avaliacoes = [avaliacao("Gostei", resposta)];
  await montarCompacto();
  expect(verMais()).not.toBeNull();
});

it("comentário e resposta curtos não ganham botão sem necessidade", async () => {
  h.avaliacoes = [
    avaliacao("Gostei muito, chegou rápido.", "Obrigada, Ana! Volte sempre."),
  ];
  await montarCompacto();
  expect(verMais()).toBeNull();
});
