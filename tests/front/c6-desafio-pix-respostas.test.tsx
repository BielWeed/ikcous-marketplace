// @vitest-environment jsdom
//
// C6 / P2 (02/10/2026) — o "Pagar com PIX" da verificação em `desafio3ds`
// contra CADA resposta do servidor ao POST de PIX (ramo (f) de
// `criar-pagamento/index.ts`: GET da order → cancela `action_required`/
// `created` → libera a vaga → cria o PIX; ou 409 `cartaoEmAnalise`).
//
// Andaime: CheckoutView, VerificacaoDoPagamento, PagamentoOnline e
// PagamentoComPix DE VERDADE; só `criarPagamento` e o "banco" são dublês. A
// retomada entra com a vaga em SENTINELA, a consulta (`verificar`) adota a
// order em 3DS, e o cliente toca em "Pagar com PIX".
//
// Em TODAS as respostas que não provam o fim do cartão, "Cancelar pedido"
// NUNCA aparece: a marca de cobrança incerta é do PEDIDO e sobrevive à troca
// de `orderId` da retomada ("" → pedido) — no baseline c4d52d29 o efeito de
// reset por `orderId` (CheckoutView.tsx:1163-1165) a apagava.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const updateOrderStatus = vi.fn();
const onNavigate = vi.fn();
const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: undefined,
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
const USUARIO = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO, profile: null, loading: false }),
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
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus, criarPagamento }),
  };
});
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const PEDIDO = "9b1c2d3e-4f50-4a6b-8c7d-0e1f2a3b4c5d";
const SENTINELA = `verificando:${PEDIDO}:c0:pabcdef012345:1790943000000`;
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
const URL_DO_DESAFIO = "https://www.mercadopago.com.br/3ds/desafio?x=1";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                total: 149.9,
                metodo_online: null,
                gateway_payment_id: SENTINELA,
                payment_status: "aguardando",
                status: "pending",
              },
              error: null,
            }),
          single: () =>
            Promise.resolve({
              data: {
                payment_status: "aguardando",
                status: "pending",
                gateway_payment_id: "ORD-3DS-ADOTADA",
                expires_at: PRAZO_FUTURO,
              },
              error: null,
            }),
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
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DESAFIO_ADOTADO = {
  verificacao: "desafio3ds",
  paymentId: "ORD-3DS-ADOTADA",
  desafio3ds: { url: URL_DO_DESAFIO },
  expiraEm: PRAZO_FUTURO,
};

function erroDaEdge(mensagem: string, campos: Record<string, unknown> = {}) {
  return Object.assign(new Error(mensagem), campos);
}

