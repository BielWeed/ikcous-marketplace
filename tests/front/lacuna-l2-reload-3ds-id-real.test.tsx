// @vitest-environment jsdom
//
// LACUNA L2 (02/10/2026) — reload no meio do 3DS com o id REAL da order na
// vaga (`metodo_online` crédito/débito, `aguardando`/`pending`).
//
// Antes, a retomada abria o FORMULÁRIO do cartão (decisão do C4): para ver o
// desafio o cliente digitava o cartão de novo (token novo; o servidor, ramo
// d, devolvia o MESMO desafio), o formulário não tinha saída para o PIX, e
// depois do prazo o POST batia no 409 terminal de `podeCobrar` com o 3DS
// ainda aprovável. Prova: scratchpad recuperacao/LACUNAS/red-front.txt e
// red-l2.txt (HEAD 421f6ba5). Agora a retomada vai para a MESMA verificação
// do sentinela (`verificar`, só GET no MP; cadência do C4).
//
// Grupos:
// - INVERTIDOS: os três retratos de "HOJE", cada um com a decisão do desenho
//   que o tornou errado;
// - DESEJADO: eram vermelhos; o comportamento da correção;
// - TERMINAL NA TELA VENCE (revisão financeira) e CUSTO SEM O C2;
// - interação com a L1, e CONTROLES (vaga vazia, `recusado`, `status`
//   ilegível, sentinela).
//
// PORTÃO DE PUBLICAÇÃO: só em loja cujo `criar-pagamento` já aceita
// `verificar` (C2 no ar, medido loja a loja) — sem ele vale o "CUSTO SEM O
// C2", abaixo.
//
// Andaime: o MESMO do c6-recusa-pos-3ds.test.tsx (CheckoutView,
// PagamentoOnline, PagamentoComCartao e VerificacaoDoPagamento DE VERDADE;
// só o SDK do MP, `criarPagamento` e o "banco" são dublês).
import { StrictMode, act } from "react";
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
const onSetBackOverride = vi.fn();
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
const mockUser = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
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

// A VerificacaoDoPagamento e o CheckoutView recebem o MESMO `criarPagamento`.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus, criarPagamento }),
  };
});
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const CREDITO_1X = { credito: true, debito: false, parcelasMax: 1 };
let configDoCartao: typeof CREDITO_1X = CREDITO_1X;
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(configDoCartao) };
});

// O "banco": UMA linha. `maybeSingle` (retomada) e `single` (verificação
// periódica) tiram uma FOTO da linha no instante da CHAMADA — como uma
// leitura real.
let linha: Record<string, unknown> = {};
// Respostas da edge que ficam EM VOO no teste. O PIX guarda a promessa em
// voo num cache POR PEDIDO (`dispararPagamentoPix`, PagamentoOnline): sem
// soltá-la no fim, o teste seguinte reaproveitaria o PIX do anterior.
let emVoo: Array<() => void> = [];
function respostaEmVoo(): Promise<never> {
  return new Promise((_resolver, rejeitar) => {
    emVoo.push(() => rejeitar(new Error("fim do teste")));
  });
}
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "ped-lacuna-l2";
const ORDER = "ORD01JC6P1VIVA";
const URL_DO_DESAFIO =
  "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoExato(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

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

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

