// @vitest-environment jsdom
//
// Auditoria de 20/08/2026, achados 6, 7 e 12 — a prova de que a TELA usa a
// medição real, e não só de que a função pura existe.
//
// O companheiro deste arquivo (`push-contadores-de-segmento.test.ts`) prova
// as funções puras. Sozinho ele não pega o defeito de origem: alguém podia
// escrever `rotuloDaContagem` certinha e esquecer de trocar o
// `Math.ceil(subCount * 0.3)` no JSX pelo valor medido — o teste da função
// pura continuaria verde e a tela continuaria mentindo. Este arquivo monta
// `AdminPushView` de verdade e lê o texto e os números renderizados.
//
// O cenário usa exatamente os números da auditoria: 8 aparelhos no total,
// segmento "vip" com 2, "inactive" com 0, "new" com 0. A versão com o
// defeito mostraria 3, 2 e 3 (30%, 25% e 45% de 8, arredondados) — se
// qualquer um desses três aparecer, a mutação não foi corrigida.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RPC `get_segmented_push_targets` devolve uma lista de linhas por
// segmento — o contador real é o TAMANHO da lista, igual ao que o
// componente já fazia para o segmento selecionado (achado 6, decisão 1).
const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    porSegmento: {
      vip: [{ id: "1" }, { id: "2" }] as unknown[],
      inactive: [] as unknown[],
      new: [] as unknown[],
    } as Record<string, unknown[] | null>,
    falharRpc: false,
    // O quarto contador (achado do revisor sobre o commit 6e406b4, em
    // 20/08/2026): a consulta a `push_subscriptions` pode falhar, e a tela
    // tem de mostrar desconhecido — nunca zero.
    falharSubCount: false,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            estadoDoBanco.falharSubCount
              ? Promise.resolve({ count: null, error: new Error("falhou") })
              : Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
        };
      }
      // push_notifications_log, vw_produtos_public, public_profiles: sem
      // linha nenhuma — não é o que este teste mede.
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      };
    },
    rpc: (nome: string, args: { p_segment: string }) => {
      if (nome !== "get_segmented_push_targets") {
        return Promise.resolve({ data: null, error: new Error("rpc desconhecida") });
      }
      if (estadoDoBanco.falharRpc) {
        return Promise.resolve({ data: null, error: new Error("falhou") });
      }
      const linhas = estadoDoBanco.porSegmento[args.p_segment] ?? null;
      if (linhas === null) {
        return Promise.resolve({ data: null, error: new Error("sem segmento") });
      }
      return Promise.resolve({ data: linhas, error: null });
    },
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — os contadores de segmento são medidos, não multiplicados", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDoBanco.subCount = 8;
    estadoDoBanco.porSegmento = {
      vip: [{ id: "1" }, { id: "2" }],
      inactive: [],
      new: [],
    };
    estadoDoBanco.falharRpc = false;
    estadoDoBanco.falharSubCount = false;

    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("cada segmento mostra O SEU número medido, não uma fração do total", async () => {
    await abrirTela();

    // vip=2, inactive=0, new=0 — o real do banco. A versão com o defeito
    // mostraria 3, 2 e 3 (30%, 25% e 45% de 8).
    const cardVip = hospedeiro.querySelector(
      'button:has(span:first-child)',
    );
    void cardVip;

    // Procura os botões de segmento pelo texto do rótulo e confere o
    // número ao lado de cada um.
    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Clientes Frequentes"),
    );
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem comprar há 30d"),
    );
    const botaoNovo = botoes.find((b) =>
      (b.textContent ?? "").includes("Novos Clientes"),
    );

    expect(botaoVip?.textContent).toContain("2");
    expect(botaoVip?.textContent).not.toMatch(/\b3\b/);

    expect(botaoInativo?.textContent).toContain("0");
    expect(botaoInativo?.textContent).not.toMatch(/\b2\b/);

    expect(botaoNovo?.textContent).toContain("0");
    expect(botaoNovo?.textContent).not.toMatch(/\b3\b/);
  });

  it("segmento vazio mostra 0 (medido), e o botão de enviar some ao selecioná-lo", async () => {
    await abrirTela();

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem comprar há 30d"),
    );
    expect(botaoInativo).toBeTruthy();

    await act(async () => {
      botaoInativo?.click();
    });
    await act(async () => {
      await esperar(50);
    });

    const botaoEnviar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").includes("Enviar Notificação Agora"),
    ) as HTMLButtonElement | undefined;
    expect(botaoEnviar).toBeTruthy();
    // effectiveReach === 0 para o segmento vazio selecionado — o botão de
    // enviar continua desabilitado. Comportamento já existente, não pode
    // quebrar.
    expect(botaoEnviar?.disabled).toBe(true);
  });

  it("medição que ainda não chegou (RPC pendente) mostra traço, nunca um número chutado", async () => {
    // Trava a RPC dos três segmentos não selecionados num Promise que nunca
    // resolve durante o teste — simula "a medição ainda não voltou".
    const controlador: { resolver: (() => void) | null } = { resolver: null };
    const travada = new Promise<void>((resolve) => {
      controlador.resolver = () => resolve();
    });

    const { supabase } = await import("@/lib/supabase");
    const original = supabase.rpc;
    (supabase as any).rpc = vi.fn(
      async (nome: string, args: { p_segment: string }) => {
        if (args.p_segment !== "all") {
          await travada;
        }
        return (original as any)(nome, args);
      },
    );

    await abrirTela();

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Clientes Frequentes"),
    );
    expect(botaoVip?.textContent).toContain("—");
    expect(botaoVip?.textContent).not.toMatch(/[023]\D*$/);

    controlador.resolver?.();
    await act(async () => {
      await esperar(50);
    });
  });

  it("medição que falha também mostra traço, não zero", async () => {
    estadoDoBanco.falharRpc = true;
    await abrirTela();

    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Clientes Frequentes"),
    );
    const botaoInativo = botoes.find((b) =>
      (b.textContent ?? "").includes("Sem comprar há 30d"),
    );

    expect(botaoVip?.textContent).toContain("—");
    expect(botaoInativo?.textContent).toContain("—");
  });

  it("os selos de plataforma iOS/Android saíram da tela", async () => {
    await abrirTela();

    expect(texto()).not.toMatch(/iOS:/);
    expect(texto()).not.toMatch(/Android:/);
  });

  it("os textos de alcance dizem aparelhos, não clientes — no plural certo", async () => {
    await abrirTela();

    // Segmento "all": 8 aparelhos, real (subCount).
    expect(texto()).toContain("Receberão: 8 aparelhos");
    expect(texto()).toContain("Enviar Notificação Agora (8 aparelhos)");
    expect(texto()).not.toMatch(/Receberão:\s*\d+\s*clientes/);
    expect(texto()).not.toMatch(/Enviar Notificação Agora \(\d+ clientes\)/);
  });

  it("com um único aparelho, o texto de alcance vem no singular", async () => {
    estadoDoBanco.subCount = 1;
    await abrirTela();

    expect(texto()).toContain("Receberão: 1 aparelho");
    expect(texto()).not.toContain("Receberão: 1 aparelhos");
  });

  // Achado do revisor sobre o commit 6e406b4, em 20/08/2026: o QUARTO
  // contador (`subCount`, o total de aparelhos) nascia em `useState(0)` e o
  // `if (!error) setSubCount(...)` simplesmente não fazia nada quando a
  // consulta falhava — a tela ficava presa em "0" para sempre, indistinguível
  // de uma loja sem ninguém cadastrado. Estes três testes provam que os TRÊS
  // lugares de exibição (topbar, cartão grande, badge "Todos os Clientes") e
  // o texto de alcance concordam entre si, e que o botão de enviar SEMPRE
  // falha fechado quando o total é desconhecido.
  describe("o total de aparelhos (subCount) distingue desconhecido de zero medido", () => {
    function numeroDoTopbar(): string | undefined {
      const span = Array.from(hospedeiro.querySelectorAll("span")).find(
        (s) =>
          (s.textContent ?? "").includes("Celulares Cadastrados") &&
          !(s.textContent ?? "").includes("Computadores"),
      );
      return span?.querySelector("strong")?.textContent ?? undefined;
    }

    function numeroDoCartaoGrande(): string | undefined {
      return (
        hospedeiro.querySelector("h2.text-3xl")?.textContent ?? undefined
      );
    }

    function numeroDoBadgeTodosOsClientes(): string | undefined {
      const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").includes("Todos os Clientes"),
      );
      return botao?.textContent ?? undefined;
    }

    function botaoEnviar(): HTMLButtonElement | undefined {
      return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Enviar Notificação Agora"),
      ) as HTMLButtonElement | undefined;
    }

    it("quando a consulta ao total de aparelhos FALHA, os três lugares mostram desconhecido — nunca zero — e o botão de enviar continua desabilitado", async () => {
      estadoDoBanco.falharSubCount = true;
      await abrirTela();

      expect(numeroDoTopbar()).toBe("—");
      expect(numeroDoCartaoGrande()).toBe("—");
      expect(numeroDoBadgeTodosOsClientes()).toContain("—");

      expect(texto()).toContain("Receberão: — aparelhos");
      expect(texto()).toContain("Enviar Notificação Agora (— aparelhos)");

      // O ponto mais importante desta tarefa: total desconhecido não pode
      // virar botão liberado. Falhar fechado.
      expect(botaoEnviar()?.disabled).toBe(true);
    });

    it("quando a consulta DEVOLVE 0 de verdade, os três lugares mostram 0 (medido) e o botão de enviar continua desabilitado, por ser zero real", async () => {
      estadoDoBanco.subCount = 0;
      await abrirTela();

      expect(numeroDoTopbar()).toBe("0");
      expect(numeroDoCartaoGrande()).toBe("0");
      expect(numeroDoBadgeTodosOsClientes()).toContain("0");

      expect(texto()).toContain("Receberão: 0 aparelhos");

      expect(botaoEnviar()?.disabled).toBe(true);
    });

    it("quando a consulta DEVOLVE 8, os três lugares mostram 8 e o botão de enviar habilita", async () => {
      await abrirTela();

      expect(numeroDoTopbar()).toBe("8");
      expect(numeroDoCartaoGrande()).toBe("8");
      expect(numeroDoBadgeTodosOsClientes()).toContain("8");

      expect(texto()).toContain("Receberão: 8 aparelhos");

      expect(botaoEnviar()?.disabled).toBe(false);
    });
  });
});
