// @vitest-environment jsdom
//
// Prova forte da lista de Clientes do painel (25/11/2026, caça por mutação).
// Defeitos de uma linha plantados na tela que os testes vizinhos deixavam
// passar; cada teste abaixo derruba um deles:
//   - voltar a conexão relê a página ATUAL e avisa;
//   - "Tentar de novo" relê a página ATUAL (não a primeira) e o toast de falha
//     tem a frase da casa;
//   - mudar o cargo sem resposta da rede relê a página ATUAL;
//   - os dois botões da barra levam a admin-qa e admin-push;
//   - o aviso "mostrando a última atualização" só aparece com falha.
// Só fixtures inventadas; datas e tempo sob relógio falso.
import { act } from "react";
import * as React from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { View } from "@/types";
import { type Customer, limparCachesDeAdmin } from "@/utils/admin_cache";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  definirCargo: vi.fn(),
  offline: false,
  ouvintes: new Set<(v: boolean) => void>(),
  analytics: { stats: null as unknown, error: null as unknown },
  resumo: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, args: unknown) =>
      nome === "get_admin_customers_paged"
        ? h.rpc(nome, args)
        : h.definirCargo(nome, args),
    from: () => ({
      select: () => {
        const resposta = Promise.resolve({ data: [], error: null });
        return Object.assign(resposta, {
          in: () => resposta,
          eq: () => resposta,
          order: () => resposta,
          maybeSingle: () =>
            Promise.resolve({ data: { user_id: "dono-1" }, error: null }),
        });
      },
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "dono-1" } }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => {
    const [valor, definir] = React.useState(h.offline);
    React.useEffect(() => {
      h.ouvintes.add(definir);
      return () => {
        h.ouvintes.delete(definir);
      };
    }, []);
    // O hook real devolve `isOffline`: true = sem conexão.
    return valor;
  },
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: h.analytics.stats,
    error: h.analytics.error,
    fetchExecutiveSummary: h.resumo,
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function cliente(id: string, nome: string, role = "customer"): Customer {
  return {
    id,
    full_name: nome,
    email: `${id}@fixture.invalid`,
    phone: null,
    role,
    created_at: "2026-10-01T12:00:00Z",
    orders_count: 1,
    total_spent: 50,
  };
}

function resposta(total: number, nomes: string[]) {
  return {
    data: {
      data: nomes.map((nome, i) => cliente(`cli-${i}-${nome}`, nome)),
      total_count: total,
      stats: {
        total_customers: total,
        global_ltv: 1200,
        global_orders: 24,
        new_customers_30d: 0,
      },
    },
    error: null,
  };
}

let AdminCustomersView: typeof TipoClientes;
let limparDonoDaLoja: () => void;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
  ({ limparDonoDaLoja } = await import("@/hooks/useDonoDaLoja"));
}, 60_000);

