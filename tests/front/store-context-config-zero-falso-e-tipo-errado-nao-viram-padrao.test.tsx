// @vitest-environment jsdom
//
// CONFIGURACOES GERAIS DA LOJA x StoreContext — o que a loja LE do banco e o
// que o painel GRAVA, nos valores de borda: zero, falso, lista vazia, numero
// que chega como texto, estilo de card desconhecido, chave em camelCase (a
// copia do cofre offline) e coluna ausente.
//
// O que protege: "zero" e "falso" sao ESCOLHAS da lojista (taxa de entrega
// R$ 0, avaliacoes desligadas, cupons desligados, frete gratis desligado), e
// nao ausencia. Se a leitura tratar 0/false como "faltou" volta o padrao de
// fabrica (taxa 15, avaliacoes ligadas) por cima do que a lojista escolheu; se a
// gravacao tratar 0/false como "vazio", o valor nunca chega ao banco e a tela
// diz "salvo" para uma regra que nao mudou. Sem mutacao isto passava: os
// vizinhos (store-context-modo-e-prazo-da-entrega) cobrem so os campos da
// entrega propria.
//
// RENDER DE VERDADE do StoreProvider (react-dom/client + jsdom), como nos
// vizinhos: um duble de contexto nao prova nada sobre mapConfig/updateConfig.
import { act, useEffect, useRef } from "react";
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

