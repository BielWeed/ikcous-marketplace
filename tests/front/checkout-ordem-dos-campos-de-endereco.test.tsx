// @vitest-environment jsdom
//
// Trava a ORDEM dos campos de endereço do checkout de convidado.
//
// POR QUE ISTO EXISTE: em 17/08/2026 a grade do endereço foi rearranjada duas
// vezes seguidas. A grade é `grid-cols-2` fixa, então a ordem dos campos no
// DOM **é** o layout — mudar a ordem muda quem fica ao lado de quem, e as duas
// primeiras tentativas produziram defeito visível: a primeira emparelhou
// `Número | Cidade` e deixou `Estado` sozinho na linha; a segunda emparelhou
// `Número | Bairro` e espremeu o Bairro em 151px, onde "Jardim Paulistano" já
// não cabe — num campo que o cliente não digita, porque quem escreve ali é a
// busca do CEP.
//
// O QUE ELE NÃO FAZ: não afirma classe de CSS nem aparência. Asserção de
// `className` quebra a cada refatoração de estilo sem proteger nada. O que
// este teste trava é a ordem em que o cliente TABULA pelos campos — isso é
// comportamento, e é o mesmo dado de onde o layout é derivado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingCoverage: "national", originCep: "38500-000" },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

// `user: null` é o que liga o bloco de endereço de convidado — cliente logado
// escolhe endereço salvo por outro caminho (AddressList/AddressForm).
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
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
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros testes de checkout deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView (convidado) — ordem dos campos de endereço", () => {
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

  it("tabula CEP → Número → Rua → Bairro → Cidade → Estado → Complemento, nesta ordem", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // `querySelectorAll` devolve na ordem do documento, que é a ordem de
    // tabulação para campos sem `tabIndex` — nenhum destes tem.
    const ordem = [
      ...hospedeiro.querySelectorAll<HTMLInputElement>('input[id^="guest-"]'),
    ].map((campo) => campo.id);

    expect(ordem).toEqual([
      "guest-cep",
      "guest-number",
      "guest-street",
      "guest-neighborhood",
      "guest-city",
      "guest-state",
      "guest-complement",
    ]);
  });

  it("põe o par que o cliente digita à mão (CEP e Número) antes do que a busca de CEP preenche", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const ordem = [
      ...hospedeiro.querySelectorAll<HTMLInputElement>('input[id^="guest-"]'),
    ].map((campo) => campo.id);

    // Esta é a garantia que sobrevive a um redesenho: o que se digita vem
    // antes do que se confere. Rua, bairro, cidade e estado são escritos pelo
    // `useBuscaCep` a partir do CEP (ver `setValue` em CheckoutView), então
    // qualquer um deles antes do Número faz o cliente passar por campo que
    // ainda vai ser preenchido sozinho.
    const preenchidosPelaBuscaDeCep = [
      "guest-street",
      "guest-neighborhood",
      "guest-city",
      "guest-state",
    ];
    const posicaoDoNumero = ordem.indexOf("guest-number");

    expect(posicaoDoNumero).toBeGreaterThan(ordem.indexOf("guest-cep"));
    for (const campo of preenchidosPelaBuscaDeCep) {
      expect(ordem.indexOf(campo)).toBeGreaterThan(posicaoDoNumero);
    }
  });
});
