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
  const canal = new EventTarget();
  return {
    rpc: vi.fn(),
    gravarCache: vi.fn(),
    usuario: { id: "admin" },
    offline: false,
    canal,
  };
});
vi.mock("@/lib/canal-de-abas", () => ({
  criarCanalDeAbas: (nome: string) =>
    nome === "ikcous_reviews_sync" ? h.canal : null,
}));
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
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
beforeEach(() => {
  h.offline = false;
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

const qa = vi.hoisted(() => ({
  erro: null as string | null,
  ler: vi.fn(),
  stats: async () => ({
    status: "ok",
    total: 50,
    pending: 3,
    answered: 47,
    rate: 94,
  }),
  assinar: () => () => {},
}));
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    erroDaListagemAdmin: qa.erro,
    getAllQuestions: qa.ler,
    getQAStats: qa.stats,
    subscribeToQuestions: qa.assinar,
  }),
}));

const paginas = () => host.querySelector('nav[aria-label="Páginas"]');

it("Avaliações esconde as páginas antigas enquanto carrega e após falhar", async () => {
  let falhar!: () => void;
  const pendente = new Promise((resolve) => {
    falhar = () => resolve({ data: null, error: { message: "falha interna" } });
  });
  h.rpc.mockResolvedValueOnce(lista).mockReturnValue(pendente);
  await montar();
  expect(paginas()).not.toBeNull();

  await filtrarSemResposta();
  expect.soft(paginas()).toBeNull();

  await act(async () => falhar());
  expect(host.textContent).toContain("Tentar de novo");
  expect(paginas()).toBeNull();
});

it("falha da releitura de outro aparelho não libera a lista do filtro anterior", async () => {
  const falha = { data: null, error: { message: "falha interna" } };
  const lerFiltroNovo = new Promise(() => {});
  const novaLista = {
    ...lista,
    data: {
      ...lista.data,
      data: [{ ...lista.data.data[0], merchant_reply: null }],
    },
  };
  h.rpc
    .mockResolvedValueOnce(lista)
    .mockReturnValueOnce(lerFiltroNovo)
    .mockResolvedValueOnce(falha)
    .mockResolvedValueOnce(novaLista);

  await montar();
  await filtrarSemResposta();
  await act(async () => {
    h.canal.dispatchEvent(
      new MessageEvent("message", { data: { type: "reviews_change" } }),
    );
  });
  expect(h.rpc).toHaveBeenCalledTimes(3);
  expect(paginas()).toBeNull();
  expect(host.textContent).not.toContain("Obrigada!");
  const tentar = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (botao) => botao.textContent?.trim() === "Tentar de novo",
  );
  expect(tentar).toBeDefined();
  await act(async () => tentar?.click());
  expect(paginas()).not.toBeNull();
  expect(
    host.querySelector<HTMLButtonElement>('[aria-label="Responder a Ana"]')
      ?.disabled,
  ).toBe(false);
});

it("voltar ao filtro A não valida a lista antiga de A se a releitura falhar", async () => {
  const pendente = new Promise(() => {});
  const falha = { data: null, error: { message: "falha interna" } };
  const acoes = () =>
    host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Editar resposta"], button[aria-label^="Excluir avaliação"]',
    );
  h.rpc
    .mockResolvedValueOnce(lista)
    .mockReturnValueOnce(pendente)
    .mockReturnValueOnce(pendente)
    .mockResolvedValueOnce(falha);

  await montar();
  expect(paginas()).not.toBeNull();
  expect(Array.from(acoes(), (botao) => botao.disabled)).toEqual([
    false,
    false,
  ]);

  await filtrarSemResposta();
  const todas = [
    ...host.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Filtrar por situação"] button',
    ),
  ].find((botao) => botao.textContent?.trim() === "Todas");
  expect(todas).toBeDefined();
  await act(async () => todas?.click());
  expect(h.rpc).toHaveBeenCalledTimes(3);
  expect(paginas()).toBeNull();

  await act(async () => {
    h.canal.dispatchEvent(
      new MessageEvent("message", { data: { type: "reviews_change" } }),
    );
  });
  expect(h.rpc).toHaveBeenCalledTimes(4);
  expect
    .soft(host.querySelector('[role="alert"]')?.textContent ?? "")
    .toContain("Tentar de novo");
  expect.soft(paginas()).toBeNull();
  expect(Array.from(acoes()).every((botao) => botao.disabled)).toBe(true);
});

