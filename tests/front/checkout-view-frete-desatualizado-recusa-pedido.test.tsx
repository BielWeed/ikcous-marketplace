// @vitest-environment jsdom
//
// EMENDA R3-4 (CONTRATO-1.5.7.md §9): a config da lojista pode mudar numa
// corrida rara — ENTRE o checkout confirmar a revisão do frete (checagem
// prévia) e o clique chegar ao banco. A RPC de criação do pedido é quem tem
// a palavra final: se ela recusar com o marcador FRETE_COTACAO_DESATUALIZADA
// (mesmo texto que EDGE calculate-shipping usa — grep confirmado nesta task,
// ver CHECKPOINT-C.txt), o checkout NUNCA cria o pedido com um frete que o
// próprio banco já rejeitou. A cliente vê "O frete mudou, calcule de novo",
// a opção escolhida é limpa e uma nova cotação é forçada.
//
// Harness copiado de checkout-view-flag-on.test.tsx (mesmo padrão de dublê
// reativo do useCart e mock do PagamentoOnline) — aqui a opção de frete é de
// TRANSPORTADORA (não "local-delivery"), porque é dela que a checagem de
// revisão (R1-2/R3-4) trata; entrega local/retirada não vêm de cotação de
// provedor.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const shippingCalculatorProps: Array<{ forcarNovaCotacaoEm?: number }> = [];

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: (props: { forcarNovaCotacaoEm?: number }) => {
    shippingCalculatorProps.push({
      forcarNovaCotacaoEm: props.forcarNovaCotacaoEm,
    });
    return null;
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
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

const mockUser = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = null;
const setSelectedShippingOption = vi.fn(
  (opt: typeof mockSelectedShippingOption) => {
    mockSelectedShippingOption = opt;
  },
);

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
      shippingFee: mockSelectedShippingOption?.price ?? 30,
      clearCart,
      selectedShippingOption: mockSelectedShippingOption,
      // Mesmo CEP do endereço padrão (addr-1): a reconciliação de CEP (onda
      // 4 do laudo 3108) limpa a seleção quando o CEP da cotação não bate
      // com o do endereço escolhido — aqui o que se prova é outra coisa
      // (R3-4), então o destino tem de casar.
      shippingCep: "38500-000",
      setSelectedShippingOption,
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// `importOriginal` preserva `mensagemAmigavelErroPedido` real: o segundo
// teste (recusa de negócio comum) exercita a tradução de verdade, igual a
// checkout-view-erro-de-pedido-traduzido.test.tsx.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

// Frete de TRANSPORTADORA exige pagamento "online" (regra do dono,
// 21/09/2026) — a flag precisa estar ligada para a opção existir na tela.
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — a RPC recusa por FRETE_COTACAO_DESATUALIZADA (EMENDA R3-4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    onNavigate.mockClear();
    toastError.mockReset();
    setSelectedShippingOption.mockClear();
    shippingCalculatorProps.length = 0;
    mockSelectedShippingOption = {
      id: "melhorenvio-pac",
      name: "PAC",
      price: 30,
      deliveryDays: 6,
      provider: "melhor_envio",
    };
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

  async function montarEFinalizar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // Frete de transportadora exige "online" — sem isso o Finalizar fica
    // travado por `pagamentoIncompativelComFrete`.
    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    )!;
    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      // TRANSPORTADORA EXIGE CPF (checkout compacto + CPF, 23/09/2026).
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    expect(botaoFinalizar.disabled).toBe(false);
    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("RPC recusa com FRETE_COTACAO_DESATUALIZADA: avisa, limpa a seleção, força nova cotação e NÃO cria o pedido", async () => {
    createOrder.mockRejectedValueOnce({
      code: "P0001",
      message: "FRETE_COTACAO_DESATUALIZADA: configuração de frete mudou",
    });

    await montarEFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("O frete mudou, calcule de novo.");
    // A seleção é limpa — nunca cobra o frete velho num novo clique.
    expect(setSelectedShippingOption).toHaveBeenCalledWith(null);
    // E uma cotação nova é forçada: o `forcarNovaCotacaoEm` que chega à
    // calculadora sobe pelo menos uma vez depois do clique.
    const ultimoValor =
      shippingCalculatorProps.at(-1)?.forcarNovaCotacaoEm ?? 0;
    const primeiroValor = shippingCalculatorProps[0]?.forcarNovaCotacaoEm ?? 0;
    expect(ultimoValor).toBeGreaterThan(primeiroValor);
    // Nenhum pedido nasceu: nem a tela de sucesso, nem a de pagamento online.
    expect(hospedeiro.textContent).not.toContain("Pedido Celebrado!");
    expect(hospedeiro.textContent).not.toContain("Finalize o pagamento");
    expect(clearCart).not.toHaveBeenCalled();
  });

  it("recusa de negócio SEM o marcador de frete desatualizado continua caindo no aviso genérico (não confunde as duas saídas)", async () => {
    createOrder.mockRejectedValueOnce({
      code: "P0001",
      message: "Estoque insuficiente para o produto Caneca Azul",
    });

    await montarEFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalledWith(
      "O frete mudou, calcule de novo.",
    );
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining(
        "Estoque insuficiente para o produto Caneca Azul",
      ),
    );
    // Sem o marcador, a seleção de frete NÃO é mexida por este caminho.
    expect(setSelectedShippingOption).not.toHaveBeenCalledWith(null);
  });
});