const { linhaDaLoja, rpcResultado, rpcArgsCapturados } = vi.hoisted(() => ({
  linhaDaLoja: { valor: {} as Record<string, unknown> },
  rpcResultado: { data: null as unknown, error: null as unknown },
  rpcArgsCapturados: {
    valor: undefined as Record<string, unknown> | undefined,
  },
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
vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function consultaEncadeada(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => consultaEncadeada(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
      }
      return () => consultaEncadeada(resultado);
    },
    apply() {
      return consultaEncadeada(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      consultaEncadeada(
        tabela === "store_config" || tabela === "v_store_config"
          ? { data: linhaDaLoja.valor, error: null }
          : { data: [], error: null },
      ),
    rpc: (_nome: string, args: Record<string, unknown>) => {
      rpcArgsCapturados.valor = args?.config_json as
        | Record<string, unknown>
        | undefined;
      return consultaEncadeada(rpcResultado);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type UpdateConfigFn = (
  updates: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<boolean>;

const visto: {
  config: StoreConfig | null;
  updateConfig: UpdateConfigFn | null;
} = { config: null, updateConfig: null };

function Capturador() {
  const { config, updateConfig } = useStore();
  const ref = useRef(visto);
  useEffect(() => {
    ref.current.config = config;
    ref.current.updateConfig = updateConfig as UpdateConfigFn;
  });
  return null;
}

// A linha que o banco devolveria hoje, nos padroes de fabrica (taxa 15,
// avaliacoes e cupons ligados, frete gratis desligado).
function linhaBase(): Record<string, unknown> {
  return {
    id: 1,
    free_shipping_min: 0,
    shipping_fee: 15,
    whatsapp_number: "34999999999",
    share_text: "Olha que achei na IKCOUS!",
    business_hours: null,
    enable_reviews: true,
    enable_coupons: true,
    theme_mode: "light",
    real_time_sales_alerts: true,
    push_marketing_enabled: false,
    origin_cep: "38500-000",
    shipping_provider: "flat_fee",
    enabled_shipping_methods: ["sedex", "pac", "store-pickup"],
    shipping_coverage: "local",
    local_delivery_fee: 10,
    local_cep_range: "",
    store_address: "Rua Fictícia de Teste, 100 — Centro",
  };
}

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await Promise.resolve();
  });
}

describe("StoreContext x configuracoes gerais: zero, falso e tipo errado", () => {
  let raiz: Root | undefined;
  let hospedeiro: HTMLDivElement | undefined;

  async function montar(linha: Record<string, unknown>) {
    linhaDaLoja.valor = linha;
    visto.config = null;
    visto.updateConfig = null;
    rpcArgsCapturados.valor = undefined;
    rpcResultado.data = null;
    rpcResultado.error = null;
    const caixa = document.createElement("div");
    document.body.appendChild(caixa);
    const raizNova = createRoot(caixa);
    hospedeiro = caixa;
    raiz = raizNova;
    await act(async () => {
      raizNova.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      );
    });
    await drenar();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (raiz) {
      const aDesmontar = raiz;
      act(() => {
        aDesmontar.unmount();
      });
    }
    hospedeiro?.remove();
    raiz = undefined;
    hospedeiro = undefined;
  });

  describe("leitura", () => {
    it("zero e falso vindos do banco sao ESCOLHA da lojista, nao 'faltou': nao viram o padrao de fabrica", async () => {
      await montar({
        ...linhaBase(),
        shipping_fee: 0,
        local_delivery_fee: 0,
        enable_reviews: false,
        enable_coupons: false,
        real_time_sales_alerts: false,
      });
      expect(visto.config?.shippingFee).toBe(0);
      expect(visto.config?.localDeliveryFee).toBe(0);
      expect(visto.config?.enableReviews).toBe(false);
      expect(visto.config?.enableCoupons).toBe(false);
      expect(visto.config?.realTimeSalesAlerts).toBe(false);
    });

    it("numero que chega como TEXTO (numeric do banco) vira numero", async () => {
      await montar({
        ...linhaBase(),
        free_shipping_min: "149.90",
        shipping_fee: "12.50",
        local_delivery_fee: "7.00",
      });
      expect(visto.config?.freeShippingMin).toBe(149.9);
      expect(visto.config?.shippingFee).toBe(12.5);
      expect(visto.config?.localDeliveryFee).toBe(7);
      expect(typeof visto.config?.freeShippingMin).toBe("number");
    });

    it("frete gratis ausente ou nulo lê como DESLIGADO (0), nunca os 350 de fabrica", async () => {
      const semAColuna = linhaBase();
      // biome-ignore lint/performance/noDelete: simula banco sem a coluna.
      delete semAColuna.free_shipping_min;
      await montar(semAColuna);
      expect(visto.config?.freeShippingMin).toBe(0);

      await act(async () => {
        raiz?.unmount();
      });
      raiz = undefined;
      hospedeiro?.remove();

      await montar({ ...linhaBase(), free_shipping_min: null });
      expect(visto.config?.freeShippingMin).toBe(0);
    });

    it("estilo do card: so 'compacto' vale; ausente ou desconhecido lê 'completo'", async () => {
      await montar({ ...linhaBase(), free_shipping_card_style: "compacto" });
      expect(visto.config?.freeShippingCardStyle).toBe("compacto");
    });

    it("estilo do card desconhecido (lixo no banco) lê 'completo'", async () => {
      await montar({ ...linhaBase(), free_shipping_card_style: "mini" });
      expect(visto.config?.freeShippingCardStyle).toBe("completo");
    });

    it("estilo do card ausente lê 'completo'", async () => {
      await montar(linhaBase());
      expect(visto.config?.freeShippingCardStyle).toBe("completo");
    });

    it("chave em camelCase (copia do cofre offline) é lida; a snake_case vence quando as duas existem", async () => {
      await montar({
        ...linhaBase(),
        free_shipping_min: undefined,
        freeShippingMin: 80,
        shipping_fee: 20,
        shippingFee: 99,
      });
      expect(visto.config?.freeShippingMin).toBe(80);
      expect(visto.config?.shippingFee).toBe(20);
    });

    it("snake_case NULA cai na camelCase (nulo não é valor)", async () => {
      await montar({
        ...linhaBase(),
        free_shipping_min: null,
        freeShippingMin: 70,
      });
      expect(visto.config?.freeShippingMin).toBe(70);
    });

    it("formas na entrega: lista vazia é escolha (só pelo app); ausente ou lixo cai nas três", async () => {
      await montar({ ...linhaBase(), formas_pagamento_entrega: [] });
      expect(visto.config?.formasPagamentoEntrega).toEqual([]);
    });

    it("formas na entrega com um item desconhecido caem no padrão inteiro", async () => {
      await montar({
        ...linhaBase(),
        formas_pagamento_entrega: ["pix", "boleto"],
      });
      expect(visto.config?.formasPagamentoEntrega).toEqual([
        "pix",
        "card",
        "cash",
      ]);
    });

    it("formas na entrega ausentes caem nas três", async () => {
      await montar(linhaBase());
      expect(visto.config?.formasPagamentoEntrega).toEqual([
        "pix",
        "card",
        "cash",
      ]);
    });
  });

  describe("gravacao: zero, falso e lista vazia VAO para o banco", () => {
    const casos: ReadonlyArray<{
      nome: string;
      campo: string;
      coluna: string;
      valor: unknown;
      linhaAntes?: Record<string, unknown>;
    }> = [
      {
        nome: "frete gratis desligado (0)",
        campo: "freeShippingMin",
        coluna: "free_shipping_min",
        valor: 0,
        linhaAntes: { free_shipping_min: 150 },
      },
      {
        nome: "taxa de entrega R$ 0",
        campo: "shippingFee",
        coluna: "shipping_fee",
        valor: 0,
      },
      {
        nome: "avaliacoes desligadas",
        campo: "enableReviews",
        coluna: "enable_reviews",
        valor: false,
      },
      {
        nome: "cupons desligados",
        campo: "enableCoupons",
        coluna: "enable_coupons",
        valor: false,
      },
      {
        nome: "avisos de venda em tempo real desligados",
        campo: "realTimeSalesAlerts",
        coluna: "real_time_sales_alerts",
        valor: false,
      },
      {
        nome: "avisos de promocao (push de marketing) desligados",
        campo: "pushMarketingEnabled",
        coluna: "push_marketing_enabled",
        valor: false,
        linhaAntes: { push_marketing_enabled: true },
      },
      {
        nome: "so pelo app (nenhuma forma na entrega)",
        campo: "formasPagamentoEntrega",
        coluna: "formas_pagamento_entrega",
        valor: [],
      },
      {
        nome: "card de frete gratis compacto",
        campo: "freeShippingCardStyle",
        coluna: "free_shipping_card_style",
        valor: "compacto",
      },
    ];

    it.each(casos)(
      "$nome: envia a chave, so ela, e a tela passa a mostrar o valor",
      async ({ campo, coluna, valor, linhaAntes }) => {
        await montar({ ...linhaBase(), ...linhaAntes });
        rpcResultado.data = { ...linhaBase(), ...linhaAntes, [coluna]: valor };

        let ok: boolean | undefined;
        await act(async () => {
          ok = await visto.updateConfig?.({ [campo]: valor });
        });

        expect(ok).toBe(true);
        expect(rpcArgsCapturados.valor).toEqual({ [coluna]: valor });
        expect(visto.config).toMatchObject({ [campo]: valor });
      },
    );

    it("chave omitida nao vai ao banco (so o que a lojista mexeu)", async () => {
      await montar(linhaBase());
      rpcResultado.data = { ...linhaBase(), shipping_fee: 22 };
      await act(async () => {
        await visto.updateConfig?.({ shippingFee: 22 });
      });
      expect(Object.keys(rpcArgsCapturados.valor ?? {})).toEqual([
        "shipping_fee",
      ]);
    });
  });
});
