// @vitest-environment jsdom
//
// Contrato "forma de cartão desligada" (01/10/2026) — a guarda de "Cancelar
// pedido" provada NO COMPONENTE QUE A DESENHA. O botão só existe na caixa de
// erro do CheckoutView; os testes de `PagamentoOnline` só conseguem provar
// que ele não abre essa caixa. Aqui o CheckoutView monta o `PagamentoOnline`
// e o `PagamentoComCartao` DE VERDADE (só o SDK do Mercado Pago e o
// `criarPagamento` são dublês) e a pergunta é sobre a tela inteira: depois do
// 409 de forma desligada, "Cancelar pedido" aparece em algum momento?
//
// O controle prova que o seletor enxerga o botão quando ele existe (cartão
// RECUSADO = morto → PIX → erro do PIX sem sinal → "Cancelar pedido" volta),
// para a ausência nos outros dois testes não ser vácuo.
//
// Andaime: o mesmo de checkout-view-cartao-erro-oferece-pix-e-em-analise.
// test.tsx, SEM o mock de PagamentoOnline.
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

import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";

const createOrder = vi.fn();
const updateOrderStatus = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));

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

// Identidades ESTÁVEIS (como no teste vizinho): efeitos do CheckoutView
// dependem de `user` e da config — objeto novo a cada render vira laço.
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

// O MESMO dublê serve ao CheckoutView (createOrder/updateOrderStatus) e às
// telas de pagamento de verdade (criarPagamento).
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

const CODIGO = "CARTAO_FORMA_DESLIGADA";
const MENSAGEM_FORMA =
  "Esta forma de pagamento não está disponível nesta loja.";
const AVISO_INDISPONIVEL =
  "O pagamento com cartão não está disponível nesta loja agora.";
const CANCELAR = "Cancelar pedido";

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

/** Dublê do SDK: cada `create()` devolve um controlador com `unmount` próprio. */
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

/** O Error no formato que `useOrders/criarPagamento` lança. */
function erroDaEdge(mensagem: string, campos: Record<string, unknown> = {}) {
  return Object.assign(new Error(mensagem), {
    terminal: false,
    cartaoEmAnalise: false,
    ...campos,
  });
}

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

describe("CheckoutView + PagamentoOnline de verdade — forma de cartão desligada não reabre 'Cancelar pedido'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    createOrder.mockReset().mockResolvedValue({ id: "ped-777" });
    updateOrderStatus.mockReset().mockResolvedValue(undefined);
    criarPagamento.mockReset();
    onNavigate.mockClear();
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

  /** Envia um cartão de crédito pelo último Brick criado. */
  async function enviarCartao() {
    const chamada = create.mock.calls.at(-1);
    if (!chamada) throw new Error("O Brick não foi criado.");
    const { callbacks } = chamada[2];
    await act(async () => {
      callbacks.onReady();
    });
    await act(async () => {
      try {
        await callbacks.onSubmit(
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
        );
      } catch {
        // O Brick recebe a recusa; o que importa é a tela.
      }
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function clicar(texto: string) {
    const botao = botaoPorTexto(texto);
    expect(botao, `o botão '${texto}' deveria estar na tela`).toBeDefined();
    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("CONTROLE: cartão RECUSADO (morto) -> PIX -> erro do PIX sem sinal -> 'Cancelar pedido' aparece (o seletor enxerga o botão)", async () => {
    criarPagamento
      .mockResolvedValueOnce({
        paymentId: "pay-1",
        statusPagamento: "recusado",
        expiraEm: "x",
        motivoRecusa: "Cartão recusado pelo banco.",
        podeTentarDeNovo: true,
      })
      .mockRejectedValueOnce(erroDaEdge("Não foi possível gerar a cobrança."));
    await chegarNoPagamentoComCartao();
    expect(create).toHaveBeenCalledTimes(1);

    await enviarCartao();
    await clicar("Pagar com PIX");

    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(criarPagamento.mock.calls[1][0]).toEqual({
      orderId: "ped-777",
      metodo: "pix",
    });
    expect(botaoPorTexto(CANCELAR)).toBeDefined();
  });

  it("sem cobrança incerta: forma desligada -> PIX -> erro do PIX sem sinal: 'Cancelar pedido' NUNCA aparece (o cartão esteve em cena)", async () => {
    criarPagamento
      .mockRejectedValueOnce(erroDaEdge(MENSAGEM_FORMA, { codigo: CODIGO }))
      .mockRejectedValueOnce(erroDaEdge("Não foi possível gerar a cobrança."));
    await chegarNoPagamentoComCartao();

    await enviarCartao();

    expect(hospedeiro.textContent).toContain(AVISO_INDISPONIVEL);
    expect(botaoPorTexto(CANCELAR)).toBeUndefined();

    await clicar("Pagar com PIX");

    // O PIX passou pela edge (guarda da vaga) e falhou sem sinal.
    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(criarPagamento.mock.calls[1][0]).toEqual({
      orderId: "ped-777",
      metodo: "pix",
    });
    expect(hospedeiro.textContent).toContain(
      "Não foi possível gerar a cobrança.",
    );
    expect(botaoPorTexto(CANCELAR)).toBeUndefined();
  });

  // C5 (front B2, 02/10/2026): o 502 ambíguo não oferece mais "Tentar de
  // novo" (o cartão de novo, token novo, sobre a dúvida) — abre a verificação
  // do C4. O caminho até a forma desligada com a cobrança incerta passa a ser:
  // consulta que prova a vaga livre -> o cliente ESCOLHE o cartão -> forma
  // desligada. A regra por pedido continua: nunca PIX nem "Cancelar pedido".
  it("com cobrança incerta (502 ambíguo antes): verificação -> vaga livre -> cartão escolhido -> forma desligada -> só 'Ver meus pedidos', nunca PIX nem 'Cancelar pedido'", async () => {
    criarPagamento
      .mockRejectedValueOnce(erroDaEdge("Erro de infraestrutura (502)."))
      .mockResolvedValueOnce({
        verificacao: "livre",
        paymentId: null,
        expiraEm: "2999-01-01T00:00:00.000Z",
      })
      .mockRejectedValueOnce(erroDaEdge(MENSAGEM_FORMA, { codigo: CODIGO }));
    await chegarNoPagamentoComCartao();

    await enviarCartao();
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
    expect(botaoPorTexto(CANCELAR)).toBeUndefined();
    expect(botaoPorTexto("Tentar de novo")).toBeUndefined();
    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(criarPagamento.mock.calls[1][0]).toEqual({
      orderId: "ped-777",
      metodo: "verificar",
    });
    await clicar("Cartão de crédito");
    expect(create).toHaveBeenCalledTimes(2);

    await enviarCartao();

    expect(criarPagamento).toHaveBeenCalledTimes(3);
    expect(hospedeiro.textContent).toContain(AVISO_INDISPONIVEL);
    expect(botaoPorTexto("Pagar com PIX")).toBeUndefined();
    expect(botaoPorTexto(CANCELAR)).toBeUndefined();

    await clicar("Ver meus pedidos");

    expect(onNavigate).toHaveBeenCalledWith("orders");
    expect(criarPagamento).toHaveBeenCalledTimes(3);
  });
});
