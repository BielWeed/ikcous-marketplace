// @vitest-environment jsdom
//
// P1 DO PR #711 (parte da tela de pagamento de um pedido que JÁ NASCEU) —
//
// 1. RETOMADA / PIX que escapou da sonda: o pedido pendente retomado (ou o PIX
//    escolhido antes de a sonda responder) bate no 409 `pixSemChaveDeAssinatura`
//    ao gerar o QR. O 409 é TERMINAL e vem ANTES de a edge ler pedido/vaga, então
//    o MESMO pedido pode ir para o cartão. A tela mostra uma frase de cliente
//    (não o texto de operador da edge) e "Pagar com cartão" — só se o cartão
//    existe e NENHUM cartão pode estar vivo nesse pedido. Sem cartão: a frase e a
//    saída de sempre (cancelar e voltar ao carrinho).
// 2. Com `pix === false` a tela de pagamento diz à `PagamentoOnline` que não há
//    PIX (`podePagarComPix={false}`) e a caixa de erro do cartão não oferece
//    "Pagar com PIX" (beco: 409 terminal, e com cartão vivo ligaria a cobrança
//    incerta).
//
// Montagem copiada de checkout-retomada-pagamento.test.tsx; a `PagamentoOnline`
// é dublê que captura as props (a tela do cartão tem suíte própria).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigDoCartao } from "@/lib/config-do-cartao";
import { esquecerPixDisponivel } from "@/lib/pix-disponivel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: "",
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

// Objeto ESTÁVEL: um `user` novo a cada render entra nas deps de vários efeitos
// do checkout e vira laço de renderização.
const USUARIA = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIA, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: () => {},
      addToCart: () => {},
      selectedShippingOption: null,
      shippingCep: null,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

let metodoOnlineDoPedido: "pix" | "credito" = "pix";
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: (_tabela: string) => ({
      select: (_colunas: string) => ({
        eq: (_coluna: string, _valor: string) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                total: 149.9,
                metodo_online: metodoOnlineDoPedido,
                gateway_payment_id: null,
              },
            }),
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

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

let mockConfigDoCartao: ConfigDoCartao | null = null;
vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => mockConfigDoCartao,
}));

let propsDoPagamento: Record<string, any> | null = null;
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    propsDoPagamento = props;
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CARTAO_LIGADO: ConfigDoCartao = {
  credito: true,
  debito: true,
  parcelasMax: 6,
};
const TEXTO_DA_EDGE =
  "Para pagar com Pix, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.";

