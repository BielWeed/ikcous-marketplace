// @vitest-environment jsdom
//
// Acessibilidade do checkout (lote r64-a): ao escolher outro endereço na lista
// de "Seus dados e entrega", a seção inteira se recolhia COM o foco dentro dela
// — o foco caía no corpo da página e nada era falado sobre o endereço
// escolhido. Agora o foco vai para o botão "Trocar" do resumo do endereço (que
// assume o lugar do cartão tocado) e uma região de aviso fala qual endereço
// ficou escolhido. Dublês copiados de checkout-view-cancelar-pagamento-falho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const mockUser: { id: string } = { id: "user-1" };

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

const ENDERECOS = [
  {
    id: "addr-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Cliente Teste",
    cep: "38500-000",
    street: "Rua Teste",
    number: "100",
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    is_default: true,
  },
  {
    id: "addr-2",
    user_id: "user-1",
    name: "Trabalho",
    recipient_name: "Cliente Teste",
    cep: "38500-000",
    street: "Avenida Outra",
    number: "500",
    neighborhood: "Bairro Novo",
    city: "Monte Carmelo",
    state: "MG",
    is_default: false,
  },
];

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: ENDERECOS,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [
        {
          product: {
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
          },
          quantity: 1,
        },
      ],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "38500-000",
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    createOrder: vi.fn(),
    updateOrderStatus: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView — escolher outro endereço na lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  const botaoTrocar = () =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === "Trocar",
    ) as HTMLButtonElement | undefined;
  const cartaoDoEndereco = (nome: string) =>
    [...hospedeiro.querySelectorAll<HTMLElement>('[role="button"]')].find((c) =>
      c.textContent?.includes(nome),
    ) as HTMLElement;
  const avisos = () =>
    [...hospedeiro.querySelectorAll('[role="status"]')]
      .map((el) => el.textContent ?? "")
      .join(" | ");

  async function abrirAListaDeEnderecos() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(botaoTrocar(), "botão Trocar do resumo do endereço").toBeDefined();
    await act(async () => {
      botaoTrocar()!.click();
    });
    // A lista está aberta, com o endereço principal escolhido.
    expect(cartaoDoEndereco("Casa").getAttribute("aria-pressed")).toBe("true");
  }

  it("escolher outro endereço: o foco vai para o 'Trocar' do resumo (não para o corpo da página)", async () => {
    await abrirAListaDeEnderecos();
    const cartao = cartaoDoEndereco("Trabalho");
    cartao.focus();
    expect(document.activeElement).toBe(cartao);

    await act(async () => {
      cartao.click();
    });

    // A seção recolheu: o cartão tocado ficou escondido.
    expect(cartao.closest("[hidden]")).not.toBeNull();
    const trocar = botaoTrocar();
    expect(trocar).toBeDefined();
    expect(document.activeElement).toBe(trocar);
  });

  it("escolher outro endereço: uma região de aviso diz qual ficou escolhido, com a rua", async () => {
    await abrirAListaDeEnderecos();
    // A região existe ANTES da escolha (região que nasce já preenchida não é
    // anunciada) e começa vazia.
    expect(avisos()).not.toContain("Trabalho");

    await act(async () => {
      cartaoDoEndereco("Trabalho").click();
    });

    expect(avisos()).toContain("Endereço escolhido: Trabalho");
    expect(avisos()).toContain("Avenida Outra, 500");
    // O resumo, já recolhido, mostra o mesmo endereço.
    expect(hospedeiro.textContent).toContain("Avenida Outra, 500");
  });

  it("limite: escolher com o teclado (Enter no cartão) tem o mesmo efeito — foco no 'Trocar' e aviso", async () => {
    await abrirAListaDeEnderecos();
    const cartao = cartaoDoEndereco("Trabalho");
    cartao.focus();

    await act(async () => {
      cartao.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(document.activeElement).toBe(botaoTrocar());
    expect(avisos()).toContain("Endereço escolhido: Trabalho");
  });

  it("limite: abrir e recolher pelo cabeçalho continua levando o foco ao 'Editar' dos dados (comportamento antigo intacto)", async () => {
    await abrirAListaDeEnderecos();
    const cabecalho = document.getElementById("cabecalho-dados-e-entrega")!;
    await act(async () => {
      cabecalho.click();
    });
    expect(document.activeElement?.id).toBe("resumo-editar-dados");
  });
});
