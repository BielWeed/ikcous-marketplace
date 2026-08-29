// @vitest-environment jsdom
//
// StoreContext.updateConfig dizia "Configurações salvas" só porque a RPC
// upsert_store_config não devolveu erro -- nunca conferindo o QUE foi
// gravado. A RPC tem lista fixa de colunas (INSERT e ON CONFLICT DO UPDATE):
// qualquer chave fora dela é descartada em silêncio, `updated_at = now()`
// roda do mesmo jeito, e a função ainda devolve sucesso. Foi assim que
// `home_sections` nunca gravou (a coluna nem existe hoje -- isso é outra
// tarefa; esta aqui é sobre a tela nunca ter conferido nada).
//
// A correção: `upsert_store_config` já devolve a linha inteira gravada
// (`RETURNING to_jsonb(public.store_config.*)`). `updateConfig` passa a
// exigir que toda chave que ela mandou esteja presente no retorno, com
// valor equivalente -- e só então declara sucesso.
//
// POR QUE RENDER DE VERDADE DO StoreProvider (react-dom/client + jsdom):
// mesmo padrão de store-context-nao-mexe-em-dark.test.tsx -- um dublê de
// contexto não prova nada sobre o que `updateConfig` realmente faz com o
// retorno da RPC.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StoreProvider,
  TIPO_DAS_COLUNAS_STORE_CONFIG,
  useStore,
} from "@/contexts/StoreContext";
import type { StoreConfig } from "@/types";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

