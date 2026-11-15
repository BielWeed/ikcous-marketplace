// @vitest-environment jsdom
//
// A TELA DO PIX ABRE NO TOPO (15/11/2026). Medido em navegador real a 1280x720:
// ao trocar o formulário pela tela "Finalize o pagamento", o <main> (a área que
// rola no App) ficava no `scrollTop` que o formulário deixou (121 px no caso
// medido) — o título e o aviso "Seu pedido está reservado… é cancelado" ficavam
// escondidos sob o cabeçalho. A troca de tela acontece DENTRO da mesma rota
// ("checkout"), então a restauração de rolagem do App (que só roda ao trocar de
// rota) não a alcança, e o reset antigo só cobria o endereço e o sucesso.
//
// O que cada teste prova:
//  - chegada: ao abrir a tela do Pix, o <main> vai ao topo, mesmo que o
//    formulário o tenha deixado rolado;
//  - borda 1: depois de aberta, redesenhar a tela (a verificação periódica) NÃO
//    puxa a cliente de volta ao topo enquanto ela rola para copiar o código;
//  - borda 2: o Pix trocado pela confirmação ("Pagamento Confirmado!"), que é
//    outra tela e mais curta, também abre no topo;
//  - borda 3: o formulário, ANTES de finalizar, não é mexido (a cliente que
//    rolou até o botão não volta ao topo no meio do preenchimento).
//
// O jsdom não rola de verdade: o `scrollTop` do <main> vira uma propriedade
// comum, que o teste lê e escreve (mesmo recurso de
// cart-view-meus-pedidos-pedido-novo-rolagem-e-botoes.test.tsx).
//
// Andaime: o de checkout-view-pix-confirmacao.test.tsx (mesmos dublês, mesma
// forma de chegar em "Finalize o pagamento").
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi
  .fn()
  .mockResolvedValue({ id: "ped-999", totalAmount: 100 });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;
type EventoRealtime = (payload: {
  eventType: string;
  new?: Record<string, unknown>;
}) => void;

let onRealtimeEventCapturado: EventoRealtime | null = null;

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
      whatsappNumber: "34999998888",
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [
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
    ],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

// Identidade ESTÁVEL: um `user` novo a cada chamada reacende os efeitos que
// dependem dele e o render não termina.
const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario, profile: null, loading: false }),
}));

let mockCart = [
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
];
let mockCartTotal = 100;

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: 0,
      clearCart: () => {
        mockCart = [];
        mockCartTotal = 0;
      },
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
  useOrders: (
    _enabled?: boolean,
    _isAdmin?: boolean,
    options?: { onRealtimeEvent?: EventoRealtime },
  ) => {
    onRealtimeEventCapturado = options?.onRealtimeEvent ?? null;
    return { createOrder, updateOrderStatus };
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// A verificação periódica (10 s) consulta o pedido: aqui ele segue aguardando.
const consultasDoPedido = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => {
            consultasDoPedido();
            return Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            });
          },
        }),
      }),
    }),
  },
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/checkout/PagamentoOnline")
    >();
  return { ...real, PagamentoOnline: () => null };
});

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

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

function botaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — a tela de pagamento abre no topo, não no scrollTop do formulário", () => {
  let raiz: Root;
  let principal: HTMLElement;
  let hospedeiro: HTMLDivElement;
  let rolagem: number;

  beforeEach(() => {
    createOrder.mockClear();
    consultasDoPedido.mockClear();
    onNavigate.mockClear();
    onRealtimeEventCapturado = null;
    mockCart = [
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
    ];
    mockCartTotal = 100;
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
    vi.useFakeTimers();
    // O jsdom não implementa `window.scrollTo`: silencia o aviso.
    vi.stubGlobal("scrollTo", vi.fn());
    // O <main> é a área que rola no App.
    rolagem = 0;
    principal = document.createElement("main");
    Object.defineProperty(principal, "scrollTop", {
      configurable: true,
      get: () => rolagem,
      set: (v: number) => {
        rolagem = v;
      },
    });
    document.body.appendChild(principal);
    hospedeiro = document.createElement("div");
    principal.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    principal.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(CheckoutViewComponente: TelaCheckout) {
    await act(async () => {
      raiz.render(
        <CheckoutViewComponente
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
  }

  async function prepararOFormulario() {
    const botaoOnline = botaoPorTexto(hospedeiro, "Pagar agora com PIX")!;
    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    // useDeferredRender(380): o "Finalizar Pedido" só nasce depois disso.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(420);
    });
  }

  async function finalizar() {
    const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("ao abrir a tela do Pix, o <main> que o formulário deixou rolado volta ao topo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await prepararOFormulario();

    rolagem = 121; // o que o formulário deixou
    await finalizar();

    expect(hospedeiro.textContent).toContain("Finalize o pagamento");
    expect(rolagem).toBe(0);
  });

  it("depois de aberta, redesenhar a tela do Pix NÃO puxa a cliente de volta ao topo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await prepararOFormulario();
    await finalizar();
    expect(hospedeiro.textContent).toContain("Finalize o pagamento");

    // A cliente rola a tela para copiar o código; a verificação periódica
    // (10 s) consulta o pedido, que segue aguardando, e a tela é redesenhada
    // (o `montar` de novo renderiza o componente outra vez, de verdade: sem
    // isto, nada garante que houve redesenho, e um efeito sem lista de
    // dependências passaria despercebido).
    rolagem = 300;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(consultasDoPedido).toHaveBeenCalled();
    await montar(CheckoutView);

    expect(hospedeiro.textContent).toContain("Finalize o pagamento");
    expect(rolagem).toBe(300);
  });

  it("do Pix para 'Pagamento Confirmado!' (outra tela, mais curta), a rolagem volta ao topo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await prepararOFormulario();
    await finalizar();

    rolagem = 250; // a cliente tinha rolado o Pix
    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago" },
      });
    });

    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");
    expect(rolagem).toBe(0);
  });

  // A rolagem já vale 180 ANTES de montar: se o efeito rodasse na montagem do
  // formulário (guarda de entrada removida), zeraria aqui. Depois, preencher o
  // formulário (sem mudar pedido nem Pix) também não pode levar ao topo.
  it("o formulário, antes de finalizar, não é levado ao topo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    rolagem = 180; // a cliente rolou até o botão
    await montar(CheckoutView);
    expect(rolagem).toBe(180);
    await prepararOFormulario();

    expect(hospedeiro.textContent).not.toContain("Finalize o pagamento");
    expect(rolagem).toBe(180);
  });
});
