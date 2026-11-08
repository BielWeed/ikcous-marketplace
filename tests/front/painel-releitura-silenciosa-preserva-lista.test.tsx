import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";
import {
  cachedQuestionsData,
  cachedReviewsData,
  limparCachesDeAdmin,
} from "@/utils/admin_cache";
// @vitest-environment jsdom
import { AdminQAView } from "@/views/admin/AdminQAView";
import { AdminReviewsView } from "@/views/admin/AdminReviewsView";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: vi.fn(),
  user: { id: "admin-ficticio" },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      const promessa = h.rpc(...args);
      return Object.assign(promessa, { abortSignal: () => promessa });
    },
    from: () => ({
      select: () =>
        Object.assign(Promise.resolve({ count: 1, error: null }), {
          eq: async () => ({ count: 1, error: null }),
        }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { error: h.toast, success: vi.fn() } }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, undefined],
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let perguntas: ReturnType<typeof useQuestions>;
let avaliacoes: ReturnType<typeof useReviews>;
function Sonda() {
  const q = useQuestions();
  const r = useReviews();
  useEffect(() => {
    perguntas = q;
    avaliacoes = r;
  });
  return null;
}
const linha = {
  id: "linha-ficticia",
  product_id: "produto-ficticio",
  user_id: "pessoa-ficticia",
  question: "Tem outra cor?",
  comment: "Gostei",
  rating: 5,
  answers: [],
  created_at: "2026-11-07T12:00:00Z",
  user: { full_name: "Pessoa fictícia" },
  product: { nome: "Produto fictício" },
};
beforeEach(async () => {
  limparCachesDeAdmin();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  h.toast.mockClear();
  h.rpc.mockReset().mockResolvedValue({
    data: { data: [linha], total_count: 1 },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Sonda />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  limparCachesDeAdmin();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

for (const tipo of ["avaliações", "perguntas"] as const) {
  it(`${tipo}: rascunho digitado sobrevive à releitura silenciosa real`, async () => {
    const View = tipo === "avaliações" ? AdminReviewsView : AdminQAView;
    await act(async () => root.render(<View active onNavigate={() => {}} />));
    const responder = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Responder",
    );
    expect(responder).toBeTruthy();
    await act(async () => responder?.click());
    const editor = document.body.querySelector("textarea");
    expect(editor).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(editor, "Resposta ainda não enviada");
      editor?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const leituras = h.rpc.mock.calls.length;
    vi.setSystemTime(Date.now() + 31_000);
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(h.rpc).toHaveBeenCalledTimes(leituras + 1);
    expect(document.body.querySelector("textarea")?.value).toBe(
      "Resposta ainda não enviada",
    );
  });

  async function carregar(silent: boolean) {
    await act(async () => {
      if (tipo === "avaliações")
        await avaliacoes.getAllReviews(0, 10, { silent });
      else await perguntas.getAllQuestions(0, 10, "all", "", silent);
    });
  }
  const lista = () =>
    tipo === "avaliações" ? avaliacoes.adminReviews : perguntas.questions;
  const cache = () =>
    tipo === "avaliações" ? cachedReviewsData : cachedQuestionsData;
  it(`${tipo}: falha silenciosa conserva lista e cache, sem aviso flutuante`, async () => {
    await carregar(false);
    const anterior = lista();
    const copia = cache();
    expect(anterior).toHaveLength(1);
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "falha simulada" },
    });
    await carregar(true);
    expect(lista()).toEqual(anterior);
    expect(cache()).toEqual(copia);
    expect(h.toast).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
  it(`${tipo}: falha não silenciosa continua retirando o retrato de outro filtro`, async () => {
    await carregar(false);
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "falha simulada" },
    });
    await carregar(false);
    expect(lista()).toEqual([]);
    expect(cache() ?? []).toEqual([]);
    expect(h.toast).toHaveBeenCalled();
  });
}
