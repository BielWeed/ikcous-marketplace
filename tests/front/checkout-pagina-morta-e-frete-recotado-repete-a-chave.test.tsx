// @vitest-environment jsdom
//
// Lote 569 (28/11/2026): PÁGINA MORTA NO "FINALIZAR" + FRETE RECOTADO.
//
// A cliente toca em Finalizar; o pedido pode ter nascido no banco, mas a página
// morre antes da resposta (o iPhone fecha o app, a aba recarrega). Ao voltar, a
// chave do pedido segue no localStorage (30 min) e o carrinho também — mas a
// opção de frete mora em memória e é cotada de novo. Se a MESMA opção, para o
// MESMO destino, volta com outro preço, frete e total mudavam juntos, a chave
// girava e o novo Finalizar criava um SEGUNDO pedido pendente. Agora a chave é
// a mesma: o banco devolve o pedido que já nasceu.
//
// Controle: o preço dos ITENS mudou (o total muda sem o frete acompanhar) —
// isso continua sendo outra compra, e a chave gira.
//
// Andaime copiado de checkout-chave-de-idempotencia-muda-com-o-eixo-do-
// pagamento.test.tsx (cliente logada com endereço padrão, relógio falso).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
const updateOrderStatus = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const configDaLoja = {
  shippingCoverage: "local",
  originCep: "38500-000",
  enableCoupons: false,
  whatsappNumber: "34999998888",
};

const enderecos = [
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
];

const usuarioLogado = { id: "user-1" };

const produtoDoCarrinho = {
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
const carrinho = [{ product: produtoDoCarrinho, quantity: 1 }];

function opcaoDeEntrega(preco: number) {
  return {
    id: "local-delivery",
    name: "Entrega Local",
    price: preco,
    deliveryDays: 1,
    provider: "local",
  };
}

// Referências ESTÁVEIS por montagem (objeto novo a cada render gira efeitos
// em laço); o teste troca o objeto só ENTRE montagens.
const mundo = {
  subtotal: 100,
  frete: 10,
  opcao: opcaoDeEntrega(10),
};

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: enderecos,
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioLogado, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: carrinho,
      cartTotal: mundo.subtotal,
      shippingFee: mundo.frete,
      clearCart,
      addToCart: vi.fn(),
      selectedShippingOption: mundo.opcao,
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
    useOrders: () => ({ createOrder, updateOrderStatus }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            }),
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

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
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

describe("CheckoutView — página morta no Finalizar e frete recotado (lote 569)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    updateOrderStatus.mockReset();
    clearCart.mockClear();
    mundo.subtotal = 100;
    mundo.frete = 10;
    mundo.opcao = opcaoDeEntrega(10);
    // localStorage SOBREVIVE à página morta (a chave mora nele); o
    // sessionStorage morre com o app fechado — aqui ele começa vazio nas duas
    // montagens, o pior caso.
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function sessaoVazia() {
    const armazemSessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => armazemSessao.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazemSessao.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazemSessao.delete(chave);
      },
    });
  }

  async function abrirOCheckout() {
    sessaoVazia();
    raiz = createRoot(hospedeiro);
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
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(420);
    });
    const pix = localizarBotaoPorTexto(hospedeiro, "Pagar agora com PIX")!;
    await act(async () => {
      pix.click();
    });
  }

  async function clicarFinalizar() {
    const botao = localizarBotaoPorTexto(document.body, "Finalizar Pedido")!;
    expect(botao, "o Finalizar tem de estar na tela").toBeDefined();
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  /** A página morre com a RPC no ar: nenhuma resposta chega à tela. */
  function aPaginaMorre() {
    act(() => {
      raiz.unmount();
    });
  }

  function chaveDaChamada(indice: number): string {
    const chamada = createOrder.mock.calls.at(indice);
    expect(chamada, `envio ${indice + 1}`).toBeDefined();
    const chave = chamada![0].idempotencyKey;
    expect(typeof chave).toBe("string");
    return chave;
  }

  it("mesma opção, mesmo destino, preço recotado: o novo Finalizar repete a MESMA chave", async () => {
    // A 1ª RPC fica no ar para sempre: o pedido pode ter nascido no banco.
    createOrder.mockReturnValueOnce(new Promise(() => {}));
    await abrirOCheckout();
    await clicarFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0]![0].totalAmount).toBe(110);
    aPaginaMorre();

    // A página nova: a calculadora cotou de novo e a MESMA entrega subiu.
    mundo.frete = 14.5;
    mundo.opcao = opcaoDeEntrega(14.5);
    createOrder.mockRejectedValueOnce({
      code: "23505",
      message: "erro genérico do banco, não é falha de rede",
    });
    await abrirOCheckout();
    await clicarFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(2);
    // O 2º envio levou o valor recotado (não é o mesmo payload reenviado)...
    expect(createOrder.mock.calls[1]![0].totalAmount).toBe(114.5);
    expect(createOrder.mock.calls[1]![0].shippingCost).toBe(14.5);
    // ...e a MESMA chave: o banco devolve o pedido que já nasceu.
    expect(chaveDaChamada(1)).toBe(chaveDaChamada(0));
  });

  it("controle: o preço dos itens mudou (frete igual) — outra compra, a chave gira", async () => {
    createOrder.mockReturnValueOnce(new Promise(() => {}));
    await abrirOCheckout();
    await clicarFinalizar();
    aPaginaMorre();

    mundo.subtotal = 120;
    createOrder.mockRejectedValueOnce({
      code: "23505",
      message: "erro genérico do banco, não é falha de rede",
    });
    await abrirOCheckout();
    await clicarFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1]![0].totalAmount).toBe(130);
    expect(chaveDaChamada(1)).not.toBe(chaveDaChamada(0));
  });
});
