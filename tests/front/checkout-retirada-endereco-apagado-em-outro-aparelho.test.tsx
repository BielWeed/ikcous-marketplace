// @vitest-environment jsdom
//
// CHECKOUT: RETIRADA NA LOJA COM O ENDEREÇO DA CONTA APAGADO EM OUTRO APARELHO.
//
// Quem tem conta e escolhe "Retirar na loja" continua com um endereço da conta
// escolhido (o checkout exige um, e o pedido guarda o `address_id`: a ficha do
// painel o mostra como "Endereço do cadastro (atual)"). Se a cliente apaga
// esse endereço em outro aparelho e toca em "Finalizar" aqui, o id velho ia
// para a RPC, que recusa com "Endereço inválido ou não pertence ao usuário."
// -- e a tela, que classifica essa frase como "trocar endereço", mandava quem
// vai BUSCAR na loja cadastrar um endereço. Agora a retirada relê a lista
// antes de enviar (como a entrega já faz) e, se o endereço escolhido sumiu,
// nada sai: a cliente confere os dados e finaliza de novo.
//
// O banco é um dublê: o "outro aparelho" mexe nele DIRETAMENTE. O `useOrders`
// é o de verdade; a RPC dublê recusa o id que não existe mais, com a mesma
// frase da função viva (20261399997000, passo 1).

import type { CartItem, Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const RETIRADA = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "local",
};

const { conta, banco, escolha, rpc } = vi.hoisted(() => ({
  conta: { usuario: { id: "user-1" } as { id: string } | null },
  banco: {
    linhas: [] as Array<Record<string, unknown>>,
    falharLeitura: false,
  },
  escolha: {
    id: null as string | null,
    ouvintes: new Set<() => void>(),
  },
  rpc: { chamadas: [] as Array<{ nome: string; args: any }> },
}));

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      freeShippingMin: 0,
      enableCoupons: false,
      formasPagamentoEntrega: ["pix", "card", "cash"],
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario, profile: null, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
  CLAIM_DELAY_WINDOW_MS: 100,
}));

