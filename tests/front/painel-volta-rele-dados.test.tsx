// @vitest-environment jsdom
import { useCrmVisao, useDashboardClassico } from "@/hooks/useCrm";
import { AdminQAView } from "@/views/admin/AdminQAView";
import { AdminReviewsView } from "@/views/admin/AdminReviewsView";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  reviews: vi.fn(),
  questions: vi.fn(),
  stats: vi.fn(),
  summary: vi.fn(),
  categories: vi.fn(),
  count: vi.fn(),
  aoEvento: null as null | (() => void),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "ficticio" } } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: {},
    categoryData: [],
    fetchExecutiveSummary: h.summary,
    fetchCategoryAnalytics: h.categories,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({ select: () => ({ eq: h.count }) }),
  },
}));
const assinar = () => () => {};
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    adminReviews: [],
    loading: false,
    getAllReviews: h.reviews,
    subscribeToReviews: assinar,
  }),
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    getAllQuestions: h.questions,
    subscribeToQuestions: (callback: () => void) => {
      h.aoEvento = callback;
      return () => {};
    },
    getQAStats: h.stats,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true } }),
}));
vi.mock("embla-carousel-react", () => ({
  default: () => [() => {}, undefined],
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let visivel = true;
let periodo = 0;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  visivel = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    visivel ? "visible" : "hidden",
  );
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
  for (const mock of Object.values(h))
    if (typeof mock === "function" && "mockReset" in mock) mock.mockReset();
  h.aoEvento = null;
  h.rpc.mockResolvedValue({
    data: {
      kpis: { pedidos: 3 },
      pipeline: [],
      segmentos: [],
      canais: [],
      formas: [],
    },
    error: null,
  });
  h.reviews.mockResolvedValue({ reviews: [], total: 0 });
  h.questions.mockResolvedValue({ questions: [], total: 0 });
  h.stats.mockResolvedValue({
    status: "ok",
    total: 0,
    pending: 0,
    answered: 0,
    rate: 0,
  });
  h.summary.mockResolvedValue(null);
  h.categories.mockResolvedValue([]);
  h.count.mockResolvedValue({ count: 0, error: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function voltar() {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

it.each(["focus", "pageshow"])(
  "CRM também relê por %s sozinho e agrupa os demais eventos",
  async (evento) => {
    const intervalo = { inicio: `2026-08-${++periodo}`, fim: "2026-11-07" };
    function Sonda() {
      useCrmVisao(intervalo, true);
      return null;
    }
    await act(async () => root.render(<Sonda />));
    await avancar(300);
    await avancar(31_000);
    await act(async () => window.dispatchEvent(new Event(evento)));
    await avancar(300);
    expect(h.rpc).toHaveBeenCalledTimes(2);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
    });
    await avancar(300);
    expect(h.rpc).toHaveBeenCalledTimes(2);
  },
);

it("CRM mantém retrato, relê velho e não duplica leitura pendente ou fresca", async () => {
  const intervalo = { inicio: `2026-10-${++periodo}`, fim: "2026-11-07" };
  let atualizarDaSonda = null as (() => void) | null;
  function Sonda({ aoLer }: { aoLer: (atualizar: () => void) => void }) {
    const { visao, carregando, atualizar } = useCrmVisao(intervalo, true);
    useEffect(() => {
      aoLer(atualizar);
    }, [aoLer, atualizar]);
    return (
      <p>
        {visao?.kpis.pedidos ?? "sem dado"} {carregando ? "esqueleto" : ""}
      </p>
    );
  }
  const aoLer = (atualizar: () => void) => {
    atualizarDaSonda = atualizar;
  };
  await act(async () => root.render(<Sonda aoLer={aoLer} />));
  await avancar(300);
  expect(host.textContent).toContain("3");
  await voltar();
  await avancar(300);
  expect(h.rpc).toHaveBeenCalledTimes(1);
  await avancar(30_000);
  const leitura = pendente<{ data: unknown; error: null }>();
  h.rpc.mockReturnValueOnce(leitura.promessa);
  await voltar();
  await avancar(300);
  expect(h.rpc).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("3");
  expect(host.textContent).not.toContain("esqueleto");
  await act(async () =>
    leitura.resolver({ data: { kpis: { pedidos: 7 } }, error: null }),
  );
  expect(host.textContent).toContain("7");

  // Leitura pendente aberta por "Sincronizar" (que nao passa pelo intervalo de 30 s
  // entre voltas): so o `podeReler` (nenhuma consulta em voo) impede que voltar ao
  // app abra uma segunda leitura enquanto ela esta dentro do prazo de 20 s.
  await avancar(31_000);
  const sincronizando = pendente<{ data: unknown; error: null }>();
  h.rpc.mockReturnValueOnce(sincronizando.promessa);
  await act(async () => atualizarDaSonda?.());
  await avancar(300);
  expect(h.rpc).toHaveBeenCalledTimes(3);
  await avancar(10_000);
  await voltar();
  await avancar(300);
  expect(h.rpc).toHaveBeenCalledTimes(3);
  await act(async () =>
    sincronizando.resolver({ data: { kpis: { pedidos: 9 } }, error: null }),
  );
  expect(host.textContent).toContain("9");
});

it("dashboard clássico relê ao restaurar sem esconder números e respeita aba inativa", async () => {
  function Sonda({ active }: { active: boolean }) {
    const { carregando } = useDashboardClassico(active);
    return <p>{carregando ? "esqueleto" : "números"}</p>;
  }
  await act(async () => root.render(<Sonda active />));
  await avancar(400);
  await avancar(31_000);
  await voltar();
  expect(h.summary).toHaveBeenCalledTimes(2);
  expect(host.textContent).toBe("números");
  await voltar();
  expect(h.summary).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<Sonda active={false} />));
  await avancar(31_000);
  await voltar();
  expect(h.summary).toHaveBeenCalledTimes(2);
});

it("resposta antiga das estatísticas não apaga a contagem mais recente", async () => {
  await act(async () =>
    root.render(<AdminQAView active onNavigate={() => {}} />),
  );
  await avancar(31_000);
  const velha = pendente<{
    status: "ok";
    total: number;
    pending: number;
    answered: number;
    rate: number;
  }>();
  h.stats.mockReturnValueOnce(velha.promessa);
  await voltar();
  h.stats.mockResolvedValue({
    status: "ok",
    total: 7,
    pending: 7,
    answered: 0,
    rate: 0,
  });
  await act(async () => h.aoEvento?.());
  expect(host.textContent).toContain("Pendentes 7");
  await act(async () =>
    velha.resolver({
      status: "ok",
      total: 2,
      pending: 2,
      answered: 0,
      rate: 0,
    }),
  );
  expect(host.textContent).toContain("Pendentes 7");
});

it("CRM guarda a resposta tardia no período dela, sem desenhá-la no período atual", async () => {
  const a = { inicio: `2026-07-${++periodo}`, fim: "2026-11-07" };
  const b = { inicio: `2026-06-${++periodo}`, fim: "2026-11-07" };
  function Sonda({ intervalo }: { intervalo: typeof a }) {
    const estado = useCrmVisao(intervalo, true);
    return <p>{estado.visao?.kpis.pedidos}</p>;
  }
  const primeira = pendente<{ data: unknown; error: null }>();
  h.rpc.mockReturnValueOnce(primeira.promessa);
  await act(async () => root.render(<Sonda intervalo={a} />));
  await avancar(300);
  h.rpc.mockResolvedValue({ data: { kpis: { pedidos: 7 } }, error: null });
  await act(async () => root.render(<Sonda intervalo={b} />));
  await avancar(300);
  await act(async () =>
    primeira.resolver({ data: { kpis: { pedidos: 3 } }, error: null }),
  );
  expect(host.textContent).toBe("7");
  await act(async () => root.render(<Sonda intervalo={a} />));
  expect(host.textContent).toBe("3");
  await avancar(300);
  expect(h.rpc).toHaveBeenCalledTimes(2);
});

it("CRM descarta resposta superada também no cache", async () => {
  const intervalo = { inicio: `2026-09-${++periodo}`, fim: "2026-11-07" };
  function Sonda() {
    const estado = useCrmVisao(intervalo, true);
    return (
      <button type="button" onClick={estado.atualizar}>
        {estado.visao?.kpis.pedidos}
      </button>
    );
  }
  await act(async () => root.render(<Sonda />));
  await avancar(300);
  const velha = pendente<{ data: unknown; error: null }>();
  h.rpc.mockReturnValueOnce(velha.promessa);
  await avancar(31_000);
  await voltar();
  await avancar(300);
  h.rpc.mockResolvedValue({ data: { kpis: { pedidos: 7 } }, error: null });
  await act(async () => host.querySelector("button")?.click());
  await avancar(300);
  expect(host.textContent).toBe("7");
  await act(async () =>
    velha.resolver({ data: { kpis: { pedidos: 2 } }, error: null }),
  );
  expect(host.textContent).toBe("7");
  // Uma nova rodada lê o cache fresco, não o resultado da chamada superada.
  await avancar(31_000);
  h.rpc.mockReturnValueOnce(new Promise(() => {}));
  await voltar();
  expect(host.textContent).toBe("7");
});

for (const tipo of ["avaliações", "perguntas"] as const) {
  it(`${tipo}: volta silenciosa, sem rajada nem leituras simultâneas`, async () => {
    const View = tipo === "avaliações" ? AdminReviewsView : AdminQAView;
    const ler = tipo === "avaliações" ? h.reviews : h.questions;
    await act(async () => root.render(<View active onNavigate={() => {}} />));
    expect(ler).toHaveBeenCalledTimes(1);
    await voltar();
    expect(ler).toHaveBeenCalledTimes(1);
    await avancar(31_000);
    const leitura = pendente<{ total: number }>();
    ler.mockReturnValueOnce(leitura.promessa);
    await voltar();
    expect(ler).toHaveBeenCalledTimes(2);
    if (tipo === "avaliações")
      expect(ler.mock.calls[1][2]).toMatchObject({ silent: true });
    else expect(ler.mock.calls[1][4]).toBe(true);
    await avancar(31_000);
    await voltar();
    expect(ler).toHaveBeenCalledTimes(2);
    await act(async () => leitura.resolver({ total: 0 }));
    await avancar(31_000);
    visivel = false;
    await voltar();
    expect(ler).toHaveBeenCalledTimes(2);
    visivel = true;
    await voltar();
    expect(ler).toHaveBeenCalledTimes(3);
    if (tipo === "perguntas") expect(h.stats).toHaveBeenCalledTimes(3);
    else expect(h.count).toHaveBeenCalledTimes(3);
    await act(async () =>
      root.render(<View active={false} onNavigate={() => {}} />),
    );
    await avancar(31_000);
    await voltar();
    expect(ler).toHaveBeenCalledTimes(3);
  });
}