describe("CheckoutView — pedido já criado, PIX sem chave de assinatura", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    invoke.mockReset();
    // Sonda sem resposta útil (edge antiga / 5xx): DESCONHECIDO -> fail-open.
    invoke.mockResolvedValue({ data: null, error: { message: "sem sonda" } });
    esquecerPixDisponivel();
    propsDoPagamento = null;
    metodoOnlineDoPedido = "pix";
    mockConfigDoCartao = CARTAO_LIGADO;
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
  });

  async function retomar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={() => {}}
          onSetBackOverride={() => {}}
          retomarPedidoId="ped-999"
        />,
      );
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );

  async function dispararErro(
    msg: string,
    categoria: "recuperavel" | "terminal",
    sinal?: string,
  ) {
    await act(async () => {
      if (sinal === undefined) propsDoPagamento!.onErro(msg, categoria);
      else propsDoPagamento!.onErro(msg, categoria, sinal);
    });
  }

  it("retomada de pedido PIX + 409 sem chave: frase de cliente e 'Pagar com cartão'; tocar remonta o MESMO pedido no cartão", async () => {
    await retomar();
    expect(propsDoPagamento?.metodo).toBe("pix");
    expect(propsDoPagamento?.orderId).toBe("ped-999");

    await dispararErro(TEXTO_DA_EDGE, "terminal", "pixSemChave");

    // Frase de comprador, não o texto de operador da edge.
    expect(hospedeiro.textContent).not.toContain("chave de assinatura");
    expect(hospedeiro.textContent).toContain(
      "Pix não está disponível nesta loja",
    );
    // Terminal: não há "Tentar de novo" (bateria no mesmo 409) e a saída de
    // sempre (cancelar e voltar ao carrinho) segue lá.
    expect(botao("Tentar de novo")).toBeUndefined();
    expect(botao("Cancelar pedido e voltar ao carrinho")).toBeDefined();

    const cartao = botao("Pagar com cartão");
    expect(cartao).toBeDefined();
    await act(async () => {
      cartao!.click();
    });

    expect(botao("Pagar com cartão")).toBeUndefined();
    expect(propsDoPagamento?.orderId).toBe("ped-999");
    expect(propsDoPagamento?.metodo).toBe("cartao");
    expect(propsDoPagamento?.configDoCartao).toEqual(CARTAO_LIGADO);
    // A edge JÁ recusou o PIX deste pedido: a tela do cartão não oferece a
    // volta ao PIX (só levaria ao mesmo 409), mesmo com a sonda desconhecida.
    expect(propsDoPagamento?.podePagarComPix).toBe(false);
  });

  it("sem cartão na loja: a frase e a saída de sempre, SEM 'Pagar com cartão'", async () => {
    mockConfigDoCartao = null;
    await retomar();
    await dispararErro(TEXTO_DA_EDGE, "terminal", "pixSemChave");

    expect(hospedeiro.textContent).toContain(
      "Pix não está disponível nesta loja",
    );
    expect(botao("Pagar com cartão")).toBeUndefined();
    expect(botao("Cancelar pedido e voltar ao carrinho")).toBeDefined();
  });

  it("cartão que pode estar VIVO no pedido (troca cartão->PIX com o desafio aberto): NUNCA oferece 'Pagar com cartão'", async () => {
    metodoOnlineDoPedido = "credito";
    await retomar();
    expect(propsDoPagamento?.metodo).toBe("cartao");

    // O cliente tocou "Pagar com PIX" com o 3DS aberto: cartão vivo.
    await act(async () => {
      propsDoPagamento!.onTrocarParaPix(true);
    });
    await dispararErro(TEXTO_DA_EDGE, "terminal", "pixSemChave");

    expect(botao("Pagar com cartão")).toBeUndefined();
    // Mesma saída de todo terminal com cobrança incerta: nunca "Cancelar".
    expect(botao("Cancelar pedido e voltar ao carrinho")).toBeUndefined();
    expect(
      botao("Ver meus pedidos") ?? botao("Falar com a loja"),
    ).toBeDefined();
  });

  it("o MESMO texto da edge SEM o sinal não ganha 'Pagar com cartão' (contrato é o campo, não o texto)", async () => {
    await retomar();
    await dispararErro(TEXTO_DA_EDGE, "terminal");
    expect(botao("Pagar com cartão")).toBeUndefined();
  });

  describe("quando a sonda diz que o PIX não está pronto", () => {
    beforeEach(() => {
      invoke.mockResolvedValue({ data: { pix: false }, error: null });
    });

    it("a tela de pagamento recebe podePagarComPix=false; com sonda desconhecida ou true, true", async () => {
      await retomar();
      expect(propsDoPagamento?.podePagarComPix).toBe(false);

      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      invoke.mockResolvedValue({ data: { pix: true }, error: null });
      await retomar();
      expect(propsDoPagamento?.podePagarComPix).toBe(true);

      act(() => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      invoke.mockResolvedValue({ data: null, error: { message: "5xx" } });
      await retomar();
      expect(propsDoPagamento?.podePagarComPix).toBe(true);
    });

    it("erro do cartão sem cobrança (Brick não montou): SEM 'Pagar com PIX' na caixa de erro; 'Tentar de novo' fica", async () => {
      metodoOnlineDoPedido = "credito";
      await retomar();
      await dispararErro(
        "Não foi possível carregar o pagamento.",
        "recuperavel",
        "semCobranca",
      );

      expect(hospedeiro.textContent).toContain(
        "Não foi possível carregar o pagamento.",
      );
      expect(botao("Pagar com PIX")).toBeUndefined();
      expect(botao("Tentar de novo")).toBeDefined();
    });
  });

  it("CONTROLE: o mesmo erro do cartão com a sonda desconhecida oferece 'Pagar com PIX', como sempre foi", async () => {
    metodoOnlineDoPedido = "credito";
    await retomar();
    await dispararErro(
      "Não foi possível carregar o pagamento.",
      "recuperavel",
      "semCobranca",
    );
    expect(botao("Pagar com PIX")).toBeDefined();
  });
});
