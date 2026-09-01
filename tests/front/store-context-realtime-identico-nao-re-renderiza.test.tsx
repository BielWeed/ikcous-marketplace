// @vitest-environment jsdom
//
// Laudo 0109 (P-5) — o listener de realtime de store_config fazia
// `setConfig(mapped)` SEM comparação: cada eco do motor trocava o OBJETO da
// config mesmo quando nada tinha mudado, e a casa inteira (todo consumidor
// de useStore) re-renderizava de graça. O `fetchConfig` já tem a guarda
// `isIdentical` — o conserto reaproveita a MESMA comparação no listener.
//
// POR QUE RENDER DE VERDADE DO StoreProvider: o defeito é a TROCA DE
// REFERÊNCIA propagando re-render pelos consumidores — um dublê de contexto
// não prova nada disso. Mesmo casco de
// store-context-nao-mexe-em-dark.test.tsx.
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

// Os listeners do useSyncListener são capturados aqui — é POR ELES que o
// teste dispara o caminho do realtime.
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

const h = vi.hoisted(() => ({
  // Linha bruta que o banco devolve ao fetchConfig — e que o evento de
  // realtime reentrega. Substituída pelo teste quando quer mudar a config.
  linha: { id: 1 } as Record<string, unknown>,
}));

// Builder encadeável e "thenable" — mesmo padrão de
// store-context-nao-mexe-em-dark.test.tsx.
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
    from: (tabela: string) =>
      tabela === "store_config"
        ? construtorEncadeavel({ data: h.linha, error: null })
        : construtorEncadeavel({ data: [], error: null }),
    rpc: () => construtorEncadeavel({ data: null, error: null }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// do casco citado.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Linha com valores explícitos — nada de defaults escondendo divergência.
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

// Contador de COMMITS (efeito sem deps roda a todo commit): sem
// re-render, não há commit novo — a escrita em variável de módulo mora no
// efeito, nunca no render (mesmo padrão de latest-ref do casco dark).
const contadores = {
  commits: 0,
  config: null as StoreConfig | null,
};

function Consumidor() {
  const { config } = useStore();
  useEffect(() => {
    contadores.commits += 1;
    contadores.config = config;
  });
  return null;
}

function dispararSync(newRecord: Record<string, unknown>) {
  const evento = { store: "store_config", eventType: "UPDATE", newRecord };
  for (const cb of callbacksDeSync) {
    cb(evento);
  }
}

describe("StoreContext — realtime com config IDÊNTICA não re-renderiza a casa (laudo 0109, P-5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    callbacksDeSync.length = 0;
    contadores.commits = 0;
    contadores.config = null;
    h.linha = { ...LINHA_DA_LOJA };
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

  it("eco do realtime com a MESMA linha: referência da config não muda", async () => {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Consumidor />
        </StoreProvider>,
      );
    });
    await act(async () => {});

    expect(contadores.config).toBeTruthy();
    expect(contadores.config?.storeName).toBe("Loja Teste");
    const commitsAposMontagem = contadores.commits;
    const referenciaAposMontagem = contadores.config;

    await act(async () => {
      dispararSync({ ...LINHA_DA_LOJA });
    });

    // O ponto do P-5: nada mudou, nada re-renderiza. Com o defeito, o
    // listener setava um objeto NOVO e o contador subia aqui.
    expect(contadores.commits).toBe(commitsAposMontagem);
    expect(contadores.config).toBe(referenciaAposMontagem);
  });

  it("controle — realtime com mudança REAL: a config atualiza de verdade", async () => {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Consumidor />
        </StoreProvider>,
      );
    });
    await act(async () => {});

    const commitsAposMontagem = contadores.commits;

    await act(async () => {
      dispararSync({ ...LINHA_DA_LOJA, shipping_fee: 99 });
    });

    expect(contadores.config?.shippingFee).toBe(99);
    expect(contadores.commits).toBeGreaterThan(commitsAposMontagem);
  });

  // Ressalva da revisão adversária (aplicada): `home_sections` é array de
  // OBJETOS e a linha nasce preenchida (a semente grava o default). O
  // round-trip do jsonb troca a referência do array e a ordem das chaves a
  // cada eco — pela guarda por `===` a loja com vitrines salvas
  // re-renderizava do mesmo jeito. O eco abaixo tem o MESMO CONTEÚDO com
  // referências TODAS novas e chaves embaralhadas, exatamente o que o banco
  // devolve.
  const VITRINES_SALVAS = [
    {
      id: "s1",
      title: "Queridinhas",
      active: true,
      type: "most_loved",
      maxItems: 8,
      productIds: ["p1", "p2"],
      isCustom: false,
    },
    {
      id: "s2",
      title: "Novidades",
      active: true,
      type: "recent",
      maxItems: 8,
      productIds: [],
      isCustom: false,
    },
  ];

  function ecoComVitrines(secoes: unknown[]): Record<string, unknown> {
    // Reconstrói TUDO por cima (array novo, objetos novos, chaves em outra
    // ordem) — zero referência compartilhada com a linha montada.
    return {
      ...LINHA_DA_LOJA,
      home_sections: secoes.map((s) => {
        const obj = s as Record<string, unknown>;
        return Object.fromEntries(
          Object.entries(obj).reverse(),
        ) as Record<string, unknown>;
      }),
    };
  }

  it("eco idêntico com vitrines SALVAS: referência da config não muda", async () => {
    h.linha = { ...LINHA_DA_LOJA, home_sections: VITRINES_SALVAS };
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Consumidor />
        </StoreProvider>,
      );
    });
    await act(async () => {});

    expect(contadores.config?.homeSections?.length).toBe(2);
    const commitsAposMontagem = contadores.commits;
    const referenciaAposMontagem = contadores.config;

    await act(async () => {
      dispararSync(ecoComVitrines(VITRINES_SALVAS));
    });

    expect(contadores.commits).toBe(commitsAposMontagem);
    expect(contadores.config).toBe(referenciaAposMontagem);
  });

  it("controle — vitrines salvas com mudança REAL: a config atualiza", async () => {
    h.linha = { ...LINHA_DA_LOJA, home_sections: VITRINES_SALVAS };
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Consumidor />
        </StoreProvider>,
      );
    });
    await act(async () => {});

    const commitsAposMontagem = contadores.commits;

    await act(async () => {
      dispararSync(
        ecoComVitrines(
          VITRINES_SALVAS.map((s) => ({ ...s, maxItems: 9 })),
        ),
      );
    });

    expect(contadores.config?.homeSections?.[0]?.maxItems).toBe(9);
    expect(contadores.commits).toBeGreaterThan(commitsAposMontagem);
  });
});