// `vi.mock` é hoisted para o topo do arquivo -- por causa do import ESTÁTICO
// de StoreContext logo abaixo, a fábrica do mock roda no momento do import,
// antes de qualquer `const` deste arquivo terminar de inicializar. `vi.hoisted`
// existe exatamente para isso: sobe a inicialização junto com o mock.
const { dataVaultPut, rpcResultado, rpcArgsCapturados } = vi.hoisted(() => ({
  dataVaultPut: vi.fn().mockResolvedValue(undefined),
  // O que a RPC devolve neste teste -- mutado por cada `it` ANTES de chamar
  // `updateConfig`. `rpc` é lido de forma preguiçosa (só quando updateConfig
  // chama), então mutar este objeto entre a montagem do provider e a
  // chamada é seguro.
  rpcResultado: { data: null as unknown, error: null as unknown },
  // `config_json` que `updateConfig` de fato mandou para `supabase.rpc` na
  // última chamada -- achado do revisor: o dublê original de `rpc` ignorava
  // totalmente os argumentos. O teste do ACHADO A2 precisa do `dbUpdates`
  // real para comparar contra `TIPO_DAS_COLUNAS_STORE_CONFIG`.
  rpcArgsCapturados: {
    valor: undefined as Record<string, unknown> | undefined,
  },
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: dataVaultPut,
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

// Builder encadeável e "thenable" -- mesmo padrão de
// store-context-nao-mexe-em-dark.test.tsx: cobre `.from().select().single()`
// (fetchConfig) e `.from().select().is().limit().order()` (fetchProducts)
// sem replicar a assinatura exata de cada chamada.
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
    from: () => construtorEncadeavel({ data: [], error: null }),
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

type UpdateConfigFn = (updates: Record<string, unknown>) => Promise<boolean>;

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

// Linha completa que `to_jsonb(public.store_config.*)` devolveria hoje --
// sem `home_sections`, porque a coluna não existe (tarefa separada). Cada
// teste clona e ajusta o que precisa.
function linhaConfigBase(): Record<string, unknown> {
  return {
    id: 1,
    free_shipping_min: 350,
    shipping_fee: 15,
    whatsapp_number: "34999999999",
    share_text: "Olha que achei na IKCOUS!",
    business_hours: "Seg-Sáb: 9h às 18h",
    enable_reviews: true,
    enable_coupons: true,
    logo_url: null,
    primary_color: "#000000",
    theme_mode: "light",
    real_time_sales_alerts: true,
    push_marketing_enabled: false,
    min_app_version: null,
    store_name: null,
    store_city: null,
    store_state: null,
    origin_cep: null,
    shipping_provider: "flat_fee",
    enabled_shipping_methods: ["sedex", "pac"],
    shipping_coverage: "national",
    local_delivery_fee: 10,
    local_cep_range: "",
    updated_at: "2026-08-22T00:00:00.000Z",
  };
}

describe("StoreContext.updateConfig — não declara sucesso sem conferir o retorno da RPC", () => {
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("TESTE CENTRAL — retorno sem a chave home_sections (o que o banco faz hoje): updateConfig devolve false, sem toast de sucesso e sem gravar no DataVault", async () => {
    const linha = linhaConfigBase();
    // home_sections propositalmente ausente -- é o defeito real de hoje.
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [{ id: "offers", title: "Ofertas", active: true }],
      });
    });

    expect(resultado).toBe(false);

    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();

    // O DataVault é gravado dentro do updater funcional passado a
    // `setConfig("store_config", ...)`. Se a verificação falhar antes disso,
    // `put` nunca roda com a config nova.
    expect(dataVaultPut).not.toHaveBeenCalled();
  });

  it("caminho feliz: retorno confirma cada chave enviada (frete, cor, WhatsApp) — sucesso e grava no DataVault", async () => {
    const linha = linhaConfigBase();
    linha.free_shipping_min = 400;
    linha.shipping_fee = 20;
    linha.whatsapp_number = "34988887777";
    linha.primary_color = "#123456";
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        freeShippingMin: 400,
        shippingFee: 20,
        whatsappNumber: "34988887777",
        primaryColor: "#123456",
      });
    });

    expect(resultado).toBe(true);

    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(dataVaultPut).toHaveBeenCalled();
    const [, gravado] = dataVaultPut.mock.calls[0];
    expect(gravado.freeShippingMin).toBe(400);
    expect(gravado.whatsappNumber).toBe("34988887777");
  });

  it("tipo numeric: front manda string, banco devolve number — considera confirmado", async () => {
    const linha = linhaConfigBase();
    linha.shipping_fee = 25; // banco sempre devolve number
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      // Simula input HTML não parseado chegando como string.
      resultado = await updateConfigRef.current!({ shippingFee: "25" as any });
    });

    expect(resultado).toBe(true);
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalled();
  });

  it("tipo numeric: banco devolve valor diferente do enviado — falha fechado", async () => {
    const linha = linhaConfigBase();
    linha.shipping_fee = 999; // divergente do que foi pedido
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({ shippingFee: 25 });
    });

    expect(resultado).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("ACHADO A1: tipo numeric — banco devolve null (coluna não gravou) para um envio de 0 — falha fechado, Number(null) não pode virar confirmação de Number(0)", async () => {
    const linha = linhaConfigBase();
    linha.shipping_fee = null; // coluna não gravou de verdade
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({ shippingFee: 0 });
    });

    expect(resultado).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("ACHADO A1: tipo numeric — front manda string vazia e banco devolve 0 — falha fechado, Number('') não pode virar confirmação de Number(0)", async () => {
    const linha = linhaConfigBase();
    linha.shipping_fee = 0;
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({ shippingFee: "" as any });
    });

    expect(resultado).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("tipo boolean: enviado e gravado batendo — considera confirmado", async () => {
    const linha = linhaConfigBase();
    linha.enable_coupons = false;
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({ enableCoupons: false });
    });

    expect(resultado).toBe(true);
  });

  it("tipo boolean: banco devolve o valor OPOSTO do pedido — falha fechado, não só 'diferente de undefined'", async () => {
    const linha = linhaConfigBase();
    linha.enable_coupons = true; // pediu false, banco ficou com true
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({ enableCoupons: false });
    });

    expect(resultado).toBe(false);
  });

  it("tipo texto com null explícito (campo que a loja limpou): null enviado e null gravado — considera confirmado", async () => {
    const linha = linhaConfigBase();
    linha.origin_cep = null;
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({ originCep: null as any });
    });

    expect(resultado).toBe(true);
  });

  it("tipo texto_array: enabled_shipping_methods bate elemento a elemento — considera confirmado", async () => {
    const linha = linhaConfigBase();
    linha.enabled_shipping_methods = ["pac", "sedex"];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        enabledShippingMethods: ["pac", "sedex"],
      });
    });

    expect(resultado).toBe(true);
  });

  it("tipo texto_array: banco devolve com um método a menos — falha fechado", async () => {
    const linha = linhaConfigBase();
    linha.enabled_shipping_methods = ["pac"]; // "sedex" sumiu
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        enabledShippingMethods: ["pac", "sedex"],
      });
    });

    expect(resultado).toBe(false);
  });

  it("tipo home_sections: mesmo conteúdo, chaves em ordem diferente dentro do objeto — considera confirmado (jsonb não garante ordem de chave)", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [
      { active: true, title: "Ofertas", id: "offers" },
      { id: "bestsellers", active: false, title: "Destaques", maxItems: 8 },
    ];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [
          { id: "offers", title: "Ofertas", active: true },
          { id: "bestsellers", title: "Destaques", active: false, maxItems: 8 },
        ],
      });
    });

    expect(resultado).toBe(true);
  });

  it("tipo home_sections: ORDEM das vitrines trocada — falha fechado (a ordem decide o que aparece primeiro na home)", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [
      { id: "bestsellers", title: "Destaques", active: false },
      { id: "offers", title: "Ofertas", active: true },
    ];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [
          { id: "offers", title: "Ofertas", active: true },
          { id: "bestsellers", title: "Destaques", active: false },
        ],
      });
    });

    expect(resultado).toBe(false);
  });

  it("tipo home_sections: seção com productIds (array) -- mesmo conteúdo, round-trip por jsonb devolve array NOVO -- considera confirmado (era o defeito: [] === [] é sempre false, e reprovava toda gravação de vitrine personalizada)", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [
      {
        id: "vitrine-custom-1",
        title: "Selecionados",
        active: true,
        type: "custom",
        maxItems: 8,
        productIds: [],
        isCustom: true,
      },
    ];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [
          {
            id: "vitrine-custom-1",
            title: "Selecionados",
            active: true,
            type: "custom",
            maxItems: 8,
            productIds: [],
            isCustom: true,
          },
        ],
      });
    });

    expect(resultado).toBe(true);
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("tipo home_sections: productIds com produtos selecionados (curadoria) -- confirma", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [
      {
        id: "vitrine-custom-1",
        title: "Selecionados",
        active: true,
        type: "custom",
        maxItems: 8,
        productIds: ["prod-1", "prod-2", "prod-3"],
        isCustom: true,
      },
    ];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [
          {
            id: "vitrine-custom-1",
            title: "Selecionados",
            active: true,
            type: "custom",
            maxItems: 8,
            productIds: ["prod-1", "prod-2", "prod-3"],
            isCustom: true,
          },
        ],
      });
    });

    expect(resultado).toBe(true);
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalled();
  });

  it("tipo home_sections: productIds em ORDEM diferente dentro da mesma seção -- falha fechado", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [
      {
        id: "vitrine-custom-1",
        title: "Selecionados",
        active: true,
        type: "custom",
        maxItems: 8,
        productIds: ["prod-2", "prod-1", "prod-3"],
        isCustom: true,
      },
    ];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [
          {
            id: "vitrine-custom-1",
            title: "Selecionados",
            active: true,
            type: "custom",
            maxItems: 8,
            productIds: ["prod-1", "prod-2", "prod-3"],
            isCustom: true,
          },
        ],
      });
    });

    expect(resultado).toBe(false);
  });

  it("tipo home_sections: gravado sem uma chave que a seção enviada tinha -- falha fechado", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [
      {
        id: "vitrine-custom-1",
        title: "Selecionados",
        active: true,
        type: "custom",
        // maxItems ausente -- coluna gravou a seção incompleta
        productIds: [],
        isCustom: true,
      },
    ];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [
          {
            id: "vitrine-custom-1",
            title: "Selecionados",
            active: true,
            type: "custom",
            maxItems: 8,
            productIds: [],
            isCustom: true,
          },
        ],
      });
    });

    expect(resultado).toBe(false);
  });

  it("tipo home_sections: productIds com um produto diferente do enviado -- falha fechado", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [
      {
        id: "vitrine-custom-1",
        title: "Selecionados",
        active: true,
        type: "custom",
        maxItems: 8,
        productIds: ["prod-1", "prod-9"],
        isCustom: true,
      },
    ];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        homeSections: [
          {
            id: "vitrine-custom-1",
            title: "Selecionados",
            active: true,
            type: "custom",
            maxItems: 8,
            productIds: ["prod-1", "prod-2"],
            isCustom: true,
          },
        ],
      });
    });

    expect(resultado).toBe(false);
  });

  it("retorno vazio/nulo: falha fechado, nunca sucesso por default", async () => {
    rpcResultado.data = null;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        whatsappNumber: "34988887777",
      });
    });

    expect(resultado).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("decisão do COALESCE-no-INSERT: se um dia alguém mandar null para uma coluna com default (hoje nenhum call site manda), o comparador não finge sucesso", async () => {
    // Simula o que a RPC faria no ramo INSERT (linha nova) se `dbUpdates`
    // mandasse `whatsapp_number: null`: a COALESCE grava o default
    // '5534999999999' em vez de null. Isto é hoje inalcançável pelo app
    // (ver comentário em StoreContext.tsx), mas o comparador tem de
    // continuar honesto se isso um dia acontecer.
    const linha = linhaConfigBase();
    linha.whatsapp_number = "5534999999999"; // default do COALESCE, não null
    rpcResultado.data = linha;
    rpcResultado.error = null;

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await updateConfigRef.current!({
        whatsappNumber: null as any,
      });
    });

    expect(resultado).toBe(false);
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("ACHADO A2: as colunas que updateConfig manda para a RPC batem exatamente com as que o comparador conhece (TIPO_DAS_COLUNAS_STORE_CONFIG) — chave nova em só um dos dois lados reprova AQUI, não em produção", async () => {
    const linha = linhaConfigBase();
    linha.home_sections = [];
    rpcResultado.data = linha;
    rpcResultado.error = null;

    // Preenche TODAS as chaves de StoreConfig para que `dbUpdates` (dentro
    // de updateConfig) percorra os 23 `if` e produza a lista completa de
    // colunas que ela sabe mandar.
    // `Required<>` e nao `StoreConfig`: 16 dos 23 campos de StoreConfig sao
    // opcionais, e campo novo aqui nasce opcional. Com o tipo frouxo, um campo
    // novo que o `updateConfig` passasse a mandar NAO seria cobrado neste
    // literal — a fixture nao o setaria, `dbUpdates` nunca o produziria, e a
    // comparacao de conjunto abaixo ficaria VERDE sem cobrir nada. `Required<>`
    // devolve o gatilho para onde o campo nasce: o typecheck fica vermelho no
    // instante em que StoreConfig cresce.
    const todasAsChaves: Required<StoreConfig> = {
      freeShippingMin: 1,
      shippingFee: 1,
      whatsappNumber: "34900000000",
      shareText: "x",
      businessHours: "x",
      enableReviews: true,
      enableCoupons: true,
      logoUrl: "https://exemplo.com/logo.png",
      primaryColor: "#111111",
      themeMode: "light",
      realTimeSalesAlerts: true,
      pushMarketingEnabled: true,
      minAppVersion: "1.0.0",
      storeName: "x",
      storeCity: "x",
      storeState: "MG",
      originCep: "38500-000",
      shippingProvider: "flat_fee",
      enabledShippingMethods: ["sedex"],
      shippingCoverage: "national",
      localDeliveryFee: 1,
      localCepRange: "x",
      homeSections: [],
    };

    await act(async () => {
      await updateConfigRef.current!(
        todasAsChaves as unknown as Record<string, unknown>,
      );
    });

    const chavesEnviadas = Object.keys(rpcArgsCapturados.valor ?? {}).sort();
    const chavesConhecidas = Array.from(
      TIPO_DAS_COLUNAS_STORE_CONFIG.keys(),
    ).sort();
    expect(chavesEnviadas).toEqual(chavesConhecidas);
  });
});