describe("Lacuna L2 — reload no meio do 3DS com o id real da order na vaga", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    criarPagamento.mockReset();
    onNavigate.mockClear();
    configDoCartao = CREDITO_1X;
    // Retomada de cartão conhecido, vaga vazia: abre o formulário direto.
    linha = {
      id: PEDIDO,
      total: 120,
      status: "pending",
      payment_status: "aguardando",
      gateway_payment_id: null,
      metodo_online: "credito",
      tentativas_de_pagamento: 0,
      expires_at: PRAZO_FUTURO,
    };
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
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
    create = instalarSdkFalso();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    const soltar = emVoo;
    emVoo = [];
    await act(async () => {
      for (const f of soltar) f();
      await esperarMicrotarefas();
    });
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function esvaziar(vezes = 4) {
    for (let i = 0; i < vezes; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
  }

  async function retomar(estrito = false) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const tela = (
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
        retomarPedidoId={PEDIDO}
      />
    );
    await act(async () => {
      raiz.render(estrito ? <StrictMode>{tela}</StrictMode> : tela);
    });
    await esvaziar();
  }

  /**
   * O cliente envia o cartão; a edge grava `naVaga` (a order) ANTES de
   * responder `resposta`.
   */
  async function enviarCartao(
    resposta: Record<string, unknown>,
    naVaga: string,
    tipo: "credit_card" | "debit_card" = "credit_card",
  ) {
    criarPagamento.mockImplementationOnce(async () => {
      linha = { ...linha, gateway_payment_id: naVaga };
      return resposta;
    });
    await submeterNoBrick({ token: "tok-teste" }, tipo);
  }

  /** O cliente toca "Pagar" no formulário montado por último. */
  async function submeterNoBrick(
    sobrepor: Record<string, unknown>,
    tipo: "credit_card" | "debit_card" = "credit_card",
  ) {
    const chamada = create.mock.calls.at(-1);
    if (!chamada) throw new Error("O formulário do cartão não foi criado.");
    const { callbacks } = chamada[2];
    await act(async () => {
      callbacks.onReady();
    });
    await act(async () => {
      try {
        await callbacks.onSubmit(
          {
            token: "tok-teste",
            issuer_id: "25",
            payment_method_id: "master",
            transaction_amount: 120,
            installments: 1,
            payer: {
              email: "cliente@exemplo.com",
              identification: { type: "CPF", number: "11144477735" },
            },
            ...sobrepor,
          },
          { paymentTypeId: tipo },
        );
      } catch {
        // O Brick recebe o relançamento; o que importa é a tela.
      }
    });
    await esvaziar();
  }

  // ── Lacuna L2 ────────────────────────────────────────────────────────────
  // Reload no meio do 3DS: a vaga guarda o id REAL da order (cartão), o
  // pedido continua `aguardando`/`pending`, `metodo_online` é crédito/débito.

  const PRAZO_VENCIDO = "2020-01-01T00:00:00.000Z";
  const SITUACAO = "Situação do pagamento";

  /** A linha do pedido no reload: a order do 3DS ainda está na vaga. */
  function pedidoComOrderNaVaga(campos: Record<string, unknown> = {}) {
    linha = {
      ...linha,
      gateway_payment_id: ORDER,
      metodo_online: "credito",
      ...campos,
    };
  }

  const chamadasPorMetodo = () =>
    criarPagamento.mock.calls.map((c) => (c[0] as { metodo?: string }).metodo);

  async function verificacaoPeriodica() {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esvaziar();
  }

  // ── Os três retratos de "HOJE", INVERTIDOS pela correção ─────────────────
  // Antes da L2 eles prendiam o comportamento antigo (saída do RED em
  // scratchpad recuperacao/LACUNAS/red-front.txt e red-l2.txt). Cada um foi
  // invertido por uma decisão do desenho L2 (DESENHO-FRONT.md, seção L2):

  // Era "HOJE: nenhuma chamada à edge, o formulário do cartão abre". Errado
  // agora porque o desenho decide: com o id real na vaga, NENHUM formulário de
  // cartão sobre uma cobrança talvez viva — a retomada consulta primeiro (uma
  // vez), e enquanto a consulta não volta a tela só diz que está consultando.
  for (const metodo_online of ["credito", "debito"]) {
    it(`INVERTIDO (${metodo_online}): reload com o id real na vaga — UMA consulta 'verificar' em voo, 'consultando', NENHUM formulário de cartão`, async () => {
      criarPagamento.mockImplementationOnce(respostaEmVoo);
      pedidoComOrderNaVaga({ metodo_online });
      await retomar();

      expect(criarPagamento.mock.calls.map((c) => c[0])).toEqual([
        { orderId: PEDIDO, metodo: "verificar" },
      ]);
      expect(create).not.toHaveBeenCalled();
      expect(hospedeiro.textContent).toContain(
        "Consultando o pagamento com o banco",
      );
      expect(hospedeiro.textContent).not.toContain("Finalize o pagamento");
    });
  }

  // Era "HOJE: o desafio só volta se o cliente DIGITAR o cartão de novo".
  // Errado agora porque o desenho decide: o desafio vem da consulta
  // (GET-only), sem token novo — nem ao abrir, nem depois que o banco avisa
  // que o desafio terminou.
  it("INVERTIDO: o desafio volta SEM o cliente digitar o cartão — zero POST de cartão, nem depois do aviso de desafio concluído", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "desafio3ds",
      paymentId: ORDER,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    pedidoComOrderNaVaga();
    await retomar();
    expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
      URL_DO_DESAFIO,
    );

    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    await esvaziar();

    expect(hospedeiro.textContent).toContain("Confirmação enviada ao banco");
    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(create).not.toHaveBeenCalled();
  });

  // Era "HOJE (depois do prazo): digitar o cartão bate no 409 terminal de
  // `podeCobrar`". Errado agora porque o desenho decide: a consulta vale até
  // 24 h depois do prazo (a 20261186 segura o cartão vivo) — o desafio que o
  // banco ainda pode aprovar aparece, e quem diz o desfecho é a consulta.
  it("INVERTIDO (depois do prazo, cartão vivo): o desafio aparece sem formulário, e a consulta seguinte pode dizer 'pago' — o 409 de `podeCobrar` não é mais o fim", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "desafio3ds",
      paymentId: ORDER,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_VENCIDO,
    });
    pedidoComOrderNaVaga({ expires_at: PRAZO_VENCIDO });
    await retomar();

    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(
      "O prazo para pagar este pedido acabou.",
    );
    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(create).not.toHaveBeenCalled();
  });

  // ── DESEJADO (eram vermelhos no HEAD 421f6ba5; red-l2.txt) ──────────────

  for (const metodo_online of ["credito", "debito"]) {
    it(`DESEJADO VERMELHO (${metodo_online}): reload com o 3DS vivo — UMA consulta \`verificar\`, nenhum formulário, o desafio na tela com 'Pagar com PIX' antes do prazo`, async () => {
      criarPagamento.mockResolvedValueOnce({
        verificacao: "desafio3ds",
        paymentId: ORDER,
        desafio3ds: { url: URL_DO_DESAFIO },
        expiraEm: PRAZO_FUTURO,
      });
      pedidoComOrderNaVaga({ metodo_online });
      await retomar();

      expect(criarPagamento.mock.calls.map((c) => c[0])).toEqual([
        { orderId: PEDIDO, metodo: "verificar" },
      ]);
      expect(create).not.toHaveBeenCalled();
      expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
        URL_DO_DESAFIO,
      );
      expect(botaoExato("Pagar com PIX")).toBeDefined();
      expect(botaoExato("Ver meus pedidos")).toBeDefined();
    });
  }

  it("DESEJADO VERMELHO (depois do prazo, dentro das 24 h): o desafio vivo continua na tela, SEM 'Pagar com PIX' (o servidor recusaria) e sem formulário", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "desafio3ds",
      paymentId: ORDER,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_VENCIDO,
    });
    pedidoComOrderNaVaga({ expires_at: PRAZO_VENCIDO });
    await retomar();

    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(create).not.toHaveBeenCalled();
    expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
      URL_DO_DESAFIO,
    );
    expect(botaoExato("Pagar com PIX")).toBeUndefined();
  });

  it("DESEJADO VERMELHO: cartão em análise (com order) — 'Pagamento em análise pelo banco', sem formulário e sem nada que cobra", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "em_analise",
      paymentId: ORDER,
      expiraEm: PRAZO_FUTURO,
    });
    pedidoComOrderNaVaga();
    await retomar();

    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(create).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Pagamento em análise pelo banco");
    expect(botaoExato("Pagar com PIX")).toBeUndefined();
    expect(botaoExato("Tentar outro cartão")).toBeUndefined();
  });

  it("DESEJADO VERMELHO: o 3DS morreu (vencido/recusado) e a consulta soltou a vaga — a escolha da forma com 'não foi concluído'; nada monta sem toque", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "recusado",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
    });
    pedidoComOrderNaVaga();
    await retomar();

    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(hospedeiro.textContent).toContain(
      "Como você quer pagar este pedido?",
    );
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "O pagamento com cartão não foi concluído.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("DESEJADO VERMELHO: 'Pagar com PIX' no desafio retomado — o ÚNICO POST novo é o do PIX, só depois do toque, e o pedido fica MARCADO com cobrança incerta", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "desafio3ds",
      paymentId: ORDER,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    pedidoComOrderNaVaga();
    await retomar();
    expect(chamadasPorMetodo()).toEqual(["verificar"]);

    let falharPix: () => void = () => {};
    criarPagamento.mockImplementationOnce(
      () =>
        new Promise((_resolver, rejeitar) => {
          falharPix = () =>
            rejeitar(new Error("Não foi possível gerar a cobrança."));
          emVoo.push(() => rejeitar(new Error("fim do teste")));
        }),
    );
    await act(async () => {
      botaoExato("Pagar com PIX")?.click();
    });
    await esvaziar();

    expect(criarPagamento.mock.calls.map((c) => c[0])).toEqual([
      { orderId: PEDIDO, metodo: "verificar" },
      { orderId: PEDIDO, metodo: "pix" },
    ]);
    expect(create).not.toHaveBeenCalled();

    // A marca de cobrança incerta (L1h) vale no pedido retomado: o PIX que
    // falha sem corpo NÃO oferece "Cancelar pedido" (o 3DS estava vivo no
    // toque).
    await act(async () => {
      falharPix();
    });
    await esvaziar();
    expect(hospedeiro.textContent).toContain(
      "Não foi possível gerar a cobrança.",
    );
    expect(
      [...hospedeiro.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Cancelar pedido"),
      ),
    ).toBe(false);
  });

  // Revisão financeira do desenho L2: o terminal que já está na tela vence.
  // A consulta respondeu 409 terminal — a tela fica nele: nenhum "Verificar
  // de novo", nenhum PIX, nenhum formulário, e nem a verificação periódica
  // nem um evento de realtime trocam a frase (nada consulta de novo).
  it("TERMINAL NA TELA VENCE: a consulta responde 409 terminal ('pode ter sido cobrado') — a frase fica, sem 'Verificar de novo', sem PIX, sem formulário, e nada a sobrescreve depois", async () => {
    const talvezCobrado =
      "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.";
    criarPagamento.mockRejectedValueOnce(
      Object.assign(new Error(talvezCobrado), {
        terminal: true,
        cartaoEmAnalise: true,
      }),
    );
    pedidoComOrderNaVaga();
    await retomar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      talvezCobrado,
    );
    expect(botaoExato("Verificar de novo")).toBeUndefined();
    expect(botaoExato("Pagar com PIX")).toBeUndefined();
    expect(botaoExato("Ver meus pedidos")).toBeDefined();

    // Depois: a vaga é solta e o pedido expira — nem a leitura periódica nem
    // o realtime trocam o terminal pela frase da L1, e nada chama a edge.
    linha = {
      ...linha,
      gateway_payment_id: null,
      payment_status: "expirado",
      status: "cancelled",
    };
    await verificacaoPeriodica();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      talvezCobrado,
    );
    expect(hospedeiro.textContent).not.toContain("não foi concluído");
    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("CUSTO SEM O C2 (é o que a mudança faz se o servidor ainda não tiver o `verificar`): 400 'Forma de pagamento inválida.' vira 'indisponível' — nada de recusa, nada de 'em análise', nenhum POST além da consulta, e sem o formulário", async () => {
    criarPagamento.mockRejectedValueOnce(
      Object.assign(new Error("Forma de pagamento inválida."), {
        terminal: false,
        cartaoEmAnalise: false,
      }),
    );
    pedidoComOrderNaVaga();
    await retomar();

    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(hospedeiro.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(hospedeiro.textContent).not.toContain("não foi concluído");
    expect(hospedeiro.textContent).not.toContain("não foi aprovado");
    expect(hospedeiro.textContent).not.toMatch(/em análise/i);
    expect(botaoExato("Pagar com PIX")).toBeUndefined();
    expect(botaoExato("Verificar de novo")).toBeDefined();
    expect(botaoExato("Ver meus pedidos")).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });

  // ── Interação com a L1 ──────────────────────────────────────────────────

  it("L2 + L1: a consulta prova a vaga livre, o cliente escolhe cartão, o 3DS novo é solto e o pedido expira — a regra da L1 ainda mostra o terminal honesto", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "livre",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
    });
    pedidoComOrderNaVaga();
    await retomar();
    linha = { ...linha, gateway_payment_id: null, metodo_online: null };
    expect(hospedeiro.textContent).toContain(
      "Como você quer pagar este pedido?",
    );

    await act(async () => {
      botaoExato("Cartão de crédito")?.click();
    });
    await esvaziar();
    expect(create).toHaveBeenCalledTimes(1);

    await enviarCartao(
      {
        paymentId: "ORD01JL2NOVA",
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
        desafio3ds: { url: URL_DO_DESAFIO },
      },
      "ORD01JL2NOVA",
    );
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();

    linha = {
      ...linha,
      gateway_payment_id: null,
      metodo_online: null,
      payment_status: "expirado",
      status: "cancelled",
    };
    await verificacaoPeriodica();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "O pagamento com cartão não foi concluído, e o prazo para pagar este pedido acabou.",
    );
    expect(chamadasPorMetodo()).toEqual(["verificar", "cartao"]);
  });

  // ── CONTROLES ────────────────────────────────────────────────────────────

  it("CONTROLE: cartão conhecido com a vaga VAZIA (nada a consultar) — formulário direto, nenhuma chamada à edge", async () => {
    await retomar();

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: `payment_status` recusado (fora do domínio do `verificar`, que responderia 409 terminal) — a retomada não consulta na montagem", async () => {
    pedidoComOrderNaVaga({ payment_status: "recusado" });
    await retomar();

    expect(criarPagamento).not.toHaveBeenCalled();
  });

  // `status` é NOT NULL no banco (20260822000000) e o não-`pending` já sai
  // antes ("não está aguardando pagamento"); um `status` ilegível é leitura
  // incompleta, e a retomada não abre caminho novo em cima dela — segue o
  // de antes e a edge decide no POST.
  it("CONTROLE: `status` ilegível (null) — fora da regra da L2 (só `aguardando` + `pending` consulta)", async () => {
    pedidoComOrderNaVaga({ status: null });
    await retomar();

    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("CONTROLE: o SENTINELA continua indo para a consulta pelo caminho do C4", async () => {
    criarPagamento.mockResolvedValueOnce({
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
      canceladoAutomaticamenteAte: "2026-10-03T15:00:00.000Z",
    });
    pedidoComOrderNaVaga({
      gateway_payment_id: `verificando:${PEDIDO}:c0:pabcdef012345:1790943000000`,
      metodo_online: null,
    });
    await retomar();

    expect(chamadasPorMetodo()).toEqual(["verificar"]);
    expect(hospedeiro.textContent).toContain(SITUACAO);
    expect(create).not.toHaveBeenCalled();
  });
});
