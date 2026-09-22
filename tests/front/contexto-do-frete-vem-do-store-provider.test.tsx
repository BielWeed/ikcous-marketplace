// @vitest-environment jsdom
//
// O FIO StoreProvider → ContextoDoFreteDaLoja (release 1.5.3).
//
// A ShippingCalculator carimba o cache v2 com o contexto do frete e recota
// quando ele muda (shipping-calculator-cache-v2-contexto-da-loja.test.tsx).
// Isso só vale no app se o StoreProvider de VERDADE fornecer o contexto a
// partir do config carregado — sem este fio, o contexto ficaria no padrão
// "sem config" para sempre, e a troca de provedor/retirada/endereço nunca
// recotaria. Molde de montagem: loja-nova-nasce-sem-frete-gratis.test.tsx.
import { act, useContext, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ContextoDoFreteDaLoja,
  contextoDaLojaParaFrete,
} from "@/contexts/ContextoDoFreteDaLoja";
import { StoreProvider } from "@/contexts/StoreContext";

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
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
      return () => consultaEncadeada(resultado);
    },
  });
}
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      consultaEncadeada(
        tabela === "store_config" || tabela === "v_store_config"
          ? Promise.resolve({
              data: {
                id: 1,
                origin_cep: "38500-000",
                shipping_provider: "frenet",
                enabled_shipping_methods: ["pac", "store-pickup"],
                store_address: `  ${ENDERECO_FICTICIO}  `,
              },
              error: null,
            })
          : Promise.resolve({ data: [], error: null }),
      ),
    rpc: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag interna do React, como nos testes existentes.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let visto = "";
function Capturador() {
  const contexto = useContext(ContextoDoFreteDaLoja);
  useEffect(() => {
    visto = contexto;
  }, [contexto]);
  return null;
}

describe("StoreProvider fornece o contexto do frete a partir do config carregado", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    visto = "";
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

  it("provedor, transportadoras, retirada e endereço (aparado) do banco chegam ao contexto", async () => {
    await act(async () =>
      root.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      ),
    );
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(visto).toBe(
      contextoDaLojaParaFrete({
        shippingProvider: "frenet",
        enabledShippingMethods: ["pac", "store-pickup"],
        storeAddress: ENDERECO_FICTICIO,
      }),
    );
    // E não é o padrão "sem config" (o que um fio solto deixaria).
    expect(visto).not.toBe(contextoDaLojaParaFrete(undefined));
  });
});
