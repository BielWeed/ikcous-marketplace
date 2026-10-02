// @vitest-environment jsdom
//
// LACUNA L1 (prova, 02/10/2026) — soltura seguida de expiração. Depois de um
// 3DS (ou de um "em análise"), a vaga é solta pela RPC
// `liberar_cobranca_do_pedido` (cartão morto por prova) e, antes de qualquer
// leitura da tela, a varredura `expirar_pedidos_vencidos` grava
// `payment_status = 'expirado'` / `status = 'cancelled'`. A regra do C6 (P1)
// exige `aguardando` + `pending` + vaga vazia, então a tela fica presa em
// "Confirmando com o banco…" (ou no quadro do desafio, ou em "em análise").
// Não há risco de dinheiro: é o cliente preso.
//
// Andaime: o MESMO do c6-recusa-pos-3ds.test.tsx (CheckoutView,
// PagamentoOnline e PagamentoComCartao DE VERDADE; só o SDK do MP,
// `criarPagamento` e o "banco" são dublês). Nada em src/** muda nesta prova.
//
// Os VERMELHOS provaram a lacuna (saída em scratchpad recuperacao/LACUNAS/
// red-front.txt) e são o comportamento da correção (CheckoutView,
// `verificarPagamento`). Os CONTROLES passavam antes e continuam passando
// (cartão VIVO na expiração, evento velho, sem token de cerca, pagamento
// tardio). As guardas da correção têm teste próprio, no fim: o terminal que
// já está na tela GANHA (revisão financeira do desenho), pedido com cobrança
// incerta não ganha "não foi concluído", a troca para o PIX tira a recusa de
// cena, e o realtime também acorda a leitura depois da recusa do C6.
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

// O realtime: o CheckoutView é o ÚNICO que passa `onRealtimeEvent` — o
// dublê guarda o mais recente (o callback fecha sobre o `orderId` do render).
let eventoDeRealtime: ((payload: unknown) => void) | null = null;
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: (
      _a?: unknown,
      _b?: unknown,
      opcoes?: { onRealtimeEvent?: (payload: unknown) => void },
    ) => {
      if (opcoes?.onRealtimeEvent) eventoDeRealtime = opcoes.onRealtimeEvent;
      return { createOrder, updateOrderStatus, criarPagamento };
    },
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

const PEDIDO = "ped-lacuna-l1";
const ORDER = "ORD01JC6P1VIVA";
const URL_DO_DESAFIO =
  "https://www.mercadopago.com.br/auth/card/validation/pages/remedies/abc?display_mode=self_hosted";
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
const CONFIRMANDO = "Confirmando com o banco…";
const NAO_CONCLUIDO = "não foi concluído";

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

