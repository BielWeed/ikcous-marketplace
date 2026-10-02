// @vitest-environment jsdom
//
// Bug do teste real da 1.5.14/1.5.15 (02/10/2026): na RETOMADA de pagamento
// com forma desconhecida, a tela "Como você quer pagar este pedido?" mostrava
// só "Pagar com PIX" enquanto a config do cartão ainda carregava — o cliente
// que escolheu cartão via uma lista PARCIAL como se fosse a final. E erro de
// leitura parecia "cartão desligado". O `null` de `useConfigDoCartao` misturava
// carregando, falha, desligado de verdade e loja sem Public Key.
//
// O que este arquivo prende, com o CheckoutView, o hook `useConfigDoCartao`,
// a leitura `lerConfigDoCartao`, o PagamentoOnline e o PagamentoComCartao DE
// VERDADE (dublês só nas bordas: `supabase` — onde a leitura da config é
// SEGURADA no ar pelo teste —, o SDK do Mercado Pago e `criarPagamento`):
//   RETOMADA
//     1. carregando: indicador e NENHUM botão de forma (nem PIX); resolve →
//        cartão + PIX.
//     2. erro: frase de erro + "Tentar de novo" + "Pagar com PIX" explícito;
//        o cartão NÃO some como se estivesse desligado.
//     3. tentar de novo: volta a carregando e, com sucesso, mostra o cartão.
//     4. desligado de verdade: só PIX, sem indicador nem "tentar de novo".
//     5. nada é cobrado sem toque em estado nenhum.
//   CHECKOUT NORMAL
//     6. a opção de cartão aparece como "carregando" (não some), vira erro com
//        "Tentar de novo" ou vira a opção normal; desligado de verdade segue
//        sem cartão.
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
import { esquecerConfigDoCartao } from "@/lib/config-do-cartao";

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
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: undefined,
    },
    isLoaded: true,
  }),
}));

// Identidades ESTÁVEIS: efeitos do CheckoutView dependem delas.
const ENDERECOS = [
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
];
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: ENDERECOS,
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

const item = () => ({
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
});

const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 20,
  deliveryDays: 1,
  provider: "local",
};

// Retomada nasce com carrinho VAZIO (o pedido já existe); o checkout normal
// com um item e entrega local. Cada bloco ajusta isto no `beforeEach`.
let mockCart: ReturnType<typeof item>[] = [];
let mockCartTotal = 0;
let mockShippingFee = 0;
let mockSelectedShippingOption: typeof ENTREGA_LOCAL | null = null;
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: mockShippingFee,
      clearCart: () => {},
      addToCart: () => {},
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: null,
      setSelectedShippingOption: (opt: typeof mockSelectedShippingOption) => {
        mockSelectedShippingOption = opt;
      },
      setShippingCep: vi.fn(),
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
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// O "banco". A leitura da config do cartão é um GANCHO que o teste segura no
// ar (`leituraDoCartao`); o resto é a linha de cada pedido, lida pela
// retomada (`maybeSingle`) e pela verificação periódica da tela (`single`).
type RespostaDoBanco = {
  data: unknown;
  error: { message: string } | null;
};
let leituraDoCartao: () => Promise<RespostaDoBanco> = () =>
  Promise.resolve({ data: null, error: null });
