// @vitest-environment jsdom
//
// "Retomar pagamento" com a leitura do pedido ainda EM VOO (16/10/2026).
//
// O defeito: a cliente toca "Retomar pagamento" num pedido que já existe. A
// leitura do pedido pode levar até 15 s (TEMPO_LIMITE_DA_LEITURA_DA_RETOMADA_MS)
// e, enquanto a PRIMEIRA leitura não volta, nenhum estado de retomada está
// ligado — a tela mostrava o formulário de pedido NOVO, com o carrinho cheio.
// Um toque em "Finalizar" nessa janela criava um SEGUNDO pedido (estoque
// reservado de novo, cobrança duplicável).
//
// O que se prova aqui:
//   1. Leitura em voo: tela "Abrindo o pedido…", formulário ausente e NENHUM
//      pedido novo criado — nem tentando preencher e finalizar.
//   2. A janela fecha em TODOS os desfechos (nada fica preso na tela de
//      carregamento): pedido pagável (monta o pagamento), pago, não aguarda
//      mais, forma a escolher, cartão em dúvida, falha de leitura, estouro dos
//      15 s e — na recarga — pedido inexistente (o checkout NORMAL volta, com o
//      Finalizar funcionando).
//   3. Trocar o pedido retomado reabre a janela só para o pedido novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const createOrder = vi.fn();
const onNavigate = vi.fn();

// A leitura do pedido é controlada pelo teste.
const { lerPedido, conta } = vi.hoisted(() => ({
  lerPedido: vi.fn(),
  // Referência ESTÁVEL entre renders (um objeto novo por render reativaria,
  // em laço, os efeitos que dependem de `user`).
  conta: { user: null as { id: string } | null },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => lerPedido(),
          single: () =>
            Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            }),
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

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
      whatsappNumber: "34999998888",
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
  useAuth: () => ({ user: conta.user, profile: null, loading: false }),
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
      clearCart: vi.fn(),
      addToCart: vi.fn(),
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

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

let propsCapturadasDoPagamento: Record<string, unknown> | null = null;
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    propsCapturadasDoPagamento = props;
    return null;
  },
}));

