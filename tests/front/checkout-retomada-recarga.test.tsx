// @vitest-environment jsdom
//
// O PIX PENDENTE SOBREVIVE À RECARGA (04/10/2026). Defeito medido na jornada
// de navegador: cliente com o QR do PIX na tela que recarregava a página caía
// num checkout VAZIO (R$ 0, sem QR, sem aviso) — o pedido vivia só na memória.
//
// O desenho: o CheckoutView guarda SÓ o id do pedido em pagamento no
// `sessionStorage` (chave por usuário); na recarga o App devolve esse id como
// `retomarPedidoId` + `retomadaDaRecarga` (o App tem teste próprio:
// checkout-recarga-no-app.test.tsx). Aqui o "App" é o próprio teste: lê o
// registro com o MESMO módulo e remonta o CheckoutView, como a recarga faz.
//
// Com o CheckoutView e o PagamentoOnline DE VERDADE (dublês: `createOrder`,
// `criarPagamento`, a leitura do banco e o SDK do Mercado Pago):
//   1. PIX pendente → recarga → MESMO pedido, MESMO QR; nenhum pedido novo, e
//      a única chamada à edge é a do MESMO pedido com a vaga já preenchida
//      (`gateway_payment_id`) — a que o servidor reconsulta, não cria.
//   2. Registro apontando para pedido de OUTRO usuário → descartado calado.
//   3. Pedido que não aparece (não existe / RLS) → descartado calado.
//   4. Pedido que não é de pagamento online → descartado calado.
//   5. Pago entre a saída e a volta → tela de confirmado, registro limpo.
//   6. Cartão em análise (order real na vaga) → verificação, nunca o
//      formulário que cobra de novo; registro mantido.
//   7. Na sessão: o PIX confirmado limpa o registro.
//   8. Storage lançando em toda operação → a compra segue (nada quebra).
//   9. Leitura com erro de rede na recarga → o aviso de sempre (não é calado).
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
import {
  chaveDoPedidoPendenteDoCheckout,
  guardarPedidoPendenteDoCheckout,
  lerPedidoPendenteDoCheckout,
} from "@/lib/pedido-pendente-do-checkout";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const { createOrder, criarPagamento } = vi.hoisted(() => ({
  createOrder: vi.fn(),
  criarPagamento: vi.fn(),
}));
const updateOrderStatus = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

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

const USUARIO = { id: "user-1", email: "cliente@exemplo.com" };
// Mutável: a troca de conta e o logout acontecem na MESMA instância.
let usuarioAtual: { id: string; email: string } | null = USUARIO;
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual, profile: null, loading: false }),
}));

function carrinhoCheio() {
  return [
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
}
let mockCart: unknown[] = [];
let mockCartTotal = 0;
let mockShippingFee = 0;
let mockSelectedShippingOption: Record<string, unknown> | null = null;
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

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus, criarPagamento }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return {
    useConfigDoCartao: () =>
      estadoPronto({ credito: true, debito: false, parcelasMax: 1 }),
  };
});

// O "banco": a linha do pedido, lida pela retomada (`maybeSingle`) e pela
// verificação periódica da tela (`single`). `erroDaLeitura` simula a rede.
const pedidos: Record<string, Record<string, unknown>> = {};
let erroDaLeitura: { message: string } | null = null;
// Leitura que o teste segura e solta quando quiser (ordem de chegada).
const leiturasAdiadas: Record<
  string,
  Promise<{ data: Record<string, unknown> | null; error: null }>