describe("Lacuna L1 — soltura da vaga seguida da expiração do pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    criarPagamento.mockReset();
    onNavigate.mockClear();
    eventoDeRealtime = null;
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

  afterEach(() => {
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

  /** O cliente envia o cartão; a edge grava a order na vaga e pede o 3DS. */
  async function enviarCartaoQueCaiNo3ds(order: string | null = ORDER) {
    await enviarCartao(
      {
        paymentId: order,
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
        desafio3ds: { url: URL_DO_DESAFIO },
      },
      order ?? ORDER,
    );
    expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
      URL_DO_DESAFIO,
    );
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

  async function concluirDesafio() {
    await act(async () => {
      globalThis.dispatchEvent(
        new MessageEvent("message", {
          data: { status: "COMPLETE" },
          origin: "https://www.mercadopago.com.br",
        }),
      );
    });
    await esvaziar();
    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
  }

  /** O banco recusou (ou o desafio expirou) e alguém soltou a vaga. */
  function soltarAVaga() {
    linha = {
      ...linha,
      gateway_payment_id: null,
      metodo_online: null,
      tentativas_de_pagamento: 1,
    };
  }

  async function chegaPeloRealtime(novo: Record<string, unknown>) {
    expect(
      eventoDeRealtime,
      "o CheckoutView deveria assinar o realtime",
    ).not.toBeNull();
    await act(async () => {
      eventoDeRealtime?.({ eventType: "UPDATE", new: { ...novo } });
    });
    await esvaziar();
  }

  async function verificacaoPeriodica() {
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esvaziar();
  }

  function esperarRecusaVisivel() {
    expect(
      hospedeiro.textContent,
      "a recusa (vaga solta) deveria aparecer em vez de 'Confirmando com o banco…'",
    ).toContain(NAO_CONCLUIDO);
    expect(hospedeiro.textContent).not.toContain(CONFIRMANDO);
    // Veredito A2, item 4: a soltura inclui o 3DS só EXPIRADO.
    expect(hospedeiro.textContent).not.toContain("não foi aprovado");
    expect(botaoExato("Tentar outro cartão")).toBeDefined();
    expect(botaoExato("Pagar com PIX")).toBeDefined();
  }

  // ── Lacuna L1 ────────────────────────────────────────────────────────────
  // A varredura `expirar_pedidos_vencidos` (migration 20261186000000,
  // :162-195) grava `payment_status = 'expirado'` e `status = 'cancelled'` e
  // NÃO toca a vaga. Ela só pega o pedido de cartão quando a vaga já não é
  // "cartão vivo" (vaga vazia, ou mais de 24 h) — ou seja, DEPOIS da soltura
  // pela RPC. E a RPC (20261176000000, :187-200) só solta com
  // `payment_status = 'aguardando'`: depois de expirado ninguém esvazia a
  // vaga. Logo `expirado` + vaga vazia, lido DEPOIS do aviso da tentativa, é
  // "a tentativa morreu por prova e depois o prazo acabou".

  /** A varredura do pg_cron expirou o pedido (não mexe na vaga). */
  function expirarOPedido() {
    linha = { ...linha, payment_status: "expirado", status: "cancelled" };
  }

  const PRAZO_ACABOU = "prazo para pagar este pedido acabou";

  /**
   * O que a tela tem de mostrar quando a tentativa morreu E o pedido fechou:
   * sai de "Confirmando com o banco…", diz que o pedido fechou, não oferece
   * nada que cobra (o servidor recusaria tudo com 409 terminal), e nunca
   * promete "nada foi cobrado".
   */
  function esperarPedidoFechadoVisivel(frase: string) {
    expect(
      hospedeiro.textContent,
      "a tela continua presa em 'Confirmando com o banco…' depois da soltura + fechamento do pedido",
    ).not.toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).toContain(frase);
    // A troca de tela nasce de uma leitura, sem toque: o leitor de tela
    // precisa anunciar.
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      frase,
    );
    expect(botaoExato("Tentar outro cartão")).toBeUndefined();
    expect(botaoExato("Pagar com PIX")).toBeUndefined();
    // Terminal: o servidor recusaria qualquer nova tentativa.
    expect(botaoExato("Tentar de novo")).toBeUndefined();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(hospedeiro.textContent).not.toMatch(/nada foi cobrado/i);
    expect(hospedeiro.textContent).not.toContain("não foi aprovado");
  }

  it("L1 VERMELHO (verificação periódica): 3DS concluído, vaga solta e DEPOIS o pedido expirou antes de qualquer leitura — a tela sai de 'Confirmando com o banco…' e diz que o prazo acabou", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    soltarAVaga();
    expirarOPedido();
    await verificacaoPeriodica();

    esperarPedidoFechadoVisivel(PRAZO_ACABOU);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("L1 VERMELHO (realtime): o UPDATE da expiração (vaga vazia) chega pelo realtime — a mesma saída", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    soltarAVaga();
    expirarOPedido();
    await chegaPeloRealtime(linha);

    esperarPedidoFechadoVisivel(PRAZO_ACABOU);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("L1 VERMELHO (desafio ainda ABERTO): o desafio expira no banco, a vaga é solta e o pedido expira — o quadro sai e o prazo acabado aparece", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();

    soltarAVaga();
    expirarOPedido();
    await verificacaoPeriodica();

    esperarPedidoFechadoVisivel(PRAZO_ACABOU);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("L1 VERMELHO (em análise, com order): soltura + expiração tira o 'em análise pelo banco' da tela", async () => {
    await retomar();
    await enviarCartao(
      {
        paymentId: ORDER,
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
      },
      ORDER,
    );
    expect(hospedeiro.textContent).toContain("Pagamento em análise pelo banco");

    soltarAVaga();
    expirarOPedido();
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).not.toContain(
      "Pagamento em análise pelo banco",
    );
    esperarPedidoFechadoVisivel(PRAZO_ACABOU);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("L1 VERMELHO (vizinho: cancelado depois da soltura — admin ou outra aba): `aguardando` + `cancelled` + vaga vazia não pode deixar a tela em 'Confirmando com o banco…'", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    soltarAVaga();
    linha = { ...linha, status: "cancelled" };
    await verificacaoPeriodica();

    esperarPedidoFechadoVisivel("foi cancelado");
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("L1b VERMELHO: a recusa do C6 já está na tela e DEPOIS o pedido expira — 'Tentar outro cartão'/'Pagar com PIX' (que só levariam a 409 terminal) saem, e o prazo acabado aparece", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();
    soltarAVaga();
    await verificacaoPeriodica();
    esperarRecusaVisivel();

    expirarOPedido();
    await verificacaoPeriodica();

    esperarPedidoFechadoVisivel(PRAZO_ACABOU);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  // ── O caso OPOSTO (cartão VIVO na expiração) e as cercas ────────────────
  // A 20261186 segura a expiração do cartão vivo por até 24 h; se mesmo assim
  // o pedido aparecer expirado com a order AINDA na vaga, o cartão pode ser
  // aprovado depois (`pago_apos_expirar`). Nada de "não foi concluído", nada
  // de "nada foi cobrado", nada que cobra.

  it("CONTROLE (cartão VIVO na expiração): pedido expirado com a order AINDA na vaga — nunca 'não foi concluído', nunca 'nada foi cobrado', nada que cobra", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    expirarOPedido();
    expect(linha.gateway_payment_id).toBe(ORDER);
    await chegaPeloRealtime(linha);
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(hospedeiro.textContent).not.toMatch(/nada foi cobrado/i);
    expect(botaoExato("Tentar outro cartão")).toBeUndefined();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE (evento velho): realtime diz 'expirado + vaga vazia' mas o banco ainda guarda a order aguardando — nada muda", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    await chegaPeloRealtime({
      ...linha,
      gateway_payment_id: null,
      payment_status: "expirado",
      status: "cancelled",
    });

    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(PRAZO_ACABOU);
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE (sem token de cerca): 200 com desafio SEM paymentId — soltura + expiração não muda a tela", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds(null);
    await concluirDesafio();

    soltarAVaga();
    expirarOPedido();
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(PRAZO_ACABOU);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: pagamento tardio (`pago_apos_expirar`) depois da expiração continua indo para a tela própria", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    linha = {
      ...linha,
      payment_status: "pago_apos_expirar",
      status: "cancelled",
    };
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).not.toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(hospedeiro.textContent).not.toMatch(/nada foi cobrado/i);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  // ── As guardas da correção ──────────────────────────────────────────────

  const FRASE_L1 = "O pagamento com cartão não foi concluído, e";

  /** A recusa do C6 na tela e o cliente indo para outro cartão. */
  async function recusaDoC6EOutroCartao() {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();
    soltarAVaga();
    await verificacaoPeriodica();
    esperarRecusaVisivel();
    await act(async () => {
      botaoExato("Tentar outro cartão")?.click();
    });
    await esvaziar();
  }

  it("O TERMINAL NA TELA GANHA (revisão financeira): um 409 terminal da edge ('Este pedido foi cancelado.', sem sinal) já na tela — a leitura seguinte com vaga vazia e pedido fechado NÃO troca a frase", async () => {
    await recusaDoC6EOutroCartao();
    criarPagamento.mockRejectedValueOnce(
      Object.assign(new Error("Este pedido foi cancelado."), {
        terminal: true,
        cartaoEmAnalise: false,
      }),
    );
    await submeterNoBrick({});
    expect(hospedeiro.textContent).toContain("Este pedido foi cancelado.");

    linha = { ...linha, status: "cancelled" };
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).toContain("Este pedido foi cancelado.");
    expect(hospedeiro.textContent).not.toContain(FRASE_L1);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(criarPagamento).toHaveBeenCalledTimes(2);
  });

  it("O TERMINAL NA TELA GANHA: o 409 terminal 'pode ter sido cobrado' (cartaoEmAnalise) já na tela — pedido expirado com vaga vazia NÃO vira 'não foi concluído'", async () => {
    await recusaDoC6EOutroCartao();
    const talvezCobrado =
      "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.";
    criarPagamento.mockRejectedValueOnce(
      Object.assign(new Error(talvezCobrado), {
        terminal: true,
        cartaoEmAnalise: true,
      }),
    );
    await submeterNoBrick({});
    expect(hospedeiro.textContent).toContain(talvezCobrado);

    expirarOPedido();
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).toContain(talvezCobrado);
    expect(hospedeiro.textContent).not.toContain(FRASE_L1);
    expect(hospedeiro.textContent).not.toMatch(/nada foi cobrado/i);
    expect(criarPagamento).toHaveBeenCalledTimes(2);
  });

  it("COBRANÇA INCERTA: outro cartão volta ambíguo (sem resposta) e abre a verificação — pedido expirado com vaga vazia NÃO afirma 'não foi concluído' por cima da dúvida", async () => {
    await recusaDoC6EOutroCartao();
    criarPagamento.mockRejectedValueOnce(
      new Error("Não foi possível gerar a cobrança."),
    );
    // A verificação do C5 consulta uma vez ao abrir: fica em voo.
    criarPagamento.mockImplementationOnce(() => new Promise(() => {}));
    await submeterNoBrick({});
    expect(hospedeiro.textContent).toContain("Situação do pagamento");

    expirarOPedido();
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).toContain("Situação do pagamento");
    expect(hospedeiro.textContent).not.toContain(FRASE_L1);
  });

  it("TROCA PARA O PIX: depois da recusa do C6 o cliente toca 'Pagar com PIX' — a recusa sai de cena e o pedido expirado não vira a frase do cartão por cima do PIX", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();
    soltarAVaga();
    await verificacaoPeriodica();
    esperarRecusaVisivel();

    criarPagamento.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      botaoExato("Pagar com PIX")?.click();
    });
    await esvaziar();
    expect(criarPagamento.mock.calls.at(-1)?.[0]).toEqual({
      orderId: PEDIDO,
      metodo: "pix",
    });

    expirarOPedido();
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).not.toContain(FRASE_L1);
  });

  it("L1b pelo REALTIME: a recusa do C6 está na tela e o UPDATE da expiração chega só pelo realtime — a leitura acorda e o terminal aparece", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();
    soltarAVaga();
    await verificacaoPeriodica();
    esperarRecusaVisivel();

    expirarOPedido();
    await chegaPeloRealtime(linha);

    esperarPedidoFechadoVisivel(PRAZO_ACABOU);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });
});
