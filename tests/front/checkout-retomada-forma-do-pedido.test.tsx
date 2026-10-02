// @vitest-environment jsdom
//
// Bug do teste real da 1.5.14 (Gabriel, 02/10/2026): "Quando eu coloco pra
// pagar em cartão, eu vou em retomar pagamento, ele volta à tela de QR Code".
//
// Causa: `metodo_online` só é gravado JUNTO da vaga, quando uma cobrança
// nasce (criar-pagamento). Pedido de cartão cujo formulário não chegou a
// enviar nada fica com `metodo_online` NULL; a retomada lia NULL, mantinha o
// "pix" inicial de `metodoDoPedido` e montava o PagamentoComPix, cujo efeito
// de montagem CRIA a cobrança PIX sozinho. Forma desconhecida virava PIX
// cobrado sem o cliente pedir.
//
// O que este arquivo prende, com o CheckoutView, o PagamentoOnline e o
// PagamentoComCartao DE VERDADE (só o SDK do Mercado Pago, `criarPagamento`
// e a leitura do pedido são dublês):
//   1. Forma desconhecida: nada é cobrado sozinho; o cliente escolhe a forma.
//      Escolher cartão abre o formulário sem chamar a edge; escolher PIX é a
//      troca explícita e chama a edge UMA vez.
//   2. Cartão conhecido (credito/debito): abre o formulário do cartão direto,
//      sem PIX; em análise no envio continua sem "Pagar com PIX" e sem
//      "Cancelar pedido"; recusado oferece a troca segura para PIX.
//   3. PIX conhecido: retoma o PIX como antes (a edge reconsulta a MESMA
//      cobrança).
//   4. Pedido que não está mais aguardando pagamento: nada monta, nada cobra.
//   5. Saída e reentrada: forma desconhecida continua sem cobrança; PIX
//      volta pelo MESMO pedido.
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

// Identidades ESTÁVEIS: efeitos do CheckoutView dependem de `user` e da
// config — objeto novo a cada render vira laço.
const mockUser = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

// Carrinho VAZIO — o estado real de quem já criou o pedido e voltou.
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
let mockConfigDoCartao: typeof CREDITO_1X | null = CREDITO_1X;
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(mockConfigDoCartao) };
});

