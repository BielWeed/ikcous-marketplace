// @vitest-environment jsdom
//
// Lote 2 do laudo "o que falta" (29/08, achado config 18, latente): para
// mostrar os três números de segmento e a previsão de alcance, a tela de
// Push chamava `get_segmented_push_targets` 4 vezes e fazia `.length` —
// baixando a LINHA INTEIRA de `push_subscriptions` (auth, endpoint, p256dh,
// user_id: a credencial de envio de cada aparelho) só para virar um número.
// Com 8 inscrições ninguém sente; com centenas, é dado sensível atravessando
// a rede à toa a cada abertura da tela.
//
// O conserto: a MEDIÇÃO passa a usar `get_segmented_push_count` (mesmos
// filtros, devolve só o número, migration 20261023000000). A
// `get_segmented_push_targets` fica EXCLUSIVA do ENVIO, que precisa das
// linhas de verdade.
//
// Este teste monta a tela de verdade com a RPC espiada e prova a fronteira:
// na medição (montagem + troca de segmento), `get_segmented_push_targets`
// NUNCA é chamada; só a count. Mesmos dublês de
// admin-push-view-contadores.test.tsx (irmão que prova os números exibidos).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chamadasRpc } = vi.hoisted(() => ({
  chamadasRpc: [] as Array<{ nome: string; args: Record<string, unknown> }>,
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
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args });
      // Seleção explícita (sem indexar objeto por variável: é o que a regra
      // security/detect-object-injection da catraca acusa).
      const populacaoDo = (seg: string): unknown[] => {
        if (seg === "vip") return [{ id: "1" }, { id: "2" }];
        if (seg === "inactive") return [];
        if (seg === "new") return [];
        return [];
      };
      const seg = (args.p_segment as string) ?? "all";
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: populacaoDo(seg).length, error: null });
      }
      // A função de alvos continua respondendo (o ENVIO a usa) — o teste
      // proíbe a MEDIÇÃO de chamá-la, não a função de existir.
      return Promise.resolve({ data: populacaoDo(seg), error: null });
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

describe("AdminPushView mede público sem baixar credencial de envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    chamadasRpc.length = 0;
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

  it("na medição (montagem e troca de segmento), a função de alvos NUNCA é chamada", async () => {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });

    // Montagem: os três segmentos medidos pela count.
    const nomesNaMontagem = chamadasRpc.map((c) => c.nome);
    expect(nomesNaMontagem).not.toContain("get_segmented_push_targets");
    const contagens = chamadasRpc.filter(
      (c) => c.nome === "get_segmented_push_count",
    );
    expect(contagens.map((c) => c.args.p_segment).sort()).toEqual([
      "inactive",
      "new",
      "vip",
    ]);

    // Troca de segmento dispara a previsão de alcance — também pela count.
    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    const botaoVip = botoes.find((b) =>
      (b.textContent ?? "").includes("Clientes Frequentes"),
    );
    expect(botaoVip).toBeTruthy();
    await act(async () => {
      botaoVip!.click();
    });
    await act(async () => {
      await esperar(50);
    });

    expect(chamadasRpc.map((c) => c.nome)).not.toContain(
      "get_segmented_push_targets",
    );
    const ultima = chamadasRpc[chamadasRpc.length - 1];
    expect(ultima.nome).toBe("get_segmented_push_count");
    expect(ultima.args.p_segment).toBe("vip");
  });
});
