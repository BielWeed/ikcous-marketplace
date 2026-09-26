// @vitest-environment jsdom
//
// CARTÃO PELO APP (Fase 3.5, 26/09/2026) — o checkout oferece, no grupo
// "No app", o PIX (de sempre) e o cartão (novo), só quando a loja ligou
// crédito ou débito. Os dois nascem como o MESMO `payment_method: "online"`
// (mesma RPC, mesma reserva, mesma chave de idempotência); o submétodo só
// decide a tela depois do pedido (`<PagamentoOnline metodo=…>`). Toda
// seleção AUTOMÁTICA de "online" (transportadora) continua sendo o PIX.
//
// Montagem copiada de checkout-transportadora-exige-antecipado.test.tsx; o
// `useConfigDoCartao` e o `<PagamentoOnline>` são dublês (a leitura da
// tabela e o Brick têm suítes próprias: config-do-cartao.test.ts e
// pagamento-com-cartao.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigDoCartao } from "@/lib/config-do-cartao";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-777" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const propsDoPagamento: Array<Record<string, unknown>> = [];

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
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

let mockUser: { id: string; email?: string } | null = {
  id: "user-1",
  email: "cliente@exemplo.com",
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

const item = () => ({
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
});

let mockCart = [item()];
let mockCartTotal = 100;
let mockShippingFee = 20;
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = null;

const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 20,
  deliveryDays: 1,
  provider: "local",
};

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: mockShippingFee,
      clearCart: () => {
        mockCart = [];
        mockCartTotal = 0;
        mockShippingFee = 0;
        mockSelectedShippingOption = null;
      },
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: null,
      setSelectedShippingOption: (opt: typeof mockSelectedShippingOption) => {
        mockSelectedShippingOption = opt;
      },
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// `null` = cartão não oferecido (o hook já resolve a falha fechada).
let mockConfigDoCartao: ConfigDoCartao | null = null;
vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => mockConfigDoCartao,
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    propsDoPagamento.push(props);
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
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

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar(Tela: TelaCheckout) {
  await act(async () => {
    raiz.render(
      <Tela onNavigate={onNavigate} onSetBackOverride={onSetBackOverride} />,
    );
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

async function clicar(botao: HTMLElement) {
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
  });
}

async function finalizar() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
  const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
  expect(botao.disabled).toBe(false);
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

describe("CheckoutView — cartão pelo app", () => {
  beforeEach(() => {
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-777" });
    onNavigate.mockClear();
    propsDoPagamento.length = 0;
    mockUser = { id: "user-1", email: "cliente@exemplo.com" };
    mockCart = [item()];
    mockCartTotal = 100;
    mockShippingFee = 20;
    mockSelectedShippingOption = { ...ENTREGA_LOCAL };
    mockConfigDoCartao = { credito: true, debito: true, parcelasMax: 6 };
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

  it("com crédito e débito ligados, 'No app' mostra PIX e 'Cartão de crédito ou débito', nessa ordem, antes da entrega", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    const grupo = hospedeiro.querySelector('[role="radiogroup"]')!;
    const texto = grupo.textContent ?? "";
    const posPix = texto.indexOf("Pagar agora com PIX");
    const posCartao = texto.indexOf("Cartão de crédito ou débito");
    const posEntrega = texto.indexOf("Na entrega");
    expect(posPix).toBeGreaterThanOrEqual(0);
    expect(posCartao).toBeGreaterThan(posPix);
    expect(posEntrega).toBeGreaterThan(posCartao);
  });

  it.each([
    [{ credito: true, debito: false, parcelasMax: 3 }, "Cartão de crédito"],
    [{ credito: false, debito: true, parcelasMax: 1 }, "Cartão de débito"],
  ])("o rótulo diz só o que a loja ligou (%o → %s)", async (config, rotulo) => {
    mockConfigDoCartao = config;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    const grupo = hospedeiro.querySelector('[role="radiogroup"]')!;
    expect(botaoPorTexto(grupo, rotulo)).toBeDefined();
    expect(grupo.textContent).not.toContain("crédito ou débito");
  });

  it("sem config de cartão (desligado/falhou): só o PIX no app — nada de cartão pelo app", async () => {
    mockConfigDoCartao = null;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    const grupo = hospedeiro.querySelector('[role="radiogroup"]')!;
    expect(botaoPorTexto(grupo, "Pagar agora com PIX")).toBeDefined();
    expect(grupo.textContent).not.toMatch(/Cartão de (crédito|débito)/);
  });

  it("escolher o cartão marca SÓ o cartão; o pedido nasce 'online' e a tela de pagamento recebe metodo='cartao' com a config e o e-mail da conta", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    const cartao = botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!;
    await clicar(cartao);
    expect(cartao.getAttribute("aria-checked")).toBe("true");
    expect(
      botaoPorTexto(hospedeiro, "Pagar agora com PIX")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("false");

    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [dadosDoPedido, opcoes] = createOrder.mock.calls[0];
    expect(dadosDoPedido.paymentMethod).toBe("online");
    expect(opcoes).toEqual({ comPagamentoOnline: true });

    const ultimas = propsDoPagamento.at(-1)!;
    expect(ultimas.metodo).toBe("cartao");
    expect(ultimas.configDoCartao).toEqual({
      credito: true,
      debito: true,
      parcelasMax: 6,
    });
    expect(ultimas.emailDoPagador).toBe("cliente@exemplo.com");
    expect(ultimas.orderId).toBe("ped-777");
  });

  it("a chave de idempotência não distingue PIX de cartão (mesmo eixo 'online', mesma RPC): retentativa pelo PIX repete a chave", async () => {
    // As duas tentativas voltam recusadas por um erro comum do banco (mesmo
    // andaime de checkout-chave-de-idempotencia-muda-com-o-eixo-do-
    // pagamento.test.tsx): o pedido não nasce, a chave NÃO é esquecida e o
    // mesmo carrinho pode ser reenviado para comparar a chave.
    createOrder.mockRejectedValue({
      code: "23505",
      message: "erro genérico do banco, não é falha de rede",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!);
    await finalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    const chaveDoCartao = createOrder.mock.calls[0][0].idempotencyKey;
    expect(typeof chaveDoCartao).toBe("string");

    // Quem sabe que o pedido não nasceu fecha o aviso (o Finalizar fica
    // travado enquanto ele está na tela), troca para o PIX e tenta de novo:
    // MESMA compra, MESMO eixo.
    const fechar = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar o aviso"]',
    );
    if (fechar) await clicar(fechar);
    await clicar(botaoPorTexto(hospedeiro, "Pagar agora com PIX")!);
    const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(chaveDoCartao);
  });

  it("voltar do cartão para o PIX: a tela de pagamento recebe metodo='pix'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!);
    const pix = botaoPorTexto(hospedeiro, "Pagar agora com PIX")!;
    await clicar(pix);
    expect(pix.getAttribute("aria-checked")).toBe("true");

    await finalizar();
    expect(propsDoPagamento.at(-1)!.metodo).toBe("pix");
  });

  it("'Pagar com PIX' dentro da tela de pagamento (onTrocarParaPix) faz o próximo render do PagamentoOnline já vir em PIX", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!);
    await finalizar();

    const props = propsDoPagamento.at(-1)!;
    expect(props.metodo).toBe("cartao");
    await act(async () => {
      (props.onTrocarParaPix as () => void)();
    });
    expect(propsDoPagamento.at(-1)!.metodo).toBe("pix");
  });

  it("o submétodo fica CONGELADO no pedido: a sessão cair na tela do cartão não troca para um PIX criado sozinho", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!);
    await finalizar();
    expect(propsDoPagamento.at(-1)!.metodo).toBe("cartao");

    // A sessão cai: o efeito da conta rebaixa `paymentMethod` para "pix".
    mockUser = null;
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      await esperarMicrotarefas();
    });

    expect(propsDoPagamento.at(-1)!.metodo).toBe("cartao");
  });

  it("convidado: o cartão aparece TRAVADO (exige conta) e o toque leva ao login, sem selecionar", async () => {
    mockUser = null;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    const cartao = botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!;
    expect(cartao.textContent).toContain("exige conta");
    await clicar(cartao);
    expect(onNavigate).toHaveBeenCalledWith("auth");
    expect(cartao.getAttribute("aria-checked")).toBe("false");
  });

  it("transportadora auto-seleciona o PIX — mesmo que o cliente tenha passado pelo cartão antes", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    // Passou pelo cartão e depois escolheu uma forma na entrega.
    await clicar(botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!);
    await clicar(botaoPorTexto(hospedeiro, "Dinheiro na Entrega")!);

    // Voltou ao carrinho e escolheu transportadora.
    mockSelectedShippingOption = {
      id: "melhor-envio-CorreiosSedex",
      name: "Sedex",
      price: 20,
      deliveryDays: 3,
      provider: "melhor_envio",
    };
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(
      botaoPorTexto(hospedeiro, "Pagar agora com PIX")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(
      botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("false");
    // Com o cartão disponível, a orientação fala em "pagamento pelo app".
    expect(hospedeiro.textContent).toContain(
      "por isso só oferecemos o pagamento pelo app aqui",
    );
  });
});