describe("Clientes — prova forte da tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: Mock<(view: View, id?: string) => void>;

  beforeEach(() => {
    h.rpc.mockReset();
    h.definirCargo.mockReset();
    h.resumo.mockReset();
    for (const f of Object.values(h.toast)) f.mockReset();
    h.offline = false;
    h.ouvintes.clear();
    h.analytics.stats = null;
    h.analytics.error = null;
    limparCachesDeAdmin();
    limparDonoDaLoja();
    onNavigate = vi.fn<(view: View, id?: string) => void>();
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) =>
        chave === "admin_customers_view_mode" ? "compact" : null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    limparCachesDeAdmin();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={onNavigate} />);
    });
    await avancar(320);
  }

  async function mudarConexao(offline: boolean) {
    h.offline = offline;
    await act(async () => {
      for (const ouvinte of h.ouvintes) ouvinte(offline);
    });
    await avancar(0);
  }

  function botaoPorTexto(texto: string): HTMLButtonElement {
    const achado = [...document.body.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes(texto),
    );
    if (!achado) throw new Error(`Botão "${texto}" não está na tela`);
    return achado;
  }

  async function irParaProximaPagina() {
    await act(async () => {
      botaoPorTexto("Próximo").click();
    });
    await avancar(320);
  }

  const ultimosArgs = () => h.rpc.mock.calls.at(-1)?.[1];

  it("os dois botões da barra levam a Perguntas e avaliações (admin-qa) e a Avisar clientes (admin-push)", async () => {
    h.rpc.mockResolvedValue(resposta(1, ["Paulo Lima"]));
    await montar();
    const barra = document.body.querySelector(
      '[aria-label="Ações dos clientes"]',
    );
    expect(barra).not.toBeNull();

    await act(async () => {
      botaoPorTexto("Perguntas e avaliações").click();
    });
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(["admin-qa"]);

    await act(async () => {
      botaoPorTexto("Avisar clientes").click();
    });
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual([
      "admin-qa",
      "admin-push",
    ]);
  });

  it("a conexão voltou na página 2: avisa e relê ESSA página, uma vez", async () => {
    h.rpc.mockResolvedValue(resposta(30, ["Paulo Lima"]));
    await montar();
    await irParaProximaPagina();
    expect(ultimosArgs()).toMatchObject({ p_page: 1 });
    await mudarConexao(true);
    const leiturasAntes = h.rpc.mock.calls.length;
    expect(h.toast.success).not.toHaveBeenCalled();

    await mudarConexao(false);

    expect(h.toast.success).toHaveBeenCalledTimes(1);
    expect(h.toast.success).toHaveBeenCalledWith(
      "Conexão restabelecida. Atualizando clientes...",
      { icon: "⚡" },
    );
    expect(h.rpc.mock.calls.length).toBe(leiturasAntes + 1);
    expect(ultimosArgs()).toMatchObject({
      p_page: 1,
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });
  });

  it("sem ter ficado offline, a tela não avisa 'Conexão restabelecida' nem relê além da carga", async () => {
    h.rpc.mockResolvedValue(resposta(1, ["Paulo Lima"]));
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.toast.success).not.toHaveBeenCalled();
  });

  it("a leitura da página 2 falha: o toast é o da casa e 'Tentar de novo' relê a página 2, não a 1", async () => {
    h.rpc.mockResolvedValueOnce(resposta(30, ["Paulo Lima"]));
    await montar();
    h.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "falha de rede" },
    });
    await irParaProximaPagina();

    expect(h.toast.error).toHaveBeenCalledTimes(1);
    expect(h.toast.error).toHaveBeenCalledWith("Erro ao carregar clientes");
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain(
      "Não conseguimos carregar os clientes agora.",
    );

    h.rpc.mockResolvedValue(resposta(30, ["Rita Gomes"]));
    const leiturasAntes = h.rpc.mock.calls.length;
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[aria-label="Tentar carregar os clientes de novo"]',
        )
        ?.click();
    });
    await avancar(0);

    expect(h.rpc.mock.calls.length).toBe(leiturasAntes + 1);
    expect(ultimosArgs()).toMatchObject({ p_page: 1 });
    expect(hospedeiro.textContent).toContain("Rita Gomes");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("aviso 'Mostrando a última atualização': aparece só quando o resumo guardado falhou ao atualizar", async () => {
    h.rpc.mockResolvedValue(resposta(1, ["Paulo Lima"]));
    h.analytics.stats = { executive: { totalOrders: 3, avgTicket: 10 } };
    h.analytics.error = null;
    await montar();
    expect(hospedeiro.textContent).not.toContain(
      "Mostrando a última atualização",
    );

    h.analytics.error = "falhou";
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    expect(hospedeiro.textContent).toContain(
      "Não foi possível atualizar os pedidos e o valor médio por venda. Mostrando a última atualização.",
    );
  });

  it("mudar o cargo sem resposta da rede, na página 2, relê a página 2 com a mesma ordem", async () => {
    h.rpc.mockResolvedValue(resposta(30, ["Paulo Lima", "Rita Gomes"]));
    h.definirCargo.mockReturnValue(new Promise(() => {}));
    await montar();
    await irParaProximaPagina();
    expect(ultimosArgs()).toMatchObject({ p_page: 1 });

    await act(async () => {
      hospedeiro
        .querySelector<HTMLElement>(
          '[aria-label="Gestão de Cliente: Paulo Lima"]',
        )
        ?.click();
    });
    await avancar(5);
    await act(async () => {
      botaoPorTexto("Tornar administrador").click();
    });
    await avancar(5);
    const leiturasAntes = h.rpc.mock.calls.length;
    await act(async () => {
      botaoPorTexto("Dar acesso de administrador").click();
    });
    await avancar(21_000);

    expect(h.toast.error).toHaveBeenCalledWith(
      "Sem resposta da rede. Confira se o acesso mudou na lista antes de tentar de novo.",
    );
    expect(h.rpc.mock.calls.length).toBe(leiturasAntes + 1);
    expect(ultimosArgs()).toMatchObject({
      p_page: 1,
      p_sort_field: "total_spent",
      p_sort_direction: "desc",
    });
  });
});
