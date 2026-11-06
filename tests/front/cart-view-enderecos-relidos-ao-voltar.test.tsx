// @vitest-environment jsdom
//
// CARRINHO: ENDEREÇO E FRETE AO VOLTAR AO APP (dois aparelhos).
//
// O tablet (B) fica com o Carrinho montado no fundo. No celular (A) a cliente
// corrige o endereço de entrega. De volta ao tablet, o carrinho cotava o frete
// do CEP ANTIGO: a lista de endereços só era lida ao montar a tela. Agora, ao
// voltar para a aba do carrinho e ao voltar do segundo plano (com guarda de
// 30 s), o carrinho relê a lista -- uma consulta por volta -- e o frete passa
// a ser o do CEP novo.
//
// O banco é um dublê: o "outro aparelho" mexe nele DIRETAMENTE.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, View } from "@/types";

const { conta, banco, invoke } = vi.hoisted(() => ({
  conta: {
    usuario: { id: "conta-a", user_metadata: { name: "Cliente A" } },
  },
  banco: {
    linhas: [] as Array<Record<string, unknown>>,
    leituras: 0,
    falharLeitura: false,
  },
  invoke: vi.fn(),
}));

const produto: Product = {
  id: "prod-1",
  name: "Blusa Teste",
  description: "",
  price: 128.25,
  images: [],
  category: "Roupas",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CARRINHO: CartItem[] = [{ product: produto, quantity: 2 }];

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      freeShippingMin: 0,
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    getFreeShippingEligibleProducts: vi.fn(() => []),
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useState } = await import("react");
  const fixos = {
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    getCartTotal: vi.fn(() => 256.5),
    getCartCount: vi.fn(() => 2),
  };
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<unknown>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    return {
      ...fixos,
      cart: CARRINHO,
      cartTotal: 256.5,
      cartCount: 2,
      isLoading: false,
      shippingFee: 0,
      freteIndefinido: !selecionada,
      freteGratis: false,
      selectedShippingOption: selecionada,
      shippingCep,
      enderecoSelecionadoId,
      setSelectedShippingOption: setSelecionada,
      setShippingCep,
      setEnderecoSelecionadoId,
    };
  }
  return { useCart: useCartComEstado };
});

vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    fetchUserOrders: vi.fn(async () => {}),
    orders: [],
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario, profile: null, loading: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
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
          return Promise.resolve(resposta).then(ok, ko);
        },
      };
      return cadeia;
    },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function casa(cep: string) {
  return {
    id: "end-casa",
    user_id: "conta-a",
    name: "Casa",
    recipient_name: "Cliente A",
    cep,
    street: "Rua Casa",
    number: "10",
    complement: "",
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    reference: "",
    is_default: true,
  };
}

let estadoDaVisibilidade: "visible" | "hidden" = "visible";

describe("CartView — relê os endereços ao voltar (frete do CEP novo)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    banco.linhas = [casa("38500-000")];
    banco.leituras = 0;
    banco.falharLeitura = false;
    invoke.mockReset();
    invoke.mockImplementation(
      async (_nome: string, opts: { body: { cep: string } }) => ({
        data: {
          options: [
            {
              id: `opcao-${opts.body.cep}`,
              name: "Entrega",
              price: 10,
              deliveryDays: 1,
              provider: "local",
            },
          ],
        },
        error: null,
      }),
    );
    onNavigate.mockClear();
    estadoDaVisibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => estadoDaVisibilidade,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function montar(isActive: boolean) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={onNavigate} isActive={isActive} />);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  const cepsCotados = () =>
    invoke.mock.calls.map((c) => (c[1] as { body: { cep: string } }).body.cep);

  async function voltarDoSegundoPlano(depoisDeMs: number) {
    await act(async () => {
      estadoDaVisibilidade = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      vi.setSystemTime(Date.now() + depoisDeMs);
      estadoDaVisibilidade = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }

  it("o app volta do segundo plano: o carrinho passa a cotar o frete do CEP corrigido no outro aparelho", async () => {
    await montar(true);
    expect(cepsCotados()).toContain("38500000");
    expect(banco.leituras).toBe(1);

    // No celular: a cliente corrigiu o CEP de Casa.
    banco.linhas = [casa("38400-123")];
    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(2);
    expect(cepsCotados()).toContain("38400123");
  });

  it("voltar do segundo plano antes de 30 s não consulta de novo", async () => {
    await montar(true);
    banco.linhas = [casa("38400-123")];

    await voltarDoSegundoPlano(10_000);

    expect(banco.leituras).toBe(1);
    expect(cepsCotados()).not.toContain("38400123");
  });

  it("carrinho escondido atrás de outra aba: o app voltar do segundo plano não o faz consultar", async () => {
    await montar(false);
    const leiturasDaMontagem = banco.leituras;
    banco.linhas = [casa("38400-123")];

    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(leiturasDaMontagem);
  });

  it("a aba do carrinho volta a ser a visível: relê UMA vez, com o CEP novo", async () => {
    await montar(false);
    const leiturasDaMontagem = banco.leituras;
    banco.linhas = [casa("38400-123")];

    await montar(true);

    expect(banco.leituras).toBe(leiturasDaMontagem + 1);
    expect(cepsCotados()).toContain("38400123");
  });

  it("sem rede ao voltar: o carrinho segue com o endereço que tinha, sem aviso", async () => {
    const { toast } = await import("sonner");
    await montar(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    banco.falharLeitura = true;

    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(cepsCotados().at(-1)).toBe("38500000");
  });
});