// O "banco": a linha de cada pedido, lida pela retomada (`maybeSingle`) e
// pela verificação periódica da tela (`single`).
const pedidos: Record<string, Record<string, unknown>> = {};
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_coluna: string, valor: string) => ({
          maybeSingle: () =>
            // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (ids definidos neste arquivo).
            Promise.resolve({ data: pedidos[valor] ?? null, error: null }),
          single: () =>
            Promise.resolve({
              // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (ids definidos neste arquivo).
              data: pedidos[valor] ?? { payment_status: "aguardando" },
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ESCOLHA = "Como você quer pagar este pedido?";
const FINALIZE = "Finalize o pagamento";
const CANCELAR = "Cancelar pedido";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoExato(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

function botaoQueContem(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
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

function erroDaEdge(mensagem: string, campos: Record<string, unknown> = {}) {
  return Object.assign(new Error(mensagem), {
    terminal: false,
    cartaoEmAnalise: false,
    ...campos,
  });
}

const PIX_VIVO = {
  paymentId: "mp-pix-1",
  statusPagamento: "aguardando",
  expiraEm: new Date(Date.now() + 20 * 60_000).toISOString(),
  qrCode: "00020126-copia-e-cola",
  qrCodeBase64: "iVBORw0KGgo=",
};

beforeAll(async () => {
  const promessa = carregarSdkMercadoPago();
  document
    .querySelector("script[data-mp-sdk]")
    ?.dispatchEvent(new Event("load"));
  await promessa;
});

describe("CheckoutView — retomar pagamento respeita a forma do pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    // Padrão: a edge responde um PIX vivo — assim uma chamada PIX indevida
    // aparece como CONTAGEM na asserção, não como quebra do dublê.
    criarPagamento.mockReset().mockResolvedValue(PIX_VIVO);
    onNavigate.mockClear();
    mockConfigDoCartao = CREDITO_1X;
    for (const chave of Object.keys(pedidos)) {
      // eslint-disable-next-line security/detect-object-injection -- Limpando o dublê local entre testes.
      delete pedidos[chave];
    }
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

  function pedido(id: string, campos: Record<string, unknown>) {
    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (ids definidos neste arquivo).
    pedidos[id] = {
      total: 120,
      status: "pending",
      payment_status: "aguardando",
      gateway_payment_id: null,
      metodo_online: null,
      expires_at: null,
      ...campos,
    };
  }

  async function retomar(pedidoId: string) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          key={`retomada-${pedidoId}-${Math.random()}`}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
          retomarPedidoId={pedidoId}
        />,
      );
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
  }

  /** Sai da tela (desmonta) — o cliente vai para "Meus pedidos". */
  function sair() {
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
  }

  async function clicar(botao: HTMLButtonElement | undefined, nome: string) {
    expect(botao, `o botão '${nome}' deveria estar na tela`).toBeDefined();
    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function enviarCartao() {
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
          },
          { paymentTypeId: "credit_card" },
        );
      } catch {
        // O Brick recebe a recusa; o que importa é a tela.
      }
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  // ── 1. Forma desconhecida ────────────────────────────────────────────────

  it("BUG do Gabriel: pedido de cartão sem cobrança (metodo_online NULL) não vira QR Code PIX sozinho", async () => {
    pedido("ped-r-01", {});
    await retomar("ped-r-01");

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("Copiar");
    expect(hospedeiro.textContent).toContain(ESCOLHA);
    expect(botaoExato("Cartão de crédito")).toBeDefined();
    expect(botaoExato("Pagar com PIX")).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("forma desconhecida -> escolher cartão: abre o formulário do cartão (crédito) sem chamar a edge", async () => {
    pedido("ped-r-02", {});
    await retomar("ped-r-02");

    await clicar(botaoExato("Cartão de crédito"), "Cartão de crédito");

    expect(hospedeiro.textContent).toContain(FINALIZE);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][2].customization.paymentMethods.types).toEqual({
      included: ["credit_card"],
    });
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("forma desconhecida -> escolher PIX (troca explícita): UMA chamada PIX para o MESMO pedido", async () => {
    pedido("ped-r-03", {});
    criarPagamento.mockResolvedValue(PIX_VIVO);
    await retomar("ped-r-03");

    await clicar(botaoExato("Pagar com PIX"), "Pagar com PIX");

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: "ped-r-03",
      metodo: "pix",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("forma desconhecida com cartão desligado na loja: só PIX é oferecido, e mesmo assim nada é cobrado sem o toque", async () => {
    mockConfigDoCartao = null;
    pedido("ped-r-04", {});
    await retomar("ped-r-04");

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain(ESCOLHA);
    expect(botaoQueContem("Cartão")).toBeUndefined();
    expect(botaoExato("Pagar com PIX")).toBeDefined();
  });

  // ── 2. Cartão conhecido ──────────────────────────────────────────────────

  it("cartão conhecido (credito, cobrança anterior recusada): abre o cartão direto, sem escolher e sem PIX", async () => {
    pedido("ped-r-05", {
      metodo_online: "credito",
      gateway_payment_id: "ORD-MORTA",
    });
    await retomar("ped-r-05");

    expect(hospedeiro.textContent).not.toContain(ESCOLHA);
    expect(hospedeiro.textContent).toContain(FINALIZE);
    expect(create).toHaveBeenCalledTimes(1);
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("cartão conhecido: o envio vai à edge como cartão; em análise NÃO oferece 'Pagar com PIX' nem 'Cancelar pedido'", async () => {
    pedido("ped-r-06", {
      metodo_online: "credito",
      gateway_payment_id: "ORD-VIVA",
    });
    criarPagamento.mockRejectedValueOnce(
      erroDaEdge("Seu cartão está em análise.", { cartaoEmAnalise: true }),
    );
    await retomar("ped-r-06");
    await enviarCartao();

    // C5 (front B2): a dúvida vira a verificação do C4 — UMA consulta
    // `verificar` (só leitura) depois do POST de cartão, nunca um segundo
    // POST de cartão nem PIX.
    expect(criarPagamento).toHaveBeenCalledTimes(2);
    const corpo = criarPagamento.mock.calls[0][0];
    expect(corpo.orderId).toBe("ped-r-06");
    expect(corpo.metodo).not.toBe("pix");
    expect(criarPagamento.mock.calls[1][0]).toEqual({
      orderId: "ped-r-06",
      metodo: "verificar",
    });
    expect(hospedeiro.textContent).not.toMatch(/em análise/i);
    expect(botaoQueContem("Pagar com PIX")).toBeUndefined();
    expect(botaoQueContem(CANCELAR)).toBeUndefined();
  });

  it("cartão conhecido recusado no envio: a troca para PIX é explícita (toque) e vai à edge pelo MESMO pedido", async () => {
    pedido("ped-r-07", { metodo_online: "credito", gateway_payment_id: null });
    criarPagamento
      .mockResolvedValueOnce({
        paymentId: "pay-1",
        statusPagamento: "recusado",
        expiraEm: "x",
        motivoRecusa: "Cartão recusado pelo banco.",
        podeTentarDeNovo: true,
      })
      .mockResolvedValueOnce(PIX_VIVO);
    await retomar("ped-r-07");
    await enviarCartao();

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    await clicar(botaoQueContem("Pagar com PIX"), "Pagar com PIX");

    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(criarPagamento.mock.calls[1][0]).toEqual({
      orderId: "ped-r-07",
      metodo: "pix",
    });
  });

  it("débito conhecido: também abre o cartão, nunca PIX", async () => {
    mockConfigDoCartao = { credito: true, debito: true, parcelasMax: 1 };
    pedido("ped-r-08", {
      metodo_online: "debito",
      gateway_payment_id: "ORD-X",
    });
    await retomar("ped-r-08");

    expect(create).toHaveBeenCalledTimes(1);
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  // ── 3. PIX conhecido ─────────────────────────────────────────────────────

  it("PIX conhecido: retoma o PIX como antes — uma chamada para o MESMO pedido, sem escolher", async () => {
    pedido("ped-r-09", {
      metodo_online: "pix",
      gateway_payment_id: "ORD-PIX",
    });
    criarPagamento.mockResolvedValue(PIX_VIVO);
    await retomar("ped-r-09");

    expect(hospedeiro.textContent).not.toContain(ESCOLHA);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: "ped-r-09",
      metodo: "pix",
    });
    expect(create).not.toHaveBeenCalled();
  });

  // ── 4. Pedido fora de "aguardando" ───────────────────────────────────────

  it("pedido já PAGO (lista desatualizada): nada monta, nada é cobrado", async () => {
    pedido("ped-r-10", {
      metodo_online: "credito",
      gateway_payment_id: "ORD-PAGA",
      payment_status: "pago",
    });
    await retomar("ped-r-10");

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain(FINALIZE);
    expect(hospedeiro.textContent).not.toContain(ESCOLHA);
    await clicar(botaoExato("Ver meus pedidos"), "Ver meus pedidos");
    expect(onNavigate).toHaveBeenCalledWith("orders");
  });

  it("pedido CANCELADO: nada monta, nada é cobrado", async () => {
    pedido("ped-r-11", { status: "cancelled" });
    await retomar("ped-r-11");

    expect(criarPagamento).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain(ESCOLHA);
    expect(hospedeiro.textContent).toContain(
      "Este pedido não está aguardando pagamento",
    );
  });

  it("pedido pendente com pagamento RECUSADO (mesma regra do botão 'Retomar pagamento'): não é bloqueado — o cartão conhecido abre", async () => {
    pedido("ped-r-14", {
      metodo_online: "credito",
      gateway_payment_id: "ORD-RECUSADA",
      payment_status: "recusado",
    });
    await retomar("ped-r-14");

    expect(hospedeiro.textContent).not.toContain(
      "Este pedido não está aguardando pagamento",
    );
    expect(hospedeiro.textContent).toContain(FINALIZE);
    expect(create).toHaveBeenCalledTimes(1);
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  // ── 5. Saída e reentrada ─────────────────────────────────────────────────

  it("saída e reentrada com forma desconhecida: escolhe cartão, sai, volta — nenhuma cobrança criada em momento nenhum", async () => {
    pedido("ped-r-12", {});
    await retomar("ped-r-12");
    await clicar(botaoExato("Cartão de crédito"), "Cartão de crédito");
    expect(create).toHaveBeenCalledTimes(1);

    sair();
    await retomar("ped-r-12");

    expect(hospedeiro.textContent).toContain(ESCOLHA);
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("saída e reentrada no PIX: cada volta pergunta à edge pelo MESMO pedido (ela devolve a MESMA cobrança)", async () => {
    pedido("ped-r-13", {
      metodo_online: "pix",
      gateway_payment_id: "ORD-PIX-13",
    });
    criarPagamento.mockResolvedValue(PIX_VIVO);
    await retomar("ped-r-13");
    sair();
    await retomar("ped-r-13");

    expect(criarPagamento).toHaveBeenCalledTimes(2);
    for (const [corpo] of criarPagamento.mock.calls) {
      expect(corpo).toEqual({ orderId: "ped-r-13", metodo: "pix" });
    }
    expect(create).not.toHaveBeenCalled();
  });
});
