// @vitest-environment jsdom
//
// CHECKOUT: QUALQUER CAMPO DO ENDEREÇO QUE MUDOU NO OUTRO APARELHO TRAVA O PEDIDO.
//
// Antes de criar o pedido, o checkout relê a lista de endereços e compara o
// endereço que a cliente está VENDO com o que está salvo agora. Se divergem,
// nada é enviado: a cliente confere o endereço novo e finaliza de novo (o
// pedido nasceria entregue no lugar errado). O outro teste desta família
// cobre só o número e a referência; aqui cada um dos outros campos que
// compõem o endereço de entrega (CEP, rua, complemento, bairro, cidade,
// estado e destinatário) tem o seu caso -- e os casos em que "nulo" e
// "vazio" são o mesmo endereço e NÃO podem travar a compra.
//
// O banco é um dublê: o "outro aparelho" mexe nele DIRETAMENTE.

import type { CartItem, Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const createOrder = vi.fn();
const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};

let opcaoDeFrete = ENTREGA_LOCAL;

const { conta, banco, escolha } = vi.hoisted(() => ({
  conta: { usuario: { id: "user-1" } as { id: string } | null },
  banco: {
    linhas: [] as Array<Record<string, unknown>>,
    leituras: 0,
    falharLeitura: false,
    proximaLeitura: null as Promise<void> | null,
  },
  // O id do endereço escolhido, como o CartContext o guarda: UM valor, lido por
  // todos os que chamam `useCart` (o checkout e os hooks dele).
  escolha: {
    id: null as string | null,
    ouvintes: new Set<() => void>(),
  },
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
      shippingCoverage: "national",
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
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      freteGratis: false,
      selectedShippingOption: opcaoDeFrete,
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

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    from: () => {
      const cadeia: any = {
        select: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          banco.leituras++;
          const resposta = banco.falharLeitura
            ? { data: null, error: { message: "rede caiu" } }
            : { data: [...banco.linhas], error: null };
          const espera = banco.proximaLeitura;
          banco.proximaLeitura = null;
          return Promise.resolve(espera)
            .then(() => resposta)
            .then(ok, ko);
        },
      };
      return cadeia;
    },
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

let estadoDaVisibilidade: "visible" | "hidden" = "visible";

describe("CheckoutView -- relê os endereços ao voltar ao app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  async function montar() {
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
  }

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
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
    banco.linhas = [
      linha("addr-x", "01310-100", true),
      linha("addr-z", "30100-000", false),
    ];
    banco.leituras = 0;
    banco.falharLeitura = false;
    banco.proximaLeitura = null;
    opcaoDeFrete = ENTREGA_LOCAL;
    escolha.id = null;
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    createOrder.mockReset().mockResolvedValue({ id: "ped-1", totalAmount: 80 });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    globalThis.sessionStorage.clear();
    estadoDaVisibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => estadoDaVisibilidade,
    });
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

  async function prepararEntrega(campos: [string, string][] = []) {
    await montar();
    for (const [id, valor] of [
      ["checkout-name", "Cliente Teste"],
      ["checkout-tel", "34999999999"],
      ...campos,
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

  async function finalizar(doisToques = false) {
    const botao = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Finalizar pedido"]',
    );
    expect(botao?.disabled).toBe(false);
    await act(async () => {
      botao!.click();
      if (doisToques) botao!.click();
    });
  }

  const AVISO_OUTRO_APARELHO =
    "O endereço de entrega foi alterado em outro aparelho. Confira o novo endereço e finalize de novo.";

  it.each([
    ["cep", "01310-200"],
    ["street", "Rua Trocada"],
    ["complement", "Apto 22"],
    ["neighborhood", "Bairro Trocado"],
    ["city", "Uberlândia"],
    ["state", "SP"],
    ["recipient_name", "Outra Pessoa"],
  ])(
    "só o campo %s mudou no outro aparelho: não cria pedido até a cliente conferir",
    async (campo, novoValor) => {
      const { toast } = await import("sonner");
      vi.mocked(toast.error).mockClear();
      await prepararEntrega();
      banco.linhas[0] = { ...banco.linhas[0], [campo]: novoValor };

      await finalizar();

      expect(createOrder).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(AVISO_OUTRO_APARELHO);
      expect(document.body.textContent).toContain(novoValor);

      // Conferido o endereço novo, o segundo toque envia -- uma vez só.
      await finalizar();
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0]).toMatchObject({
        addressId: "addr-x",
      });
    },
  );

  it.each([
    ["complement", null, ""],
    ["recipient_name", null, ""],
  ])(
    "campo %s nulo e vazio são o mesmo endereço e não impedem o pedido",
    async (campo, antes, depois) => {
      banco.linhas[0] = { ...banco.linhas[0], [campo]: antes };
      await prepararEntrega();
      banco.linhas[0] = { ...banco.linhas[0], [campo]: depois };

      await finalizar();

      expect(createOrder).toHaveBeenCalledTimes(1);
    },
  );

  it("o apelido do endereço não faz parte do que se entrega: trocá-lo no outro aparelho não trava", async () => {
    await prepararEntrega();
    banco.linhas[0] = { ...banco.linhas[0], name: "Casa da praia" };

    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});