vi.mock("@/hooks/useCart", async () => {
  const { useSyncExternalStore } = await import("react");
  const assinar = (ouvinte: () => void) => {
    escolha.ouvintes.add(ouvinte);
    return () => {
      escolha.ouvintes.delete(ouvinte);
    };
  };
  const setEnderecoSelecionadoId = (id: string | null) => {
    escolha.id = id;
    for (const ouvinte of escolha.ouvintes) ouvinte();
  };
  function useCartDeTeste() {
    const enderecoSelecionadoId = useSyncExternalStore(
      assinar,
      () => escolha.id,
    );
    return {
      cart: CART,
      cartTotal: 80,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: "38500-000",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      freteGratis: false,
      selectedShippingOption: RETIRADA,
      freteIndefinido: false,
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
    };
  }
  return { useCart: useCartDeTeste };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Só `user_addresses` devolve linhas; as outras leituras (pedidos, perfil)
// voltam vazias.
function consulta(tabela: string): unknown {
  const alvo: unknown = new Proxy(() => {}, {
    get(_destino, propriedade) {
      if (propriedade === "then") {
        return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          const resposta =
            tabela !== "user_addresses"
              ? { data: [], error: null, count: 0 }
              : banco.falharLeitura
                ? { data: null, error: { message: "rede caiu" } }
                : { data: [...banco.linhas], error: null };
          return Promise.resolve(resposta).then(ok, ko);
        };
      }
      if (propriedade === "maybeSingle" || propriedade === "single") {
        return () => Promise.resolve({ data: null, error: null });
      }
      return () => alvo;
    },
  });
  return alvo;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => consulta(tabela),
    // A função viva confere o dono do endereço ANTES de tudo (passo 1):
    // id que não está mais na conta é recusado com esta frase.
    rpc: async (nome: string, args: any) => {
      rpc.chamadas.push({ nome, args });
      if (!nome.startsWith("create_marketplace_order")) {
        return { data: null, error: null };
      }
      const existe = banco.linhas.some((l) => l.id === args?.p_address_id);
      if (args?.p_address_id && !existe) {
        return {
          data: null,
          error: {
            code: "P0001",
            message: "Endereço inválido ou não pertence ao usuário.",
          },
        };
      }
      return {
        data: null,
        error: { code: "P0001", message: "Pedido dublê: não cria nada." },
      };
    },
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    channel: () => {
      const canal = {
        on: () => canal,
        subscribe: (retorno?: (status: string) => void) => {
          retorno?.("SUBSCRIBED");
          return canal;
        },
        unsubscribe: () => Promise.resolve("ok"),
        send: () => Promise.resolve("ok"),
      };
      return canal;
    },
    removeChannel: () => Promise.resolve("ok"),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRODUTO: Product = {
  id: "prod-1",
  name: "Camiseta",
  description: "",
  price: 80,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CART: CartItem[] = [{ product: PRODUTO, quantity: 1 }];

let contador = 0;
function linha(id: string, cep: string, principal: boolean) {
  return {
    id,
    user_id: "user-1",
    name: id,
    recipient_name: "Cliente Teste",
    cep,
    street: `Rua ${id}`,
    number: "10",
    complement: null,
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    reference: null,
    is_default: principal,
    created_at: ++contador,
  };
}

const AVISO_DA_RETIRADA =
  "O endereço da sua conta foi alterado em outro aparelho. Confira seus dados e finalize de novo.";

function chamadasDoPedido() {
  return rpc.chamadas.filter((c) =>
    c.nome.startsWith("create_marketplace_order"),
  );
}

describe("CheckoutView -- retirada com o endereço apagado em outro aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function preparar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={CART}
          subtotal={80}
          shipping={0}
          total={80}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    await esperar(50);
    for (const [id, valor] of [
      ["checkout-name", "Cliente Teste"],
      ["checkout-tel", "34999999999"],
    ]) {
      await act(async () => {
        const campo = document.getElementById(id) as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(campo, valor);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await esperar(420);
  }

  async function finalizar() {
    const botao = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Finalizar pedido"]',
    );
    expect(botao?.disabled).toBe(false);
    await act(async () => {
      botao!.click();
    });
    await esperar(50);
  }

  beforeEach(async () => {
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    conta.usuario = { id: "user-1" };
    banco.linhas = [linha("addr-a", "38500-000", true)];
    banco.falharLeitura = false;
    escolha.id = null;
    rpc.chamadas = [];
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    globalThis.sessionStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o único endereço sumiu: nada é enviado e o aviso não fala de entrega", async () => {
    const { toast } = await import("sonner");
    await preparar();
    expect(escolha.id).toBe("addr-a");
    banco.linhas = [];

    await finalizar();

    expect(chamadasDoPedido()).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(AVISO_DA_RETIRADA);
    expect(toast.error).not.toHaveBeenCalledWith(
      "Endereço inválido ou não pertence ao usuário.",
    );
  });

  it("sobrou outro endereço: o segundo toque sai com ele, nunca com o apagado", async () => {
    banco.linhas = [
      linha("addr-a", "38500-000", true),
      linha("addr-b", "38500-000", false),
    ];
    await preparar();
    expect(escolha.id).toBe("addr-a");
    banco.linhas = [banco.linhas[1]];

    await finalizar();
    expect(chamadasDoPedido()).toEqual([]);

    await finalizar();
    expect(chamadasDoPedido()).toHaveLength(1);
    expect(chamadasDoPedido()[0].args.p_address_id).toBe("addr-b");
    expect(chamadasDoPedido()[0].args.p_shipping_option_id).toBe(
      "store-pickup",
    );
  });

  it("controle: o endereço continua na conta e o pedido sai no primeiro toque", async () => {
    await preparar();

    await finalizar();

    expect(chamadasDoPedido()).toHaveLength(1);
    expect(chamadasDoPedido()[0].args.p_address_id).toBe("addr-a");
  });

  it("a releitura falhou: a retirada não trava por isso (o servidor confere o dono)", async () => {
    const { toast } = await import("sonner");
    await preparar();
    banco.falharLeitura = true;

    await finalizar();

    expect(chamadasDoPedido()).toHaveLength(1);
    expect(chamadasDoPedido()[0].args.p_address_id).toBe("addr-a");
    expect(toast.error).not.toHaveBeenCalledWith(
      "Não consegui confirmar o endereço. Tente de novo.",
    );
  });
});
