// @vitest-environment jsdom
//
// C6 / P1 — as duas mudanças OBRIGATÓRIAS do revisor financeiro (02/10/2026)
// sobre o sinal "a tentativa de cartão terminou sem pagamento":
//   1. Só ARMA com o `paymentId` NÃO VAZIO da resposta 200 do cartão (o
//      "token de cerca"), nas três etapas (desafio aberto, em análise,
//      confirmando depois do COMPLETE). 200 de desafio sem id: tela de hoje.
//   2. A CHAVE é PEDIDO + identidade da tentativa: uma leitura de OUTRO
//      pedido nunca encerra a tentativa deste.
//   Revisão independente do front (02/10/2026, bloqueio reproduzido): a
//   identidade da tentativa é o PRÓPRIO TOKEN DE CERCA (`paymentId`), não o
//   contador local — ele volta a 0 a cada remontagem da tela do cartão, e a
//   marca de uma tentativa velha derrubava um 3DS vivo novo. Chave final:
//   `{ orderId, paymentId }`.
//
// Duas pontas, cada uma com o seu dublê:
//   - o PAI (CheckoutView real; PagamentoOnline dublê que expõe as props):
//     quem lê a vaga e devolve `cartaoEncerrado`;
//   - o FILHO (PagamentoComCartao real; SDK do MP e `criarPagamento`
//     dublês): quem arma (`onCartaoEmCurso`) e quem obedece ao encerramento.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { carregarSdkMercadoPago } from "@/components/checkout/sdk-mercado-pago";

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

const CREDITO_1X = { credito: true, debito: false, parcelasMax: 1 };
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(CREDITO_1X) };
});

let linha: Record<string, unknown> = {};
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { ...linha }, error: null }),
          single: () => Promise.resolve({ data: { ...linha }, error: null }),
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

