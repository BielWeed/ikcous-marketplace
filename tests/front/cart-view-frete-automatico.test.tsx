// @vitest-environment jsdom
//
// FRETE AUTOMÁTICO NO CARRINHO (22/09/2026, pedido do dono): sai o campo de
// CEP e o botão "Calcular". O frete é cotado sozinho pelo endereço de
// entrega cadastrado/escolhido, com "Entrega para <apelido>" e o resumo do
// endereço. Sem endereço, o carrinho pede o cadastro mas NÃO bloqueia: o
// "Finalizar Compra" continua levando ao checkout. "Trocar" usa a lista de
// endereços que já existe (AddressList) e a escolha vai para o estado
// compartilhado com o checkout.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption, View } from "@/types";

const { conta, estadoEnderecos, invoke, espelho } = vi.hoisted(() => ({
  conta: {
    usuario: { id: "conta-a", user_metadata: { name: "Cliente A" } } as {
      id: string;
      user_metadata: { name: string };
    } | null,
  },
  estadoEnderecos: { lista: [] as Address[] },
  invoke: vi.fn(),
  espelho: {
    enderecoSelecionadoId: null as string | null,
    selecionada: null as ShippingOption | null,
  },
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

const CASA: Address = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Cliente A",
  cep: "38500-000",
  street: "Rua Principal",
  number: "100",
  complement: "Apto 12",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "Portão azul",
  is_default: true,
};
const TRABALHO: Address = {
  id: "end-trabalho",
  user_id: "conta-a",
  name: "Trabalho",
  recipient_name: "Cliente A",
  cep: "01001-000",
  street: "Praça da Sé",
  number: "1",
  complement: "",
  neighborhood: "Sé",
  city: "São Paulo",
  state: "SP",
  reference: "",
  is_default: false,
};

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

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: async () => {},
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useEffect, useState } = await import("react");
  const fixos = {
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    getCartTotal: vi.fn(() => 256.5),
    getCartCount: vi.fn(() => 2),
  };
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    useEffect(() => {
      espelho.selecionada = selecionada;
      espelho.enderecoSelecionadoId = enderecoSelecionadoId;
    }, [selecionada, enderecoSelecionadoId]);
    return {
      ...fixos,
      cart: CARRINHO,
      cartTotal: 256.5,
      cartCount: 2,
      isLoading: false,
      shippingFee: selecionada?.price ?? 0,
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function opcoesPara(cep: string): ShippingOption[] {
  return cep === "38500000"
    ? [
        {
          id: "local-delivery",
          name: "Entrega local",
          price: 5,
          deliveryDays: 1,
          provider: "local",
        },
      ]
    : [
        {
          id: "melhorenvio-pac",
          name: "PAC",
          price: 30,
          deliveryDays: 6,
          provider: "melhor_envio",
        },
      ];
}

describe("CartView — frete automático pelo endereço de entrega", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    conta.usuario = { id: "conta-a", user_metadata: { name: "Cliente A" } };
    estadoEnderecos.lista = [CASA, TRABALHO];
    espelho.enderecoSelecionadoId = null;
    espelho.selecionada = null;
    invoke.mockReset();
    invoke.mockImplementation(
      async (_nome: string, opts: { body: { cep: string } }) => ({
        data: { options: opcoesPara(opts.body.cep) },
        error: null,
      }),
    );
    onNavigate.mockClear();
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
  });

  async function montar(isActive = true) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={onNavigate} isActive={isActive} />);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  function regiao(): HTMLElement | null {
    return hospedeiro.querySelector('section[aria-label="Entrega e frete"]');
  }

  function botao(texto: string): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(texto),
    );
  }

  async function clicar(el: HTMLElement | undefined) {
    expect(el).toBeDefined();
    await act(async () => {
      el?.click();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  it("endereço salvo: 'Entrega para Casa' + resumo, cotação automática — sem campo de CEP e sem 'Calcular'", async () => {
    await montar();

    const texto = regiao()?.textContent ?? "";
    expect(texto).toContain("Entrega para Casa");
    expect(texto).toContain("Rua Principal, 100");
    expect(texto).toContain("Monte Carmelo/MG");
    expect(texto).toContain("CEP 38500-000");
    // Dado de quem recebe não aparece no resumo do carrinho.
    expect(texto).not.toContain("Apto 12");
    expect(texto).not.toContain("Portão azul");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(
      (invoke.mock.calls[0][1] as { body: { cep: string } }).body.cep,
    ).toBe("38500000");
    expect(espelho.selecionada?.id).toBe("local-delivery");
    expect(texto).toContain("Entrega local");

    expect(hospedeiro.querySelector("input")).toBeNull();
    expect(botao("Calcular")).toBeUndefined();
  });

  it("'Trocar' → escolher o Trabalho (outra cidade): o destino compartilhado muda e o frete é recotado para ele", async () => {
    await montar();
    expect(espelho.selecionada?.id).toBe("local-delivery");

    await clicar(botao("Trocar"));
    // A lista abre numa folha modal portalada no body (seletor de endereço,
    // 22/09) — fora do hospedeiro, por isso a busca é no documento.
    const folha = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(folha).not.toBeNull();
    const cartaoTrabalho = Array.from(
      folha?.querySelectorAll<HTMLElement>('[role="button"]') ?? [],
    ).find((el) => el.textContent?.includes("Trabalho"));
    await clicar(cartaoTrabalho);

    expect(espelho.enderecoSelecionadoId).toBe("end-trabalho");
    expect(regiao()?.textContent ?? "").toContain("Entrega para Trabalho");
    expect(regiao()?.textContent ?? "").toContain("São Paulo/SP");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(
      (invoke.mock.calls[1][1] as { body: { cep: string } }).body.cep,
    ).toBe("01001000");
    // A entrega local da casa não vale para São Paulo.
    expect(espelho.selecionada?.id).toBe("melhorenvio-pac");
    expect(regiao()?.textContent ?? "").not.toContain("Entrega local");
  });

  it("sem endereço: pede o cadastro, nada é cotado, e o 'Finalizar Compra' continua levando ao checkout", async () => {
    estadoEnderecos.lista = [];
    await montar();

    const texto = regiao()?.textContent ?? "";
    expect(texto).toContain("Cadastre um endereço");
    expect(texto).toContain("informe o endereço na finalização");
    expect(invoke).not.toHaveBeenCalled();
    // Frete desconhecido: "A calcular", nunca grátis nem R$ 0 fechado.
    expect(hospedeiro.textContent).toContain("A calcular");
    expect(hospedeiro.textContent).not.toContain("GRÁTIS");

    await clicar(botao("Finalizar Compra"));
    expect(onNavigate).toHaveBeenCalledWith("checkout");
  });

  it("'Cadastrar endereço' leva à tela de endereço e o endereço NOVO passa a ser o de entrega quando a lista chega", async () => {
    estadoEnderecos.lista = [];
    await montar();

    await clicar(botao("Cadastrar endereço"));
    expect(onNavigate).toHaveBeenCalledWith("address-form");

    // A tela de endereço salvou (carrinho fora de foco, montado atrás); a
    // lista compartilhada chegou; a cliente volta ao carrinho.
    await montar(false);
    estadoEnderecos.lista = [TRABALHO];
    await montar(false);
    await montar(true);

    expect(espelho.enderecoSelecionadoId).toBe("end-trabalho");
    expect(regiao()?.textContent ?? "").toContain("Entrega para Trabalho");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("'Cadastrar endereço' ABANDONADO: um endereço cadastrado depois, fora do carrinho, NÃO vira o de entrega sozinho", async () => {
    estadoEnderecos.lista = [];
    await montar();
    await clicar(botao("Cadastrar endereço"));
    expect(onNavigate).toHaveBeenCalledWith("address-form");

    // Foi para a tela de endereço (carrinho fora de foco) e voltou sem salvar.
    await montar(false);
    await montar(true);

    // Mais tarde, pelo Perfil, cadastrou o Trabalho (não principal) — a
    // lista compartilhada chega ao carrinho, que segue montado atrás.
    estadoEnderecos.lista = [CASA, TRABALHO];
    await montar(false);

    expect(espelho.enderecoSelecionadoId).toBeNull();
  });

  it("convidado sem cotação anterior: explica que o endereço vem na finalização e não cota nada", async () => {
    conta.usuario = null;
    await montar();

    expect(regiao()?.textContent ?? "").toContain(
      "informa na finalização da compra",
    );
    expect(botao("Trocar")).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("aba fora de foco (checkout aberto por cima): a calculadora do carrinho não monta nem cota — uma calculadora por vez", async () => {
    await montar(false);
    expect(regiao()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
