// @vitest-environment jsdom
//
// CARRINHO: ENDEREÇO QUE AINDA NÃO CARREGOU (ou que falhou ao carregar).
//
// Num aparelho sem lista de endereços guardada e com a rede lenta ou caída, o
// carrinho lia só a lista (vazia) e dizia "Cadastre um endereço para ver o
// frete" com o botão "Cadastrar endereço" -- para quem TEM endereços (e podia
// cadastrar o mesmo de novo). O checkout já separava "carregando" e "não
// conseguimos carregar"; o carrinho agora faz o mesmo: enquanto lê, avisa que
// está lendo; se falhar, diz a verdade e oferece "Tentar de novo"; só oferece
// "Cadastrar endereço" quando a leitura terminou bem e a lista está vazia.
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
    modo: "ok" as "ok" | "falha" | "pendente",
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
          if (banco.modo === "pendente") return new Promise(() => {});
          const resposta =
            banco.modo === "falha"
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

const CASA = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Cliente A",
  cep: "38500-000",
  street: "Rua Casa",
  number: "10",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
};

describe("CartView — endereço que não carregou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    banco.linhas = [];
    banco.leituras = 0;
    banco.modo = "ok";
    invoke.mockReset();
    invoke.mockResolvedValue({ data: { options: [] }, error: null });
    onNavigate.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Aparelho SEM lista de endereços guardada.
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={onNavigate} isActive={true} />);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }

  const botao = (nome: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === nome,
    );

  it("enquanto a lista ainda carrega: avisa que está lendo e NÃO oferece cadastrar", async () => {
    banco.modo = "pendente";
    await montar();

    expect(hospedeiro.textContent).toContain("Carregando seus endereços");
    expect(botao("Cadastrar endereço")).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("Cadastre um endereço");
  });

  it("a leitura falhou: diz a verdade, oferece Tentar de novo e NÃO manda cadastrar", async () => {
    banco.modo = "falha";
    banco.linhas = [CASA];
    await montar();

    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar seus endereços agora.",
    );
    expect(botao("Cadastrar endereço")).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain("Cadastre um endereço");
    expect(botao("Tentar de novo")).toBeDefined();
  });

  it("Tentar de novo relê os endereços e, vindo a lista, o carrinho passa a oferecer Trocar", async () => {
    banco.modo = "falha";
    banco.linhas = [CASA];
    await montar();
    const leiturasAntes = banco.leituras;

    banco.modo = "ok";
    await act(async () => {
      botao("Tentar de novo")?.click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

    expect(banco.leituras).toBe(leiturasAntes + 1);
    expect(botao("Trocar")).toBeDefined();
    expect(botao("Tentar de novo")).toBeUndefined();
    expect(hospedeiro.textContent).not.toContain(
      "Não conseguimos carregar seus endereços",
    );
  });

  it("leitura terminou bem e a lista está vazia: aí sim oferece Cadastrar endereço", async () => {
    banco.modo = "ok";
    banco.linhas = [];
    await montar();

    expect(hospedeiro.textContent).toContain("Cadastre um endereço");
    expect(botao("Cadastrar endereço")).toBeDefined();
    expect(hospedeiro.textContent).not.toContain("Carregando seus endereços");
    expect(hospedeiro.textContent).not.toContain("Não conseguimos carregar");
  });
});
