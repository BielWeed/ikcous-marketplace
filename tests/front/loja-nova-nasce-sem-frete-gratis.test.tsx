import { StoreProvider, useStore } from "@/contexts/StoreContext";
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Molde copiado de store-config-arquivos-identidade.test.tsx (mesmo StoreProvider
// real, mesmo Proxy encadeado para o supabase.from) — só o suficiente para exercer
// o ramo PGRST116 do fetchConfig, que é onde a semente da loja nova nasce.
const externo = vi.hoisted(() => ({
  insert: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: null }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getById: async () => null,
      getAll: async () => [],
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: async () => {},
      setLastSync: async () => {},
    }),
  },
}));
vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: () => () => {},
    onSync: () => () => {},
  },
}));
function consultaEncadeada(
  resultado: Promise<{ data: unknown; error: unknown }>,
) {
  const alvo: any = () => consultaEncadeada(resultado);
  return new Proxy(alvo, {
    get(_target, prop) {
      if (prop === "then") return resultado.then.bind(resultado);
      if (prop === "insert")
        return (rows: unknown) => {
          externo.insert(rows);
          // O Supabase de verdade devolve a própria linha inserida em
          // `.insert([...]).select().single()` — é assim que o app aprende
          // o valor que acabou de semear, sem depender de um segundo fetch.
          const linha = Array.isArray(rows) ? rows[0] : rows;
          return consultaEncadeada(
            Promise.resolve({ data: linha, error: null }),
          );
        };
      return () => consultaEncadeada(resultado);
    },
  });
}
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) =>
      consultaEncadeada(
        // Loja nova de verdade: a linha id=1 ainda não existe, então TODA
        // leitura de store_config/v_store_config estoura PGRST116.
        table === "store_config" || table === "v_store_config"
          ? Promise.resolve({ data: null, error: { code: "PGRST116" } })
          : Promise.resolve({ data: [], error: null }),
      ),
    rpc: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag interna do React, como nos testes existentes.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let store: ReturnType<typeof useStore>;
function Capturador() {
  const value = useStore();
  useEffect(() => {
    store = value;
  }, [value]);
  return null;
}

describe("loja nova nasce sem frete grátis inventado (StoreContext-576)", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    externo.insert.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function montar() {
    await act(async () =>
      root.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      ),
    );
  }

  it("o INSERT de semente (fetchConfig ao achar PGRST116) grava free_shipping_min desligado, não 350", async () => {
    await montar();
    expect(externo.insert).toHaveBeenCalledTimes(1);
    const [linhaGravada] = externo.insert.mock.calls[0];
    // A sentinela de "não configurado" é a mesma que a RPC já usa para
    // ausência (COALESCE(...,0)) e que presetDoConfig já classifica como
    // desligada — nunca um limiar que ninguém escolheu.
    expect(linhaGravada[0].free_shipping_min).toBe(0);
    expect(presetDoConfig(linhaGravada[0].free_shipping_min)).toBe("desligado");
  });

  it("o config em memória da loja nova nasce com o preset desligado, não com 'acima de R$ 350'", async () => {
    await montar();
    expect(store.config.freeShippingMin).toBe(0);
    expect(presetDoConfig(store.config.freeShippingMin)).toBe("desligado");
  });
});
