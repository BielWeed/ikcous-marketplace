// @vitest-environment jsdom
//
// Frete velho na tela depois de a lojista mudar o valor em outro aparelho.
//
// A leitura da configuração (`fetchConfig`) captura uma "geração" e descarta a
// resposta se a geração mudou -- mas a geração só subia quando a gravação foi
// feita NESTA instância. O caminho ao vivo (realtime) aplicava a configuração
// nova SEM invalidar a leitura que já estava no ar: a leitura lenta (frete
// R$ 15), saída antes da mudança, chegava DEPOIS do evento (frete R$ 20),
// passava pela guarda e restaurava R$ 15 na tela E no cache offline.
//
// POR QUE RENDER DE VERDADE DO StoreProvider e leitura SOB CONTROLE: o defeito
// é a ORDEM de chegada (evento antes da resposta velha). Um dublê que responde
// na hora nunca produz essa ordem. Casco do
// store-context-realtime-identico-nao-re-renderiza.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { StoreConfig } from "@/types";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const h = vi.hoisted(() => ({
  // Cada leitura da config fica PENDURADA aqui até o teste responder: é o
  // teste quem decide a ordem de chegada.
  leituras: [] as Array<(resposta: { data: unknown; error: unknown }) => void>,
  // O que foi gravado no cache offline (IndexedDB) -- a outra metade do dano.
  put: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: h.put,
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Os listeners do useSyncListener são capturados aqui -- é POR ELES que o
// teste dispara o evento ao vivo.
const callbacksDeSync: Array<(event: unknown) => void> = [];

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn((cb: (event: unknown) => void) => {
      callbacksDeSync.push(cb);
      return () => {};
    }),
  },
}));

function construtorImediato(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => construtorImediato(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
      }
      return () => construtorImediato(resultado);
    },
    apply() {
      return construtorImediato(resultado);
    },
  });
}