const leiturasDoCartao = vi.fn();
const pedidos: Record<string, Record<string, unknown>> = {};
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: (_coluna: string, valor: string) => ({
          maybeSingle: () => {
            if (tabela === "config_pagamento_cartao") {
              leiturasDoCartao();
              return leituraDoCartao();
            }
            return Promise.resolve({
              // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (ids definidos neste arquivo).
              data: pedidos[valor] ?? null,
              error: null,
            });
          },
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ESCOLHA = "Como você quer pagar este pedido?";
const CARREGANDO_RETOMADA = "Carregando formas de pagamento…";
const ERRO_RETOMADA =
  "Não foi possível conferir se o cartão está disponível agora.";
const CARTAO_CARREGANDO = "Cartão: carregando…";
const CARTAO_ERRO = "Cartão: não foi possível conferir agora.";
const FINALIZE = "Finalize o pagamento";
const CARREGANDO_CARTAO_DO_PEDIDO = "Carregando o pagamento com cartão…";
const ERRO_CARTAO_DO_PEDIDO =
  "Não foi possível conferir o pagamento com cartão agora.";
const INDISPONIVEL = "O pagamento com cartão não está disponível nesta loja";
const CREDITO_6X = { credito: true, debito: false, parcelas_max: 6 };

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

/** Uma leitura que o teste solta quando quiser. */
function leituraAdiada() {
  let resolver!: (valor: RespostaDoBanco) => void;
  const promessa = new Promise<RespostaDoBanco>((res) => {
    resolver = res;
  });
  leituraDoCartao = () => promessa;
  return resolver;
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

describe("CheckoutView — a config do cartao tem estado: carregando, erro e desligado sao coisas diferentes", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    esquecerConfigDoCartao();
    leiturasDoCartao.mockReset();
    leituraDoCartao = () => Promise.resolve({ data: null, error: null });
    criarPagamento.mockReset().mockResolvedValue(PIX_VIVO);
    createOrder.mockReset().mockResolvedValue({ id: "ped-777" });
    onNavigate.mockClear();
    mockCart = [];
    mockCartTotal = 0;
    mockShippingFee = 0;
    mockSelectedShippingOption = null;
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
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    esquecerConfigDoCartao();
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function pedido(id: string, campos: Record<string, unknown> = {}) {
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

  async function assentar(vezes = 3) {
    for (let i = 0; i < vezes; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
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
    await assentar(4);
  }

  async function montarCheckoutNormal() {
    mockCart = [item()];
    mockCartTotal = 100;
    mockShippingFee = 20;
    mockSelectedShippingOption = { ...ENTREGA_LOCAL };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await assentar(2);
  }

  async function clicar(botao: HTMLButtonElement | undefined, nome: string) {
    expect(botao, `o botão '${nome}' deveria estar na tela`).toBeDefined();
    await act(async () => {
      botao!.click();
      await esperarMicrotarefas();
    });
    await assentar(1);
  }

  async function soltar(
    resolver: (valor: RespostaDoBanco) => void,
    valor: RespostaDoBanco,
  ) {
    await act(async () => {
      resolver(valor);
    });
    await assentar(2);
  }

  const botoesDeForma = () =>
    [...document.body.querySelectorAll("button")].map((b) =>
      b.textContent?.trim(),
    );

  // ── RETOMADA (forma desconhecida) ────────────────────────────────────────

  describe("retomada de pagamento com forma desconhecida", () => {
    it("config CARREGANDO: indicador e NENHUM botão de forma (nem PIX); resolvida, aparecem cartão + PIX", async () => {
      pedido("ped-c-01");
      const resolver = leituraAdiada();
      await retomar("ped-c-01");

      expect(hospedeiro.textContent).toContain(ESCOLHA);
      expect(hospedeiro.textContent).toContain(CARREGANDO_RETOMADA);
      expect(botaoExato("Pagar com PIX")).toBeUndefined();
      expect(botaoQueContem("Cartão")).toBeUndefined();
      expect(botoesDeForma()).toEqual([]);
      expect(criarPagamento).not.toHaveBeenCalled();

      await soltar(resolver, { data: CREDITO_6X, error: null });

      expect(hospedeiro.textContent).not.toContain(CARREGANDO_RETOMADA);
      expect(botaoExato("Cartão de crédito")).toBeDefined();
      expect(botaoExato("Pagar com PIX")).toBeDefined();
      expect(criarPagamento).not.toHaveBeenCalled();
    });

    it("ERRO de leitura: diz que não conseguiu conferir, oferece 'Tentar de novo' e 'Pagar com PIX' — e NÃO some com o cartão como se estivesse desligado", async () => {
      pedido("ped-c-02");
      leituraDoCartao = () =>
        Promise.resolve({ data: null, error: { message: "sem rede" } });
      await retomar("ped-c-02");

      expect(hospedeiro.textContent).toContain(ESCOLHA);
      expect(hospedeiro.textContent).toContain(ERRO_RETOMADA);
      expect(botaoExato("Tentar de novo")).toBeDefined();
      expect(botaoExato("Pagar com PIX")).toBeDefined();
      expect(hospedeiro.textContent).not.toContain(CARREGANDO_RETOMADA);
      expect(botaoQueContem("Cartão")).toBeUndefined();
      expect(criarPagamento).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("erro → 'Tentar de novo' volta a carregando (sem botão de forma) e, com sucesso, mostra o cartão; escolher o cartão abre o formulário sem chamar a edge", async () => {
      pedido("ped-c-03");
      leituraDoCartao = () =>
        Promise.resolve({ data: null, error: { message: "sem rede" } });
      await retomar("ped-c-03");
      expect(hospedeiro.textContent).toContain(ERRO_RETOMADA);
      expect(leiturasDoCartao).toHaveBeenCalledTimes(1);

      const resolver = leituraAdiada();
      await clicar(botaoExato("Tentar de novo"), "Tentar de novo");

      expect(leiturasDoCartao).toHaveBeenCalledTimes(2);
      expect(hospedeiro.textContent).toContain(CARREGANDO_RETOMADA);
      expect(hospedeiro.textContent).not.toContain(ERRO_RETOMADA);
      expect(botoesDeForma()).toEqual([]);

      await soltar(resolver, { data: CREDITO_6X, error: null });

      expect(botaoExato("Cartão de crédito")).toBeDefined();
      expect(botaoExato("Pagar com PIX")).toBeDefined();
      expect(botaoExato("Tentar de novo")).toBeUndefined();

      await clicar(botaoExato("Cartão de crédito"), "Cartão de crédito");
      expect(hospedeiro.textContent).toContain(FINALIZE);
      expect(create).toHaveBeenCalledTimes(1);
      expect(criarPagamento).not.toHaveBeenCalled();
    });

    it("erro → 'Pagar com PIX' é a troca EXPLÍCITA: só o toque chama a edge, UMA vez, pelo MESMO pedido", async () => {
      pedido("ped-c-04");
      leituraDoCartao = () =>
        Promise.resolve({ data: null, error: { message: "sem rede" } });
      await retomar("ped-c-04");
      expect(criarPagamento).not.toHaveBeenCalled();

      await clicar(botaoExato("Pagar com PIX"), "Pagar com PIX");

      expect(criarPagamento).toHaveBeenCalledTimes(1);
      expect(criarPagamento.mock.calls[0][0]).toEqual({
        orderId: "ped-c-04",
        metodo: "pix",
      });
      expect(create).not.toHaveBeenCalled();
    });

    it("cartão desligado DE VERDADE (linha ausente): só PIX — sem indicador de carregando e sem 'Tentar de novo'", async () => {
      pedido("ped-c-05");
      leituraDoCartao = () => Promise.resolve({ data: null, error: null });
      await retomar("ped-c-05");

      expect(hospedeiro.textContent).toContain(ESCOLHA);
      expect(hospedeiro.textContent).not.toContain(CARREGANDO_RETOMADA);
      expect(hospedeiro.textContent).not.toContain(ERRO_RETOMADA);
      expect(botaoExato("Tentar de novo")).toBeUndefined();
      expect(botaoQueContem("Cartão")).toBeUndefined();
      expect(botaoExato("Pagar com PIX")).toBeDefined();
      expect(criarPagamento).not.toHaveBeenCalled();
    });

    it("crédito e débito desligados na linha: também só PIX", async () => {
      pedido("ped-c-06");
      leituraDoCartao = () =>
        Promise.resolve({
          data: { credito: false, debito: false, parcelas_max: 3 },
          error: null,
        });
      await retomar("ped-c-06");

      expect(botaoQueContem("Cartão")).toBeUndefined();
      expect(botaoExato("Tentar de novo")).toBeUndefined();
      expect(botaoExato("Pagar com PIX")).toBeDefined();
    });

    it("loja SEM Public Key: só PIX de imediato — nem passa por 'carregando' nem vai ao banco ler o cartão", async () => {
      vi.stubEnv("VITE_MP_PUBLIC_KEY", "");
      pedido("ped-c-07");
      const resolver = leituraAdiada();
      await retomar("ped-c-07");

      expect(hospedeiro.textContent).not.toContain(CARREGANDO_RETOMADA);
      expect(botaoQueContem("Cartão")).toBeUndefined();
      expect(botaoExato("Pagar com PIX")).toBeDefined();
      resolver({ data: CREDITO_6X, error: null });
    });
  });

  // ── RETOMADA COM CARTÃO JÁ CONHECIDO ─────────────────────────────────────
  // Com o método do pedido conhecido o PagamentoOnline monta direto; mas ele
  // recebe `null` enquanto a config não está pronta, e `null` faz ele dizer
  // "cartão não está disponível nesta loja" — em erro, para sempre. Enquanto a
  // config não está pronta, o CheckoutView NÃO monta o PagamentoOnline.

  describe("retomada com cartão JÁ conhecido (metodo_online = credito)", () => {
    // Lacuna L2 (02/10/2026): vaga VAZIA (a cobrança anterior já foi solta) —
    // com o id real da order na vaga, a retomada consulta antes (`verificar`)
    // e não chega à config do cartão. O que estes testes provam é a config.
    const pedidoDeCartao = (id: string) =>
      pedido(id, { metodo_online: "credito", gateway_payment_id: null });

    it("config CARREGANDO: indicador no lugar do pagamento — sem Brick, sem edge, sem 'não está disponível', sem PIX de saída; resolvida, o Brick monta com crédito", async () => {
      pedidoDeCartao("ped-k-01");
      const resolver = leituraAdiada();
      await retomar("ped-k-01");

      expect(hospedeiro.textContent).toContain(FINALIZE);
      expect(hospedeiro.textContent).toContain(CARREGANDO_CARTAO_DO_PEDIDO);
      expect(hospedeiro.textContent).not.toContain(INDISPONIVEL);
      expect(botaoQueContem("Pagar com PIX")).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
      expect(criarPagamento).not.toHaveBeenCalled();

      await soltar(resolver, { data: CREDITO_6X, error: null });

      expect(hospedeiro.textContent).not.toContain(CARREGANDO_CARTAO_DO_PEDIDO);
      expect(hospedeiro.textContent).not.toContain(INDISPONIVEL);
      expect(create).toHaveBeenCalledTimes(1);
      expect(
        create.mock.calls[0][2].customization.paymentMethods.types,
      ).toEqual({ included: ["credit_card"] });
      expect(criarPagamento).not.toHaveBeenCalled();
    });

    it("ERRO de leitura: 'não foi possível conferir' + 'Tentar de novo' (sem PIX automático, sem 'não está disponível'); tentar de novo com sucesso monta o Brick", async () => {
      pedidoDeCartao("ped-k-02");
      leituraDoCartao = () =>
        Promise.resolve({ data: null, error: { message: "sem rede" } });
      await retomar("ped-k-02");

      expect(hospedeiro.textContent).toContain(ERRO_CARTAO_DO_PEDIDO);
      expect(botaoExato("Tentar de novo")).toBeDefined();
      expect(hospedeiro.textContent).not.toContain(INDISPONIVEL);
      expect(hospedeiro.textContent).not.toContain(CARREGANDO_CARTAO_DO_PEDIDO);
      expect(botaoQueContem("Pagar com PIX")).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
      expect(criarPagamento).not.toHaveBeenCalled();

      const resolver = leituraAdiada();
      await clicar(botaoExato("Tentar de novo"), "Tentar de novo");
      expect(hospedeiro.textContent).toContain(CARREGANDO_CARTAO_DO_PEDIDO);
      expect(hospedeiro.textContent).not.toContain(ERRO_CARTAO_DO_PEDIDO);
      expect(create).not.toHaveBeenCalled();

      await soltar(resolver, { data: CREDITO_6X, error: null });

      expect(create).toHaveBeenCalledTimes(1);
      expect(botaoExato("Tentar de novo")).toBeUndefined();
      expect(hospedeiro.textContent).not.toContain(INDISPONIVEL);
      expect(criarPagamento).not.toHaveBeenCalled();
    });

    it("cartão desligado DE VERDADE: o aviso de hoje ('não está disponível'), sem indicador — o desligamento real não virou 'carregando'", async () => {
      pedidoDeCartao("ped-k-03");
      leituraDoCartao = () => Promise.resolve({ data: null, error: null });
      await retomar("ped-k-03");

      expect(hospedeiro.textContent).toContain(INDISPONIVEL);
      expect(hospedeiro.textContent).not.toContain(CARREGANDO_CARTAO_DO_PEDIDO);
      expect(hospedeiro.textContent).not.toContain(ERRO_CARTAO_DO_PEDIDO);
      expect(create).not.toHaveBeenCalled();
      expect(criarPagamento).not.toHaveBeenCalled();
    });

    it("PIX conhecido com a config ainda carregando: o PIX segue normal (não depende dessa leitura) e nenhum indicador de cartão aparece", async () => {
      pedido("ped-k-04", {
        metodo_online: "pix",
        gateway_payment_id: "ORD-PIX",
      });
      leituraAdiada();
      await retomar("ped-k-04");

      expect(hospedeiro.textContent).not.toContain(CARREGANDO_CARTAO_DO_PEDIDO);
      expect(hospedeiro.textContent).not.toContain(ERRO_CARTAO_DO_PEDIDO);
      expect(hospedeiro.textContent).not.toContain(INDISPONIVEL);
      expect(criarPagamento).toHaveBeenCalledTimes(1);
      expect(criarPagamento.mock.calls[0][0]).toEqual({
        orderId: "ped-k-04",
        metodo: "pix",
      });
      expect(create).not.toHaveBeenCalled();
    });
  });

  // ── CHECKOUT NORMAL ──────────────────────────────────────────────────────

  describe("lista de formas do checkout normal", () => {
    const grupo = () => hospedeiro.querySelector('[role="radiogroup"]')!;

    it("config CARREGANDO: a opção de cartão aparece como 'carregando' (não some) e o PIX segue normal; resolvida, vira a opção do cartão", async () => {
      const resolver = leituraAdiada();
      await montarCheckoutNormal();

      expect(grupo().textContent).toContain("Pagar agora com PIX");
      expect(grupo().textContent).toContain(CARTAO_CARREGANDO);
      expect(grupo().querySelector('[role="status"]')).not.toBeNull();
      expect(grupo().textContent).not.toContain("Cartão de crédito");

      await soltar(resolver, { data: CREDITO_6X, error: null });

      expect(grupo().textContent).not.toContain(CARTAO_CARREGANDO);
      expect(grupo().querySelector('[role="status"]')).toBeNull();
      expect(botaoQueContem("Cartão de crédito")).toBeDefined();
    });

    it("ERRO de leitura: indicador do cartão com 'Tentar de novo' (PIX segue); tentar de novo com sucesso vira a opção do cartão", async () => {
      leituraDoCartao = () =>
        Promise.resolve({ data: null, error: { message: "sem rede" } });
      await montarCheckoutNormal();

      expect(grupo().textContent).toContain("Pagar agora com PIX");
      expect(grupo().textContent).toContain(CARTAO_ERRO);
      expect(grupo().textContent).not.toContain(CARTAO_CARREGANDO);
      expect(botaoQueContem("Cartão de crédito")).toBeUndefined();

      leituraDoCartao = () =>
        Promise.resolve({ data: CREDITO_6X, error: null });
      await clicar(botaoExato("Tentar de novo"), "Tentar de novo");
      await assentar(2);

      expect(grupo().textContent).not.toContain(CARTAO_ERRO);
      expect(botaoExato("Tentar de novo")).toBeUndefined();
      expect(botaoQueContem("Cartão de crédito")).toBeDefined();
    });

    it("cartão desligado DE VERDADE: sem opção de cartão, sem indicador, sem 'Tentar de novo' (o desligamento real é respeitado)", async () => {
      leituraDoCartao = () => Promise.resolve({ data: null, error: null });
      await montarCheckoutNormal();

      expect(grupo().textContent).toContain("Pagar agora com PIX");
      expect(grupo().textContent).not.toMatch(/Cartão de (crédito|débito)/);
      expect(grupo().textContent).not.toContain(CARTAO_CARREGANDO);
      expect(grupo().textContent).not.toContain(CARTAO_ERRO);
      expect(botaoExato("Tentar de novo")).toBeUndefined();
    });

    it("o indicador não é uma forma escolhível: carregando não cria nenhum 'radio' de cartão e nada é cobrado nem criado", async () => {
      leituraAdiada();
      await montarCheckoutNormal();

      const radios = [...grupo().querySelectorAll('[role="radio"]')].map((r) =>
        r.textContent?.trim(),
      );
      expect(radios.some((texto) => texto?.includes("Cartão de"))).toBe(false);
      expect(createOrder).not.toHaveBeenCalled();
      expect(criarPagamento).not.toHaveBeenCalled();
    });
  });

  // ── ACESSIBILIDADE ───────────────────────────────────────────────────────
  // Revisão independente (02/10/2026): o leitor de tela precisa OUVIR a
  // troca. "Carregando" mora numa região viva educada; a falha é
  // `role="alert"`, que o leitor anuncia assim que o elemento entra na tela —
  // um `<p>` comum (ou um `role="status"` que já nasce preenchido) passava em
  // silêncio.

  describe("acessibilidade dos indicadores do cartão", () => {
    const vivoEducado = (texto: string) =>
      [
        ...hospedeiro.querySelectorAll('[role="status"][aria-live="polite"]'),
      ].some((e) => e.textContent?.includes(texto));
    const alerta = (texto: string) =>
      [...hospedeiro.querySelectorAll('[role="alert"]')].some((e) =>
        e.textContent?.includes(texto),
      );

    it("retomada com forma desconhecida: carregando em região viva educada; a falha é anunciada como alerta", async () => {
      pedido("ped-a-01");
      const resolver = leituraAdiada();
      await retomar("ped-a-01");
      expect(vivoEducado(CARREGANDO_RETOMADA)).toBe(true);
      expect(alerta(ERRO_RETOMADA)).toBe(false);

      await soltar(resolver, { data: null, error: { message: "sem rede" } });
      expect(alerta(ERRO_RETOMADA)).toBe(true);
    });

    it("pedido de cartão conhecido: carregando em região viva educada; a falha é anunciada como alerta", async () => {
      // Lacuna L2: vaga vazia (ver `pedidoDeCartao`, acima).
      pedido("ped-a-02", {
        metodo_online: "credito",
        gateway_payment_id: null,
      });
      const resolver = leituraAdiada();
      await retomar("ped-a-02");
      expect(vivoEducado(CARREGANDO_CARTAO_DO_PEDIDO)).toBe(true);
      expect(alerta(ERRO_CARTAO_DO_PEDIDO)).toBe(false);

      await soltar(resolver, { data: null, error: { message: "sem rede" } });
      expect(alerta(ERRO_CARTAO_DO_PEDIDO)).toBe(true);
    });

    it("checkout normal: carregando em região viva educada; a falha é anunciada como alerta", async () => {
      const resolver = leituraAdiada();
      await montarCheckoutNormal();
      expect(vivoEducado(CARTAO_CARREGANDO)).toBe(true);
      expect(alerta(CARTAO_ERRO)).toBe(false);

      await soltar(resolver, { data: null, error: { message: "sem rede" } });
      expect(alerta(CARTAO_ERRO)).toBe(true);
    });
  });
});
