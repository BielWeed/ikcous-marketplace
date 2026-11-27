// @vitest-environment jsdom
//
// Caça 27/11 — ajustes da loja em dois aparelhos. As vitrines da Home e as
// formas de pagamento na entrega são gravadas INTEIRAS a partir da cópia que a
// tela tem em memória: o celular com a tela velha regravava a lista e apagava o
// que o computador tinha acabado de mudar. Agora quem chama `updateConfig` diz
// qual lista ele VIU (`vistos`); o pedido leva essa lista ao lado das colunas
// (`config_json.vistos`, fora da conferência do que foi gravado), o banco
// recusa com o código `LST01` quando ela já não é a do banco, e o
// `updateConfig` relê a configuração e avisa em português.
//
// Render de verdade do StoreProvider (mesmo padrão de
// store-context-vitrine-nao-declara-sucesso-sem-conferir.test.tsx).
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const { rpcResultado, rpcArgsCapturados, leiturasDaConfig } = vi.hoisted(
  () => ({
    rpcResultado: { data: null as unknown, error: null as unknown },
    rpcArgsCapturados: {
      valor: undefined as Record<string, unknown> | undefined,
    },
    leiturasDaConfig: { total: 0 },
  }),
);

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function construtorEncadeavel(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
      }
      return () => construtorEncadeavel(resultado);
    },
    apply() {
      return construtorEncadeavel(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "v_store_config" || tabela === "store_config")
        leiturasDaConfig.total += 1;
      return construtorEncadeavel({ data: [], error: null });
    },
    rpc: (_nome: string, args: Record<string, unknown>) => {
      rpcArgsCapturados.valor = args?.config_json as
        | Record<string, unknown>
        | undefined;
      return construtorEncadeavel(rpcResultado);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UpdateConfigFn = (
  updates: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<boolean>;

function Capturador({ onReady }: { onReady: (fn: UpdateConfigFn) => void }) {
  const { updateConfig } = useStore();
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });
  useEffect(() => {
    onReadyRef.current(updateConfig as UpdateConfigFn);
  }, [updateConfig]);
  return null;
}

const VITRINES_DO_CELULAR = [
  { id: "offers", title: "Ofertas", active: true },
  { id: "new_arrivals", title: "Lançamentos", active: true },
];
const VITRINES_NOVAS = [
  { id: "offers", title: "Ofertas", active: false },
  { id: "new_arrivals", title: "Lançamentos", active: true },
];

function linhaGravada(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1,
    store_name: null,
    updated_at: "2026-11-27T00:00:00.000Z",
    ...extra,
  };
}

describe("StoreContext.updateConfig — a lista mudou em outro aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let updateConfigRef: { current: UpdateConfigFn | null };

  beforeEach(async () => {
    vi.clearAllMocks();
    rpcResultado.data = null;
    rpcResultado.error = null;
    rpcArgsCapturados.valor = undefined;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    updateConfigRef = { current: null };
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador
            onReady={(fn) => {
              updateConfigRef.current = fn;
            }}
          />
        </StoreProvider>,
      );
    });
    leiturasDaConfig.total = 0;
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function salvar(
    updates: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<boolean | undefined> {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!(updates, options);
    });
    return resultado;
  }

  it("vitrines: manda a lista VISTA em config_json.vistos.home_sections e a conferência do gravado não a cobra", async () => {
    rpcResultado.data = linhaGravada({ home_sections: VITRINES_NOVAS });
    const ok = await salvar(
      { homeSections: VITRINES_NOVAS },
      { vistos: { homeSections: VITRINES_DO_CELULAR } },
    );
    expect(ok).toBe(true);
    expect(rpcArgsCapturados.valor).toEqual({
      home_sections: VITRINES_NOVAS,
      vistos: { home_sections: VITRINES_DO_CELULAR },
    });
    const { toast } = await import("sonner");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("vitrines: a tela que nunca leu vitrine salva (undefined) manda null — o banco aceita quando a coluna ainda é vazia", async () => {
    rpcResultado.data = linhaGravada({ home_sections: VITRINES_NOVAS });
    await salvar(
      { homeSections: VITRINES_NOVAS },
      { vistos: { homeSections: undefined } },
    );
    expect(rpcArgsCapturados.valor?.vistos).toEqual({ home_sections: null });
  });

  it("formas na entrega: manda a lista VISTA em config_json.vistos.formas_pagamento_entrega", async () => {
    rpcResultado.data = linhaGravada({
      formas_pagamento_entrega: ["pix", "cash"],
    });
    const ok = await salvar(
      { formasPagamentoEntrega: ["pix", "cash"] },
      { silentSuccess: true, vistos: { formasPagamentoEntrega: ["pix"] } },
    );
    expect(ok).toBe(true);
    expect(rpcArgsCapturados.valor).toEqual({
      formas_pagamento_entrega: ["pix", "cash"],
      vistos: { formas_pagamento_entrega: ["pix"] },
    });
  });

  it("só vai a lista vista da coluna que está sendo gravada", async () => {
    rpcResultado.data = linhaGravada({ store_name: "Loja" });
    await salvar(
      { storeName: "Loja" },
      {
        vistos: {
          homeSections: VITRINES_DO_CELULAR,
          formasPagamentoEntrega: ["pix"],
        },
      },
    );
    expect(rpcArgsCapturados.valor).toEqual({ store_name: "Loja" });
  });

  it("cliente de sempre (sem vistos) manda o pedido como antes, sem a chave vistos", async () => {
    rpcResultado.data = linhaGravada({ home_sections: VITRINES_NOVAS });
    await salvar({ homeSections: VITRINES_NOVAS });
    expect(rpcArgsCapturados.valor).toEqual({ home_sections: VITRINES_NOVAS });
  });

  it("o banco recusa com LST01 nas vitrines: devolve false, avisa das vitrines e relê a configuração", async () => {
    rpcResultado.error = {
      code: "LST01",
      details: "home_sections",
      message: "A lista foi mudada em outro aparelho.",
    };
    const ok = await salvar(
      { homeSections: VITRINES_NOVAS },
      { vistos: { homeSections: VITRINES_DO_CELULAR } },
    );
    expect(ok).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      "As vitrines foram mudadas em outro aparelho. Atualizamos a lista — confira e faça a mudança de novo.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(leiturasDaConfig.total).toBeGreaterThan(0);
  });

  it("o banco recusa com LST01 nas formas: avisa das formas na entrega, mesmo com silentSuccess", async () => {
    rpcResultado.error = {
      code: "LST01",
      details: "formas_pagamento_entrega",
      message: "A lista foi mudada em outro aparelho.",
    };
    const ok = await salvar(
      { formasPagamentoEntrega: ["pix", "cash"] },
      { silentSuccess: true, vistos: { formasPagamentoEntrega: ["pix"] } },
    );
    expect(ok).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      "As formas de pagamento na entrega foram mudadas em outro aparelho. Atualizamos a lista — confira e toque de novo.",
    );
    expect(leiturasDaConfig.total).toBeGreaterThan(0);
  });

  it("silent:true cala o aviso da recusa, mas ainda relê a configuração", async () => {
    rpcResultado.error = { code: "LST01", details: "home_sections" };
    const ok = await salvar(
      { homeSections: VITRINES_NOVAS },
      { silent: true, vistos: { homeSections: VITRINES_DO_CELULAR } },
    );
    expect(ok).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.error).not.toHaveBeenCalled();
    expect(leiturasDaConfig.total).toBeGreaterThan(0);
  });
});
