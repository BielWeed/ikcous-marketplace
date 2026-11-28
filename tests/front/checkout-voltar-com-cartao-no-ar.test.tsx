// @vitest-environment jsdom
//
// Caça "voltar do navegador" (27/11/2026): com o cartão sendo cobrado, o
// Voltar do celular (ou da barra do navegador) SAÍA da tela calado. O
// tratamento do Voltar só conhecia o envio do PEDIDO (`isSubmitting`); a
// cobrança do cartão roda dentro da tela do cartão, depois de o pedido
// nascer, e caía no ramo "aguardando pagamento" — que leva ao Início. A tela
// do cartão desmontava, a resposta do banco era descartada e a cliente não
// sabia se tinha pago.
//
// Agora, com o cartão no ar: há uma guarda no histórico, o Voltar devolve a
// guarda e diz "Aguarde a resposta do cartão.", e a bandeira que o roteador
// consulta (barra de baixo, cabeçalho) fica ligada. Quando a resposta chega,
// o Voltar volta a ser o de sempre (Início).
//
// Andaime: checkout-view-cartao-forma-desligada.test.tsx (CheckoutView +
// PagamentoOnline + PagamentoComCartao DE VERDADE; só o SDK do Mercado Pago e
// o `criarPagamento` são dublês), com o `sonner` observado como em
// checkout-pedido-chave-voltar-e-sessao.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";
import { haEnvioDoCheckoutEmCurso } from "@/lib/envio-do-checkout-em-curso";

const createOrder = vi.fn();
const updateOrderStatus = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const { criarPagamento, toastInfo } = vi.hoisted(() => ({
  criarPagamento: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: toastInfo },
}));

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
      whatsappNumber: undefined,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
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
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

// Identidades ESTÁVEIS: efeitos do CheckoutView dependem de `user` e da
// config — objeto novo a cada render vira laço.
const mockUser = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

function carrinhoDeTeste() {
  return [
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
}
let mockCart = carrinhoDeTeste();

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: 100,
      shippingFee: 20,
      clearCart: () => {
        mockCart = [];
      },
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "opt-mock",
        name: "Entrega Padrão",
        price: 20,
        deliveryDays: 3,
        provider: "flat_fee",
      },
      shippingCep: "38500-000",
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
    useOrders: () => ({ createOrder, updateOrderStatus, criarPagamento }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const mockConfigDoCartao = { credito: true, debito: false, parcelasMax: 6 };
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(mockConfigDoCartao) };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: { status: "pending" }, error: null }),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO_CARTAO_NO_AR = "Aguarde a resposta do cartão.";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function instalarSdkFalso() {
  const create = vi.fn(
    async (_brick: string, _container: string, _config: any) => ({
      unmount: vi.fn(),
    }),
  );
  // @ts-expect-error stub do SDK
  globalThis.MercadoPago = vi.fn(function MercadoPagoStub() {
    return { bricks: () => ({ create }) };
  });
  return create;
}

/** O override do Voltar que o CheckoutView registrou por último. */
function overrideAtual(): (() => void) | null {
  const ultima = onSetBackOverride.mock.calls.at(-1)?.[0] as
    | (() => () => void)
    | null
    | undefined;
  return typeof ultima === "function" ? ultima() : null;
}

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

