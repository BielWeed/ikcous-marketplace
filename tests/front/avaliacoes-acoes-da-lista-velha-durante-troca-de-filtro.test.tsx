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
  return {
    rpc: vi.fn(),
    publicar: vi.fn(),
    gravarCache: vi.fn(),
    usuario: { id: "admin" },
  };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({
      update: h.publicar,
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
  lerGeracaoDosCachesDeAdmin: () => 0,
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
const lista = {
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
        merchant_reply: "Obrigada!",
        status: "pendente",
        created_at: "2026-10-01T12:00:00Z",
      },
    ],
    total_count: 50,
    global_total_count: 50,
  },
  error: null,
};

async function filtrarSemResposta() {
  const filtro = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Filtrar por situação"] button',
    ),
  ].find((botao) => botao.textContent?.startsWith("Sem resposta"));
  expect(filtro).not.toBeNull();
  await act(async () => filtro?.click());
}

it("responder e excluir ficam desabilitados na avaliação do filtro anterior", async () => {
  let responder!: (resposta: typeof lista) => void;
  const pendente = new Promise<typeof lista>((resolve) => {
    responder = resolve;
  });
  h.rpc.mockResolvedValueOnce(lista).mockReturnValueOnce(pendente);
  await montar();
  const editar = () =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Editar resposta a Ana"]',
    );
  const excluir = () =>
    host.querySelector<HTMLButtonElement>(
      'button[aria-label="Excluir avaliação de Ana"]',
    );
  const aprovar = () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Aprovar e Publicar"]');
  expect(aprovar()?.disabled).toBe(false);
  expect(editar()?.disabled).toBe(false);
  expect(excluir()?.disabled).toBe(false);

  const anuncio = () => host.querySelector('[aria-live="polite"]');
  const regiao = anuncio();
  expect(regiao?.textContent).toBe("");

  await filtrarSemResposta();
  expect(h.rpc).toHaveBeenLastCalledWith(
    "get_admin_reviews_paged",
    expect.objectContaining({ p_status: "sem_resposta" }),
  );
  await act(async () => aprovar()?.click());
  expect.soft(h.publicar).not.toHaveBeenCalled();
  expect(aprovar()?.disabled).toBe(true);
  expect(editar()?.disabled).toBe(true);
  expect(excluir()?.disabled).toBe(true);
  expect(anuncio()).toBe(regiao);
  expect(regiao?.textContent).toBe("Atualizando a lista…");

  await act(async () => responder(lista));
  expect(anuncio()).toBe(regiao);
  expect(regiao?.textContent).toBe("");
});
