// @vitest-environment jsdom
//
// O StoreProvider PEDE OS BANNERS NO BOOT, junto da configuração -- sem esperar
// a Home montar (era o último elo da fila da 1a visita; ver
// banners-da-vitrine-pedido-no-boot.test.tsx para o módulo em si).
//
// Aqui o que se prova é a LIGAÇÃO, com o StoreProvider de verdade:
//  - monta o provedor e a consulta de banners sai UMA vez;
//  - o provedor desmontado e montado de novo (ou o efeito refeito) não repete;
//  - banner que falha, ou cliente que estoura ao montar a consulta, não
//    derruba a loja nem trava o `isLoaded` dela.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  consultasDeBanners: 0,
  bannersEstoura: false,
  bannersResposta: { data: [], error: null } as unknown,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockImplementation(async () => ({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    })),
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

function construtorEncadeavel(resultado: () => unknown) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado());
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
      if (tabela === "banners") {
        rede.consultasDeBanners++;
        if (rede.bannersEstoura) throw new Error("cliente quebrado");
        return construtorEncadeavel(() => rede.bannersResposta);
      }
      return construtorEncadeavel(() => ({ data: [], error: null }));
    },
    rpc: () => construtorEncadeavel(() => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("StoreContext — pede os banners no boot", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let isLoaded: boolean;
  let StoreProvider: typeof import("@/contexts/StoreContext").StoreProvider;
  let useStore: typeof import("@/contexts/StoreContext").useStore;

  function Espiao() {
    const { isLoaded: carregado } = useStore();
    useEffect(() => {
      isLoaded = carregado;
    });
    return null;
  }

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Espiao />
        </StoreProvider>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.consultasDeBanners = 0;
    rede.bannersEstoura = false;
    rede.bannersResposta = { data: [], error: null };
    isLoaded = false;
    ({ StoreProvider, useStore } = await import("@/contexts/StoreContext"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("monta o provedor e a consulta de banners sai uma vez", async () => {
    await montar();
    expect(rede.consultasDeBanners).toBe(1);
    expect(isLoaded).toBe(true);
  });

  it("desmontar e montar o provedor de novo não repete o pedido", async () => {
    await montar();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar();
    expect(rede.consultasDeBanners).toBe(1);
  });

  it("banners que falham na rede não derrubam a loja", async () => {
    rede.bannersResposta = { data: null, error: { message: "rede caiu" } };
    await montar();
    expect(rede.consultasDeBanners).toBe(1);
    expect(isLoaded).toBe(true);
  });

  it("cliente que estoura ao montar a consulta de banners não derruba a loja", async () => {
    rede.bannersEstoura = true;
    await montar();
    expect(rede.consultasDeBanners).toBe(1);
    expect(isLoaded).toBe(true);
  });
});
