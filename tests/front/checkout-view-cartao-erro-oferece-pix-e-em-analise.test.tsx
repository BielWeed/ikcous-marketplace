// @vitest-environment jsdom
//
// B1 e B3 da revisão de risco pré-publicação (26/09/2026, PR #666) —
// RODADA 2 (achado money: a rodada 1 piorou o B1).
//
// B1, rodada 1: em modo cartão, a caixa de erro não oferecia PIX nenhum
// jeito de sair de um Brick bloqueado pelo COEP. Correção da rodada 1: um
// botão "Pagar com PIX" sempre que `metodoDoPedido === "cartao"`.
//
// B1, rodada 2 (achado BLOQUEANTE — dinheiro): a correção da rodada 1
// oferecia "Pagar com PIX" para QUALQUER erro em modo cartão — inclusive a
// resposta terminal "Seu cartão pode ter sido cobrado…" (achado N7) e um 502
// ambíguo do POST de cartão que pode ter chegado aprovado no Mercado Pago
// (reproduzido: duas cobranças vivas). Correção: só oferece PIX quando o
// erro carrega o sinal `semCobranca` — Brick que não montou, validação
// local, ou a URL de desafio fora do Mercado Pago (a edge cancela essa vaga
// sozinha ao pedir PIX). Nunca em erro terminal, nunca com `cartaoEmAnalise`.
//
// B3 — cancelar um pedido com o cartão ainda em análise é DINHEIRO: o 409
// "Há um pagamento com cartão em análise para este pedido." (ou o terminal
// N7, "Seu cartão pode ter sido cobrado…") aparecia como erro comum, com
// "Cancelar pedido" logo abaixo. Correção: detectar pelo sinal
// `cartaoEmAnalise` (contrato do lado da edge) OU pelo texto exato como
// reserva (funciona antes e depois da edge mandar o sinal) — NUNCA
// "Cancelar pedido". Reforço da rodada 2: quando recuperável, a caixa ganha
// "Tentar de novo" (re-pede a MESMA cobrança — a edge responde o mesmo 409
// enquanto o cartão vive, 'pago' se aprovou, ou cria o PIX quando o cartão
// finalmente morreu); quando TERMINAL (N7), nenhum botão — só a mensagem,
// porque tentar de novo bateria na mesma resposta e a loja já vai conferir
// na mão. A verificação periódica que o CheckoutView já roda continua de pé
// (não é tocada por este teste) e leva à confirmação sozinha se o banco
// aprovar.
//
// RODADA 3 (achado 1, BLOQUEANTE — a rodada 2 julgava `cartaoEmAnalise` por
// ERRO, não por PEDIDO): a sequência que quebrava isso — (1) 502 ambíguo do
// POST de cartão; (2) "Tentar de novo"; (3) a segunda tentativa falha numa
// validação LOCAL, marcada `semCobranca` corretamente PARA ESTE erro; (4)
// "Pagar com PIX" reaparecia, e a edge antiga criava o PIX na vaga vazia:
// duas cobranças vivas. Correção: `pedidoTemCobrancaIncerta`, um marcador
// POR PEDIDO (não por erro) que, uma vez `true`, nunca mais permite "Pagar
// com PIX" nem "Cancelar pedido" neste pedido — só reseta com um `orderId`
// novo. Achado 2 (should-fix, mesma rodada): um erro do POST de cartão SEM
// corpo nenhum (rede caiu antes da resposta chegar) é tão incerto quanto
// `cartaoEmAnalise` explícito — vai para a caixa âmbar, só com "Tentar de
// novo" e o aviso "Se nada mudar em alguns minutos, toque em Tentar de
// novo.".
//
// Andaime: MESMO modelo de checkout-view-cancelar-pagamento-falho.test.tsx
// (PagamentoOnline mocado, expõe `onErro`) somado ao mock de
// useConfigDoCartao de checkout-view-cartao-online.test.tsx (para chegar em
// `metodoDoPedido === "cartao"` pela UI de verdade).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigDoCartao } from "@/lib/config-do-cartao";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const pagamentoOnlineProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
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

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// `null` = cartão não oferecido — sobrescrito por teste que precisa dele.
let mockConfigDoCartao: ConfigDoCartao | null = {
  credito: true,
  debito: true,
  parcelasMax: 6,
};
vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => mockConfigDoCartao,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({ data: { status: "cancelled" }, error: null }),
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