> = {};
const leiturasDaRetomada: string[] = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: (colunas: string) => ({
        eq: (_coluna: string, valor: string) => ({
          maybeSingle: () => {
            leiturasDaRetomada.push(colunas);
            // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (ids definidos neste arquivo).
            const adiada = leiturasAdiadas[valor];
            if (adiada) return adiada;
            return Promise.resolve(
              erroDaLeitura
                ? { data: null, error: erroDaLeitura }
                : // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (ids definidos neste arquivo).
                  { data: pedidos[valor] ?? null, error: null },
            );
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

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FINALIZE = "Finalize o pagamento";
const QR_DO_PEDIDO = "00020126-copia-e-cola-do-pedido";
const PIX_VIVO = {
  paymentId: "mp-pix-1",
  statusPagamento: "aguardando",
  expiraEm: new Date(Date.now() + 20 * 60_000).toISOString(),
  qrCode: QR_DO_PEDIDO,
  qrCodeBase64: "iVBORw0KGgo=",
};

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

function botaoQueContem(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function armazemDeTeste() {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
    clear: () => {
      dados.clear();
    },
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

function instalarSdkFalso() {
  const create = vi.fn(async () => ({ unmount: vi.fn() }));
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

describe("CheckoutView — o pagamento pendente sobrevive à recarga da página", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let sessao: ReturnType<typeof armazemDeTeste>;
  let create: ReturnType<typeof instalarSdkFalso>;

  beforeEach(() => {
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
    createOrder.mockReset().mockResolvedValue({ id: PEDIDO });
    criarPagamento.mockReset().mockResolvedValue(PIX_VIVO);
    updateOrderStatus.mockReset().mockResolvedValue(undefined);
    onNavigate.mockClear();
    erroDaLeitura = null;
    usuarioAtual = USUARIO;
    leiturasDaRetomada.length = 0;
    for (const chave of Object.keys(leiturasAdiadas)) {
      // eslint-disable-next-line security/detect-object-injection -- Limpando o dublê local entre testes.
      delete leiturasAdiadas[chave];
    }
    for (const chave of Object.keys(pedidos)) {
      // eslint-disable-next-line security/detect-object-injection -- Limpando o dublê local entre testes.
      delete pedidos[chave];
    }
    mockCart = [];
    mockCartTotal = 0;
    mockShippingFee = 0;
    mockSelectedShippingOption = null;
    const armazemLocal = armazemDeTeste();
    vi.stubGlobal("localStorage", armazemLocal);
    sessao = armazemDeTeste();
    vi.stubGlobal("sessionStorage", sessao);
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

  function linhaDoPedido(campos: Record<string, unknown> = {}) {
    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (PEDIDO, constante deste arquivo).
    pedidos[PEDIDO] = {
      user_id: USUARIO.id,
      total: 120,
      status: "pending",
      payment_status: "aguardando",
      gateway_payment_id: "mp-pix-1",
      metodo_online: "pix",
      expires_at: PIX_VIVO.expiraEm,
      ...campos,
    };
  }

  async function esvaziar(voltas = 6) {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await esperarMicrotarefas();
      });
    }
  }

  /** Sessão 1: carrinho → "Pagar agora com PIX" → Finalizar → QR na tela. */
  async function comprarComPix() {
    mockCart = carrinhoCheio();
    mockCartTotal = 100;
    mockShippingFee = 20;
    mockSelectedShippingOption = {
      id: "opt-mock",
      name: "Entrega Padrão",
      price: 20,
      deliveryDays: 3,
      provider: "flat_fee",
    };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esvaziar(1);
    await act(async () => {
      botaoQueContem("Pagar agora com PIX")!.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    await act(async () => {
      botaoQueContem("Finalizar Pedido")!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await esvaziar();
  }

  /**
   * A recarga: a página some (sem desmontar nada pelo React — o navegador só
   * descarta), e o App novo lê o registro e remonta o checkout com ele.
   */
  async function recarregar() {
    const raizVelha = raiz;
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    // A raiz velha sai do documento; desmontá-la aqui só evita vazamento
    // entre testes — o registro NÃO depende de desmontagem (nada limpa ao
    // desmontar), então o resultado é o mesmo da recarga real.
    act(() => {
      raizVelha.unmount();
    });
    const pedidoGuardado = lerPedidoPendenteDoCheckout(USUARIO.id);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
          retomarPedidoId={pedidoGuardado ?? undefined}
          retomadaDaRecarga={pedidoGuardado !== null}
        />,
      );
    });
    await esvaziar();
    return pedidoGuardado;
  }

  function semPagamentoNaTela() {
    expect(hospedeiro.textContent).not.toContain(FINALIZE);
    expect(hospedeiro.textContent).not.toContain(
      "Retomar o pagamento do pedido",
    );
    expect(hospedeiro.textContent).not.toContain(
      "Este pedido não está aguardando pagamento",
    );
    expect(hospedeiro.textContent).not.toContain(QR_DO_PEDIDO);
  }

  it("PIX pendente: a recarga volta ao MESMO pedido e ao MESMO QR, sem pedido novo nem cobrança nova", async () => {
    linhaDoPedido();
    await comprarComPix();

    // Sessão 1: o QR do pedido está na tela, e o registro guarda SÓ o id.
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain(FINALIZE);
    expect(hospedeiro.textContent).toContain(QR_DO_PEDIDO);
    expect([...sessao.dados.entries()]).toContainEqual([
      chaveDoPedidoPendenteDoCheckout(USUARIO.id),
      PEDIDO,
    ]);
    for (const valor of sessao.dados.values()) {
      expect(valor).not.toContain(QR_DO_PEDIDO);
      expect(valor).not.toContain("11144477735");
      expect(valor).not.toContain("cliente@exemplo.com");
    }

    createOrder.mockClear();
    criarPagamento.mockClear();
    const guardado = await recarregar();

    expect(guardado).toBe(PEDIDO);
    // O MESMO pedido, o MESMO QR.
    expect(hospedeiro.textContent).toContain(FINALIZE);
    expect(hospedeiro.textContent).toContain(QR_DO_PEDIDO);
    // Nenhum pedido novo; a única chamada à edge é a do MESMO pedido, cuja
    // vaga já tem a cobrança (`gateway_payment_id`) — o `podeCobrar` da edge
    // devolve "reconsultar" para ela, nunca "criar".
    expect(createOrder).not.toHaveBeenCalled();
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: PEDIDO,
      metodo: "pix",
    });
    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (PEDIDO, constante deste arquivo).
    expect(pedidos[PEDIDO].gateway_payment_id).toBe("mp-pix-1");
    // A leitura da recarga pede o dono do pedido.
    expect(leiturasDaRetomada.at(-1)).toContain("user_id");
    // O registro continua: recarregar de novo volta ao mesmo lugar.
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBe(PEDIDO);
  });

  it("registro apontando para pedido de OUTRO usuário: descartado calado, fluxo normal, nada cobra", async () => {
    // A RLS de `marketplace_orders` deixa o ADMIN ler pedido alheio — o dono
    // é conferido na própria linha, não só pela RLS.
    linhaDoPedido({ user_id: "user-2" });
    guardarPedidoPendenteDoCheckout(USUARIO.id, PEDIDO);

    await recarregar();

    semPagamentoNaTela();
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBeNull();
  });

  it("pedido que não aparece (não existe, ou a RLS esconde): descartado calado", async () => {
    guardarPedidoPendenteDoCheckout(USUARIO.id, PEDIDO);

    await recarregar();

    semPagamentoNaTela();
    expect(hospedeiro.textContent).not.toContain(
      "Não foi possível abrir o pagamento",
    );
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBeNull();
  });

  it("pedido que não é de pagamento online (entrega): descartado calado", async () => {
    linhaDoPedido({
      payment_status: null,
      metodo_online: null,
      gateway_payment_id: null,
    });
    guardarPedidoPendenteDoCheckout(USUARIO.id, PEDIDO);

    await recarregar();

    semPagamentoNaTela();
    expect(hospedeiro.textContent).not.toContain(
      "Como você quer pagar este pedido?",
    );
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBeNull();
  });

  it("pago entre a saída e a volta: a recarga mostra o pagamento confirmado e limpa o registro", async () => {
    linhaDoPedido({ payment_status: "pago", status: "processing" });
    guardarPedidoPendenteDoCheckout(USUARIO.id, PEDIDO);

    await recarregar();

    expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");
    expect(hospedeiro.textContent).toContain("R$ 120,00 recebido");
    expect(hospedeiro.textContent).not.toContain(FINALIZE);
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBeNull();
  });

  it("cancelado/expirado entre a saída e a volta: o aviso honesto da retomada, registro limpo, nada cobra", async () => {
    linhaDoPedido({ payment_status: "expirado", status: "cancelled" });
    guardarPedidoPendenteDoCheckout(USUARIO.id, PEDIDO);

    await recarregar();

    expect(hospedeiro.textContent).toContain(
      "Este pedido não está aguardando pagamento",
    );
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBeNull();
  });

  it("cartão em análise (order real na vaga): a recarga volta à VERIFICAÇÃO, nunca ao formulário que cobra de novo", async () => {
    linhaDoPedido({
      metodo_online: "credito",
      gateway_payment_id: "ORD01ABCDEF",
    });
    criarPagamento.mockReturnValue(new Promise(() => {}));
    guardarPedidoPendenteDoCheckout(USUARIO.id, PEDIDO);

    await recarregar();

    expect(hospedeiro.textContent).toContain("Situação do pagamento");
    expect(hospedeiro.textContent).not.toContain(FINALIZE);
    // Nenhum formulário de cartão montado, nenhum PIX criado: só a consulta.
    expect(create).not.toHaveBeenCalled();
    for (const [corpo] of criarPagamento.mock.calls) {
      expect(corpo).toEqual({ orderId: PEDIDO, metodo: "verificar" });
    }
    // A dúvida continua: recarregar de novo volta à mesma verificação.
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBe(PEDIDO);
  });

  it("na sessão: o PIX confirmado limpa o registro", async () => {
    linhaDoPedido();
    await comprarComPix();
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBe(PEDIDO);

    linhaDoPedido({ payment_status: "pago", status: "processing" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esvaziar();

    expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBeNull();
  });

  it("storage que lança em toda operação do registro: a compra segue até o QR, e a recarga cai no fluxo normal", async () => {
    // Lança em TODA operação deste registro (e nas de varredura, que só ele
    // usa). As outras chaves da sessão seguem funcionando: a chave da compra
    // (chave-do-pedido.ts) EXIGE storage por desenho — sem ela o pedido nem
    // nasce, e isso é anterior e alheio a esta mudança.
    const PREFIXO = chaveDoPedidoPendenteDoCheckout("");
    const explodeSeForDoRegistro = (chave: string) => {
      if (chave.startsWith(PREFIXO)) throw new Error("SecurityError");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => {
        explodeSeForDoRegistro(chave);
        return sessao.getItem(chave);
      },
      setItem: (chave: string, valor: string) => {
        explodeSeForDoRegistro(chave);
        sessao.setItem(chave, valor);
      },
      removeItem: (chave: string) => {
        explodeSeForDoRegistro(chave);
        sessao.removeItem(chave);
      },
      key: () => {
        throw new Error("SecurityError");
      },
      get length(): number {
        throw new Error("SecurityError");
      },
    });
    linhaDoPedido();
    await comprarComPix();

    expect(hospedeiro.textContent).toContain(QR_DO_PEDIDO);

    criarPagamento.mockClear();
    const guardado = await recarregar();

    expect(guardado).toBeNull();
    semPagamentoNaTela();
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("CONTROLE: erro de rede na leitura da recarga mostra o aviso de sempre (não descarta calado)", async () => {
    linhaDoPedido();
    erroDaLeitura = { message: "Failed to fetch" };
    guardarPedidoPendenteDoCheckout(USUARIO.id, PEDIDO);

    await recarregar();

    expect(hospedeiro.textContent).toContain(
      "Não foi possível abrir o pagamento deste pedido agora",
    );
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(lerPedidoPendenteDoCheckout(USUARIO.id)).toBe(PEDIDO);
  });

  // ── A confirmação pertence ao PEDIDO e ao USUÁRIO (revisão, 04/10/2026) ──
  // A mesma instância do CheckoutView (sem desmontar) recebendo outra
  // retomada ou outro usuário: a confirmação de A nunca aparece para B.

  const PEDIDO_B = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

  function linhaDoPedidoB(campos: Record<string, unknown> = {}) {
    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (PEDIDO_B, constante deste arquivo).
    pedidos[PEDIDO_B] = {
      user_id: USUARIO.id,
      total: 80,
      status: "pending",
      payment_status: "aguardando",
      gateway_payment_id: "mp-pix-b",
      metodo_online: "pix",
      expires_at: PIX_VIVO.expiraEm,
      ...campos,
    };
  }

  function adiarLeitura(id: string) {
    let soltar: (linha: Record<string, unknown> | null) => void = () => {};
    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (ids definidos neste arquivo).
    leiturasAdiadas[id] = new Promise((resolve) => {
      soltar = (linha) => resolve({ data: linha, error: null });
    });
    return (linha: Record<string, unknown> | null) => soltar(linha);
  }

  /** Re-renderiza a MESMA instância (sem `key`, sem desmontar). */
  async function renderizarNaMesmaInstancia(pedidoId: string | undefined) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
          retomarPedidoId={pedidoId}
          retomadaDaRecarga={pedidoId !== undefined}
        />,
      );
    });
    await esvaziar();
  }

  it("A pago → B pendente na mesma instância: nenhuma confirmação para B e nenhuma cobrança antes da leitura de B", async () => {
    linhaDoPedido({ payment_status: "pago", status: "processing" });
    await renderizarNaMesmaInstancia(PEDIDO);
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");

    linhaDoPedidoB();
    const soltarB = adiarLeitura(PEDIDO_B);
    await renderizarNaMesmaInstancia(PEDIDO_B);

    // A leitura de B ainda não voltou: nem a confirmação de A, nem cobrança.
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado!");
    expect(hospedeiro.textContent).not.toContain("recebido");
    expect(criarPagamento).not.toHaveBeenCalled();

    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (PEDIDO_B, constante deste arquivo).
    soltarB(pedidos[PEDIDO_B]);
    await esvaziar();

    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado!");
    expect(hospedeiro.textContent).toContain(FINALIZE);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: PEDIDO_B,
      metodo: "pix",
    });
  });

  it("leitura ATRASADA de A (pago) que chega depois de a retomada já ser B: não mostra confirmação", async () => {
    linhaDoPedido({ payment_status: "pago", status: "processing" });
    const soltarA = adiarLeitura(PEDIDO);
    await renderizarNaMesmaInstancia(PEDIDO);

    linhaDoPedidoB();
    const soltarB = adiarLeitura(PEDIDO_B);
    await renderizarNaMesmaInstancia(PEDIDO_B);

    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (PEDIDO, constante deste arquivo).
    soltarA(pedidos[PEDIDO]);
    await esvaziar();
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado!");
    expect(criarPagamento).not.toHaveBeenCalled();

    // eslint-disable-next-line security/detect-object-injection -- Chave fechada do dublê (PEDIDO_B, constante deste arquivo).
    soltarB(pedidos[PEDIDO_B]);
    await esvaziar();
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado!");
    expect(hospedeiro.textContent).toContain(FINALIZE);
  });

  it("troca de conta (A → B) e logout na mesma instância: a confirmação de A não vaza", async () => {
    linhaDoPedido({ payment_status: "pago", status: "processing" });
    await renderizarNaMesmaInstancia(PEDIDO);
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado!");

    // A releitura do pedido para o usuário novo fica SEGURA: o que decide a
    // tela nesse intervalo é a identidade da confirmação, não o descarte.
    adiarLeitura(PEDIDO);
    usuarioAtual = { id: "user-2", email: "outra@exemplo.com" };
    await renderizarNaMesmaInstancia(PEDIDO);
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado!");

    usuarioAtual = null;
    await renderizarNaMesmaInstancia(PEDIDO);
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado!");
    expect(criarPagamento).not.toHaveBeenCalled();
  });
});
