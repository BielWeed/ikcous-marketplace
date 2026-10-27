// @vitest-environment jsdom
//
// "Calcular o frete de novo" tem de calcular de novo (caça 10, item 2, lote 228).
//
// DEFEITO: o servidor recusa o pedido com "A cotação de frete expirou". O painel
// da recusa oferece "Calcular o frete de novo", que só levava ao carrinho — e o
// carrinho serve a cópia da cotação guardada no navegador (até 2 h) SEM consultar
// o servidor. A cliente via o mesmo frete "pronto", voltava, e era recusada de
// novo, em laço. O botão agora APAGA a cópia guardada antes de navegar; com ela
// apagada, o carrinho não tem o que servir e consulta o servidor de verdade.
//
// Modelo estrutural: checkout-recusa-atualiza-o-carrinho-de-verdade.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const mundo = vi.hoisted(() => ({
  ordem: [] as string[],
}));

const createOrder = vi.fn();
const clearCart = vi.fn();
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
      renovarCarrinhoPeloCatalogo: vi.fn(),
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

const RECUSA_DE_FRETE_EXPIROU = {
  code: "P0001",
  message:
    "A cotação de frete expirou. Calcule o frete novamente e refaça o pedido.",
};
const RECUSA_DE_ENTREGA_INVALIDA = {
  code: "P0001",
  message: "Escolha uma opção de entrega antes de finalizar o pedido.",
};
const RECUSA_DE_PRECO = {
  code: "P0001",
  message:
    "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
};

const CHAVE_DO_CEP_DA_COMPRA = "ikcous_shipping_cache_v2_01310100";
const CHAVE_DE_OUTRO_CEP = "ikcous_shipping_cache_v2_38500000";
const CHAVE_ANTIGA_V1 = "ikcous_shipping_cache_01310100";
const CHAVE_NAO_RELACIONADA = "ikcous_last_shipping_cep";
const CHAVE_DE_OUTRO_ASSUNTO = "ikcous_alguma_outra_coisa";

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

describe("CheckoutView — a recusa de frete apaga a cotação guardada antes de levar ao carrinho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    sessionStorage.clear();
    createOrder.mockReset();
    clearCart.mockClear();
    onNavigate.mockReset();
    mundo.ordem.length = 0;
    armazem = new Map<string, string>();
    onNavigate.mockImplementation((destino: string) => {
      // Fotografa o armazém no instante da navegação: é o que o carrinho
      // encontra ao montar.
      mundo.ordem.push(
        `ir:${destino}:cotacao-guardada=${armazem.has(CHAVE_DO_CEP_DA_COMPRA)}`,
      );
    });
    pararABuscaDeCep();
    // Armazém completo (com `length` e `key`): o descarte varre por prefixo.
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
      get length() {
        return armazem.size;
      },
      key: (i: number) => [...armazem.keys()].at(i) ?? null,
    });
    // A cópia que mantinha a cliente no laço: válida (gravada agora).
    const envelope = JSON.stringify({
      contexto: "ctx",
      assinatura: "prod-1::1",
      gravadoEm: Date.now(),
      opcoes: [{ id: "pac", name: "PAC", price: 30, deliveryDays: 7 }],
      revisaoConfig: "rev-1",
    });
    armazem.set(CHAVE_DO_CEP_DA_COMPRA, envelope);
    armazem.set(CHAVE_DE_OUTRO_CEP, envelope);
    armazem.set(CHAVE_ANTIGA_V1, "[]");
    armazem.set(CHAVE_NAO_RELACIONADA, "01310-100");
    armazem.set(CHAVE_DE_OUTRO_ASSUNTO, "fica");
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

  it.each([
    ["a cotação expirou", RECUSA_DE_FRETE_EXPIROU, "recotar_frete"],
    ["entrega não escolhida", RECUSA_DE_ENTREGA_INVALIDA, "trocar_entrega"],
  ] as const)(
    "%s (%s): a cópia guardada é apagada ANTES de a cliente chegar ao carrinho",
    async (_nome, recusa, acao) => {
      const botao = await chegarNaRecusa(recusa, acao);
      // Sanidade: a cópia que causava o laço está lá antes do toque.
      expect(armazem.has(CHAVE_DO_CEP_DA_COMPRA)).toBe(true);

      await act(async () => {
        botao.click();
      });

      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("cart");
      // No instante da navegação a cópia já não existia.
      expect(mundo.ordem).toEqual(["ir:cart:cotacao-guardada=false"]);
      // Sem sobra: toda cópia de frete (qualquer CEP, qualquer versão) caiu...
      expect(armazem.has(CHAVE_DE_OUTRO_CEP)).toBe(false);
      expect(armazem.has(CHAVE_ANTIGA_V1)).toBe(false);
      // ...e o que NÃO é cópia de cotação ficou intacto.
      expect(armazem.get(CHAVE_NAO_RELACIONADA)).toBe("01310-100");
      expect(armazem.get(CHAVE_DE_OUTRO_ASSUNTO)).toBe("fica");
    },
  );

  it("controle: outra saída que também vai ao carrinho (preço mudou) NÃO mexe na cotação guardada", async () => {
    const botao = await chegarNaRecusa(RECUSA_DE_PRECO, "reconferir_carrinho");

    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(onNavigate).toHaveBeenCalledWith("cart");
    expect(armazem.has(CHAVE_DO_CEP_DA_COMPRA)).toBe(true);
    expect(armazem.has(CHAVE_DE_OUTRO_CEP)).toBe(true);
  });
});
