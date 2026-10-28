// @vitest-environment jsdom
//
// Lote 257 (caça 13-C, achado 2): se a LEITURA dos endereços falha, o cartão
// "Endereço de Entrega" do checkout dizia "Nenhum endereço cadastrado" — a
// cliente achava que tinha perdido os endereços, digitava tudo de novo em
// "Novo" e a conta ficava com endereço duplicado. Agora a falha tem a própria
// frase e um botão "Tentar de novo"; o "vazio" só aparece quando a leitura deu
// certo e a conta de fato não tem endereço.
//
// Harness enxuto: o mesmo de checkout-pedido-chave-voltar-e-sessao.test.tsx,
// com o `useAddresses` devolvendo o que cada caso precisa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { estado, produto, fetchAddresses } = vi.hoisted(() => {
  const produto = {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 100,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
  return {
    produto,
    fetchAddresses: vi.fn(),
    estado: {
      user: { id: "user-1" },
      enderecos: [] as unknown[],
      erroAoCarregar: false,
      carregando: false,
    },
  };
});

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.enderecos,
    erroAoCarregar: estado.erroAoCarregar,
    fetchAddresses,
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: estado.carregando,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [{ product: produto, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: null,
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENDERECO = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "01310-100",
  street: "Rua Teste",
  number: "100",
  neighborhood: "Centro",
  city: "Cidade Teste",
  state: "SP",
  is_default: true,
};

const FRASE_DA_FALHA = "Não conseguimos carregar seus endereços";

describe("CheckoutView — leitura de endereços que falhou não vira 'Nenhum endereço cadastrado'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrir() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  }

  const textoDaTela = () => document.body.textContent ?? "";
  const botaoPorTexto = (texto: string) =>
    [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement | undefined;

  beforeEach(() => {
    fetchAddresses.mockReset();
    estado.user = { id: "user-1" };
    estado.enderecos = [];
    estado.erroAoCarregar = false;
    estado.carregando = false;
    sessionStorage.clear();
    pararABuscaDeCep();
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

  it("leitura falhou e a lista está vazia: avisa a falha, oferece 'Tentar de novo' e NÃO diz que não há endereço", async () => {
    estado.erroAoCarregar = true;
    await abrir();

    expect(textoDaTela()).toContain(FRASE_DA_FALHA);
    expect(textoDaTela()).not.toContain("Nenhum endereço cadastrado");
    // O resumo recolhido também não convida a cadastrar como se estivesse vazio.
    expect(textoDaTela()).not.toContain("Cadastre um endereço de entrega");
    expect(textoDaTela()).toContain("Não carregamos seus endereços");
    const alerta = [...document.querySelectorAll('[role="alert"]')].find((el) =>
      el.textContent?.includes(FRASE_DA_FALHA),
    );
    expect(alerta).toBeDefined();

    const tentar = botaoPorTexto("Tentar de novo");
    expect(tentar).toBeDefined();
    const chamadasAntes = fetchAddresses.mock.calls.length;
    await act(async () => {
      tentar!.click();
    });
    expect(fetchAddresses.mock.calls.length).toBe(chamadasAntes + 1);
  });

  it("leitura deu certo e a conta não tem endereço: o vazio de sempre, sem aviso de falha", async () => {
    await abrir();

    expect(textoDaTela()).toContain("Nenhum endereço cadastrado");
    expect(textoDaTela()).toContain("Cadastre um endereço de entrega");
    expect(textoDaTela()).not.toContain(FRASE_DA_FALHA);
  });

  it("leitura falhou mas há endereços guardados no aparelho: a lista continua aparecendo", async () => {
    estado.erroAoCarregar = true;
    estado.enderecos = [ENDERECO];
    await abrir();

    expect(textoDaTela()).toContain("Rua Teste");
    expect(textoDaTela()).not.toContain("Nenhum endereço cadastrado");
  });

  it("enquanto lê, continua o 'Sincronizando endereços...' (a falha antiga não sobrepõe a leitura em curso)", async () => {
    estado.erroAoCarregar = true;
    estado.carregando = true;
    await abrir();

    expect(textoDaTela()).toContain("Sincronizando endereços");
    expect(textoDaTela()).not.toContain(FRASE_DA_FALHA);
  });
});
