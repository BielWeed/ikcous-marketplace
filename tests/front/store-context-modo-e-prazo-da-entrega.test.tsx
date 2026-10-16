// @vitest-environment jsdom
//
// "COMO ENTREGO NA MINHA CIDADE" (16/10/2026) × StoreContext: a leitura e a
// gravação dos dois campos novos de `store_config`
// (`local_delivery_enabled`, `local_delivery_days`), a conferência de que o
// banco GRAVOU de verdade, e a frase de lojista quando a trigger do banco
// recusa "Só retiro" sem a retirada ligada.
//
// RENDER DE VERDADE do StoreProvider (react-dom/client + jsdom), como em
// store-context-vitrine-nao-declara-sucesso-sem-conferir.test.tsx: um dublê
// de contexto não prova nada sobre o que `updateConfig`/`mapConfig` fazem.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StoreProvider,
  TIPO_DAS_COLUNAS_STORE_CONFIG,
  useStore,
} from "@/contexts/StoreContext";
import { modoDaEntregaNaCidade } from "@/lib/guarda-de-frete";
import type { StoreConfig } from "@/types";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const { linhaDaLoja, rpcResultado, rpcArgsCapturados, cofrePut } = vi.hoisted(
  () => ({
    // O `put` do cofre offline: regravá-lo à toa é o sintoma de "config mudou"
    // onde nada mudou.
    cofrePut: vi.fn().mockResolvedValue(undefined),
    // A linha que `store_config`/`v_store_config` devolvem na leitura.
    linhaDaLoja: { valor: {} as Record<string, unknown> },
    rpcResultado: { data: null as unknown, error: null as unknown },
    rpcArgsCapturados: {
      valor: undefined as Record<string, unknown> | undefined,
    },
  }),
);

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: cofrePut,
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

// A linha que o banco devolveria HOJE, sem as colunas novas (banco sem a
// migration) — cada caso acrescenta o que precisa.
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

