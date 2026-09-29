// @vitest-environment jsdom
//
// D3 do frete divergente (bug 07095-005 → 38500-000): o checkout já tinha o
// efeito que derruba a cotação quando o destino diverge — mas ele roda DEPOIS
// do pintar. No intervalo entre o destino ficar conhecido (endereço chega
// async / é auto-selecionado) e o efeito executar, a tela pigmentava o TOTAL
// com o frete cotado para OUTRO CEP — exatamente o print do bug: endereço
// 38500-000 na entrega, total R$ 282,91 do frete de 07095-005.
//
// A guarda nova é de RENDER (não de efeito): cotação cujo CEP diverge do
// CEP efetivo de entrega vira "a calcular" no primeiro pintar e trava o
// Finalizar, sem depender de nenhum efeito ter rodado.
//
// Segue o padrão de checkout-summary-bar.test.tsx (dublês de hooks com
// estado mutável via vi.hoisted; o pai re-renderiza para aplicar o estado).
import { type ReactNode, act, useLayoutEffect, useRef } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, ShippingOption } from "@/types";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const {
  estadoCarrinho,
  estadoEnderecos,
  endereco38500,
  contaEstavel,
  dubleEnderecos,
} = vi.hoisted(() => {
  const produto256: Product = {
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
  const item: CartItem[] = [{ product: produto256, quantity: 2 }];

  const endereco38500: Address = {
    id: "end-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Cliente Teste",
    cep: "38500-000",
    street: "Rua Principal",
    number: "100",
    complement: "",
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    reference: "",
    is_default: true,
  };

  return {
    estadoEnderecos: { lista: [] as Address[] },
    estadoCarrinho: {
      cart: item,
      cartTotal: 256.5,
      shippingFee: 26.41,
      selectedShippingOption: {
        id: "eco",
        name: "Econômico",
        price: 26.41,
        deliveryDays: 8,
        provider: "melhor_envio",
      } as ShippingOption | null,
      shippingCep: "07095-005" as string | null,
      freteIndefinido: false,
      freteGratis: false,
      enderecoSelecionadoId: null as string | null,
      espiaoOpcao: vi.fn(),
      espiaoCep: vi.fn(),
    },
    endereco38500,
    // Objetos e funções ESTÁVEIS entre renders: `user`/`profile` novos a
    // cada chamada re-disparam efeitos dependestes (form.trigger, fetch de
    // endereços) e a tela nunca estabiliza.
    contaEstavel: {
      user: { id: "user-1", user_metadata: { name: "Cliente Teste" } },
      profile: { full_name: "Cliente Teste", whatsapp: "34999999999" },
    },
    dubleEnderecos: {
      fetchAddresses: vi.fn(async () => {}),
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
    },
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: true,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estadoEnderecos.lista,
    fetchAddresses: dubleEnderecos.fetchAddresses,
    addAddress: dubleEnderecos.addAddress,
    updateAddress: dubleEnderecos.updateAddress,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: contaEstavel.user,
    profile: contaEstavel.profile,
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: estadoCarrinho.cart,
    cartTotal: estadoCarrinho.cartTotal,
    shippingFee: estadoCarrinho.shippingFee,
    clearCart: vi.fn(),
    addToCart: vi.fn(),
    selectedShippingOption: estadoCarrinho.selectedShippingOption,
    shippingCep: estadoCarrinho.shippingCep,
    freteIndefinido: estadoCarrinho.freteIndefinido,
    freteGratis: estadoCarrinho.freteGratis,
    enderecoSelecionadoId: estadoCarrinho.enderecoSelecionadoId,
    // Reflete o estado (o auto-select do checkout grava nele).
    setEnderecoSelecionadoId: (id: string | null) => {
      estadoCarrinho.enderecoSelecionadoId = id;
    },
    setSelectedShippingOption: estadoCarrinho.espiaoOpcao,
    setShippingCep: estadoCarrinho.espiaoCep,
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

// A economia do frete cota por conta própria (edge function) — irrelevante
// aqui e com o supabase seco abaixo ela não pode rodar.
vi.mock("@/hooks/useEconomiaDoFreteExibida", () => ({
  useEconomiaDoFreteExibida: () => 0,
}));

// O adiamento de 380ms da barra de resumo não é assunto deste teste: sem
// isto, o primeiro pintar capturado pelo wrapper abaixo não teria a barra.
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Captura o DOM num `useLayoutEffect` de wrapper: layout effects correm
 * DEPOIS do commit (o DOM já está pintável) e ANTES dos efeitos passivos —
 * o quadro exato do bug é "destino já conhecido, efeito de invalidação
 * ainda não rodou". Ler `innerHTML` logo após `raiz.render` viria ANTES do
 * commit e provaría nada. O bar é portado para `document.body`, por isso a
 * captura é do body inteiro, não do hospedeiro.
 */
function CaptadorDoPrimeiroPintar({
  aoComitar,
  children,
}: {
  aoComitar: (html: string) => void;
  children: ReactNode;
}) {
  // Callback em ref: o layout effect roda UMA vez e o aviso de dependência
  // não é silenciado.
  const aoComitarRef = useRef(aoComitar);
  useLayoutEffect(() => {
    aoComitarRef.current(document.body.innerHTML);
  }, [aoComitarRef]);
  return children;
}

function reiniciarEstado() {
  estadoEnderecos.lista = [];
  estadoCarrinho.cartTotal = 256.5;
  estadoCarrinho.shippingFee = 26.41;
  estadoCarrinho.selectedShippingOption = {
    id: "eco",
    name: "Econômico",
    price: 26.41,
    deliveryDays: 8,
    provider: "melhor_envio",
  };
  estadoCarrinho.shippingCep = "07095-005";
  estadoCarrinho.freteIndefinido = false;
  estadoCarrinho.freteGratis = false;
  estadoCarrinho.enderecoSelecionadoId = null;
  estadoCarrinho.espiaoOpcao.mockClear();
  estadoCarrinho.espiaoCep.mockClear();
}

describe("CheckoutView — frete cotado para CEP diferente do destino não pinta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    reiniciarEstado();
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

  async function montar(): Promise<string> {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    let primeiroPintar = "";
    act(() => {
      raiz.render(
        <CaptadorDoPrimeiroPintar
          aoComitar={(html) => {
            primeiroPintar = html;
          }}
        >
          <CheckoutView
            onNavigate={onNavigate}
            onSetBackOverride={onSetBackOverride}
          />
        </CaptadorDoPrimeiroPintar>,
      );
    });
    return primeiroPintar;
  }

  /** O CartContext aplicou o estado e o checkout re-renderizou. */
  async function sincronizarPai() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  function botaoFinalizar(): HTMLButtonElement {
    // A barra é portada para document.body (createPortal) — não está no
    // hospedeiro.
    return document.querySelector(
      'button[aria-label="Finalizar pedido"]',
    ) as HTMLButtonElement;
  }

  it("o DEFEITO: endereço 38500-000 com cotação de 07095-005 — 'a calcular' NO PRIMEIRO PINTAR, efeito ou não", async () => {
    // O endereço já está carregado (chegou antes da montagem): o destino é
    // conhecido desde o primeiro render.
    estadoEnderecos.lista = [endereco38500];

    const primeiroPintar = await montar();

    // 🔴 O DEFEITO: o primeiro pintar mostrava "R$ 282,91" (256,50 + frete
    // de OUTRO CEP) até o efeito de invalidação rodar.
    expect(primeiroPintar).toContain("a calcular");
    expect(primeiroPintar).not.toContain("282,91");

    // O efeito de reconciliação (que já existia) derruba a escolha.
    expect(estadoCarrinho.espiaoOpcao).toHaveBeenCalledWith(null);
    expect(estadoCarrinho.espiaoCep).toHaveBeenCalledWith(null);

    // Estado aplicado pelo contexto: "a calcular" e Finalizar travado.
    estadoCarrinho.selectedShippingOption = null;
    estadoCarrinho.shippingCep = null;
    estadoCarrinho.freteIndefinido = true;
    await sincronizarPai();
    expect(document.body.innerHTML).toContain("a calcular");
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("não-regressão: cotação COERENTE com o endereço (entrega local) pinta o total e libera o Finalizar", async () => {
    estadoEnderecos.lista = [endereco38500];
    estadoCarrinho.shippingCep = "38500-000";
    estadoCarrinho.selectedShippingOption = {
      id: "local-delivery",
      name: "Entrega local",
      price: 0,
      deliveryDays: 1,
      provider: "local",
    };
    estadoCarrinho.shippingFee = 0;

    await montar();
    await sincronizarPai();

    expect(document.body.innerHTML).toContain("256,50");
    expect(botaoFinalizar().disabled).toBe(false);
  });
});
