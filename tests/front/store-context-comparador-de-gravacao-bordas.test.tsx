// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) no comparador que confere o retorno da RPC
// `upsert_store_config` (StoreContext.valorFoiGravado): o que decide se a tela
// diz "Configurações salvas" ou avisa que NÃO deu certo. O teste vizinho
// (`store-context-vitrine-nao-declara-sucesso-sem-conferir`) prende a maioria
// dos casos; ficavam soltos:
//   - número que chega como texto SÓ DE ESPAÇOS ("   "): `Number("   ")` é 0 e
//     "confirmaria" um frete de R$ 0 que a lojista nunca pediu;
//   - lista de métodos de entrega gravada em OUTRA ORDEM: a ordem é a
//     prioridade das opções, não pode passar como "igual".
//
// Mutantes equivalentes (sem teste possível, anotados de propósito):
//   - `!Number.isNaN(numEnviado) &&` em `numeric`: `NaN === x` é sempre falso;
//   - `gravado.length === enviado.length &&` em `texto_array`: a comparação do
//     JSON logo depois já exige o mesmo tamanho;
//   - `typeof gravado === "boolean" &&` em `boolean`: o `===` estrito seguinte
//     já recusa qualquer valor que não seja o próprio booleano pedido;
//   - o ramo `enviado === null || enviado === undefined` de
//     `brandingAssetsIguais`: `null` já sai antes, em `valorFoiGravado`, e uma
//     chave `undefined` nunca chega ao comparador (`JSON.stringify` a descarta
//     antes de a RPC ser chamada).
import { act, useEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const { rpcResultado } = vi.hoisted(() => ({
  rpcResultado: { data: null as unknown, error: null as unknown },
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

// Builder encadeável e "thenable" (mesmo padrão do teste vizinho).
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
    rpc: () => construtorEncadeavel(rpcResultado),
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

describe("StoreContext — o comparador da gravação nas bordas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atualizar: { current: UpdateConfigFn | null };

  beforeAll(async () => {
    // Aquece o import pesado (a 1ª compilação do Vite é lenta).
    await import("@/contexts/StoreContext");
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcResultado.data = null;
    rpcResultado.error = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    atualizar = { current: null };
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador
            onReady={(fn) => {
              atualizar.current = fn;
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
    vi.restoreAllMocks();
  });

  async function gravar(
    mudancas: Record<string, unknown>,
    daLinha: (linha: Record<string, unknown>) => void,
  ): Promise<boolean> {
    const linha = linhaConfigBase();
    daLinha(linha);
    rpcResultado.data = linha;
    let resultado = false;
    await act(async () => {
      resultado = await (atualizar.current as UpdateConfigFn)(mudancas);
    });
    return resultado;
  }

  describe("número que chega como texto", () => {
    it.each(["   ", "\t", " \n "])(
      "texto só de espaços (%j) nunca confirma um R$ 0 gravado",
      async (texto) => {
        const resultado = await gravar({ shippingFee: texto }, (l) => {
          l.shipping_fee = 0;
        });
        expect(resultado).toBe(false);
        const { toast } = await import("sonner");
        expect(toast.success).not.toHaveBeenCalled();
      },
    );

    it('texto que não é número ("abc") não confirma nada', async () => {
      const resultado = await gravar({ shippingFee: "abc" }, (l) => {
        l.shipping_fee = 0;
      });
      expect(resultado).toBe(false);
    });

    it.each([
      ["25.5", 25.5],
      ["0", 0],
      [" 12 ", 12],
    ])("texto numérico %j confirma o número gravado %j", async (texto, n) => {
      const resultado = await gravar({ shippingFee: texto }, (l) => {
        l.shipping_fee = n;
      });
      expect(resultado).toBe(true);
    });

    it("número igual no texto mas valor gravado DIFERENTE não confirma", async () => {
      const resultado = await gravar({ shippingFee: "25" }, (l) => {
        l.shipping_fee = 26;
      });
      expect(resultado).toBe(false);
    });
  });

  describe("lista de métodos de entrega", () => {
    it("mesma lista em OUTRA ORDEM não confirma (a ordem é a prioridade)", async () => {
      const resultado = await gravar(
        { enabledShippingMethods: ["sedex", "pac"] },
        (l) => {
          l.enabled_shipping_methods = ["pac", "sedex"];
        },
      );
      expect(resultado).toBe(false);
    });

    it("mesma lista na mesma ordem confirma", async () => {
      const resultado = await gravar(
        { enabledShippingMethods: ["sedex", "pac"] },
        (l) => {
          l.enabled_shipping_methods = ["sedex", "pac"];
        },
      );
      expect(resultado).toBe(true);
    });

    it("gravado como texto solto (não lista) não confirma", async () => {
      const resultado = await gravar(
        { enabledShippingMethods: ["sedex"] },
        (l) => {
          l.enabled_shipping_methods = "sedex";
        },
      );
      expect(resultado).toBe(false);
    });
  });
});