describe("CheckoutView — Voltar com o cartão sendo cobrado espera a resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    globalThis.history.replaceState(null, "", "/checkout");
    createOrder.mockReset().mockResolvedValue({ id: "ped-888" });
    updateOrderStatus.mockReset().mockResolvedValue(undefined);
    criarPagamento.mockReset();
    toastInfo.mockReset();
    onNavigate.mockClear();
    onSetBackOverride.mockReset();
    mockCart = carrinhoDeTeste();
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
    create = instalarSdkFalso();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function chegarNoPagamentoComCartao() {
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
      await esperarMicrotarefas();
    });
    await act(async () => {
      botaoPorTexto("Cartão de crédito")!.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    await act(async () => {
      botaoPorTexto("Finalizar Pedido")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  /**
   * Envia um cartão pelo último Brick criado, SEM esperar a resposta. O envio
   * volta DENTRO de um objeto: devolvido direto por função `async`, seria
   * esperado por quem chama — e só resolve com a resposta que o teste segura.
   */
  async function enviarCartaoSemEsperar(): Promise<{
    envio: Promise<unknown>;
  }> {
    const chamada = create.mock.calls.at(-1);
    if (!chamada) throw new Error("O Brick não foi criado.");
    const { callbacks } = chamada[2];
    await act(async () => {
      callbacks.onReady();
    });
    let envio: Promise<unknown> = Promise.resolve();
    await act(async () => {
      envio = callbacks
        .onSubmit(
          {
            token: "tok-teste",
            issuer_id: "25",
            payment_method_id: "master",
            transaction_amount: 120,
            installments: 1,
            payer: {
              email: "cliente@exemplo.com",
              identification: { type: "CPF", number: "11144477735" },
            },
          },
          { paymentTypeId: "credit_card" },
        )
        .catch(() => {});
      await esperarMicrotarefas();
    });
    return { envio };
  }

  it("com o cartão no ar o Voltar não sai: avisa, devolve a guarda e liga a bandeira; com a resposta, volta ao de sempre", async () => {
    let responder!: (resposta: unknown) => void;
    criarPagamento.mockImplementationOnce(
      () => new Promise((resolve) => (responder = resolve)),
    );
    await chegarNoPagamentoComCartao();
    expect(create).toHaveBeenCalledTimes(1);
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);

    const empurrar = vi.spyOn(globalThis.history, "pushState");
    const { envio } = await enviarCartaoSemEsperar();

    // Cobrança no ar: guarda no histórico (o Voltar a consome sem sair do
    // /checkout) e bandeira do roteador ligada.
    expect(empurrar).toHaveBeenCalledWith(
      { modal: "checkout-enviando" },
      "",
      "/checkout",
    );
    expect(haEnvioDoCheckoutEmCurso()).toBe(true);

    const voltar = overrideAtual();
    expect(voltar).not.toBeNull();
    const antes = empurrar.mock.calls.length;
    voltar!();
    expect(onNavigate).not.toHaveBeenCalledWith("home");
    expect(toastInfo).toHaveBeenCalledWith(AVISO_CARTAO_NO_AR);
    // O popstate consumiu a guarda: ela volta, para o PRÓXIMO toque também
    // ser retido.
    expect(empurrar.mock.calls.length).toBe(antes + 1);
    expect(empurrar.mock.calls.at(-1)?.[0]).toEqual({
      modal: "checkout-enviando",
    });

    // A resposta chega (recusa: a tela do cartão continua, com o pedido
    // aguardando pagamento) — o Voltar volta a ser o de sempre.
    await act(async () => {
      responder({
        paymentId: "pay-1",
        statusPagamento: "recusado",
        expiraEm: "2999-01-01T00:00:00.000Z",
        motivoRecusa: "Cartão recusado pelo banco.",
        podeTentarDeNovo: true,
      });
      await envio;
      await esperarMicrotarefas();
    });
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);
    toastInfo.mockReset();
    overrideAtual()!();
    expect(toastInfo).not.toHaveBeenCalledWith(AVISO_CARTAO_NO_AR);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });

  it("CONTROLE: na tela do cartão SEM envio no ar, o Voltar leva ao Início como antes", async () => {
    await chegarNoPagamentoComCartao();
    expect(create).toHaveBeenCalledTimes(1);
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);

    const voltar = overrideAtual();
    expect(voltar).not.toBeNull();
    voltar!();
    expect(toastInfo).not.toHaveBeenCalledWith(AVISO_CARTAO_NO_AR);
    expect(onNavigate).toHaveBeenCalledWith("home");
  });
});
