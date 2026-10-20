// @vitest-environment jsdom
//
// A tela "Avisar clientes" oferecia a chave "Avisos de Compras Recentes"
// ("Mostra na loja avisos de compras em tempo real"), mas NADA na vitrine nem
// no servidor lê essa configuração: a lojista ligava, achava que a loja
// mostrava "fulana comprou há 5 min", e nada acontecia. Promessa falsa.
//
// Conserto (decisão do sócio, 14/10/2026): ESCONDER a chave e tudo que a
// anuncia (o cartão, a ajuda e o selo "Avisos de Vendas Ativos" do topo), SEM
// apagar a configuração guardada nem o campo `realTimeSalesAlerts` do
// contexto/banco — para religar quando o recurso existir.
//
// O que este arquivo prende:
//   1. Nem a chave nem o texto dela aparecem — com a configuração ligada ou
//      desligada, e nem depois de abrir o bloco "Ajustes".
//   2. O resto da tela continua: composição, histórico, métrica e o botão de
//      teste de recebimento (que mora no Ajustes).
//   3. Abrir/usar a tela não grava `realTimeSalesAlerts` (o valor guardado
//      fica como estava) — o único escritor era a chave escondida.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { configDaLoja, updateConfigDaLoja } = vi.hoisted(() => ({
  configDaLoja: { realTimeSalesAlerts: true },
  updateConfigDaLoja: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configDaLoja,
    isLoaded: true,
    updateConfig: updateConfigDaLoja,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: true, subscribe: vi.fn() }),
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
          select: () => Promise.resolve({ count: 8, error: null }),
        };
      }
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
    rpc: () => Promise.resolve({ data: 0, error: null }),
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Avisar clientes — não promete o que a loja não faz", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    configDaLoja.realTimeSalesAlerts = true;
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
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const texto = () => hospedeiro.textContent ?? "";

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  async function abrirAjustes() {
    const ajustes = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
    ).find((b) => (b.textContent ?? "").includes("Ajustes"));
    expect(ajustes).toBeTruthy();
    await act(async () => {
      ajustes!.click();
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const FRASES_DA_PROMESSA_FALSA = [
    "Avisos de Compras Recentes",
    "avisos de compras em tempo real",
    "Avisos de Vendas Ativos",
    "Avisos Desativados",
    "notificações discretas",
  ];

  for (const ligada of [true, false]) {
    it(`com a configuração ${ligada ? "LIGADA" : "desligada"}, nenhuma chave nem texto de avisos de compras aparece (nem no Ajustes aberto)`, async () => {
      configDaLoja.realTimeSalesAlerts = ligada;
      await abrirTela();
      await abrirAjustes();

      expect(
        hospedeiro.querySelector("#realtime-sales-alerts-switch"),
      ).toBeNull();
      expect(hospedeiro.querySelector('[role="switch"]')).toBeNull();
      for (const frase of FRASES_DA_PROMESSA_FALSA) {
        expect(texto()).not.toContain(frase);
      }
    });
  }

  it("o resto da tela continua: composição, histórico, métrica e o teste de recebimento", async () => {
    await abrirTela();

    expect(texto()).toContain("O que já foi ao ar");
    expect(texto()).toContain("Celulares Cadastrados");
    expect(hospedeiro.querySelector("#push-title")).not.toBeNull();
    expect(hospedeiro.querySelector("#push-body")).not.toBeNull();

    await abrirAjustes();
    expect(texto()).toContain("Testar Recebimento Neste Aparelho");
  });

  it("abrir a tela e o Ajustes não grava realTimeSalesAlerts: o valor guardado fica como estava", async () => {
    await abrirTela();
    await abrirAjustes();

    expect(updateConfigDaLoja).not.toHaveBeenCalled();
    expect(configDaLoja.realTimeSalesAlerts).toBe(true);
  });
});
