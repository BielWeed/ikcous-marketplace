// @vitest-environment jsdom
//
// F5 DEPOIS DO PEDIDO (12/11/2026). A cliente fazia o pedido (Pix confirmado ou
// pago na entrega), apertava F5 e lia "Seu carrinho está vazio" — o pedido já
// existia e ela podia comprar de novo. Agora a tela diz "Seu pedido já foi
// feito" com o número do pedido, e o texto é "recebido", NUNCA "pago".
//
// O que cada teste prova:
//  - gravação: as telas "Pedido recebido!" e "Pagamento Confirmado!" deixam o
//    recibo na aba; a tela de pagamento FORA DO PRAZO não (o pedido pode ser
//    cancelado);
//  - leitura: com o carrinho vazio e recibo válido DO USUÁRIO, a tela nova;
//    recibo de outro, vencido, storage com erro ou sem recibo = a tela de hoje;
//  - o registro do pagamento pendente continua sendo apagado depois de pago
//    (o recibo vive numa chave à parte e não o ressuscita).
//
// "F5" aqui = desmontar a árvore e montar uma nova com o carrinho já vazio, no
// MESMO sessionStorage (é o que a recarga preserva).
//
// Andaime: o de checkout-view-pix-confirmacao.test.tsx e de
// checkout-convidado-sai-do-beco-na-tela-de-sucesso.test.tsx (mesmos dublês).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

import { chaveDoPedidoPendenteDoCheckout } from "@/lib/pedido-pendente-do-checkout";
import {
  VALIDADE_DO_RECIBO_MS,
  guardarReciboDoCheckout,
  lerReciboDoCheckout,
} from "@/lib/recibo-do-checkout";

// uuid de verdade: o recibo só aceita o formato do id de `marketplace_orders`.
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const NUMERO = "4F5A6B"; // os 6 últimos, em maiúsculas
const OUTRO_PEDIDO = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const CHAVE_DO_RECIBO = "ikcous:checkout-recibo";
const FRASE_DO_CARRINHO_VAZIO = "Seu carrinho está vazio";
const TITULO_NOVO = "Seu pedido já foi feito";
const FRASE_NOVA = `Pedido #${NUMERO} recebido. Você não precisa comprar de novo.`;

const createOrder = vi.fn();
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type EventoRealtime = (payload: {
  eventType: string;
  new?: Record<string, unknown>;
}) => void;
let onRealtimeEventCapturado: EventoRealtime | null = null;

let mockUser: { id: string } | null = { id: "user-1" };
let mockAuthLoading = false;
let mockWhatsappNumber: string | undefined = "34999998888";

const produtoCarrinho = {
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
let mockCart: { product: typeof produtoCarrinho; quantity: number }[] = [];
let mockCartTotal = 0;
const carrinhoCheio = () => [{ product: produtoCarrinho, quantity: 1 }];

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
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: mockWhatsappNumber,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: mockUser
      ? [
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
        ]
      : [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    profile: null,
    loading: mockAuthLoading,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: 0,
      // O pedido esvazia o carrinho de verdade: é o que o F5 encontra.
      clearCart: () => {
        mockCart = [];
        mockCartTotal = 0;
      },
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: mockUser ? "38500-000" : "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: (
    _enabled?: boolean,
    _isAdmin?: boolean,
    options?: { onRealtimeEvent?: EventoRealtime },
  ) => {
    onRealtimeEventCapturado = options?.onRealtimeEvent ?? null;
    return { createOrder, updateOrderStatus };
  },
}));

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
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          in: () => Promise.resolve({ data: [], error: null }),
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

vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/checkout/PagamentoOnline")
    >();
  return { ...real, PagamentoOnline: () => null };
});

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

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

function botaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — F5 depois do pedido diz 'Seu pedido já foi feito'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: PEDIDO, totalAmount: 100 });
    onNavigate.mockClear();
    onRealtimeEventCapturado = null;
    mockUser = { id: "user-1" };
    mockAuthLoading = false;
    mockWhatsappNumber = "34999998888";
    mockCart = carrinhoCheio();
    mockCartTotal = 100;
    sessionStorage.clear();
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
    pararABuscaDeCep();
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
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
  }

  // O F5: a árvore some, o sessionStorage fica, e o app abre de novo.
  async function apertarF5() {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await montar();
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  }

  async function esperarOFinalizar() {
    // useDeferredRender(380): o "Finalizar Pedido" só nasce depois disso.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  }

  async function finalizar() {
    const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
    await act(async () => {
      botao.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function pagarNaEntregaComConta() {
    await montar();
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await Promise.resolve();
      await Promise.resolve();
    });
    await esperarOFinalizar();
    await finalizar();
    expect(hospedeiro.textContent).toContain("Pedido recebido!");
  }

  async function pagarNaEntregaComoVisitante() {
    mockUser = null;
    await montar();
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-street", "Rua Teste");
      digitar("guest-number", "100");
      digitar("guest-neighborhood", "Centro");
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-city", "Cidade Teste");
      await Promise.resolve();
    });
    await act(async () => {
      digitar("guest-state", "SP");
      await Promise.resolve();
    });
    await esperarOFinalizar();
    await finalizar();
    expect(hospedeiro.textContent).toContain("Pedido recebido!");
  }

  async function chegarNoPixAguardando() {
    await montar();
    const botaoPix = botaoPorTexto(hospedeiro, "Pagar agora com PIX")!;
    await act(async () => {
      botaoPix.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await Promise.resolve();
      await Promise.resolve();
    });
    await esperarOFinalizar();
    await finalizar();
    expect(hospedeiro.textContent).toContain("Finalize o pagamento");
  }

  async function pixMuda(paymentStatus: string) {
    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: PEDIDO, payment_status: paymentStatus },
      });
    });
  }

  function textoDaTela() {
    return hospedeiro.textContent ?? "";
  }

  function esperaATelaDoRecibo() {
    expect(textoDaTela()).toContain(TITULO_NOVO);
    expect(textoDaTela()).toContain(FRASE_NOVA);
    expect(textoDaTela()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
    // "recebido", NUNCA "pago": o recibo não sabe se o dinheiro entrou.
    expect(textoDaTela()).not.toMatch(/pago|paga|pagamento/i);
  }

  describe("o que grava o recibo", () => {
    it("Pix confirmado: o recibo fica na aba, com o dono e o pedido", async () => {
      await chegarNoPixAguardando();
      await pixMuda("pago");
      expect(textoDaTela()).toContain("Pagamento Confirmado");

      expect(lerReciboDoCheckout("user-1")).toBe(PEDIDO);
      // SÓ o id, o dono e a hora: nada de valor nem forma de pagamento.
      const bruto = JSON.parse(sessionStorage.getItem(CHAVE_DO_RECIBO)!);
      expect(Object.keys(bruto).sort()).toEqual([
        "gravadoEm",
        "pedidoId",
        "userId",
      ]);
    });

    it("pago na entrega, com conta: o recibo fica na aba", async () => {
      await pagarNaEntregaComConta();
      expect(lerReciboDoCheckout("user-1")).toBe(PEDIDO);
    });

    it("pago na entrega, visitante: o recibo fica na aba sem dono", async () => {
      await pagarNaEntregaComoVisitante();
      expect(lerReciboDoCheckout(null)).toBe(PEDIDO);
      expect(JSON.parse(sessionStorage.getItem(CHAVE_DO_RECIBO)!).userId).toBe(
        null,
      );
    });

    it("pagamento FORA DO PRAZO não grava recibo (o pedido pode ser cancelado)", async () => {
      await chegarNoPixAguardando();
      await pixMuda("pago_apos_expirar");

      expect(textoDaTela()).toContain("prazo de reserva venceu");
      expect(sessionStorage.getItem(CHAVE_DO_RECIBO)).toBeNull();
      expect(lerReciboDoCheckout("user-1")).toBeNull();
    });

    it("a aba sem confirmação (Pix ainda aguardando) não tem recibo", async () => {
      await chegarNoPixAguardando();
      expect(sessionStorage.getItem(CHAVE_DO_RECIBO)).toBeNull();
    });
  });

  describe("F5 depois do pedido", () => {
    it("Pix confirmado: o F5 mostra 'já foi feito' com o número certo, sem 'carrinho vazio'", async () => {
      await chegarNoPixAguardando();
      await pixMuda("pago");
      expect(textoDaTela()).toContain("Pagamento Confirmado");

      await apertarF5();

      esperaATelaDoRecibo();
    });

    it("pago na entrega, com conta: 'Ver meus pedidos' é o botão principal e leva a 'orders'; 'Voltar à vitrine' leva a 'home'", async () => {
      await pagarNaEntregaComConta();

      await apertarF5();

      esperaATelaDoRecibo();
      const botoes = [...hospedeiro.querySelectorAll("button")];
      expect(botoes.map((b) => b.textContent?.trim())).toEqual([
        "Ver meus pedidos",
        "Voltar à vitrine",
      ]);
      await act(async () => {
        botoes[0].click();
      });
      expect(onNavigate).toHaveBeenLastCalledWith("orders");
      await act(async () => {
        botoes[1].click();
      });
      expect(onNavigate).toHaveBeenLastCalledWith("home");
    });

    it("pago na entrega, visitante com WhatsApp da loja: o botão abre o wa.me com o número do pedido; não há 'Ver meus pedidos'", async () => {
      await pagarNaEntregaComoVisitante();

      await apertarF5();

      esperaATelaDoRecibo();
      expect(botaoPorTexto(hospedeiro, "Ver meus pedidos")).toBeUndefined();
      expect(botaoPorTexto(hospedeiro, "Voltar à vitrine")).toBeDefined();

      const abrir = vi.fn();
      vi.stubGlobal("open", abrir);
      const whatsapp = botaoPorTexto(hospedeiro, "WhatsApp")!;
      expect(whatsapp).toBeDefined();
      await act(async () => {
        whatsapp.click();
      });
      expect(abrir).toHaveBeenCalledTimes(1);
      const url = abrir.mock.calls[0][0] as string;
      expect(url).toContain("https://wa.me/5534999998888");
      expect(decodeURIComponent(url)).toContain(NUMERO);
      expect(abrir.mock.calls[0][2]).toBe("noopener,noreferrer");
    });

    it("pago na entrega, visitante SEM WhatsApp da loja: 'Guarde o número do pedido', nunca um botão morto", async () => {
      mockWhatsappNumber = undefined;
      await pagarNaEntregaComoVisitante();

      await apertarF5();

      esperaATelaDoRecibo();
      expect(botaoPorTexto(hospedeiro, "WhatsApp")).toBeUndefined();
      expect(textoDaTela()).toContain("Guarde o número do pedido");
    });

    it("o registro do pagamento pendente continua sendo apagado depois de pago — o recibo não o ressuscita", async () => {
      await chegarNoPixAguardando();
      // Com o Pix na tela, o pagamento está EM ANDAMENTO.
      expect(
        sessionStorage.getItem(chaveDoPedidoPendenteDoCheckout("user-1")),
      ).toBe(PEDIDO);

      await pixMuda("pago");
      expect(
        sessionStorage.getItem(chaveDoPedidoPendenteDoCheckout("user-1")),
      ).toBeNull();

      await apertarF5();
      esperaATelaDoRecibo();
      // O F5 também não recria o "pagamento em andamento".
      expect(
        sessionStorage.getItem(chaveDoPedidoPendenteDoCheckout("user-1")),
      ).toBeNull();
    });
  });

  describe("quando a tela nova NÃO aparece: a tela de hoje continua igual", () => {
    it("sem recibo: 'Seu carrinho está vazio' e 'Voltar ao carrinho'", async () => {
      mockCart = [];
      mockCartTotal = 0;
      await montar();

      expect(textoDaTela()).toContain(FRASE_DO_CARRINHO_VAZIO);
      expect(textoDaTela()).not.toContain(TITULO_NOVO);
      await act(async () => {
        botaoPorTexto(hospedeiro, "Voltar ao carrinho")!.click();
      });
      expect(onNavigate).toHaveBeenCalledWith("cart");
    });

    it("recibo de OUTRO usuário não aparece", async () => {
      guardarReciboDoCheckout("user-2", PEDIDO);
      mockCart = [];
      await montar();

      expect(textoDaTela()).toContain(FRASE_DO_CARRINHO_VAZIO);
      expect(textoDaTela()).not.toContain(TITULO_NOVO);
      expect(textoDaTela()).not.toContain(NUMERO);
    });

    it("recibo de VISITANTE não aparece para quem entrou com conta", async () => {
      guardarReciboDoCheckout(null, PEDIDO);
      mockCart = [];
      await montar();

      expect(textoDaTela()).toContain(FRASE_DO_CARRINHO_VAZIO);
      expect(textoDaTela()).not.toContain(TITULO_NOVO);
    });

    it("recibo VENCIDO (mais de 2 horas) não aparece", async () => {
      guardarReciboDoCheckout(
        "user-1",
        PEDIDO,
        Date.now() - VALIDADE_DO_RECIBO_MS - 1000,
      );
      mockCart = [];
      await montar();

      expect(textoDaTela()).toContain(FRASE_DO_CARRINHO_VAZIO);
      expect(textoDaTela()).not.toContain(TITULO_NOVO);
    });

    it("storage com erro cai na tela de hoje, sem quebrar", async () => {
      vi.stubGlobal("sessionStorage", {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
        key: () => null,
        length: 0,
      });
      mockCart = [];
      await montar();

      expect(textoDaTela()).toContain(FRASE_DO_CARRINHO_VAZIO);
      expect(textoDaTela()).not.toContain(TITULO_NOVO);
    });

    it("com itens no carrinho a tela de recibo nunca cobre o checkout (comprar de novo é livre)", async () => {
      guardarReciboDoCheckout("user-1", PEDIDO);
      await montar();

      expect(textoDaTela()).not.toContain(TITULO_NOVO);
      expect(textoDaTela()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
      expect(document.getElementById("checkout-name")).not.toBeNull();
    });

    it("sessão ainda a caminho (auth carregando) com recibo na aba: a tela espera (nunca diz 'carrinho vazio'); chegando a sessão do dono, mostra o recibo", async () => {
      guardarReciboDoCheckout("user-1", PEDIDO);
      mockCart = [];
      mockUser = null;
      mockAuthLoading = true;
      await montar();

      expect(textoDaTela()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
      expect(textoDaTela()).not.toContain(TITULO_NOVO);

      mockUser = { id: "user-1" };
      mockAuthLoading = false;
      await montar();
      esperaATelaDoRecibo();
    });

    it("sessão chegou e é de OUTRA conta: o recibo do primeiro dono não aparece", async () => {
      guardarReciboDoCheckout("user-1", PEDIDO);
      mockCart = [];
      mockUser = { id: "user-2" };
      await montar();

      expect(textoDaTela()).toContain(FRASE_DO_CARRINHO_VAZIO);
      // E o recibo continua guardado para o dono dele.
      expect(lerReciboDoCheckout("user-1")).toBe(PEDIDO);
    });

    it("recibo mais novo substitui o antigo: o número na tela é o do último pedido", async () => {
      guardarReciboDoCheckout("user-1", OUTRO_PEDIDO);
      guardarReciboDoCheckout("user-1", PEDIDO);
      mockCart = [];
      await montar();

      esperaATelaDoRecibo();
    });
  });
});