describe("CheckoutView — cartão: a caixa de erro oferece PIX (B1) e não deixa cancelar com o cartão em análise (B3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    createOrder.mockResolvedValue({ id: "ped-999" });
    updateOrderStatus.mockReset();
    updateOrderStatus.mockResolvedValue(undefined);
    onNavigate.mockClear();
    pagamentoOnlineProps.length = 0;
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

  // Teste (c) da rodada 3: falha de montagem NA PRIMEIRA tentativa — nada
  // foi postado ainda, o marcador `pedidoTemCobrancaIncerta` está no
  // padrão (`false`) e "Pagar com PIX" continua oferecido normalmente.
  it("B1/(c): mount failure na PRIMEIRA tentativa (sinal 'semCobranca') tem 'Pagar com PIX'; clicar troca o método e limpa o erro", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    expect(pagamentoOnlineProps.at(-1)!.metodo).toBe("cartao");

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
          sinal?: "cartaoEmAnalise" | "semCobranca",
        ) => void
      )("Não foi possível carregar o pagamento.", "recuperavel", "semCobranca");
    });

    const pix = botaoPorTexto(hospedeiro, "Pagar com PIX");
    expect(pix).toBeDefined();

    await act(async () => {
      pix!.click();
    });

    // O erro sumiu (a caixa vermelha dá lugar ao <PagamentoOnline> de novo)
    // e a próxima montagem já é em PIX.
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(pagamentoOnlineProps.at(-1)!.metodo).toBe("pix");
  });

  // Teste (a) da rodada 3 — achado 1 (BLOQUEANTE): a sequência exata do
  // relato. Um 502 ambíguo marca o pedido como incerto; "Tentar de novo"
  // limpa SÓ `erroPagamento`, nunca o marcador; a SEGUNDA tentativa falha
  // numa validação local (`semCobranca` correto PARA ESTE erro) — mas
  // "Pagar com PIX" não pode reaparecer, porque a vaga da PRIMEIRA cobrança
  // ambígua ainda pode virar aprovada.
  it("(a) 502 ambíguo, depois 'Tentar de novo', depois falha semCobranca: 'Pagar com PIX' NUNCA reaparece neste pedido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    // 1. 502 ambíguo do POST de cartão (sem sinal) — marca o pedido.
    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )("Erro de infraestrutura (502).", "recuperavel");
    });
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();

    // 2. "Tentar de novo" — limpa a caixa de erro, remonta <PagamentoOnline>
    // (mocado: só mais uma entrada em pagamentoOnlineProps).
    const tentar = botaoPorTexto(hospedeiro, "Tentar de novo")!;
    await act(async () => {
      tentar.click();
    });
    expect(hospedeiro.textContent).not.toContain(
      "Se nada mudar em alguns minutos",
    );

    // 3. A segunda tentativa falha numa validação LOCAL — sinal
    // 'semCobranca' correto PARA ESTE erro específico.
    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
          sinal?: "cartaoEmAnalise" | "semCobranca",
        ) => void
      )(
        "Confira o CPF ou CNPJ do titular do cartão e tente de novo.",
        "recuperavel",
        "semCobranca",
      );
    });

    // 4. O marcador do pedido continua de pé: nem PIX nem Cancelar, mesmo
    // este erro sendo, isoladamente, `semCobranca`.
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeDefined();
  });

  // B1, rodada 2 (achado BLOQUEANTE, dinheiro) — Caso A da revisão: a
  // resposta TERMINAL "Seu cartão pode ter sido cobrado…" (achado N7) não
  // pode ganhar "Pagar com PIX" — o cartão pode já estar cobrado, e um PIX
  // por cima duplicaria a cobrança se o banco confirmar depois.
  it("B1/B3, Caso A: terminal N7 ('Seu cartão pode ter sido cobrado…') não mostra NENHUM botão — nem PIX, nem Cancelar, nem Tentar de novo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )(
        "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
        "terminal",
      );
    });

    expect(hospedeiro.textContent).toContain(
      "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
    );
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeUndefined();
  });

  // Mesmo Caso A, mas já com o sinal explícito que a edge vai mandar
  // (rodada futura dela) — prova que a detecção funciona pelos dois canais.
  it("B1/B3, Caso A com o sinal explícito 'cartaoEmAnalise' + terminal: mesma tela sem botões", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
          sinal?: "cartaoEmAnalise" | "semCobranca",
        ) => void
      )(
        "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
        "terminal",
        "cartaoEmAnalise",
      );
    });

    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeUndefined();
  });

  // Caso B da revisão (rodada 2): um 502 do POST de cartão (sem sinal
  // nenhum) já saiu para o Mercado Pago — não é seguro assumir "sem
  // cobrança". Rodada 3 (achado 2, revisão de risco pré-publicação): esse
  // erro vai para a caixa ÂMBAR (mesmo tratamento do "cartão em análise") —
  // só "Tentar de novo", nunca PIX nem Cancelar. A rodada 2 deixava esse
  // caso na caixa vermelha com "Cancelar pedido" disponível — reproduzido:
  // cancelar aí e o Mercado Pago aprovar depois vira `pago_apos_expirar`.
  it("B1, Caso B: 502 ambíguo do POST de cartão (sem sinal) cai na caixa âmbar — só 'Tentar de novo', nunca PIX nem Cancelar", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )("Erro de infraestrutura (502).", "recuperavel");
    });

    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeDefined();
    expect(hospedeiro.textContent).toContain(
      "Se nada mudar em alguns minutos, toque em Tentar de novo.",
    );
  });

  it("B1: em modo PIX, a caixa de erro NÃO ganha o botão 'Pagar com PIX' (já está em PIX)", async () => {
    mockConfigDoCartao = null;
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
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
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
    expect(pagamentoOnlineProps.at(-1)!.metodo).toBe("pix");

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )("Não foi possível gerar a cobrança.", "recuperavel");
    });

    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeDefined();
  });

  it("B3: 409 com sinal 'cartaoEmAnalise' esconde 'Cancelar pedido' e 'Pagar com PIX', mas oferece 'Tentar de novo'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
          sinal?: "cartaoEmAnalise" | "semCobranca",
        ) => void
      )(
        "Há um pagamento com cartão em análise para este pedido.",
        "recuperavel",
        "cartaoEmAnalise",
      );
    });

    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Seu cartão está em análise pelo banco. Aguarde a resposta; você será avisado aqui.",
    );
    // Reforço da rodada 2: "Tentar de novo" re-pede a MESMA cobrança — a
    // edge responde o mesmo 409 enquanto o cartão vive, ou libera o caminho
    // (pago/PIX) quando ele já não vive mais (achado B2, "webhook soltou a
    // vaga mas a tela nunca reconsulta").
    const tentar = botaoPorTexto(hospedeiro, "Tentar de novo");
    expect(tentar).toBeDefined();

    await act(async () => {
      tentar!.click();
    });
    // Erro limpo — a tela volta a montar <PagamentoOnline> (mocado, mais uma
    // entrada em pagamentoOnlineProps) em vez da caixa âmbar.
    expect(hospedeiro.textContent).not.toContain(
      "Seu cartão está em análise pelo banco",
    );
  });

  it("B3: MESMO sem o sinal (edge antiga), a mensagem exata já basta como reserva — e 'Tentar de novo' aparece", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )(
        "Há um pagamento com cartão em análise para este pedido.",
        "recuperavel",
      );
    });

    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Seu cartão está em análise pelo banco. Aguarde a resposta; você será avisado aqui.",
    );
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeDefined();
  });

  // Rodada 3 (achado 2): a rodada 2 tinha um "controle" aqui com um erro
  // recuperável sem sinal — mas esse é EXATAMENTE o Caso B (502 ambíguo)
  // acima de propósito, não um controle. O controle de verdade agora é um
  // terminal DEFINITIVO do cartão (recusado sem nova tentativa, expirado,
  // estornado — vem de `classificarRespostaCartao`, uma resposta que a edge
  // realmente enviou): sem ambiguidade nenhuma, "Cancelar pedido" continua
  // certo, porque o pedido está mesmo morto.
  it("controle: um terminal DEFINITIVO do cartão (sem sinal, mas categoria terminal) continua oferecendo 'Cancelar pedido' — não é ambíguo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNoPagamentoComCartao(CheckoutView);

    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )(
        "O pagamento foi recusado e este pedido não aceita nova tentativa. Faça um pedido novo ou fale com a loja.",
        "terminal",
      );
    });

    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeDefined();
    expect(hospedeiro.textContent).not.toContain(
      "Seu cartão está em análise pelo banco",
    );
    expect(botaoPorTexto(hospedeiro, "Tentar de novo")).toBeUndefined();
    expect(botaoPorTexto(hospedeiro, "Pagar com PIX")).toBeUndefined();
  });

  // Teste (d) da rodada 3: o marcador é POR PEDIDO — reseta com um
  // `orderId` novo. Em produção `orderId` só nasce uma vez por pedido
  // (`grep setOrderId` em CheckoutView.tsx: uma chamada só) — o cliente não
  // reabre o MESMO checkout depois de marcado, porque cancelar já fica
  // bloqueado de propósito. A prova mais direta é duas sessões de checkout
  // SEPARADAS (dois `createOrder`, dois ids): o pedido B nasce limpo, ainda
  // que o pedido A tenha ficado com a cobrança incerta.
  it("(d) o marcador não vaza entre pedidos: um pedido novo nasce sem a cobrança incerta do pedido anterior", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    // Pedido A: fica com a cobrança incerta (502 ambíguo).
    await chegarNoPagamentoComCartao(CheckoutView);
    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )("Erro de infraestrutura (502).", "recuperavel");
    });
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeUndefined();

    // Fecha a sessão do pedido A antes de abrir a do B — dois <CheckoutView>
    // vivos ao mesmo tempo duplicariam ids no DOM (checkout-name etc.), e
    // `digitar` acertaria o campo errado.
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();

    // Pedido B: sessão de checkout NOVA, outro orderId. `onClearCart()` do
    // pedido A já esvaziou o carrinho e a opção de frete do dublê de
    // useCart (módulo compartilhado no arquivo inteiro) — sem repor aqui, o
    // pedido B nasceria com carrinho vazio e sem transportadora, e o campo
    // de CPF (exigido só "para entrega por transportadora") nunca apareceria.
    createOrder.mockResolvedValueOnce({ id: "ped-outro-pedido" });
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
      id: "opt-mock-b",
      name: "Entrega Padrão",
      price: 20,
      deliveryDays: 3,
      provider: "flat_fee",
    };
    pagamentoOnlineProps.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    await chegarNoPagamentoComCartao(CheckoutView);

    // Erro terminal comum (sem ambiguidade nenhuma) no pedido NOVO:
    // "Cancelar pedido" tem que estar disponível — se o marcador tivesse
    // vazado do pedido A, este teste falharia aqui.
    await act(async () => {
      (
        pagamentoOnlineProps.at(-1)!.onErro as (
          msg: string,
          categoria: "recuperavel" | "terminal",
        ) => void
      )(
        "O pagamento foi recusado e este pedido não aceita nova tentativa. Faça um pedido novo ou fale com a loja.",
        "terminal",
      );
    });
    expect(
      botaoPorTexto(hospedeiro, "Cancelar pedido e voltar ao carrinho"),
    ).toBeDefined();
  });
});
