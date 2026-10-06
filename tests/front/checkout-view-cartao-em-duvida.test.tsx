// @vitest-environment jsdom
//
// C5 (front B2, 02/10/2026) — a caixa âmbar "Seu cartão está em análise pelo
// banco" aparecia para respostas SEM order confirmada (o `sem_registro` e o
// 503 `indisponivel` do C3, o 502 ambíguo da criação, a rede que caiu), e o
// "Tentar de novo" dela pedia o CARTÃO de novo (token novo) sobre uma
// cobrança em dúvida. Agora, em modo cartão, a dúvida abre a verificação do
// C4 (`metodo: "verificar"`, só leitura): texto verdadeiro, nada que cobre,
// cancele ou peça outro cartão; quando a consulta prova a vaga livre, o
// cliente ESCOLHE a forma. Em modo PIX (a saída A2 com o cartão vivo) a caixa
// continua com "Tentar de novo" — é o mesmo pedido de PIX que a edge só
// atende quando consegue cancelar o cartão —, mas sem prometer "em análise".
//
// Andaime: o MESMO de checkout-view-cartao-erro-oferece-pix-e-em-analise.
// test.tsx (PagamentoOnline mocado, expõe `onErro`/`onCobrancaEmDuvida`),
// com `criarPagamento` no dublê do `useOrders` para a verificação de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigDoCartao } from "@/lib/config-do-cartao";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const criarPagamento = vi.fn();
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const pagamentoOnlineProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

// Achado 4, rodada 4: `whatsappNumber` mutável — `undefined` por padrão (a
// maioria dos testes já verifica que a saída de WhatsApp NÃO aparece sem
// configuração), sobrescrito só nos testes que precisam da loja com
// WhatsApp.
let mockWhatsappNumber: string | undefined;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: mockWhatsappNumber,
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

const mockUser: { id: string; email?: string } = {
  id: "user-1",
  email: "cliente@exemplo.com",
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

let mockCart = [
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
let mockCartTotal = 100;
let mockShippingFee = 20;
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = {
  id: "opt-mock",
  name: "Entrega Padrão",
  price: 20,
  deliveryDays: 3,
  provider: "flat_fee",
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
      addToCart: vi.fn(),
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: "38500-000",
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Achado 1, rodada 6: `mensagemAmigavelErroAtualizacaoStatus` fica com a
// implementação REAL (via `importOriginal`) — só `useOrders` é trocado pelo
// dublê. É ela quem `handleCancelarPedidoESairDoPagamento` chama quando a
// guarda P0001 barra a gravação (ver o teste da guarda, abaixo) — sem isto,
// a chamada seria `undefined(...)` e o teste quebraria por TypeError, não
// pela asserção.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus, criarPagamento }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// `null` = cartão não oferecido — sobrescrito por teste que precisa dele.
let mockConfigDoCartao: ConfigDoCartao | null = {
  credito: true,
  debito: true,
  parcelasMax: 6,
};
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(mockConfigDoCartao) };
});

// Achado 1, rodada 6: mutável — nenhum teste existente até aqui CLICA em
// "Cancelar pedido" (só confere presença/ausência do botão), então o padrão
// "cancelled" preserva o comportamento de todos eles; o teste da guarda
// P0001 (abaixo) sobrescreve para "pending".
let mockStatusAposCancelar = "cancelled";
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: { status: mockStatusAposCancelar },
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

// O resto do módulo fica REAL: a verificação de verdade usa o
// `comTempoLimite` dele.
vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/checkout/PagamentoOnline")
  >()),
  PagamentoOnline: (props: Record<string, unknown>) => {
    pagamentoOnlineProps.push(props);
    return null;
  },
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

function botaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
// 15:00 UTC cai no dia 03/10 em qualquer fuso do Brasil e em UTC (CI).
const CANCELAMENTO_AUTOMATICO = "2026-10-03T15:00:00.000Z";

