// @vitest-environment jsdom
//
// C6 / P1 (02/10/2026; achado B1) — a recusa DEPOIS do 3DS não
// aparece. O cliente conclui o desafio do banco, o banco recusa, e o servidor
// solta a vaga (`liberar_cobranca_do_pedido`, pelo webhook, pela
// reconciliação ou pelo `verificar` → `recusado`). A RPC (migration
// 20261176000000, :166-205) só faz `gateway_payment_id = NULL`,
// `metodo_online = NULL`, `tentativas + 1` — `payment_status` CONTINUA
// `aguardando`. A tela "Confirmando com o banco…" (PagamentoComCartao) só
// sai daí quando o CheckoutView vê `pago`/`pago_apos_expirar`
// (`onRealtimeEvent` e `verificarPagamento` leem SÓ `payment_status`): a
// recusa nunca aparece, e a tela fica presa até o teto de 360 ticks da
// verificação periódica (que só para de consultar — a tela continua igual).
//
// Andaime: o MESMO de checkout-retomada-forma-do-pedido.test.tsx — o
// CheckoutView, o PagamentoOnline e o PagamentoComCartao DE VERDADE; só o
// SDK do Mercado Pago, `criarPagamento` e o "banco" são dublês. O pedido
// entra pela retomada de um cartão conhecido (`metodo_online: credito`, vaga
// vazia), que abre o formulário do cartão direto — o mesmo componente da
// sessão normal.
//
// Os VERMELHOS provam o defeito pelos dois canais por onde a soltura chega à
// tela (realtime e verificação periódica). Os CONTROLES passam hoje e têm de
// continuar passando depois do C6: são as guardas contra a RECUSA FALSA
// (vaga ainda com a order; leitura VELHA de antes da resposta do cartão;
// evento de realtime velho) e contra cobrança sem toque.
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
// Identidades estáveis (o dublê memoriza o estado por objeto).
const CREDITO_E_DEBITO = { credito: true, debito: true, parcelasMax: 1 };
let configDoCartao: typeof CREDITO_1X = CREDITO_1X;
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(configDoCartao) };
});

// O "banco": UMA linha. `maybeSingle` (retomada) e `single` (verificação
// periódica) tiram uma FOTO da linha no instante da CHAMADA — como uma
// leitura real. `seguraProximaLeitura` deixa a próxima leitura `single` em
// voo até o teste soltar (para encenar a leitura velha).
let linha: Record<string, unknown> = {};
let leituraSegurada: {
  foto: Record<string, unknown>;
  soltar: () => void;
} | null = null;
let seguraProximaLeitura = false;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { ...linha }, error: null }),
          single: () => {
            const foto = { ...linha };
            if (!seguraProximaLeitura) {
              return Promise.resolve({ data: foto, error: null });
            }
            seguraProximaLeitura = false;
            return new Promise((resolve) => {
              leituraSegurada = {
                foto,
                soltar: () => resolve({ data: foto, error: null }),
              };
            });
          },
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

const PEDIDO = "ped-c6-p1";
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

