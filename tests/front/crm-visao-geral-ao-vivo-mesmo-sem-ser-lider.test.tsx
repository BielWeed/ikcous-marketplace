// @vitest-environment jsdom
//
// Defeito (irmão de `painel-perguntas-e-avaliacoes-ao-vivo-mesmo-sem-ser-lider`):
// a "Visão geral" do CRM só abria os canais de tempo real na aba LÍDER, e a
// liderança é fixa por aba. Com a vitrine aberta primeiro (líder) e o painel em
// outra aba, os números só se atualizavam ao voltar o foco. Quem abre a Visão
// geral é sempre o painel (admin): a aba visível assina os próprios canais,
// mesmo seguidora — como as bolinhas do `AdminLayout`. Aba escondida fecha.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type CanalRegistrado = {
  nome: string;
  vivo: boolean;
  tabelas: string[];
  handlers: Array<() => void>;
};

const h = vi.hoisted(() => ({
  lider: false,
  isAdmin: true,
  session: { user: { id: "admin-1" } } as { user: { id: string } } | null,
  canais: [] as Array<{
    nome: string;
    vivo: boolean;
    tabelas: string[];
    handlers: Array<() => void>;
  }>,
  ouvintesDoCanalEntreAbas: 0,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.session,
    user: h.session?.user ?? null,
    isAdmin: h.isAdmin,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: h.lider }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: vi.fn(),
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn().mockResolvedValue(undefined),
    fetchCategoryAnalytics: vi.fn().mockResolvedValue(undefined),
    stats: null,
    categoryData: null,
    error: null,
    categoryError: null,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (nome: string) => {
      const reg: CanalRegistrado = {
        nome,
        vivo: true,
        tabelas: [],
        handlers: [],
      };
      h.canais.push(reg);
      const canal: any = {
        __reg: reg,
        on: (_tipo: string, filtro: { table: string }, handler: () => void) => {
          reg.tabelas.push(filtro.table);
          reg.handlers.push(handler);
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: (canal: any) => {
      if (canal?.__reg) canal.__reg.vivo = false;
      return Promise.resolve("ok");
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const vivos = () => h.canais.filter((c) => c.vivo);

let visibilidade: "visible" | "hidden" = "visible";

function definirVisibilidade(estado: "visible" | "hidden") {
  visibilidade = estado;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("Visão geral do CRM — tempo real sem depender da liderança", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atualizar: Mock<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    h.lider = false;
    h.isAdmin = true;
    h.session = { user: { id: "admin-1" } };
    h.canais.length = 0;
    h.ouvintesDoCanalEntreAbas = 0;
    visibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilidade,
    });
    // O canal entre abas conta quantas vezes alguém escuta o repasse da líder.
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        set onmessage(ouvinte: unknown) {
          if (ouvinte) h.ouvintesDoCanalEntreAbas += 1;
        }
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    atualizar = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function montar(ativo = true) {
    const { useDashboardClassico } = await import("@/hooks/useCrm");
    function Crm({ ativa }: { ativa: boolean }) {
      useDashboardClassico(ativa, atualizar);
      return null;
    }
    await act(async () => {
      raiz.render(<Crm ativa={ativo} />);
    });
    // Mesmo componente, mesma instância do hook: só renderiza de novo.
    return async (ativa: boolean) => {
      await act(async () => {
        raiz.render(<Crm ativa={ativa} />);
      });
    };
  }

  async function bancoAvisa() {
    await act(async () => {
      for (const canal of vivos()) for (const aviso of canal.handlers) aviso();
      await vi.advanceTimersByTimeAsync(1500);
    });
  }

  const TABELAS = ["marketplace_orders", "produtos", "reviews", "questions"];

  it("seguidora do PAINEL (admin, aba visível) abre os próprios canais e recarrega quando o banco avisa", async () => {
    await montar();

    expect(vivos()).toHaveLength(4);
    expect(vivos().flatMap((c) => c.tabelas)).toEqual(
      expect.arrayContaining([...TABELAS, "answers"]),
    );
    // Nomes próprios, nunca os da líder (que podem estar vivos na MESMA aba
    // quando ela vira líder e o canal velho ainda fecha).
    for (const canal of vivos()) {
      expect(canal.nome).toMatch(/^admin-dashboard-.+-painel$/);
    }
    // Não escuta também o repasse da líder.
    expect(h.ouvintesDoCanalEntreAbas).toBe(0);

    await bancoAvisa();

    // Vários avisos na mesma rajada viram UMA recarga (espera de 1,5 s).
    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: seguidora que NÃO é admin continua sem canal, ouvindo só a líder", async () => {
    h.isAdmin = false;

    await montar();

    expect(h.canais).toHaveLength(0);
    expect(h.ouvintesDoCanalEntreAbas).toBe(1);
  });

  it("CONTROLE: sem sessão não abre canal nenhum", async () => {
    h.session = null;
    h.isAdmin = false;

    await montar();

    expect(h.canais).toHaveLength(0);
  });

  it("LÍDER: os quatro canais de sempre, com os nomes de sempre — nenhum a mais", async () => {
    h.lider = true;

    await montar();

    expect(h.canais.map((c) => c.nome).sort()).toEqual([
      "admin-dashboard-orders",
      "admin-dashboard-products",
      "admin-dashboard-qa",
      "admin-dashboard-reviews",
    ]);
  });

  it("tela inativa (outra aba do painel aberta) não abre canal; ao ativar abre, ao desativar fecha", async () => {
    const definirAtiva = await montar(false);
    expect(h.canais).toHaveLength(0);

    await definirAtiva(true);
    expect(vivos()).toHaveLength(4);

    await definirAtiva(false);
    expect(vivos()).toHaveLength(0);
  });

  it("aba ESCONDIDA fecha os canais; ao voltar abre de novo (sem acumular)", async () => {
    await montar();
    expect(vivos()).toHaveLength(4);

    definirVisibilidade("hidden");
    expect(vivos()).toHaveLength(0);

    definirVisibilidade("visible");
    expect(vivos()).toHaveLength(4);
    expect(h.canais).toHaveLength(8);
  });

  it("ao VOLTAR a aba escondida relê uma vez (o que mudou sem canal não chegou por evento)", async () => {
    await montar();
    // Abrir a tela não relê: a tela acabou de ler.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(atualizar).toHaveBeenCalledTimes(0);

    definirVisibilidade("hidden");
    definirVisibilidade("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(atualizar).toHaveBeenCalledTimes(1);
  });

  it("desmontar a tela fecha os quatro canais", async () => {
    await montar();
    expect(vivos()).toHaveLength(4);

    await act(async () => raiz.render(null));

    expect(vivos()).toHaveLength(0);
    expect(h.canais).toHaveLength(4);
  });

  it("a aba vira LÍDER no meio: os canais próprios fecham e ficam só os da líder", async () => {
    const renderizarDeNovo = await montar();
    expect(vivos()).toHaveLength(4);
    expect(vivos().every((c) => c.nome.endsWith("-painel"))).toBe(true);

    h.lider = true;
    await renderizarDeNovo(true);

    expect(vivos()).toHaveLength(4);
    expect(vivos().some((c) => c.nome.endsWith("-painel"))).toBe(false);
  });
});