describe("CheckoutView — cartão em dúvida nunca vira 'em análise pelo banco' sem order (C5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    criarPagamento.mockReset();
    createOrder.mockResolvedValue({ id: "ped-999" });
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue(undefined);
    onNavigate.mockClear();
    pagamentoOnlineProps.length = 0;
    mockWhatsappNumber = undefined;
    mockStatusAposCancelar = "cancelled";
    mockCart = [
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
    mockCartTotal = 100;
    mockShippingFee = 20;
    mockSelectedShippingOption = {
      id: "opt-mock",
      name: "Entrega Padrão",
      price: 20,
      deliveryDays: 3,
      provider: "flat_fee",
    };
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

  /** Chega em "Finalize o pagamento" já com o cartão escolhido como método. */
  async function chegarNoPagamentoComCartao(
    CheckoutViewComponente: TelaCheckout,
  ) {
    await act(async () => {
      raiz.render(
        <CheckoutViewComponente
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const cartao = botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!;
    await act(async () => {
      cartao.click();
      await esperarMicrotarefas();
    });

    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      // Compra por transportadora exige CPF do destinatário para a etiqueta
      // — sem ele o Finalizar segue travado (mesmo achado do checkout
      // compacto, 23/09/2026).
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = botaoPorTexto(document.body, "Finalizar Pedido")!;
    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  type OnErro = (
    msg: string,
    categoria: "recuperavel" | "terminal",
    sinal?: "cartaoEmAnalise" | "semCobranca",
  ) => void;

  function props() {
    return pagamentoOnlineProps.at(-1)!;
  }

  async function esvaziar() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
  }

  async function avisarCobrancaEmDuvida(ponto: Record<string, unknown>) {
    const callback = props().onCobrancaEmDuvida;
    expect(typeof callback).toBe("function");
    await act(async () => {
      (callback as (p: Record<string, unknown>) => void)(ponto);
    });
    await esvaziar();
  }

  async function erroDoPagamento(...args: Parameters<OnErro>) {
    await act(async () => {
      (props().onErro as OnErro)(...args);
    });
    await esvaziar();
  }

  /** Nada que cobra, cancela ou promete "em análise" sem order. */
  function semPromessaNemSaidaQueCobra() {
    expect(hospedeiro.textContent).not.toMatch(/em análise/i);
    for (const proibido of [
      "Pagar com PIX",
      "Cancelar pedido e voltar ao carrinho",
      "Tentar outro cartão",
      "Tentar de novo",
    ]) {
      expect(botaoPorTexto(hospedeiro, proibido)).toBeUndefined();
    }
  }

  it("sem_registro do POST de cartão: abre a verificação com a data real, sem consulta sozinha e sem saída que cobra", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);
    expect(props().metodo).toBe("cartao");
    const montagensAntes = pagamentoOnlineProps.length;

    await avisarCobrancaEmDuvida({
      verificacao: "sem_registro",
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
    });

    expect(hospedeiro.textContent).toContain("Situação do pagamento");
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos confirmar com o banco se o pagamento com cartão deste pedido foi feito.",
    );
    expect(hospedeiro.textContent).toContain(
      "Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente até 03/10/2026 às",
    );
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(pagamentoOnlineProps.length).toBe(montagensAntes);
    semPromessaNemSaidaQueCobra();
    expect(botaoPorTexto(hospedeiro, "Ver meus pedidos")).toBeDefined();
  });

  it("indisponivel do POST de cartão: alerta honesto, 'Verificar de novo' (nunca o cartão de novo), nenhuma chamada sozinha", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await avisarCobrancaEmDuvida({ verificacao: "indisponivel" });

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(botaoPorTexto(hospedeiro, "Verificar de novo")).toBeDefined();
    expect(criarPagamento).not.toHaveBeenCalled();
    semPromessaNemSaidaQueCobra();
  });

  for (const [nome, args] of [
    [
      "502 ambíguo na criação (sinal cartaoEmAnalise)",
      ["Não foi possível gerar a cobrança.", "recuperavel", "cartaoEmAnalise"],
    ],
    [
      "erro sem corpo (rede caiu, sem sinal)",
      ["Não foi possível gerar a cobrança.", "recuperavel"],
    ],
    [
      "409 de reserva pela frase exata (edge antiga, sem sinal)",
      [
        "Há um pagamento com cartão em análise para este pedido.",
        "recuperavel",
      ],
    ],
  ] as const) {
    it(`modo cartão, ${nome}: vira a verificação (UMA consulta 'verificar'), nunca a caixa 'em análise' com 'Tentar de novo'`, async () => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await chegarNoPagamentoComCartao(CheckoutView);
      const montagensAntes = pagamentoOnlineProps.length;
      criarPagamento.mockReturnValue(new Promise(() => {}));

      await erroDoPagamento(...(args as unknown as Parameters<OnErro>));

      expect(hospedeiro.textContent).toContain("Situação do pagamento");
      expect(criarPagamento).toHaveBeenCalledTimes(1);
      expect(criarPagamento.mock.calls[0][0]).toEqual({
        orderId: "ped-999",
        metodo: "verificar",
      });
      expect(pagamentoOnlineProps.length).toBe(montagensAntes);
      semPromessaNemSaidaQueCobra();
    });
  }

  it("a verificação que prova a vaga livre leva à ESCOLHA da forma (nada cobra sozinho) e a cobrança continua incerta neste pedido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);
    criarPagamento.mockResolvedValue({
      verificacao: "recusado",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
    });

    await erroDoPagamento(
      "Não foi possível gerar a cobrança.",
      "recuperavel",
      "cartaoEmAnalise",
    );

    expect(hospedeiro.textContent).toContain(
      "Como você quer pagar este pedido?",
    );
    expect(hospedeiro.textContent).toContain(
      "O pagamento com cartão não foi concluído.",
    );
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    const montagensAntes = pagamentoOnlineProps.length;

    // Escolher o cartão remonta o formulário — só com o toque.
    await act(async () => {
      botaoPorTexto(hospedeiro, "Cartão")!.click();
    });
    await esvaziar();
    expect(pagamentoOnlineProps.length).toBeGreaterThan(montagensAntes);
    expect(props().metodo).toBe("cartao");
    expect(props().orderId).toBe("ped-999");

    // A regra por pedido continua: uma falha local depois disso não reabre
    // PIX nem "Cancelar pedido".
    await erroDoPagamento(
      "Não foi possível ler os dados do cartão. Tente de novo.",
      "recuperavel",
      "semCobranca",
    );
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
  });

  it("modo PIX (a saída A2 com o cartão vivo): a caixa âmbar não promete 'em análise', não consulta sozinha e mantém 'Tentar de novo'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);
    await act(async () => {
      (props().onTrocarParaPix as (vivo: boolean) => void)(true);
    });
    expect(props().metodo).toBe("pix");

    await erroDoPagamento(
      "Há um pagamento com cartão em análise para este pedido.",
      "recuperavel",
      "cartaoEmAnalise",
    );

    expect(hospedeiro.textContent).not.toMatch(/em análise/i);
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos confirmar se a tentativa de pagamento com cartão deste pedido foi cobrada.",
    );
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeDefined();
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("CONTROLE: terminal com o sinal (N7 'pode ter sido cobrado') continua na caixa âmbar terminal, sem consulta", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await erroDoPagamento(
      "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
      "terminal",
      "cartaoEmAnalise",
    );

    expect(hospedeiro.textContent).toContain(
      "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
    );
    expect(hospedeiro.textContent).not.toContain("Situação do pagamento");
    expect(criarPagamento).not.toHaveBeenCalled();
    semPromessaNemSaidaQueCobra();
  });

  it("CONTROLE: falha local (semCobranca) na primeira tentativa continua na caixa vermelha com 'Pagar com PIX'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await erroDoPagamento(
      "Não foi possível carregar o pagamento.",
      "recuperavel",
      "semCobranca",
    );

    expect(hospedeiro.textContent).not.toContain("Situação do pagamento");
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeDefined();
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  // Ressalva da revisão do lote B (04/10/2026): o cliente com o PIX VIVO na
  // vaga tenta o cartão numa loja sem a chave de assinatura. A edge responde
  // 409 NÃO terminal ("Seu PIX continua valendo…"); o envio do cartão
  // entrega isso como erro recuperável sem sinal (`enviarPagamentoComCartao`,
  // "sem o campo, recuperável"). Prova de ponta a ponta na tela: o cliente
  // volta ao PIX, e "Cancelar pedido" nunca aparece.
  const MENSAGEM_PIX_CONTINUA_VALENDO =
    "Seu PIX continua valendo. Volte e pague pelo código, ou aguarde ele vencer para escolher outra forma.";

  it("PIX vivo + cartão sem chave (409 NÃO terminal): verificação -> 'pix' -> escolha da forma com 'Pagar com PIX', que remonta no PIX; nunca 'Cancelar pedido'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);
    criarPagamento.mockResolvedValue({
      verificacao: "pix",
      paymentId: "ORDTST01PIXNAVAGA00000000000",
      expiraEm: PRAZO_FUTURO,
    });

    await erroDoPagamento(MENSAGEM_PIX_CONTINUA_VALENDO, "recuperavel");

    // A verificação só CONSULTA (GET no MP) — nada cobra nem cancela.
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: "ped-999",
      metodo: "verificar",
    });
    expect(hospedeiro.textContent).toContain(
      "Como você quer pagar este pedido?",
    );
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(updateOrderStatus).not.toHaveBeenCalled();

    const montagensAntes = pagamentoOnlineProps.length;
    await act(async () => {
      botaoPorTexto(hospedeiro, "Pagar com PIX")!.click();
    });
    await esvaziar();
    expect(pagamentoOnlineProps.length).toBeGreaterThan(montagensAntes);
    expect(props().metodo).toBe("pix");
    expect(props().orderId).toBe("ped-999");
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });

  it("CONTROLE: a MESMA frase como terminal (a resposta antiga da edge) cai na caixa vermelha com 'Cancelar pedido' como ação principal e sem PIX", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await erroDoPagamento(MENSAGEM_PIX_CONTINUA_VALENDO, "terminal");

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain(MENSAGEM_PIX_CONTINUA_VALENDO);
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeDefined();
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeUndefined();
  });

  it("sem_registro com WhatsApp: 'Falar com a loja' abre o wa.me com o pedido", async () => {
    mockWhatsappNumber = "34999990000";
    const abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await avisarCobrancaEmDuvida({ verificacao: "sem_registro" });
    await act(async () => {
      botaoPorTexto(hospedeiro, "Falar com a loja")!.click();
    });

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(String(abrir.mock.calls[0][0])).toContain("https://wa.me/55");
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  // Revisão do C5 (ressalva, mutante k7): a dúvida que vem do POST marca a
  // cobrança como incerta POR PEDIDO — depois que a verificação prova a vaga
  // livre e o cliente escolhe o cartão de novo, uma falha local seguinte
  // (`semCobranca`) NÃO reabre "Pagar com PIX" nem "Cancelar pedido".
  for (const [nome, ponto] of [
    [
      "sem_registro do C3",
      {
        verificacao: "sem_registro",
        canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO,
      },
    ],
    ["'aguardando' sem paymentId", { verificacao: "sem_registro" }],
  ] as const) {
    it(`${nome}: o pedido fica marcado — depois da vaga livre e do cartão escolhido, a caixa vermelha nunca traz PIX nem 'Cancelar pedido'`, async () => {
      vi.useFakeTimers({
        shouldAdvanceTime: true,
        toFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "Date",
        ],
      });
      try {
        const { CheckoutView } = await import("@/views/customer/CheckoutView");
        await chegarNoPagamentoComCartao(CheckoutView);
        criarPagamento.mockResolvedValue({
          verificacao: "livre",
          paymentId: null,
          expiraEm: PRAZO_FUTURO,
        });

        await avisarCobrancaEmDuvida(ponto);
        expect(criarPagamento).not.toHaveBeenCalled();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });
        await act(async () => {
          botaoPorTexto(hospedeiro, "Verificar de novo")!.click();
        });
        await esvaziar();
        expect(criarPagamento).toHaveBeenCalledTimes(1);
        expect(criarPagamento.mock.calls[0][0]).toEqual({
          orderId: "ped-999",
          metodo: "verificar",
        });
        expect(hospedeiro.textContent).toContain(
          "Como você quer pagar este pedido?",
        );

        await act(async () => {
          botaoPorTexto(hospedeiro, "Cartão de crédito ou débito")!.click();
        });
        await esvaziar();
        expect(props().metodo).toBe("cartao");
        expect(props().cobrancaIncerta).toBe(true);

        await erroDoPagamento(
          "Não foi possível carregar o pagamento.",
          "recuperavel",
          "semCobranca",
        );
        expect(hospedeiro.textContent).toContain(
          "Não foi possível carregar o pagamento.",
        );
        expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
        expect(
          botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
        ).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  }
});
