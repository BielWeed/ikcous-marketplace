// @vitest-environment jsdom
//
// Lote 226 (item 4): a Visão geral do CRM dependia do OBJETO `session`. O
// AuthContext troca esse objeto a cada SIGNED_IN (que o supabase-js reanuncia
// quando o lojista volta ao app) — e cada troca recriava os 4 canais ao vivo.
// O efeito tem de depender só de "há sessão ou não": sessão nova do mesmo
// usuário não mexe nos canais; login/logout de verdade continua mexendo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    session: { user: { id: "admin-1" } } as object | null,
    canaisCriados: 0,
    canaisRemovidos: 0,
  };
  return { state };
});

vi.mock("@/lib/supabase", () => {
  const criarCanal = () => {
    h.state.canaisCriados += 1;
    const canal = {
      on: () => canal,
      subscribe: () => canal,
    };
    return canal;
  };
  return {
    supabase: {
      channel: () => criarCanal(),
      removeChannel: () => {
        h.state.canaisRemovidos += 1;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

// Funções ESTÁVEIS entre renders (como o useAnalytics real, que usa
// useCallback): senão o efeito rodaria de novo por causa do dublê.
vi.mock("@/hooks/useAnalytics", () => {
  const analytics = {
    fetchExecutiveSummary: vi.fn().mockResolvedValue(undefined),
    fetchCategoryAnalytics: vi.fn().mockResolvedValue(undefined),
    stats: null,
    categoryData: null,
    error: null,
    categoryError: null,
  };
  return { useAnalytics: () => analytics };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.state.session, profile: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Visão geral do CRM — sessão nova do mesmo usuário não refaz os canais", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.state.session = { user: { id: "admin-1" } };
    h.state.canaisCriados = 0;
    h.state.canaisRemovidos = 0;
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
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
  });

  async function montar() {
    const { useDashboardClassico } = await import("@/hooks/useCrm");
    function Sonda() {
      useDashboardClassico(true);
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
    return Sonda;
  }

  it("trocar o objeto da sessão (mesmo usuário) não recria os 4 canais", async () => {
    const Sonda = await montar();
    expect(h.state.canaisCriados).toBe(4);

    h.state.session = { user: { id: "admin-1" } }; // objeto novo, SIGNED_IN reanunciado
    await act(async () => {
      raiz.render(<Sonda />);
    });

    expect(h.state.canaisCriados).toBe(4);
    expect(h.state.canaisRemovidos).toBe(0);
  });

  it("logout de verdade remove os canais; login de novo recria", async () => {
    const Sonda = await montar();
    expect(h.state.canaisCriados).toBe(4);

    h.state.session = null;
    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(h.state.canaisRemovidos).toBe(4);

    h.state.session = { user: { id: "admin-1" } };
    await act(async () => {
      raiz.render(<Sonda />);
    });
    expect(h.state.canaisCriados).toBe(8);
  });
});