// Builder cuja resposta fica PENDURADA até o teste chamar `h.leituras[n]`.
function construtorPendurado() {
  const alvo: any = () => construtorPendurado();
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: { data: unknown; error: unknown }) => void) => {
          h.leituras.push(resolve);
        };
      }
      return () => construtorPendurado();
    },
    apply() {
      return construtorPendurado();
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      tabela === "store_config"
        ? construtorPendurado()
        : construtorImediato({ data: [], error: null }),
    rpc: () => construtorImediato({ data: null, error: null }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público -- mesmo padrão
// do casco citado.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA_DA_LOJA: Record<string, unknown> = {
  id: 1,
  free_shipping_min: 350,
  shipping_fee: 15,
  whatsapp_number: null,
  share_text: null,
  business_hours: null,
  enable_reviews: true,
  enable_coupons: true,
  primary_color: null,
  theme_mode: "light",
  real_time_sales_alerts: false,
  push_marketing_enabled: false,
  min_app_version: null,
  store_name: "Loja Teste",
  store_city: null,
  store_state: null,
  origin_cep: null,
  shipping_provider: "manual",
  enabled_shipping_methods: ["correios"],
  shipping_coverage: null,
  local_delivery_fee: 5,
  local_cep_range: "38500",
  home_sections: null,
};

const contadores = {
  config: null as StoreConfig | null,
  refresh: null as ((o?: { onlyConfig?: boolean }) => Promise<void>) | null,
};

function Consumidor() {
  const { config, refresh } = useStore();
  useEffect(() => {
    contadores.config = config;
    contadores.refresh = refresh;
  });
  return null;
}

function dispararSync(newRecord: Record<string, unknown>) {
  const evento = { store: "store_config", eventType: "UPDATE", newRecord };
  for (const cb of callbacksDeSync) {
    cb(evento);
  }
}

const freteNoCacheOffline = () =>
  h.put.mock.calls
    .filter(([loja]) => loja === "store_config")
    .map(([, registro]) => (registro as StoreConfig).shippingFee);

describe("StoreContext -- leitura lenta da config não desfaz o evento ao vivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    callbacksDeSync.length = 0;
    h.leituras.length = 0;
    h.put.mockClear();
    contadores.config = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Consumidor />
        </StoreProvider>,
      );
    });
    await act(async () => {});
  }

  it("evento ao vivo (R$ 20) chega ANTES da leitura velha (R$ 15): tela e cache offline ficam em R$ 20", async () => {
    await montar();
    // A leitura A está no ar, sem resposta.
    expect(h.leituras).toHaveLength(1);

    // Em outro aparelho a lojista mudou o frete para R$ 20: o evento chega.
    await act(async () => {
      dispararSync({ ...LINHA_DA_LOJA, shipping_fee: 20 });
    });
    expect(contadores.config?.shippingFee).toBe(20);

    // A resposta velha (R$ 15, saída antes da mudança) chega depois.
    await act(async () => {
      h.leituras[0]?.({
        data: { ...LINHA_DA_LOJA, shipping_fee: 15 },
        error: null,
      });
    });
    await act(async () => {});

    // Tela: continua R$ 20. Cache offline: R$ 15 nunca foi gravado.
    expect(contadores.config?.shippingFee).toBe(20);
    expect(freteNoCacheOffline()).not.toContain(15);

    // A leitura descartada pede UMA releitura (a mesma de sempre), e quando
    // ela responde o valor atual do servidor também é R$ 20.
    expect(h.leituras).toHaveLength(2);
    await act(async () => {
      h.leituras[1]?.({
        data: { ...LINHA_DA_LOJA, shipping_fee: 20 },
        error: null,
      });
    });
    await act(async () => {});
    expect(contadores.config?.shippingFee).toBe(20);
    expect(freteNoCacheOffline()).not.toContain(15);
  });

  it("controle -- sem evento ao vivo, a leitura lenta aplica normalmente (nada é descartado à toa)", async () => {
    await montar();
    expect(h.leituras).toHaveLength(1);

    await act(async () => {
      h.leituras[0]?.({
        data: { ...LINHA_DA_LOJA, shipping_fee: 15 },
        error: null,
      });
    });
    await act(async () => {});

    expect(contadores.config?.shippingFee).toBe(15);
    expect(freteNoCacheOffline()).toContain(15);
    // Nenhuma releitura: ninguém ultrapassou a leitura.
    expect(h.leituras).toHaveLength(1);
  });

  it("controle -- leitura que chega ANTES do evento: o evento (mais novo) continua vencendo", async () => {
    await montar();
    await act(async () => {
      h.leituras[0]?.({
        data: { ...LINHA_DA_LOJA, shipping_fee: 15 },
        error: null,
      });
    });
    await act(async () => {});
    expect(contadores.config?.shippingFee).toBe(15);

    await act(async () => {
      dispararSync({ ...LINHA_DA_LOJA, shipping_fee: 20 });
    });
    expect(contadores.config?.shippingFee).toBe(20);
    // Sem leitura em voo, o evento não pede releitura nenhuma.
    expect(h.leituras).toHaveLength(1);
  });

  it("borda -- duas leituras em voo terminam fora de ordem: a que COMEÇOU depois (R$ 20) vale", async () => {
    await montar();
    expect(h.leituras).toHaveLength(1);

    // Puxar para atualizar enquanto a primeira leitura ainda não respondeu.
    let terminou = false;
    await act(async () => {
      void contadores.refresh?.({ onlyConfig: true }).then(() => {
        terminou = true;
      });
    });
    expect(h.leituras).toHaveLength(2);

    // A segunda leitura (nova) responde primeiro; a primeira (velha, R$ 15)
    // chega depois e não pode desfazê-la.
    await act(async () => {
      h.leituras[1]?.({
        data: { ...LINHA_DA_LOJA, shipping_fee: 20 },
        error: null,
      });
    });
    await act(async () => {
      h.leituras[0]?.({
        data: { ...LINHA_DA_LOJA, shipping_fee: 15 },
        error: null,
      });
    });
    await act(async () => {});

    expect(terminou).toBe(true);
    expect(contadores.config?.shippingFee).toBe(20);
    expect(freteNoCacheOffline()[freteNoCacheOffline().length - 1]).toBe(20);
  });

  it("borda -- dois eventos ao vivo seguidos com a leitura ainda pendente: vale o último, e só UMA releitura", async () => {
    await montar();
    expect(h.leituras).toHaveLength(1);

    await act(async () => {
      dispararSync({ ...LINHA_DA_LOJA, shipping_fee: 20 });
      dispararSync({ ...LINHA_DA_LOJA, shipping_fee: 25 });
    });
    expect(contadores.config?.shippingFee).toBe(25);

    await act(async () => {
      h.leituras[0]?.({
        data: { ...LINHA_DA_LOJA, shipping_fee: 15 },
        error: null,
      });
    });
    await act(async () => {});

    expect(contadores.config?.shippingFee).toBe(25);
    expect(freteNoCacheOffline()).not.toContain(15);
    expect(h.leituras).toHaveLength(2);
  });
});
