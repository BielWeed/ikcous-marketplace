// @vitest-environment jsdom
//
// "LOJA PRONTA" × StoreContext (27/11/2026, migration 20261652000000): a leitura
// das duas colunas de confirmação de `store_config` (`entrega_confirmada_em`,
// `pagamento_confirmado_em`) — coluna AUSENTE (banco atrasado) vale confirmado,
// coluna presente e vazia é a loja nova que ainda não confirmou — e a gravação
// pela RPC de sempre, com a conferência de que o banco carimbou mesmo.
//
// Mesmo dublê de store-context-modo-e-prazo-da-entrega.test.tsx: RENDER DE
// VERDADE do StoreProvider; só a rede e o cofre são de mentira.
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  StoreProvider,
  TIPO_DAS_COLUNAS_STORE_CONFIG,
  useStore,
} from "@/contexts/StoreContext";
import {
  confirmacaoAoSalvarAEntrega,
  confirmacaoAoSalvarOPagamento,
} from "@/lib/loja-pronta";
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

describe("StoreContext × a loja confirma o que veio de fábrica (20261652000000)", () => {
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

  async function gravar(updates: Record<string, unknown>) {
    let ok: boolean | undefined;
    await act(async () => {
      ok = await visto.updateConfig!(updates);
    });
    return ok;
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

  it("o comparador do 'gravou mesmo?' conhece as duas colunas como carimbo", () => {
    expect(TIPO_DAS_COLUNAS_STORE_CONFIG.get("entrega_confirmada_em")).toBe(
      "carimbo",
    );
    expect(TIPO_DAS_COLUNAS_STORE_CONFIG.get("pagamento_confirmado_em")).toBe(
      "carimbo",
    );
  });

  describe("leitura", () => {
    it("banco SEM as colunas (migration ainda não rodou): o campo nem entra — a Loja pronta lê como confirmado", async () => {
      await montar(linhaBase());
      // Nada de `false` (que pediria confirmação) nem de `true` inventado
      // (que faria a config lida diferir do cofre e regravá-lo à toa).
      expect(visto.config && "entregaConfirmada" in visto.config).toBe(false);
      expect(visto.config && "pagamentoConfirmado" in visto.config).toBe(false);
      expect(confirmacaoAoSalvarAEntrega(visto.config)).toEqual({});
      expect(confirmacaoAoSalvarOPagamento(visto.config)).toEqual({});
    });

    it("coluna presente e vazia (loja nova): falta confirmar; com data: confirmado", async () => {
      await montar({
        ...linhaBase(),
        entrega_confirmada_em: null,
        pagamento_confirmado_em: "2026-11-27T12:00:00+00:00",
      });
      expect(visto.config?.entregaConfirmada).toBe(false);
      expect(visto.config?.pagamentoConfirmado).toBe(true);
    });
  });

  describe("gravação", () => {
    it("'Está certo' manda a chave com true e aceita a data que o banco carimbou", async () => {
      await montar({ ...linhaBase(), entrega_confirmada_em: null });
      rpcResultado.data = {
        ...linhaBase(),
        entrega_confirmada_em: "2026-11-27T22:00:00.123+00:00",
      };
      expect(await gravar({ entregaConfirmada: true })).toBe(true);
      expect(rpcArgsCapturados.valor).toEqual({ entrega_confirmada_em: true });
      expect(visto.config?.entregaConfirmada).toBe(true);
    });

    it("o pagamento vai junto com as formas no mesmo pedido", async () => {
      await montar({ ...linhaBase(), pagamento_confirmado_em: null });
      rpcResultado.data = {
        ...linhaBase(),
        formas_pagamento_entrega: ["pix"],
        pagamento_confirmado_em: "2026-11-27T22:00:00+00:00",
      };
      expect(
        await gravar({
          formasPagamentoEntrega: ["pix"],
          pagamentoConfirmado: true,
        }),
      ).toBe(true);
      expect(rpcArgsCapturados.valor).toEqual({
        formas_pagamento_entrega: ["pix"],
        pagamento_confirmado_em: true,
      });
      expect(visto.config?.pagamentoConfirmado).toBe(true);
    });

    it("banco que não devolve a coluna (sem a migration) ou devolve vazia: NÃO finge que confirmou", async () => {
      await montar({ ...linhaBase(), entrega_confirmada_em: null });
      rpcResultado.data = linhaBase();
      expect(await gravar({ entregaConfirmada: true })).toBe(false);
      rpcResultado.data = { ...linhaBase(), entrega_confirmada_em: null };
      expect(await gravar({ entregaConfirmada: true })).toBe(false);
      expect(visto.config?.entregaConfirmada).toBe(false);
    });

    it("false nunca vai ao banco (não existe desconfirmar)", async () => {
      await montar(linhaBase());
      rpcResultado.data = { ...linhaBase(), shipping_fee: 20 };
      await gravar({ shippingFee: 20, entregaConfirmada: false });
      expect(rpcArgsCapturados.valor).toEqual({ shipping_fee: 20 });
    });
  });
});
