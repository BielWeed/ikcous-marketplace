// @vitest-environment jsdom
//
// R1-2 (CONTRATO-1.5.7.md §6/§8): a checagem PRÉVIA de revisão, antes de
// criar o pedido. O par desta prova (nenhuma evidência de revisão -> segue
// sem bloquear) já está coberto por
// checkout-view-frete-desatualizado-recusa-pedido.test.tsx (o envelope não
// existe ali e `createOrder` é chamado normalmente). Este arquivo prova o
// caso POSITIVO: existe um envelope 1.5.7 no cache do navegador (a cotação
// escolhida SABIA sua revisão) e ela diverge da revisão atual — o checkout
// tem de travar ANTES de chamar a RPC, e não apenas confiar no backstop dela
// (EMENDA R3-4).
//
// Harness idêntico ao de checkout-view-frete-desatualizado-recusa-pedido.
// test.tsx — mesma opção de transportadora, mesmo motivo para "online".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const invoke = vi.fn();
const shippingCalculatorProps: Array<{ forcarNovaCotacaoEm?: number }> = [];

// `chaveDoCacheDeFrete` real (o formato da chave é o contrato do envelope);
// só o COMPONENTE vira dublê neutro.
vi.mock("@/components/ui/custom/ShippingCalculator", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/ui/custom/ShippingCalculator")
    >();
  return {
    ...real,
    ShippingCalculator: (props: { forcarNovaCotacaoEm?: number }) => {
      shippingCalculatorProps.push({
        forcarNovaCotacaoEm: props.forcarNovaCotacaoEm,
      });
      return null;
    },
  };
});

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
      // Mesmo CEP do endereço padrão — a reconciliação de CEP (onda 4 do
      // laudo 3108) não é o que este arquivo prova.
      shippingCep: "38500-000",
      setSelectedShippingOption,
      setShippingCep: vi.fn(),
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
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

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

describe("CheckoutView — checagem prévia de revisão do frete antes de fechar o pedido (R1-2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    onNavigate.mockClear();
    toastError.mockReset();
    setSelectedShippingOption.mockClear();
    invoke.mockReset();
    shippingCalculatorProps.length = 0;
    mockSelectedShippingOption = {
      id: "melhorenvio-pac",
      name: "PAC",
      price: 30,
      deliveryDays: 6,
      provider: "melhor_envio",
    };
    armazem = new Map<string, string>();
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

  async function gravarEnvelope(revisaoConfig: string) {
    const { chaveDoCacheDeFrete } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    // Formato REAL de `EnvelopeDeCacheDeFrete` (ShippingCalculator.tsx):
    // `opcoes`/`gravadoEm`/`assinatura`/`contexto`/`revisaoConfig` — não os
    // nomes inventados que este teste usava antes da revisão.
    armazem.set(
      chaveDoCacheDeFrete("38500000"),
      JSON.stringify({
        opcoes: [mockSelectedShippingOption],
        revisaoConfig,
        gravadoEm: Date.now(),
        assinatura: "prod-1:1",
        contexto: "cotacao-3",
      }),
    );
  }

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

  it("revisão do envelope DIVERGE da atual: trava ANTES da RPC, avisa, limpa a seleção e força nova cotação — createOrder nunca é chamado", async () => {
    await gravarEnvelope("rev-velha");
    invoke.mockResolvedValue({
      data: { revisaoConfig: "rev-nova" },
      error: null,
    });

    await montarEFinalizar();

    expect(invoke).toHaveBeenCalledWith("calculate-shipping", {
      body: { action: "revisao_config_frete" },
    });
    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("O frete mudou, calcule de novo.");
    expect(setSelectedShippingOption).toHaveBeenCalledWith(null);
    const ultimoValor =
      shippingCalculatorProps.at(-1)?.forcarNovaCotacaoEm ?? 0;
    const primeiroValor = shippingCalculatorProps[0]?.forcarNovaCotacaoEm ?? 0;
    expect(ultimoValor).toBeGreaterThan(primeiroValor);
  });

  it("confirmação do frete sem resposta: termina a espera, recota e não cria pedido", async () => {
    await gravarEnvelope("rev-antiga");
    invoke.mockImplementation(() => new Promise(() => {}));
    const agendar = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, prazo, ...args) =>
        agendar(callback, prazo === 12_000 ? 1 : prazo, ...args),
    );

    await montarEFinalizar();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Não deu para confirmar o frete agora. Calculamos de novo — confira e finalize.",
    );
    expect(setSelectedShippingOption).toHaveBeenCalledWith(null);
    expect(
      localizarBotaoPorTexto(document.body, "Finalizar Pedido")?.disabled,
    ).toBe(true);
  });

  it("revisão do envelope BATE com a atual: segue e cria o pedido normalmente", async () => {
    await gravarEnvelope("rev-igual");
    invoke.mockResolvedValue({
      data: { revisaoConfig: "rev-igual" },
      error: null,
    });
    createOrder.mockResolvedValueOnce({ id: "ped-321" });

    await montarEFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalledWith(
      "O frete mudou, calcule de novo.",
    );
    expect(setSelectedShippingOption).not.toHaveBeenCalledWith(null);
  });

  it("HÁ evidência de revisão (envelope) mas a confirmação não carrega (edge fora do ar): trata como 'não confirmado' — não cria o pedido, limpa a seleção e força nova cotação", async () => {
    // Corrigido pela revisão Opus: a versão anterior deste teste esperava
    // "segue e cria o pedido" quando a confirmação falhava — e isso reabria
    // exatamente o buraco que R1-2 fecha (a RPC que reforçaria isso não é
    // uma trava que sempre vale: a migration ainda não foi aplicada e nem
    // cobre mudança em `store_config`). Com evidência de revisão no
    // envelope, "não confirmei" é tratado como divergência, não como "segue".
    await gravarEnvelope("rev-velha");
    invoke.mockResolvedValue({ data: null, error: { message: "offline" } });
    createOrder.mockResolvedValueOnce({ id: "ped-654" });

    await montarEFinalizar();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Não deu para confirmar o frete agora. Calculamos de novo — confira e finalize.",
    );
    expect(setSelectedShippingOption).toHaveBeenCalledWith(null);
    const ultimoValor =
      shippingCalculatorProps.at(-1)?.forcarNovaCotacaoEm ?? 0;
    const primeiroValor = shippingCalculatorProps[0]?.forcarNovaCotacaoEm ?? 0;
    expect(ultimoValor).toBeGreaterThan(primeiroValor);
  });
});