describe("C6/P1 — recusa depois do 3DS: a vaga solta tem de virar recusa visível", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    criarPagamento.mockReset();
    onNavigate.mockClear();
    eventoDeRealtime = null;
    configDoCartao = CREDITO_1X;
    leituraSegurada = null;
    seguraProximaLeitura = false;
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

  it("VERMELHO (realtime): 3DS concluído, banco recusou, a vaga foi solta — a tela mostra a recusa com 'Tentar outro cartão'/'Pagar com PIX', sem nenhum POST novo", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    soltarAVaga();
    await chegaPeloRealtime(linha);

    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("VERMELHO (verificação periódica, realtime caído — o caso do celular): a mesma soltura lida do banco vira recusa visível", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    soltarAVaga();
    await verificacaoPeriodica();

    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("VERMELHO (mesmo mecanismo, desafio ainda ABERTO): o desafio expira no banco e a vaga é solta — o quadro sai e a recusa aparece", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();

    soltarAVaga();
    await chegaPeloRealtime(linha);
    await verificacaoPeriodica();

    expect(hospedeiro.querySelector("iframe")).toBeNull();
    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE (recusa falsa): a vaga AINDA guarda a order — a tela continua 'Confirmando com o banco…'", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    await chegaPeloRealtime(linha);
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(botaoExato("Tentar outro cartão")).toBeUndefined();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE (recusa falsa): leitura do banco que SAIU antes da resposta do cartão (vaga ainda vazia) e chega depois não vira recusa", async () => {
    await retomar();
    // A verificação periódica sai com a vaga AINDA vazia e fica em voo...
    seguraProximaLeitura = true;
    await verificacaoPeriodica();
    expect(leituraSegurada?.foto.gateway_payment_id).toBeNull();
    // ...o cartão vai, o servidor grava a order e pede o 3DS...
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();
    // ...e só agora a leitura velha chega.
    await act(async () => {
      leituraSegurada?.soltar();
    });
    await esvaziar();

    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE (recusa falsa): evento de realtime VELHO (vaga vazia, de antes do cartão) com o banco já guardando a order não vira recusa", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    await chegaPeloRealtime({ ...linha, gateway_payment_id: null });
    expect(linha.gateway_payment_id).toBe(ORDER);

    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: aprovado pelo banco (payment_status pago) continua indo para a confirmação", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    linha = { ...linha, payment_status: "pago" };
    await chegaPeloRealtime(linha);

    expect(hospedeiro.textContent).not.toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("VERMELHO (em análise pelo banco, com order): a soltura da vaga também vira recusa visível", async () => {
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
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).not.toContain(
      "Pagamento em análise pelo banco",
    );
    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("VERMELHO (StrictMode): a soltura depois do 3DS vira recusa visível, com UM POST só", async () => {
    await retomar(true);
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();

    soltarAVaga();
    await chegaPeloRealtime(linha);

    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  // Mudança obrigatória 1 do revisor financeiro: o P1 só arma com o
  // `paymentId` NÃO VAZIO da resposta 200 (o "token de cerca"). Sem ele, a
  // tela fica exatamente como hoje.
  it("CONTROLE (sem token de cerca): 200 com desafio SEM paymentId, quadro aberto — a vaga vazia não vira recusa", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds(null);

    soltarAVaga();
    await chegaPeloRealtime(linha);
    await verificacaoPeriodica();

    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(botaoExato("Tentar outro cartão")).toBeUndefined();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE (sem token de cerca): 200 com desafio SEM paymentId, depois do COMPLETE — continua 'Confirmando com o banco…'", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds(null);
    await concluirDesafio();

    soltarAVaga();
    await chegaPeloRealtime(linha);
    await verificacaoPeriodica();

    expect(hospedeiro.textContent).toContain(CONFIRMANDO);
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  // Lacuna L1 (02/10/2026): estes dois casos eram CONTROLES "fora do
  // escopo" do C6 — prendiam a tela em "Confirmando com o banco…" quando a
  // vaga solta vinha com o pedido já fechado (a lacuna L1, provada em
  // lacuna-l1-soltura-expiracao.test.tsx). A inversão é o desenho, não um
  // afrouxamento: o que estes testes protegiam continua aqui — nada que
  // cobra ("Tentar outro cartão"/"Pagar com PIX"), nenhum POST novo, nunca
  // "não foi aprovado" nem "nada foi cobrado". O que muda é só a frase: a
  // tentativa morta por prova (vaga solta pela RPC, que só solta pedido
  // `aguardando`) num pedido que fechou depois vira o terminal honesto, em
  // `role="alert"`.
  for (const [rotulo, campos, frase] of [
    [
      "pedido cancelado (status cancelled)",
      { status: "cancelled" },
      "O pagamento com cartão não foi concluído, e este pedido foi cancelado.",
    ],
    [
      "pagamento expirado (payment_status expirado)",
      { payment_status: "expirado" },
      "O pagamento com cartão não foi concluído, e o prazo para pagar este pedido acabou.",
    ],
  ] as const) {
    it(`vaga vazia com ${rotulo}: o terminal honesto em alerta — sem outro cartão, sem PIX, sem POST novo`, async () => {
      await retomar();
      await enviarCartaoQueCaiNo3ds();
      await concluirDesafio();

      soltarAVaga();
      linha = { ...linha, ...campos };
      await verificacaoPeriodica();

      expect(hospedeiro.textContent).not.toContain(CONFIRMANDO);
      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
        frase,
      );
      expect(hospedeiro.textContent).not.toContain("não foi aprovado");
      expect(hospedeiro.textContent).not.toMatch(/nada foi cobrado/i);
      expect(botaoExato("Tentar outro cartão")).toBeUndefined();
      expect(botaoExato("Pagar com PIX")).toBeUndefined();
      expect(criarPagamento).toHaveBeenCalledTimes(1);
    });
  }

  it("depois da recusa, 'Pagar com PIX' é a troca com o cartão MORTO: se o PIX falhar sem corpo, 'Cancelar pedido' continua disponível", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();
    soltarAVaga();
    await verificacaoPeriodica();
    esperarRecusaVisivel();

    criarPagamento.mockRejectedValueOnce(
      new Error("Não foi possível gerar a cobrança."),
    );
    await act(async () => {
      botaoExato("Pagar com PIX")?.click();
    });
    await esvaziar();

    const pix = criarPagamento.mock.calls.filter((c) => c[0]?.metodo === "pix");
    expect(pix).toHaveLength(1);
    expect(pix[0][0]).toEqual({ orderId: PEDIDO, metodo: "pix" });
    expect(hospedeiro.textContent).toContain(
      "Não foi possível gerar a cobrança.",
    );
    expect(
      [...hospedeiro.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Cancelar pedido"),
      ),
    ).toBe(true);
  });

  it("'Tentar outro cartão' depois da recusa: a recusa da tentativa ANTERIOR não derruba a nova (chave pedido + token de cerca)", async () => {
    await retomar();
    await enviarCartaoQueCaiNo3ds();
    await concluirDesafio();
    soltarAVaga();
    await verificacaoPeriodica();
    esperarRecusaVisivel();

    const montagensAntes = create.mock.calls.length;
    await act(async () => {
      botaoExato("Tentar outro cartão")?.click();
    });
    await esvaziar();
    expect(create.mock.calls.length).toBeGreaterThan(montagensAntes);

    await enviarCartaoQueCaiNo3ds("ORD01JC6P1SEGUNDA");
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    await verificacaoPeriodica();
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);

    // E a segunda tentativa também mostra a SUA recusa.
    soltarAVaga();
    await verificacaoPeriodica();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(2);
  });

  // ── Revisão independente do front (02/10/2026), bloqueio REPRODUZIDO: a
  // tela do cartão REMONTA (a tentativa local volta a 0) e a marca de
  // encerramento da tentativa ANTERIOR derrubava um 3DS VIVO novo. A
  // identidade da tentativa é o TOKEN DE CERCA (`paymentId` do 200), único
  // entre montagens: marca de outro token nunca encerra o atual.

  /** Recusa P1 da 1ª order (3DS concluído, vaga solta, leitura posterior). */
  async function primeiraTentativaRecusada() {
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

  /** O 3DS VIVO da order nova fica na tela; e a SUA recusa ainda aparece. */
  async function novoDesafioVivoEDepoisASuaRecusa(postsAteAqui: number) {
    const NOVA = "ORD01JC6P1NOVA";
    await enviarCartao(
      {
        paymentId: NOVA,
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
        desafio3ds: { url: URL_DO_DESAFIO },
      },
      NOVA,
    );
    expect(linha.gateway_payment_id).toBe(NOVA);
    expect(
      hospedeiro.querySelector("iframe"),
      "o 3DS VIVO da order nova deveria continuar na tela",
    ).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    // Uma leitura nova da vaga (que guarda a order nova) não muda nada.
    await verificacaoPeriodica();
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    expect(criarPagamento).toHaveBeenCalledTimes(postsAteAqui);

    // CONTROLE POSITIVO: a recusa de verdade do token NOVO aparece.
    soltarAVaga();
    await verificacaoPeriodica();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(postsAteAqui);
  }

  it("REMONTAGEM por 'Tentar de novo' (falha local depois da recusa): o 3DS vivo novo NÃO vira 'não foi concluído'", async () => {
    await primeiraTentativaRecusada();
    // Outro cartão com falha LOCAL (sem token): nenhum POST, caixa vermelha.
    await submeterNoBrick({ token: "" });
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    const tentar = botaoExato("Tentar de novo");
    expect(tentar, "caixa vermelha com 'Tentar de novo'").toBeDefined();
    await act(async () => {
      tentar?.click();
    });
    await esvaziar();

    await novoDesafioVivoEDepoisASuaRecusa(2);
  });

  it("REMONTAGEM pela forma desligada (o crédito sai, o débito fica): o 3DS vivo novo NÃO vira 'não foi concluído'", async () => {
    configDoCartao = CREDITO_E_DEBITO;
    await primeiraTentativaRecusada();
    const montagensAntes = create.mock.calls.length;
    criarPagamento.mockRejectedValueOnce(
      Object.assign(
        new Error("Esta forma de pagamento não está disponível nesta loja."),
        {
          codigo: "CARTAO_FORMA_DESLIGADA",
          terminal: false,
          cartaoEmAnalise: false,
        },
      ),
    );
    await submeterNoBrick({}, "credit_card");
    expect(criarPagamento).toHaveBeenCalledTimes(2);
    // A tela do cartão remontou só com o débito.
    expect(create.mock.calls.length).toBeGreaterThan(montagensAntes);
    expect(
      create.mock.calls.at(-1)?.[2].customization.paymentMethods.types,
    ).toEqual({ included: ["debit_card"] });

    criarPagamento.mockImplementationOnce(async () => {
      linha = { ...linha, gateway_payment_id: "ORD01JC6P1NOVA" };
      return {
        paymentId: "ORD01JC6P1NOVA",
        statusPagamento: "aguardando",
        expiraEm: PRAZO_FUTURO,
        desafio3ds: { url: URL_DO_DESAFIO },
      };
    });
    await submeterNoBrick({}, "debit_card");
    expect(linha.gateway_payment_id).toBe("ORD01JC6P1NOVA");
    expect(
      hospedeiro.querySelector("iframe"),
      "o 3DS VIVO do débito deveria continuar na tela",
    ).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);
    await verificacaoPeriodica();
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    expect(hospedeiro.textContent).not.toContain(NAO_CONCLUIDO);

    soltarAVaga();
    await verificacaoPeriodica();
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    esperarRecusaVisivel();
    expect(criarPagamento).toHaveBeenCalledTimes(3);
  });

  it("REMONTAGEM pela escolha da forma depois da verificação (C5): o 3DS vivo novo NÃO vira 'não foi concluído'", async () => {
    await primeiraTentativaRecusada();
    // O outro cartão volta ambíguo: a verificação consulta UMA vez e prova a
    // vaga livre — o cliente escolhe a forma de novo.
    criarPagamento.mockRejectedValueOnce(
      Object.assign(
        new Error("Há um pagamento com cartão em análise para este pedido."),
        { terminal: false, cartaoEmAnalise: true },
      ),
    );
    criarPagamento.mockResolvedValueOnce({
      verificacao: "livre",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
    });
    await submeterNoBrick({});
    await esvaziar();
    expect(criarPagamento).toHaveBeenCalledTimes(3);
    expect(criarPagamento.mock.calls[2][0]).toEqual({
      orderId: PEDIDO,
      metodo: "verificar",
    });
    expect(hospedeiro.textContent).toContain(
      "Como você quer pagar este pedido?",
    );
    await act(async () => {
      botaoExato("Cartão de crédito")?.click();
    });
    await esvaziar();

    await novoDesafioVivoEDepoisASuaRecusa(4);
  });
});