describe("C6/P2 — 'Pagar com PIX' do desafio adotado, contra cada resposta do servidor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    criarPagamento.mockReset();
    onNavigate.mockReset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
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
    vi.restoreAllMocks();
  });

  async function esvaziar(vezes = 10) {
    for (let i = 0; i < vezes; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  /** Retomada → `verificar` adota o 3DS → o desafio com "Pagar com PIX". */
  async function abrirDesafioAdotado() {
    criarPagamento.mockResolvedValueOnce(DESAFIO_ADOTADO);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={() => {}}
          retomarPedidoId={PEDIDO}
        />,
      );
    });
    await esvaziar();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: PEDIDO,
      metodo: "verificar",
    });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(botao("Pagar com PIX")).toBeDefined();
  }

  async function tocarPix() {
    await act(async () => {
      botao("Pagar com PIX")?.click();
    });
    await esvaziar();
  }

  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === rotulo,
    ) as HTMLButtonElement | undefined;
  const temBotaoQueContem = (trecho: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).some((b) =>
      (b.textContent ?? "").includes(trecho),
    );
  const chamadasPix = () =>
    criarPagamento.mock.calls.filter((c) => c[0]?.metodo === "pix");

  function umPostDePixDoPedido() {
    expect(chamadasPix()).toHaveLength(1);
    expect(chamadasPix()[0][0]).toEqual({ orderId: PEDIDO, metodo: "pix" });
  }

  function nuncaCancelarNemOutroPix() {
    expect(temBotaoQueContem("Cancelar pedido")).toBe(false);
    expect(botao("Pagar com PIX")).toBeUndefined();
  }

  it("200 com QR (cartão cancelado no MP, vaga liberada, PIX criado): o QR aparece, UM POST", async () => {
    await abrirDesafioAdotado();
    criarPagamento.mockResolvedValueOnce({
      paymentId: "PIX-1",
      statusPagamento: "aguardando",
      expiraEm: PRAZO_FUTURO,
      qrCode: "00020126-copia-e-cola",
      qrCodeBase64: "iVBORw0KGgo=",
    });
    await tocarPix();
    umPostDePixDoPedido();
    expect(hospedeiro.textContent).toContain("00020126-copia-e-cola");
    expect(hospedeiro.querySelector("iframe")).toBeNull();
  });

  it("200 pago (o 3DS foi aprovado entre a consulta e o PIX — ramo a): confirmação, nenhum QR", async () => {
    await abrirDesafioAdotado();
    criarPagamento.mockResolvedValueOnce({
      paymentId: "ORD-3DS-ADOTADA",
      statusPagamento: "pago",
      expiraEm: PRAZO_FUTURO,
    });
    await tocarPix();
    umPostDePixDoPedido();
    expect(hospedeiro.textContent).toContain(
      "Pagamento confirmado! Finalizando seu pedido…",
    );
    expect(hospedeiro.textContent).not.toContain("Copiar código PIX");
  });

  for (const [rotulo, erro] of [
    [
      "409 cartaoEmAnalise (o MP não cancelou o 3DS)",
      erroDaEdge("Há um pagamento com cartão em análise para este pedido.", {
        terminal: false,
        cartaoEmAnalise: true,
      }),
    ],
    [
      "502 cartaoEmAnalise (o GET da order falhou)",
      erroDaEdge("Não foi possível consultar o pagamento.", {
        terminal: false,
        cartaoEmAnalise: true,
      }),
    ],
  ] as const) {
    it(`${rotulo}: caixa âmbar honesta, 'Tentar de novo' só por toque, nunca cancelar nem PIX`, async () => {
      await abrirDesafioAdotado();
      criarPagamento.mockRejectedValueOnce(erro);
      await tocarPix();
      umPostDePixDoPedido();
      expect(hospedeiro.textContent).toContain(
        "Não conseguimos confirmar se a tentativa de pagamento com cartão deste pedido foi cobrada.",
      );
      expect(hospedeiro.textContent).not.toContain(
        "Pagamento em análise pelo banco",
      );
      nuncaCancelarNemOutroPix();
      expect(botao("Tentar de novo")).toBeDefined();

      // Sem laço: nada repete sozinho; o toque repete o MESMO PIX.
      await esvaziar();
      expect(chamadasPix()).toHaveLength(1);
      criarPagamento.mockRejectedValueOnce(erro);
      await act(async () => {
        botao("Tentar de novo")?.click();
      });
      await esvaziar();
      expect(chamadasPix()).toHaveLength(2);
      expect(chamadasPix()[1][0]).toEqual({ orderId: PEDIDO, metodo: "pix" });
    });
  }

  it("409 terminal (prazo acabou): a frase da edge, sem 'Tentar de novo', sem cancelar — 'Ver meus pedidos'", async () => {
    await abrirDesafioAdotado();
    criarPagamento.mockRejectedValueOnce(
      erroDaEdge("O prazo para pagar este pedido acabou.", {
        terminal: true,
        cartaoEmAnalise: false,
      }),
    );
    await tocarPix();
    umPostDePixDoPedido();
    expect(hospedeiro.textContent).toContain(
      "O prazo para pagar este pedido acabou.",
    );
    expect(botao("Tentar de novo")).toBeUndefined();
    nuncaCancelarNemOutroPix();
    expect(botao("Ver meus pedidos")).toBeDefined();
  });

  for (const [rotulo, erro] of [
    [
      "503 (a liberação da vaga falhou depois do cancelamento)",
      erroDaEdge(
        "Não foi possível liberar a cobrança anterior. Tente de novo em instantes.",
        { terminal: false, cartaoEmAnalise: false },
      ),
    ],
    [
      "rede caiu (erro sem corpo)",
      new Error("Não foi possível gerar a cobrança."),
    ],
  ] as const) {
    it(`${rotulo}: caixa vermelha recuperável, 'Tentar de novo' só por toque, NUNCA 'Cancelar pedido' (marca do pedido)`, async () => {
      await abrirDesafioAdotado();
      criarPagamento.mockRejectedValueOnce(erro);
      await tocarPix();
      umPostDePixDoPedido();
      expect(hospedeiro.textContent).toContain(erro.message);
      expect(botao("Tentar de novo")).toBeDefined();
      nuncaCancelarNemOutroPix();
    });
  }

  it("tempo limite local (resposta que nunca chega): erro recuperável do PIX, NUNCA 'Cancelar pedido'", async () => {
    await abrirDesafioAdotado();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    criarPagamento.mockImplementationOnce(() => new Promise(() => {}));
    await tocarPix();
    umPostDePixDoPedido();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_001);
    });
    vi.useRealTimers();
    await esvaziar();
    expect(hospedeiro.textContent).toContain(
      "O Pix está demorando mais que o normal para ser gerado.",
    );
    expect(botao("Tentar de novo")).toBeDefined();
    nuncaCancelarNemOutroPix();
  });

  it("toque DUPLO em 'Pagar com PIX': UM POST de PIX só", async () => {
    await abrirDesafioAdotado();
    criarPagamento.mockResolvedValueOnce({
      paymentId: "PIX-1",
      statusPagamento: "aguardando",
      expiraEm: PRAZO_FUTURO,
      qrCode: "00020126-copia-e-cola",
      qrCodeBase64: "iVBORw0KGgo=",
    });
    const alvo = botao("Pagar com PIX");
    await act(async () => {
      alvo?.click();
      alvo?.click();
    });
    await esvaziar();
    umPostDePixDoPedido();
    expect(hospedeiro.textContent).toContain("00020126-copia-e-cola");
  });
});
