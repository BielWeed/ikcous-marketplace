// @vitest-environment jsdom
//
// Defeito carrinho-checkout-1, lado do PEDIDO: produto de cadastro antigo com
// cor e tamanho em linhas separadas de product_variants. O carrinho agora tem
// uma linha por combinação (Azul-P, Azul-M), todas com o MESMO primeiro id.
// O que o checkout precisa garantir ao enviar:
//
//   1. a RPC recebe SÓ o primeiro id por linha, nunca a chave composta (a RPC
//      converte `variant_id` em uuid: "idA~idB" derrubaria o pedido inteiro);
//   2. as DUAS escolhas e a quantidade de cada combinação vão por escrito na
//      observação do pedido (a RPC só grava um variant_id por linha);
//   3. a chave de idempotência enxerga a SEGUNDA escolha: trocar Azul-P por
//      Azul-M e tentar de novo não pode repetir a chave e devolver o pedido da
//      outra combinação.
//
// Andaime copiado de checkout-chave-de-idempotencia-muda-com-o-eixo-do-pagamento
// .test.tsx (mesmos dublês; cliente logado, relógio falso).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const enderecoPadrao = {
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
};
const enderecos = [enderecoPadrao];
const usuarioLogado = { id: "user-1" };

const variante = (
  id: string,
  name: string,
  value: string,
  estoque: number,
) => ({
  id,
  productId: "prod-1",
  name,
  value,
  stockIncrement: estoque,
  active: true,
});
const produtoDoCarrinho = {
  id: "prod-1",
  name: "Camiseta",
  description: "",
  price: 100,
  images: [],
  category: "geral",
  stock: 16,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
  variants: [
    variante("vc-azul", "Cor", "Azul", 5),
    variante("vt-p", "Tamanho", "P", 4),
    variante("vt-m", "Tamanho", "M", 2),
  ],
};
const linhaDoCarrinho = (
  tamanhoId: string,
  tamanho: string,
  quantity: number,
) => ({
  product: produtoDoCarrinho,
  quantity,
  variantId: "vc-azul",
  outrasVariantIds: [tamanhoId],
  variantNames: `Cor: Azul, Tamanho: ${tamanho}`,
});
// O carrinho que o dublê do useCart devolve; o teste troca antes de montar.
const mundo = vi.hoisted(() => ({ carrinho: [] as unknown[] }));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: enderecos,
    fetchAddresses: vi.fn(),
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
      cart: mundo.carrinho,
      cartTotal: 100,
      shippingFee: 0,
      clearCart,
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

describe("CheckoutView — produto com cor e tamanho separados: o pedido leva as duas escolhas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    // Recusa "comum": o pedido NÃO é dado como criado, e dá para reenviar.
    createOrder.mockRejectedValue({
      code: "23505",
      message: "erro genérico do banco, não é falha de rede",
    });
    updateOrderStatus.mockReset();
    clearCart.mockClear();
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
    vi.useFakeTimers();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
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

  async function montarEPreencher() {
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
  }

  async function finalizarNaEntrega() {
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Dinheiro na Entrega")!.click();
    });
    await act(async () => {
      localizarBotaoPorTexto(document.body, "Finalizar Pedido")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(createOrder).toHaveBeenCalled();
    return createOrder.mock.calls.at(-1)![0];
  }

  it("a RPC recebe só o primeiro id de cada linha; as duas escolhas e a quantidade de cada combinação vão na observação", async () => {
    mundo.carrinho = [
      linhaDoCarrinho("vt-p", "P", 1),
      linhaDoCarrinho("vt-m", "M", 2),
    ];
    await montarEPreencher();
    const pedido = await finalizarNaEntrega();

    // Contrato com o servidor: uuid puro, uma linha por combinação.
    expect(pedido.items).toEqual([
      { product_id: "prod-1", quantity: 1, variant_id: "vc-azul" },
      { product_id: "prod-1", quantity: 2, variant_id: "vc-azul" },
    ]);
    expect(JSON.stringify(pedido.items)).not.toContain("~");
    // As duas escolhas, com a quantidade de cada uma.
    expect(pedido.notes).toContain("Camiseta: Cor: Azul, Tamanho: P (1 un.)");
    expect(pedido.notes).toContain("Camiseta: Cor: Azul, Tamanho: M (2 un.)");
  });

  it("trocar Azul-P por Azul-M e tentar de novo gira chave NOVA; o mesmo carrinho repete a chave", async () => {
    mundo.carrinho = [linhaDoCarrinho("vt-p", "P", 1)];
    await montarEPreencher();
    const primeiro = await finalizarNaEntrega();

    // Mesma compra, de novo (a retentativa legítima): MESMA chave.
    await act(async () => {
      localizarBotaoPorTexto(document.body, "Finalizar Pedido")!.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls.at(-1)![0].idempotencyKey).toBe(
      primeiro.idempotencyKey,
    );

    // A cliente troca o tamanho: a RPC receberia os MESMOS items (mesmo
    // primeiro id, mesma quantidade) -- só a chave de idempotência pode
    // diferenciar as duas compras.
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    mundo.carrinho = [linhaDoCarrinho("vt-m", "M", 1)];
    await montarEPreencher();
    const outro = await finalizarNaEntrega();

    expect(outro.items).toEqual(primeiro.items);
    expect(outro.idempotencyKey).not.toBe(primeiro.idempotencyKey);
  });

  it("produto de uma escolha só: o pedido é o de sempre, sem texto de quantidade", async () => {
    mundo.carrinho = [
      {
        product: produtoDoCarrinho,
        quantity: 2,
        variantId: "vt-p",
        variantNames: "Tamanho: P",
      },
    ];
    await montarEPreencher();
    const pedido = await finalizarNaEntrega();

    expect(pedido.items).toEqual([
      { product_id: "prod-1", quantity: 2, variant_id: "vt-p" },
    ]);
    expect(pedido.notes).toContain("Camiseta: Tamanho: P");
    expect(pedido.notes).not.toContain("un.)");
  });
});
