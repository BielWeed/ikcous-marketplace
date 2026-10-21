// @vitest-environment jsdom
//
// "Atualizar o carrinho" tem de ATUALIZAR o carrinho (14/10/2026).
//
// DEFEITO MEDIDO: a cliente toca em Finalizar; o servidor recusa com "Os
// valores do pedido mudaram. Atualize o carrinho e tente novamente."; o painel
// da recusa oferece "Atualizar o carrinho" (ou "Deixar a quantidade
// disponível", se foi o estoque). Os dois botões só levavam ao carrinho — com
// os MESMOS preços, porque nada relia o catálogo. A cliente tocava em
// Finalizar de novo e levava a mesma recusa; só fechar e reabrir o app
// resolvia. Aqui se prova o caminho de ponta a ponta na tela do checkout: a
// releitura do carrinho acontece ANTES de navegar, e nunca prende a cliente.
//
// Modelo estrutural copiado de checkout-recusa-de-entrega-manda-para-a-conta
// .test.tsx (mesmo harness de render real via react-dom/client + jsdom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const mundo = vi.hoisted(() => ({
  ordem: [] as string[],
}));

const createOrder = vi.fn();
const clearCart = vi.fn();
const renovarCarrinho = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
    },
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

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
      shippingFee: 0,
      clearCart,
      renovarCarrinhoPeloCatalogo: () => renovarCarrinho(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
      setSelectedShippingOption: vi.fn(),
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

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RECUSA_DE_PRECO = {
  code: "P0001",
  message:
    "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
};
const RECUSA_DE_ESTOQUE = {
  code: "P0001",
  message:
    "Estoque insuficiente para o produto Caneca (Disponível: 2, Solicitado: 5)",
};
const RECUSA_DE_FRETE = {
  code: "P0001",
  message:
    "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
};

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

function localizarBotaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement | undefined;
}

async function preencherEClicarFinalizar() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    digitar("guest-street", "Rua Teste");
    digitar("guest-number", "100");
    digitar("guest-neighborhood", "Centro");
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-cep", "01310-100");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-city", "Cidade Teste");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-state", "SP");
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });

  const botao = localizarBotaoFinalizar()!;
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

describe("CheckoutView — a recusa de preço/estoque relê o carrinho antes de levar até ele", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    sessionStorage.clear();
    createOrder.mockReset();
    clearCart.mockClear();
    renovarCarrinho.mockReset();
    onNavigate.mockReset();
    mundo.ordem.length = 0;
    onNavigate.mockImplementation((destino: string) => {
      mundo.ordem.push(`ir:${destino}`);
    });
    const armazem = new Map<string, string>();
    pararABuscaDeCep();
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
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function chegarNaRecusa(recusa: unknown, acao: string) {
    createOrder.mockRejectedValueOnce(recusa);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await preencherEClicarFinalizar();
    const botao = document.querySelector(
      `button[data-acao="${acao}"]`,
    ) as HTMLButtonElement | null;
    expect(botao).not.toBeNull();
    return botao!;
  }

  /** Uma releitura que só termina quando o teste manda. */
  function releituraSobControle() {
    let terminar: () => void = () => {};
    renovarCarrinho.mockImplementation(() => {
      mundo.ordem.push("releitura:comecou");
      return new Promise<void>((resolve) => {
        terminar = () => {
          mundo.ordem.push("releitura:terminou");
          resolve();
        };
      });
    });
    return { terminar: () => terminar() };
  }

  for (const [nome, recusa, acao] of [
    ["preço mudou", RECUSA_DE_PRECO, "reconferir_carrinho"],
    ["estoque caiu", RECUSA_DE_ESTOQUE, "ajustar_estoque"],
  ] as const) {
    it(`${nome} (${acao}): relê o carrinho, e SÓ DEPOIS leva até ele`, async () => {
      const releitura = releituraSobControle();
      const botao = await chegarNaRecusa(recusa, acao);

      await act(async () => {
        botao.click();
        await esperarMicrotarefas();
      });

      // A releitura começou e a cliente ainda NÃO foi levada ao carrinho com
      // o preço velho.
      expect(renovarCarrinho).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
      // O painel de recusa não fica na tela como aviso velho.
      expect(document.querySelector('[role="alert"]')).toBeNull();

      await act(async () => {
        releitura.terminar();
        await esperarMicrotarefas();
      });

      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("cart");
      expect(mundo.ordem).toEqual([
        "releitura:comecou",
        "releitura:terminou",
        "ir:cart",
      ]);
    });
  }

  it("rede PENDURADA: depois do teto a cliente chega ao carrinho mesmo assim", async () => {
    renovarCarrinho.mockImplementation(() => new Promise<void>(() => {}));
    const botao = await chegarNaRecusa(RECUSA_DE_PRECO, "reconferir_carrinho");

    vi.useFakeTimers();
    await act(async () => {
      botao.click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(renovarCarrinho).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("cart");
  });

  it("releitura que FALHA: a cliente chega ao carrinho, sem travar", async () => {
    renovarCarrinho.mockRejectedValue(new Error("rede caiu"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const botao = await chegarNaRecusa(RECUSA_DE_PRECO, "reconferir_carrinho");

    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(renovarCarrinho).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("cart");
    erro.mockRestore();
  });

  it("controle: outra saída que também vai ao carrinho (recotar frete) NÃO relê o catálogo e vai direto", async () => {
    const botao = await chegarNaRecusa(RECUSA_DE_FRETE, "recotar_frete");

    await act(async () => {
      botao.click();
    });

    expect(renovarCarrinho).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("cart");
  });

  it("a cliente sai do checkout durante a espera: a releitura termina, mas ela NÃO é arrastada ao carrinho", async () => {
    const releitura = releituraSobControle();
    const botao = await chegarNaRecusa(RECUSA_DE_PRECO, "reconferir_carrinho");

    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
    expect(renovarCarrinho).toHaveBeenCalledTimes(1);

    // Ela voltou (ou foi para outra tela): o checkout desmonta.
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);

    await act(async () => {
      releitura.terminar();
      await esperarMicrotarefas();
    });

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