it("Seguinte recupera o foco depois da leitura da próxima página", async () => {
  let responder!: (resultado: typeof lista) => void;
  const pendente = new Promise<typeof lista>((resolve) => {
    responder = resolve;
  });
  h.rpc.mockResolvedValueOnce(lista).mockReturnValueOnce(pendente);
  await montar();
  const main = host.querySelector("main");
  if (main) main.scrollTo = vi.fn();
  function seguinte() {
    return [...(paginas()?.querySelectorAll("button") ?? [])].find(
      (botao) => botao.textContent?.trim() === "Seguinte",
    );
  }
  const origem = seguinte();
  expect(origem?.disabled).toBe(false);
  origem?.focus();
  expect(document.activeElement).toBe(origem);

  // O navegador traduz Enter sobre o botão focado num clique nativo.
  await act(async () => origem?.click());
  expect(h.rpc).toHaveBeenLastCalledWith(
    "get_admin_reviews_paged",
    expect.objectContaining({ p_page: 1 }),
  );
  await act(async () => responder(lista));
  expect(seguinte()).toBeDefined();
  expect(document.activeElement).toBe(seguinte());
});

it("Seguinte mantém o foco na recarga automática ao voltar a conexão", async () => {
  let responder!: (resultado: typeof lista) => void;
  const pendente = new Promise<typeof lista>((resolve) => {
    responder = resolve;
  });
  h.rpc.mockResolvedValueOnce(lista).mockReturnValueOnce(pendente);
  await montar();
  const seguinte = () =>
    paginas()?.querySelector<HTMLButtonElement>("button:last-child");
  const origem = seguinte();
  expect(origem?.disabled).toBe(false);
  origem?.focus();

  h.offline = true;
  await montar();
  expect(document.activeElement).toBe(origem);
  h.offline = false;
  await montar();
  expect(h.rpc).toHaveBeenCalledTimes(2);
  const durante = seguinte();
  const bloqueado = durante?.getAttribute("aria-disabled");
  await act(async () => durante?.click());
  expect(h.rpc).toHaveBeenCalledTimes(2);

  await act(async () => responder(lista));
  expect(seguinte()?.disabled).toBe(false);
  expect(document.activeElement === seguinte()).toBe(true);
  expect(seguinte()).toBe(durante);
  expect(bloqueado).toBe("true");
});

it("Perguntas esconde as páginas antigas quando o novo filtro falha", async () => {
  qa.ler
    .mockResolvedValueOnce({ questions: [], total: 50 })
    .mockImplementation(async () => {
      qa.erro = "Não foi possível carregar as perguntas.";
      return { questions: [], total: 0, falhou: true };
    });
  const { AdminQAView } = await import("@/views/admin/AdminQAView");
  const onNavigate = vi.fn();
  const tela = () => <AdminQAView active onNavigate={onNavigate} />;
  await act(async () => raiz.render(tela()));
  expect(paginas()).not.toBeNull();

  // Alterna de fato o filtro, e renderiza o novo erro do hook dublado.
  const filtro = host.querySelector<HTMLButtonElement>(
    '[aria-label="Filtrar perguntas"] button[aria-pressed="false"]',
  );
  expect(filtro).not.toBeNull();
  await act(async () => filtro?.click());
  await act(async () =>
    raiz.render(<AdminQAView active onNavigate={vi.fn()} />),
  );
  expect(qa.ler).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("Não foi possível carregar as perguntas.");
  expect(paginas()).toBeNull();
});