describe("StoreContext × modo e prazo da entrega própria", () => {
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
    // O teste do mapa de colunas não monta o provider.
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

  describe("o mapa de colunas que o comparador do 'gravou mesmo?' consulta", () => {
    it("conhece as duas colunas novas, com o tipo certo", () => {
      expect(TIPO_DAS_COLUNAS_STORE_CONFIG.get("local_delivery_enabled")).toBe(
        "boolean",
      );
      expect(TIPO_DAS_COLUNAS_STORE_CONFIG.get("local_delivery_days")).toBe(
        "numeric",
      );
    });
  });

  describe("leitura", () => {
    it("banco SEM as colunas (migration ainda não rodou): entrega ligada e 1 dia — o comportamento de hoje", async () => {
      await montar(linhaBase());
      expect(visto.config?.localDeliveryEnabled).toBe(true);
      expect(visto.config?.localDeliveryDays).toBe(1);
      expect(modoDaEntregaNaCidade(visto.config)).toBe("entrego_e_retiro");
    });

    it("colunas NULAS (linha corrompida): também os padrões", async () => {
      await montar({
        ...linhaBase(),
        local_delivery_enabled: null,
        local_delivery_days: null,
      });
      expect(visto.config?.localDeliveryEnabled).toBe(true);
      expect(visto.config?.localDeliveryDays).toBe(1);
    });

    it("loja nos padrões: o primeiro carregamento NÃO regrava o cofre (nada mudou, nada se grava à toa)", async () => {
      await montar({});
      expect(cofrePut).not.toHaveBeenCalled();
    });

    it("controle: loja em só retiro MUDA a config lida — aí o cofre é regravado", async () => {
      await montar({ local_delivery_enabled: false });
      expect(cofrePut).toHaveBeenCalled();
    });

    it("loja em só retiro com prazo de 3 dias: lê exatamente o que o banco tem", async () => {
      await montar({
        ...linhaBase(),
        local_delivery_enabled: false,
        local_delivery_days: 3,
      });
      expect(visto.config?.localDeliveryEnabled).toBe(false);
      expect(visto.config?.localDeliveryDays).toBe(3);
      expect(modoDaEntregaNaCidade(visto.config)).toBe("so_retiro");
    });

    it("prazo ZERO é um prazo (mesmo dia), não 'ausente': não vira 1", async () => {
      await montar({ ...linhaBase(), local_delivery_days: 0 });
      expect(visto.config?.localDeliveryDays).toBe(0);
    });

    it("prazo fora da faixa que o CHECK permite (lixo) lê como o padrão", async () => {
      await montar({ ...linhaBase(), local_delivery_days: 99 });
      expect(visto.config?.localDeliveryDays).toBe(1);
    });
  });

  describe("gravação", () => {
    it("manda as duas chaves quando a lojista muda as duas, e só quando muda", async () => {
      await montar(linhaBase());
      rpcResultado.data = {
        ...linhaBase(),
        local_delivery_enabled: false,
        local_delivery_days: 3,
      };
      let ok: boolean | undefined;
      await act(async () => {
        ok = await visto.updateConfig!({
          localDeliveryEnabled: false,
          localDeliveryDays: 3,
        });
      });
      expect(ok).toBe(true);
      expect(rpcArgsCapturados.valor).toEqual({
        local_delivery_enabled: false,
        local_delivery_days: 3,
      });
      expect(visto.config?.localDeliveryEnabled).toBe(false);
      expect(visto.config?.localDeliveryDays).toBe(3);
    });

    it("chave omitida NÃO vai para o banco (a RPC preserva o valor atual)", async () => {
      await montar(linhaBase());
      rpcResultado.data = { ...linhaBase(), shipping_fee: 20 };
      await act(async () => {
        await visto.updateConfig!({ shippingFee: 20 });
      });
      expect(rpcArgsCapturados.valor).toEqual({ shipping_fee: 20 });
      expect(rpcArgsCapturados.valor).not.toHaveProperty(
        "local_delivery_enabled",
      );
      expect(rpcArgsCapturados.valor).not.toHaveProperty("local_delivery_days");
    });

    it("prazo ZERO é enviado (0 não é 'vazio')", async () => {
      await montar(linhaBase());
      rpcResultado.data = { ...linhaBase(), local_delivery_days: 0 };
      let ok: boolean | undefined;
      await act(async () => {
        ok = await visto.updateConfig!({ localDeliveryDays: 0 });
      });
      expect(rpcArgsCapturados.valor).toEqual({ local_delivery_days: 0 });
      expect(ok).toBe(true);
    });

    it("banco antigo (a RPC devolve a linha SEM as colunas): não declara sucesso", async () => {
      await montar(linhaBase());
      rpcResultado.data = linhaBase(); // sem local_delivery_*: a RPC velha descartou
      let ok: boolean | undefined;
      await act(async () => {
        ok = await visto.updateConfig!({ localDeliveryEnabled: false });
      });
      expect(ok).toBe(false);
      const { toast } = await import("sonner");
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
      // E a config da tela não ficou "só retiro" sem o banco ter gravado.
      expect(visto.config?.localDeliveryEnabled).toBe(true);
    });

    it("banco devolve valor diferente do pedido: não declara sucesso", async () => {
      await montar(linhaBase());
      rpcResultado.data = {
        ...linhaBase(),
        local_delivery_enabled: true,
        local_delivery_days: 1,
      };
      let ok: boolean | undefined;
      await act(async () => {
        ok = await visto.updateConfig!({
          localDeliveryEnabled: false,
          localDeliveryDays: 5,
        });
      });
      expect(ok).toBe(false);
    });
  });

  describe("a trigger do banco recusa 'Só retiro' sem retirada ligada", () => {
    it("LOJA_SO_RETIRADA_SEM_RETIRADA vira frase de lojista, não o genérico", async () => {
      await montar(linhaBase());
      rpcResultado.error = { message: "LOJA_SO_RETIRADA_SEM_RETIRADA" };
      let ok: boolean | undefined;
      await act(async () => {
        ok = await visto.updateConfig!({ localDeliveryEnabled: false });
      });
      expect(ok).toBe(false);
      const { toast } = await import("sonner");
      expect(toast.error).toHaveBeenCalledWith(
        "Para entregar só por retirada, ligue a retirada na loja e cadastre o endereço da loja.",
      );
      expect(toast.error).not.toHaveBeenCalledWith(
        "Erro ao salvar as configurações",
      );
    });

    it("o código da outra trigger (formas de pagamento) continua com a frase dela", async () => {
      await montar(linhaBase());
      rpcResultado.error = { message: "LOJA_SEM_FORMA_DE_PAGAMENTO" };
      await act(async () => {
        await visto.updateConfig!({ formasPagamentoEntrega: [] });
      });
      const { toast } = await import("sonner");
      expect(toast.error).toHaveBeenCalledWith(
        "Ligue ao menos uma forma de pagamento — o PIX pelo app está desligado",
      );
    });

    it("erro desconhecido continua no genérico", async () => {
      await montar(linhaBase());
      rpcResultado.error = { message: "algo que ninguém conhece" };
      await act(async () => {
        await visto.updateConfig!({ shippingFee: 20 });
      });
      const { toast } = await import("sonner");
      expect(toast.error).toHaveBeenCalledWith(
        "Erro ao salvar as configurações",
      );
    });
  });
});
