// @vitest-environment jsdom
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
  return { rpc: vi.fn(), gravarCache: vi.fn(), usuario: { id: "admin" } };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({
      select: () => ({
        eq: async () => ({ count: 0, error: null }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuario, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: h.gravarCache,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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
beforeEach(() => {
  h.rpc.mockReset();
  h.gravarCache.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function montar() {
  const { AdminReviewsView } = await import("@/views/admin/AdminReviewsView");
  await act(async () => {
    raiz.render(<AdminReviewsView active onNavigate={vi.fn()} />);
  });
}
function tentarDeNovo() {
  const botao = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Tentar de novo",
  );
  if (!botao) throw new Error("Tentativa de recarga ausente");
  return botao;
}
const vazia = {
  data: { data: [], total_count: 0, global_total_count: 0 },
  error: null,
};
const falha = { data: null, error: { message: "falha interna" } };

it("erro inicial não anuncia loja vazia e a nova tentativa recupera a leitura", async () => {
  h.rpc.mockResolvedValueOnce(falha).mockResolvedValue(vazia);
  await montar();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Sem Feedback Ainda");
  expect(host.textContent).not.toContain("falha interna");
  await act(async () => {
    tentarDeNovo().click();
  });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Sem Feedback Ainda");
});

it("falha posterior avisa e tira a lista e o cache da leitura anterior (contrato B2)", async () => {
  h.rpc
    .mockResolvedValueOnce({
      data: {
        data: [
          {
            id: "a",
            product_id: "p",
            user_id: "u",
            user: { full_name: "Ana" },
            product: { nome: "Produto" },
            rating: 5,
            comment: "Gostei do produto",
            created_at: "2026-10-01T12:00:00Z",
          },
        ],
        total_count: 1,
        global_total_count: 1,
      },
      error: null,
    })
    .mockResolvedValue(falha);
  await montar();
  expect(host.textContent).toContain("Gostei do produto");
  const filtro = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (botao) => botao.textContent?.trim() === "4",
  );
  await act(async () => {
    filtro!.click();
  });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Gostei do produto");
  expect(host.textContent).not.toContain("Sem Feedback Ainda");
  expect(h.gravarCache).toHaveBeenLastCalledWith([]);
  await act(async () => {
    tentarDeNovo().click();
  });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Gostei do produto");
  expect(host.textContent).not.toContain("Sem Feedback Ainda");
});