// O PAI enxerga só o dublê; o FILHO é importado de verdade, direto.
let propsDoPagamento: Record<string, unknown> | null = null;
vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/checkout/PagamentoOnline")
    >();
  return {
    ...real,
    PagamentoOnline: (props: Record<string, unknown>) => {
      propsDoPagamento = props;
      return null;
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "ped-c6-chave";
const URL_DO_DESAFIO =
  "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
  criarPagamento.mockReset();
  propsDoPagamento = null;
  linha = {
    id: PEDIDO,
    total: 120,
    status: "pending",
    payment_status: "aguardando",
    // Lacuna L2 (02/10/2026): vaga VAZIA — com o id real da order na vaga a
    // retomada passa pela consulta `verificar` (nunca o formulário do cartão
    // sobre uma cobrança possivelmente viva). Este andaime só precisa do
    // formulário montado; a vaga não muda o que ele prova.
    gateway_payment_id: null,
    metodo_online: "credito",
    tentativas_de_pagamento: 0,
    expires_at: PRAZO_FUTURO,
  };
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
  // @ts-expect-error limpando o global entre testes
  globalThis.MercadoPago = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function esvaziar(vezes = 6) {
  for (let i = 0; i < vezes; i++) {
    await act(async () => {
      await esperarMicrotarefas();
    });
  }
}

describe("C6/P1 — o PAI: a leitura da vaga encerra só a tentativa do MESMO pedido", () => {
  async function retomar() {
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
    expect(propsDoPagamento?.metodo).toBe("cartao");
    expect(propsDoPagamento?.orderId).toBe(PEDIDO);
  }

  async function armar(cartao: { orderId: string; paymentId: string }) {
    const onCartaoEmCurso = propsDoPagamento?.onCartaoEmCurso as
      | ((c: { orderId: string; paymentId: string } | null) => void)
      | undefined;
    expect(
      onCartaoEmCurso,
      "o CheckoutView deveria passar onCartaoEmCurso ao pagamento",
    ).toBeTypeOf("function");
    await act(async () => {
      onCartaoEmCurso?.(cartao);
    });
  }

  async function lerAVagaVazia() {
    linha = { ...linha, gateway_payment_id: null, metodo_online: null };
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esvaziar();
  }

  it("VERMELHO: tentativa armada deste pedido + leitura posterior com a vaga vazia → `cartaoEncerrado` com pedido E token", async () => {
    await retomar();
    await armar({ orderId: PEDIDO, paymentId: "ORD-TOKEN-1" });
    await lerAVagaVazia();
    expect(propsDoPagamento?.cartaoEncerrado).toEqual({
      orderId: PEDIDO,
      paymentId: "ORD-TOKEN-1",
    });
  });

  it("higiene: armar uma tentativa NOVA (outro token) tira a marca velha de cena", async () => {
    await retomar();
    await armar({ orderId: PEDIDO, paymentId: "ORD-TOKEN-1" });
    await lerAVagaVazia();
    expect(propsDoPagamento?.cartaoEncerrado).toEqual({
      orderId: PEDIDO,
      paymentId: "ORD-TOKEN-1",
    });
    await armar({ orderId: PEDIDO, paymentId: "ORD-TOKEN-2" });
    expect(propsDoPagamento?.cartaoEncerrado ?? null).toBeNull();
  });

  it("CONTROLE (chave com o pedido): tentativa armada de OUTRO pedido nunca é encerrada pela leitura deste", async () => {
    await retomar();
    await armar({ orderId: "outro-pedido", paymentId: "ORD-TOKEN-1" });
    await lerAVagaVazia();
    expect(propsDoPagamento?.cartaoEncerrado ?? null).toBeNull();
  });

  it("CONTROLE: nada armado (null) → a vaga vazia não encerra nada", async () => {
    await retomar();
    await armar({ orderId: PEDIDO, paymentId: "ORD-TOKEN-1" });
    const onCartaoEmCurso = propsDoPagamento?.onCartaoEmCurso as (
      c: null,
    ) => void;
    await act(async () => {
      onCartaoEmCurso(null);
    });
    await lerAVagaVazia();
    expect(propsDoPagamento?.cartaoEncerrado ?? null).toBeNull();
  });
});

describe("C6/P1 — o FILHO: arma só com o token de cerca e obedece só à chave pedido + token", () => {
  function instalarSdkFalso() {
    const create = vi.fn(
      async (_brick: string, _container: string, _config: any) => ({
        unmount: vi.fn(),
      }),
    );
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = vi.fn(function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    });
    return create;
  }

  const onCartaoEmCurso = vi.fn();
  type Encerrado = { orderId: string; paymentId: string } | null;

  async function renderCartao(cartaoEncerrado: Encerrado = null) {
    const { PagamentoComCartao } = await import(
      "@/components/checkout/PagamentoComCartao"
    );
    await act(async () => {
      raiz.render(
        <PagamentoComCartao
          orderId={PEDIDO}
          valor={120}
          config={CREDITO_1X}
          emailDoPagador="cliente@exemplo.com"
          onErro={vi.fn()}
          onPagarComPix={vi.fn()}
          onCartaoEmCurso={onCartaoEmCurso}
          cartaoEncerrado={cartaoEncerrado}
        />,
      );
    });
    await esvaziar();
  }

  async function enviar(
    create: ReturnType<typeof instalarSdkFalso>,
    resposta: Record<string, unknown>,
  ) {
    criarPagamento.mockResolvedValueOnce(resposta);
    const { callbacks } = create.mock.calls.at(-1)![2];
    await act(async () => {
      callbacks.onReady();
    });
    await act(async () => {
      try {
        await callbacks.onSubmit(
          {
            token: "tok-teste",
            payment_method_id: "master",
            installments: 1,
            payer: {
              email: "cliente@exemplo.com",
              identification: { type: "CPF", number: "11144477735" },
            },
          },
          { paymentTypeId: "credit_card" },
        );
      } catch {
        // relançado para o Brick
      }
    });
    await esvaziar();
  }

  const ultimoArmado = () =>
    onCartaoEmCurso.mock.calls.length === 0
      ? undefined
      : onCartaoEmCurso.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    onCartaoEmCurso.mockReset();
  });

  for (const [rotulo, resposta] of [
    [
      "desafio",
      {
        paymentId: "ORD01JC6CHAVE",
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
        desafio3ds: { url: URL_DO_DESAFIO },
      },
    ],
    [
      "em análise",
      {
        paymentId: "ORD01JC6CHAVE",
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
      },
    ],
  ] as const) {
    it(`VERMELHO: 200 de ${rotulo} COM paymentId arma { orderId, paymentId }`, async () => {
      const create = instalarSdkFalso();
      await renderCartao();
      await enviar(create, resposta);
      expect(ultimoArmado()).toEqual({
        orderId: PEDIDO,
        paymentId: "ORD01JC6CHAVE",
      });
    });
  }

  it("VERMELHO: depois do COMPLETE (confirmando com o banco) continua armado", async () => {
    const create = instalarSdkFalso();
    await renderCartao();
    await enviar(create, {
      paymentId: "ORD01JC6CHAVE",
      statusPagamento: "aguardando",
      expiraEm: PRAZO_FUTURO,
      desafio3ds: { url: URL_DO_DESAFIO },
    });
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    await esvaziar();
    expect(hospedeiro.textContent).toContain("Confirmando com o banco…");
    expect(ultimoArmado()).toEqual({
      orderId: PEDIDO,
      paymentId: "ORD01JC6CHAVE",
    });
  });

  for (const paymentId of [null, "", "   ", undefined]) {
    it(`CONTROLE (token de cerca): 200 de desafio com paymentId ${JSON.stringify(paymentId)} NUNCA arma — e o encerramento não derruba a tela`, async () => {
      const create = instalarSdkFalso();
      await renderCartao();
      await enviar(create, {
        paymentId,
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
        desafio3ds: { url: URL_DO_DESAFIO },
      });
      expect(hospedeiro.querySelector("iframe")).not.toBeNull();
      for (const chamada of onCartaoEmCurso.mock.calls) {
        expect(chamada[0]).toBeNull();
      }
      await renderCartao({ orderId: PEDIDO, paymentId: "sem-token" });
      expect(hospedeiro.querySelector("iframe")).not.toBeNull();
      expect(hospedeiro.textContent).not.toContain("não foi concluído");
    });
  }

  it("encerramento da MESMA chave (pedido + token) vira recusa 'não foi concluído'; de OUTRO pedido ou de um token ANTIGO, não", async () => {
    const create = instalarSdkFalso();
    await renderCartao();
    await enviar(create, {
      paymentId: "ORD01JC6CHAVE",
      statusPagamento: "aguardando",
      expiraEm: PRAZO_FUTURO,
      desafio3ds: { url: URL_DO_DESAFIO },
    });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();

    await renderCartao({ orderId: "outro-pedido", paymentId: "ORD01JC6CHAVE" });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    // A marca de uma tentativa ANTERIOR (outro token) — o caso da
    // remontagem, em que o contador local volta a 0.
    await renderCartao({ orderId: PEDIDO, paymentId: "ORD-ANTIGA" });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain("não foi concluído");

    await renderCartao({ orderId: PEDIDO, paymentId: "ORD01JC6CHAVE" });
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(hospedeiro.textContent).toContain(
      "O pagamento com cartão não foi concluído.",
    );
    expect(hospedeiro.textContent).not.toContain("não foi aprovado");
  });
});
