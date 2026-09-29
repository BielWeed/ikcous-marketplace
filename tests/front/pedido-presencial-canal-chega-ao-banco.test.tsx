// @vitest-environment jsdom
//
// C4.4 (achado 5 da rodada de correção): o critério de aceite central do
// chip "Balcão" — "filtra NO BANCO: paginação e total respeitam o filtro"
// — não tinha teste nenhum. tests/front/pedido-presencial-filtro-de-canal.test.tsx
// moca `@/hooks/useOrders` inteiro para provar o selo do card, então nada
// ali prendia `canalFilter` ao 9º argumento de `loadOrders` nem `canal` ao
// `p_canal` da RPC — apagar `p_canal: canal || "all"` de useOrders.ts:1400
// deixava a suíte inteira verde.
//
// Este arquivo é irmão de painel-filtro-de-pagamento-chega-ao-banco.test.tsx
// (mesmo molde) e existe SEPARADO do teste do selo pelo mesmo motivo daquele
// arquivo: aqui o `@/hooks/useOrders` precisa ser o de VERDADE (só
// `@/lib/supabase` é dublê), e `vi.mock` é hoisted para o topo do ARQUIVO —
// misturar com o mock de `useOrders` do teste do card faria este bloco
// herdar o hook falso e nunca tocar a RPC.
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

describe("loadOrders — o filtro de canal chega ao banco (C4.4)", () => {
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
    const chamada = chamadasRpc.find((p) => "p_canal" in p);
    expect(chamada).toBeDefined();
    return chamada!;
  }

  it("com o chip 'Balcão' ligado (9º argumento), manda p_canal: 'presencial' para a RPC", async () => {
    await comHook();
    await act(async () => {
      await gancho.loadOrders(
        0,
        12,
        "all",
        "",
        undefined,
        undefined,
        false,
        "all",
        "presencial",
      );
    });

    expect(chamadaDaListagem().p_canal).toBe("presencial");
  });

  it("com o chip em 'all', manda p_canal: 'all' — o banco não filtra por canal", async () => {
    await comHook();
    await act(async () => {
      await gancho.loadOrders(
        0,
        12,
        "all",
        "",
        undefined,
        undefined,
        false,
        "all",
        "all",
      );
    });

    expect(chamadaDaListagem().p_canal).toBe("all");
  });

  it("sem o 9º argumento (chamador antigo, ex.: AdminLayout.tsx com 7 args), manda p_canal: 'all' por default", async () => {
    await comHook();
    await act(async () => {
      await gancho.loadOrders(0, 12, "all", "", undefined, undefined, false);
    });

    expect(chamadaDaListagem().p_canal).toBe("all");
  });
});
