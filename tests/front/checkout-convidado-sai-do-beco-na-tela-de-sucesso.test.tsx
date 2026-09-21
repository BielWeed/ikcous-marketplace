// @vitest-environment jsdom
//
// CheckoutView-3301: o convidado não tem e-mail (o formulário de convidado
// nunca coletou) nem conta — "Ver Meus Pedidos", na tela de sucesso, leva ao
// OrderSearch, que EXIGE e-mail válido (OrderSearch.tsx:63-66) para mandar
// o OTP. Sem `customer_data.email` gravado no pedido, a busca nunca casa e o
// convidado sempre lê "Não encontramos um pedido...". Nenhum caminho dá a
// ele o estado do pedido depois de sair desta tela.
//
// A correção completa (pedir e-mail no formulário e gravá-lo em
// `customer_data.email`) exige mudar o payload que `useOrders.createOrder`
// manda para `create_marketplace_order_v23/v24` — NENHUMA das duas RPCs
// aceita `p_customer_email` hoje (conferido em
// supabase/migrations/20261081000000..., a versão mais recente que recria
// as duas funções). `useOrders.ts` é arquivo de outra frente nesta mesma
// árvore — por isso esta tarefa implementa a saída sugerida pelos
// verificadores enquanto a gravação do e-mail não existe: para quem não tem
// conta, a tela de sucesso troca o botão que leva ao beco por um caminho que
// FUNCIONA de verdade (WhatsApp da loja, mesmo mecanismo já usado em
// PagamentoForaDoPrazoView) ou, sem WhatsApp configurado, por uma instrução
// honesta em vez de um botão morto.
//
// Modelo estrutural copiado de checkout-view-selos-contraste-aa.test.tsx
// (mockUser mutável escolhe convidado x autenticado; mesmos dublês de
// useCart/useAddresses/useOrders/useCoupons/flags) — este arquivo acrescenta
// só o que muda: as afirmações sobre o botão da tela "Pedido Celebrado!".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn();
const clearCart = vi.fn();
const addToCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// Mutável: convidado x autenticado por teste (mesmo padrão do arquivo
// copiado) — o botão da tela de sucesso muda de comportamento com isto.
let mockUser: { id: string } | null = null;
// Mutável: o teste "sem WhatsApp" esvazia isto sem afetar os outros.
let mockWhatsappNumber: string | undefined = "34999998888";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: mockWhatsappNumber,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: mockUser
      ? [
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
        ]
      : [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

const produtoCarrinho = {
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

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [{ product: produtoCarrinho, quantity: 1 }],
    cartTotal: 100,
    shippingFee: 0,
    clearCart,
    addToCart,
    // ENTREGA LOCAL selecionada (regra frete × pagamento do dono,
    // 21/09/2026): a guarda do Finalizar (`finalizarBloqueadoPorFrete`)
    // passou a exigir a ESCOLHA de entrega — o servidor recusa id ausente
    // (FRETE V2 EMENDA, ELSIF do bloco 4). O assunto deste arquivo é outro;
    // sem a opção, o botão travaria por um motivo que ele não prova.
    selectedShippingOption: {
      id: "local-delivery",
      name: "Entrega Local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    },
    shippingCep: "38500-000",
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// Nenhum teste deste arquivo exercita o pagamento online (P6: convidado não
// paga online — a régua nem oferece a opção; e o autenticado do teste 3 usa
// o meio padrão "pix na entrega"). Objeto vazio é suficiente, mesmo
// raciocínio de checkout-view-flag-off.test.tsx.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("canvas-confetti", () => ({ default: confettiMock }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — convidado sem beco na tela de sucesso (CheckoutView-3301)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    updateOrderStatus.mockClear();
    clearCart.mockClear();
    addToCart.mockClear();
    confettiMock.mockClear();
    onNavigate.mockClear();
    mockUser = null;
    mockWhatsappNumber = "34999998888";
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

  async function chegarNaTelaDeSucessoComoConvidado() {
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
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-street", "Rua Teste");
      digitar("guest-number", "100");
      digitar("guest-neighborhood", "Centro");
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-city", "Cidade Teste");
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-state", "SP");
      await Promise.resolve();
    });

    // O botão "Finalizar Pedido" só existe depois que useDeferredRender(380)
    // resolve — espera o tempo real, como o componente exige.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    await act(async () => {
      botaoFinalizar.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A armadilha precisa estar de fato presente: sem chegar de verdade na
    // tela de sucesso, as afirmações abaixo não provam nada.
    expect(hospedeiro.textContent).toContain("Pedido Celebrado!");
  }

  it("convidado com WhatsApp da loja configurado: sem 'Ver Meus Pedidos' (beco), com um caminho de acompanhamento que funciona", async () => {
    await chegarNaTelaDeSucessoComoConvidado();

    // O beco: OrderSearch exige e-mail que o convidado nunca informou —
    // este botão nunca poderia achar o pedido dele.
    expect(hospedeiro.textContent).not.toContain("Ver Meus Pedidos");

    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);

    const botaoWhatsapp = localizarBotaoPorTexto(hospedeiro, "WhatsApp");
    expect(botaoWhatsapp).not.toBeUndefined();

    await act(async () => {
      botaoWhatsapp!.click();
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = openSpy.mock.calls[0][0] as string;
    // Mesma régua de todos os outros pontos de wa.me da tela (DDI 55 + os
    // 11 dígitos do número da loja).
    expect(url).toContain("https://wa.me/5534999998888");
    // O número do pedido precisa estar na mensagem — sem ele a loja não
    // acha o pedido do lado de lá também.
    expect(decodeURIComponent(url)).toContain("ED-999");
  });

  it("convidado SEM WhatsApp configurado na loja: instrução honesta, nunca um botão morto", async () => {
    mockWhatsappNumber = undefined;
    await chegarNaTelaDeSucessoComoConvidado();

    expect(hospedeiro.textContent).not.toContain("Ver Meus Pedidos");
    expect(localizarBotaoPorTexto(hospedeiro, "WhatsApp")).toBeUndefined();
    // O identificador já aparece acima na tela (Identificador: #ED-999) —
    // a instrução só reforça que ele é o que resta para acompanhar. A metade
    // positiva também é cobrada: sem ela o convidado fica só com "Retornar à
    // Vitrine" e nenhuma pista de como acompanhar.
    expect(hospedeiro.textContent).toContain("ED-999");
    expect(hospedeiro.textContent).toContain("Guarde o identificador acima");
  });

  it("cliente com conta: 'Ver Meus Pedidos' continua existindo e leva para 'orders' — este caminho já funciona e não muda", async () => {
    mockUser = { id: "user-1" };
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
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    await act(async () => {
      botaoFinalizar.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toContain("Pedido Celebrado!");

    const botaoMeusPedidos = localizarBotaoPorTexto(
      hospedeiro,
      "Ver Meus Pedidos",
    );
    expect(botaoMeusPedidos).not.toBeUndefined();

    await act(async () => {
      botaoMeusPedidos!.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("orders");
  });
});