vi.mock("@/components/checkout/VerificacaoDoPagamento", () => ({
  VerificacaoDoPagamento: () => <p>Verificando o pagamento do pedido</p>,
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "ped-777";
const PEDIDO_LIDO = {
  data: { total: 149.9, metodo_online: "pix", status: "pending" },
  error: null,
};
const CARREGANDO = "Abrindo o pedido…";

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

function botaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement | undefined;
}

const formularioDePedidoNovoNaTela = () =>
  document.getElementById("checkout-name") !== null;

/** Preenche o formulário de convidado — só se ele estiver na tela. */
async function preencherFormulario() {
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
}

describe("CheckoutView — retomada com a leitura do pedido em voo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    sessionStorage.clear();
    lerPedido.mockReset();
    createOrder.mockReset();
    // Se um pedido novo fosse tentado, que ao menos não derrube o teste por
    // outro motivo: a chamada é o que se conta.
    createOrder.mockRejectedValue({
      code: "",
      message: "TypeError: Failed to fetch",
    });
    onNavigate.mockReset();
    conta.user = null;
    propsCapturadasDoPagamento = null;
    // Desde o #761 o CEP de 8 dígitos dispara a busca em toda loja: sem dublê,
    // o teste iria à rede de verdade (ver duble-busca-de-cep.ts).
    pararABuscaDeCep();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function esvaziar() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function renderizar(
    pedido: string = PEDIDO,
    retomadaDaRecarga = false,
  ) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={() => {}}
          retomarPedidoId={pedido}
          retomadaDaRecarga={retomadaDaRecarga}
        />,
      );
    });
    await esvaziar();
  }

  const texto = () => hospedeiro.textContent ?? "";
  const rotulosDosBotoes = () =>
    [...hospedeiro.querySelectorAll("button")].map((b) =>
      (b.textContent ?? "").trim(),
    );

  /** Nada preso: a tela de carregamento e o formulário novo, os dois fora. */
  function carregamentoEncerrado() {
    expect(texto()).not.toContain(CARREGANDO);
  }

  it("leitura em voo: tentar finalizar NÃO cria pedido novo, e a tela é a de carregamento — não o formulário de pedido novo", async () => {
    lerPedido.mockReturnValue(new Promise(() => {})); // nunca responde
    await renderizar();

    // O que a cliente faria na janela: preencher e tocar em Finalizar, se o
    // formulário estiver à mão. Com a correção ele nem está.
    if (formularioDePedidoNovoNaTela()) {
      await preencherFormulario();
      const botao = botaoFinalizar();
      await act(async () => {
        botao?.click();
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
    }

    expect(createOrder).not.toHaveBeenCalled();
    expect(formularioDePedidoNovoNaTela()).toBe(false);
    expect(botaoFinalizar()).toBeUndefined();
    expect(hospedeiro.querySelector('[role="status"]')?.textContent).toContain(
      CARREGANDO,
    );
    expect(propsCapturadasDoPagamento).toBeNull();
    // A saída existe enquanto espera: ninguém fica preso até os 15 s.
    expect(rotulosDosBotoes()).toEqual(["Ver meus pedidos"]);
  });

  it("estouro dos 15 s: a tela de carregamento dá lugar à mensagem de falha, e nenhum pedido novo foi criado", async () => {
    vi.useFakeTimers();
    lerPedido.mockReturnValue(new Promise(() => {}));
    await renderizar();
    expect(texto()).toContain(CARREGANDO);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    carregamentoEncerrado();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível abrir o pagamento deste pedido agora.",
    );
    expect(rotulosDosBotoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    expect(formularioDePedidoNovoNaTela()).toBe(false);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("a resposta chega: o carregamento sai e o pagamento do PEDIDO retomado monta", async () => {
    let responder: (v: unknown) => void = () => {};
    lerPedido.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await renderizar();
    expect(texto()).toContain(CARREGANDO);

    await act(async () => {
      responder(PEDIDO_LIDO);
    });
    await esvaziar();

    carregamentoEncerrado();
    expect(texto()).toContain("Finalize o pagamento");
    expect(propsCapturadasDoPagamento?.orderId).toBe(PEDIDO);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("erro na leitura: carregamento sai, entra a mensagem de falha existente", async () => {
    lerPedido.mockResolvedValue({
      data: null,
      error: { message: "FetchError: Failed to fetch" },
    });
    await renderizar();

    carregamentoEncerrado();
    expect(rotulosDosBotoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
    expect(formularioDePedidoNovoNaTela()).toBe(false);
  });

  it("'Tentar de novo' mostra o carregamento enquanto relê, e sai quando a leitura volta", async () => {
    lerPedido
      .mockResolvedValueOnce({ data: null, error: { message: "falhou" } })
      .mockReturnValueOnce(new Promise(() => {}));
    await renderizar();
    const tentar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Tentar de novo",
    );
    await act(async () => {
      tentar?.click();
    });
    await esvaziar();

    expect(texto()).toContain(CARREGANDO);
    expect(rotulosDosBotoes()).toEqual(["Ver meus pedidos"]);
    expect(formularioDePedidoNovoNaTela()).toBe(false);
  });

  it("pedido que já não espera pagamento: o carregamento sai e a tela dele aparece", async () => {
    lerPedido.mockResolvedValue({
      data: {
        total: 80,
        metodo_online: "pix",
        status: "cancelled",
        payment_status: "aguardando",
      },
      error: null,
    });
    await renderizar();

    carregamentoEncerrado();
    expect(texto()).toContain("Este pedido não está aguardando pagamento");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("forma de pagamento desconhecida: o carregamento sai e a cliente escolhe a forma", async () => {
    lerPedido.mockResolvedValue({
      data: {
        total: 80,
        metodo_online: null,
        status: "pending",
        payment_status: "aguardando",
      },
      error: null,
    });
    await renderizar();

    carregamentoEncerrado();
    expect(texto()).toContain("Como você quer pagar este pedido?");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("cartão em dúvida (vaga com sentinela): o carregamento sai e a verificação do pagamento aparece", async () => {
    lerPedido.mockResolvedValue({
      data: {
        total: 80,
        metodo_online: null,
        gateway_payment_id: `verificando:${PEDIDO}:c0:pabcdef012345:1790943000000`,
        status: "pending",
        payment_status: "aguardando",
      },
      error: null,
    });
    await renderizar();

    carregamentoEncerrado();
    expect(texto()).toContain("Verificando o pagamento do pedido");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("recarga, pedido já PAGO: o carregamento sai e aparece o pagamento confirmado", async () => {
    conta.user = { id: "user-1" };
    lerPedido.mockResolvedValue({
      data: {
        total: 80,
        metodo_online: "pix",
        status: "processing",
        payment_status: "pago",
        user_id: "user-1",
      },
      error: null,
    });
    await renderizar(PEDIDO, true);

    carregamentoEncerrado();
    expect(texto()).toContain("Pagamento Confirmado!");
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("recarga, pedido que NÃO existe: descartado calado — o checkout NORMAL volta e o Finalizar funciona (nada fica preso)", async () => {
    let responder: (v: unknown) => void = () => {};
    lerPedido.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await renderizar(PEDIDO, true);
    expect(texto()).toContain(CARREGANDO);
    expect(formularioDePedidoNovoNaTela()).toBe(false);

    await act(async () => {
      responder({ data: null, error: null });
    });
    await esvaziar();

    carregamentoEncerrado();
    expect(formularioDePedidoNovoNaTela()).toBe(true);
    await preencherFormulario();
    const botao = botaoFinalizar();
    expect(botao?.disabled).toBe(false);
    await act(async () => {
      botao?.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    // Sem pedido retomado, o checkout é o de sempre: o pedido sai UMA vez.
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("trocar o pedido retomado reabre a janela só para o pedido novo (o B lê, o A já tinha lido)", async () => {
    lerPedido
      .mockResolvedValueOnce(PEDIDO_LIDO)
      .mockReturnValueOnce(new Promise(() => {}));
    await renderizar("ped-A");
    expect(texto()).toContain("Finalize o pagamento");

    await renderizar("ped-B");

    expect(texto()).toContain(CARREGANDO);
    expect(formularioDePedidoNovoNaTela()).toBe(false);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("CONTROLE: sem retomada nenhuma, o checkout de sempre aparece direto, sem carregamento", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={onNavigate} onSetBackOverride={() => {}} />,
      );
    });
    await esvaziar();

    expect(texto()).not.toContain(CARREGANDO);
    expect(formularioDePedidoNovoNaTela()).toBe(true);
    expect(lerPedido).not.toHaveBeenCalled();
  });
});
