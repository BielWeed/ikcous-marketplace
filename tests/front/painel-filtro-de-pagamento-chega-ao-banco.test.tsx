// @vitest-environment jsdom
//
// Item 10 do laudo "o que falta" (29/08, degrau 2): o filtro de Status de
// Pagamento do painel cortava EM MEMÓRIA a página que a RPC trouxe — dormia
// enquanto o resultado cabia numa página, e voltava a enganar no dia em que
// passasse dela. O conserto (migration 20261028000000) dá à
// get_admin_orders_paged o parâmetro p_payment_status, e o loadOrders passa
// a mandar o filtro para o banco.
//
// O que este teste olha: os PARÂMETROS que o loadOrders entrega à RPC
// (dublê do supabase que captura a chamada) — o corpo do filtro no banco é
// ancorado pela ficha de verificação da própria migration e pela entrada no
// VERIFICACOES do db-apply.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let chamadasRpc: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (_nome: string, params: Record<string, unknown>) => {
      chamadasRpc.push(params);
      return {
        abortSignal: () =>
          Promise.resolve({ data: { data: [], total_count: 0 }, error: null }),
      };
    },
    auth: {
      refreshSession: vi.fn(async () => ({ data: { session: null } })),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// testes irmãos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("loadOrders — o filtro de pagamento chega ao banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let gancho: {
    loadOrders: (...args: unknown[]) => Promise<unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasRpc = [];
    // O hook guarda cache de pedidos em localStorage — jsdom fornece, mas
    // este arquivo roda em ambiente sem as API completas; um Map basta.
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

  async function comHook(): Promise<void> {
    const { useOrders } = await import("@/hooks/useOrders");

    function Hospedeiro() {
      const hook = useOrders();
      // Captura em efeito, não no render: regra da catraca
      // (react-hooks/globals) que já pegou hospedeiro de teste antes.
      useEffect(() => {
        gancho = hook as unknown as {
          loadOrders: (...args: unknown[]) => Promise<unknown>;
        };
      }, [hook]);
      return null;
    }

    await act(async () => {
      raiz.render(<Hospedeiro />);
    });
  }

  function chamadaDaListagem(): Record<string, unknown> {
    const chamada = chamadasRpc.find(
      (p) => "p_payment_status" in p || "p_status" in p,
    );
    expect(chamada).toBeDefined();
    return chamada!;
  }

  it("com filtro, manda p_payment_status para a RPC", async () => {
    await comHook();
    await act(async () => {
      await gancho.loadOrders(
        0,
        10,
        "all",
        "",
        undefined,
        undefined,
        false,
        "pago",
      );
    });

    expect(chamadaDaListagem().p_payment_status).toBe("pago");
  });

  it("sem filtro, manda 'all' — o banco não filtra nada", async () => {
    await comHook();
    await act(async () => {
      await gancho.loadOrders(0, 10, "all", "", undefined, undefined, false);
    });

    expect(chamadaDaListagem().p_payment_status).toBe("all");
  });

  it("'sem_cobranca' atravessa intacto (a regra do NULL mora no banco, na migration)", async () => {
    // É exatamente o caso que um `paymentStatus || "all"` malfeito quebraria:
    // 'sem_cobranca' é string verdadeira e não pode virar 'all' no caminho.
    await comHook();
    await act(async () => {
      await gancho.loadOrders(
        0,
        10,
        "all",
        "",
        undefined,
        undefined,
        false,
        "sem_cobranca",
      );
    });

    expect(chamadaDaListagem().p_payment_status).toBe("sem_cobranca");
  });
});
