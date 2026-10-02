// @vitest-environment jsdom
//
// C6 / P2 (02/10/2026) — a VerificacaoDoPagamento no estado
// `desafio3ds` (order CONFIRMADA pelo GET do `verificar`: `paymentId` +
// `action_required`) mostra o desafio do banco SEM a saída "Pagar com PIX".
// A tela do cartão da própria sessão (PagamentoComCartao, etapa "desafio")
// oferece essa saída (achado A2), e o servidor sustenta a troca no ramo (f)
// de `criar-pagamento/index.ts`: cancela a order `action_required`/`created`
// no MP ANTES de criar o PIX, ou responde 409 `cartaoEmAnalise`.
//
// Andaime: o MESMO de checkout-retomada-verificacao.test.tsx (CheckoutView e
// VerificacaoDoPagamento DE VERDADE; PagamentoOnline é dublê contador —
// montar = poder cobrar).
//
// Os VERMELHOS provam a saída nova (no baseline c4d52d29 não existia o
// botão). Os de CONTROLE passavam no baseline e prendem as guardas: sem
// `paymentId` nunca PIX; prazo vencido nunca PIX; `sem_registro`/`em_analise`
// nunca PIX; servidor sem o `verificar` (C2) nunca PIX; nada cobra sem toque.
import { StrictMode, act } from "react";
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
      whatsappNumber: "34999998888",
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
const USUARIO = { id: "user-1" };
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
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus, criarPagamento }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

let linhaDoPedido: Record<string, unknown> | null = null;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn(() => new Promise(() => {})) },
    from: (_tabela: string) => ({
      select: (_colunas: string) => ({
        eq: (_coluna: string, _valor: string) => ({
          maybeSingle: () => Promise.resolve({ data: linhaDoPedido }),
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
let montagensDoPagamento = 0;
let propsDoPagamento: Record<string, unknown> | null = null;
vi.mock("@/components/checkout/PagamentoOnline", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/checkout/PagamentoOnline")
    >();
  return {
    ...real,
    PagamentoOnline: (props: Record<string, unknown>) => {
      montagensDoPagamento += 1;
      propsDoPagamento = props;
      return null;
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const SENTINELA = `verificando:${PEDIDO}:c0:pabcdef012345:1790943000000`;
const PRAZO_FUTURO = "2999-01-01T00:00:00.000Z";
const PRAZO_VENCIDO = "2001-01-01T00:00:00.000Z";
const URL_DO_DESAFIO = "https://www.mercadopago.com.br/3ds/desafio?x=1";
const LINHA_COM_SENTINELA = {
  total: 149.9,
  metodo_online: null,
  gateway_payment_id: SENTINELA,
  payment_status: "aguardando",
  status: "pending",
};

describe("C6/P2 — verificação em desafio3ds (order confirmada) oferece 'Pagar com PIX'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    criarPagamento.mockReset();
    onNavigate.mockReset();
    montagensDoPagamento = 0;
    propsDoPagamento = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function retomar(linha: Record<string, unknown>, estrito = false) {
    linhaDoPedido = linha;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    const tela = (
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={() => {}}
        retomarPedidoId={PEDIDO}
      />
    );
    await act(async () => {
      raiz.render(estrito ? <StrictMode>{tela}</StrictMode> : tela);
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === rotulo,
    );
  const chamadasPix = () =>
    criarPagamento.mock.calls.filter((c) => c[0]?.metodo === "pix").length;

  it("VERMELHO: sentinela adotada em 3DS (paymentId + desafio, antes do prazo) mostra o desafio E 'Pagar com PIX'; o toque troca para PIX marcando a cobrança incerta, sem cobrar antes do toque", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-ADOTADA",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    await retomar(LINHA_COM_SENTINELA);

    // O pré-requisito da prova: a consulta abriu o desafio de verdade.
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: PEDIDO,
      metodo: "verificar",
    });
    expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
      URL_DO_DESAFIO,
    );
    // Nada cobrou nem montou pagamento sozinho.
    expect(montagensDoPagamento).toBe(0);
    expect(chamadasPix()).toBe(0);

    // O DEFEITO: a saída do ramo (f) não existe nesta tela.
    expect(
      botao("Pagar com PIX"),
      "desafio3ds com order confirmada deveria oferecer 'Pagar com PIX' (ramo f)",
    ).toBeDefined();

    // O desenho: o toque é a ÚNICA coisa que liga o PIX, no MESMO pedido, e
    // a cobrança fica incerta POR PEDIDO (o cartão estava vivo no toque).
    await act(async () => {
      botao("Pagar com PIX")?.click();
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(montagensDoPagamento).toBeGreaterThan(0);
    expect(propsDoPagamento?.metodo).toBe("pix");
    expect(propsDoPagamento?.orderId).toBe(PEDIDO);
    expect(propsDoPagamento?.cobrancaIncerta).toBe(true);
    // A verificação não faz POST de PIX por conta própria (quem cria é o
    // PagamentoComPix ao montar — aqui um dublê).
    expect(chamadasPix()).toBe(0);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: desafio3ds SEM paymentId não abre desafio nem oferece PIX", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: null,
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    await retomar(LINHA_COM_SENTINELA);
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(montagensDoPagamento).toBe(0);
  });

  it("CONTROLE: desafio3ds com o prazo do pedido VENCIDO não oferece PIX (o servidor responderia 409 terminal)", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-ADOTADA",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_VENCIDO,
    });
    await retomar(LINHA_COM_SENTINELA);
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(montagensDoPagamento).toBe(0);
  });

  for (const resposta of [
    {
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
      canceladoAutomaticamenteAte: "2026-10-03T15:00:00.000Z",
    },
    {
      verificacao: "em_analise",
      paymentId: "ORD-VIVA",
      expiraEm: PRAZO_FUTURO,
    },
  ]) {
    it(`CONTROLE: ${resposta.verificacao} nunca oferece PIX`, async () => {
      criarPagamento.mockResolvedValue(resposta);
      await retomar(LINHA_COM_SENTINELA);
      expect(botao("Pagar com PIX")).toBeUndefined();
      expect(montagensDoPagamento).toBe(0);
    });
  }

  it("VERMELHO (StrictMode): UMA consulta, o desafio com 'Pagar com PIX', e o toque troca para PIX marcando a cobrança incerta", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-ADOTADA",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    await retomar(LINHA_COM_SENTINELA, true);
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(botao("Pagar com PIX")).toBeDefined();
    await act(async () => {
      botao("Pagar com PIX")?.click();
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(propsDoPagamento?.metodo).toBe("pix");
    expect(propsDoPagamento?.cobrancaIncerta).toBe(true);
    expect(chamadasPix()).toBe(0);
  });

  it("VERMELHO (relógio): o botão existe antes do prazo e SOME quando o prazo do pedido passa — o desafio continua", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-ADOTADA",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: new Date(Date.now() + 400).toISOString(),
    });
    await retomar(LINHA_COM_SENTINELA);
    expect(botao("Pagar com PIX")).toBeDefined();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(hospedeiro.querySelector("iframe")?.getAttribute("src")).toBe(
      URL_DO_DESAFIO,
    );
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(montagensDoPagamento).toBe(0);
  });

  it("CONTROLE (servidor sem C2): o 'verificar' recusado com 400 nunca chega ao desafio — sem PIX", async () => {
    criarPagamento.mockRejectedValue(
      Object.assign(new Error("Forma de pagamento inválida."), {
        terminal: false,
        cartaoEmAnalise: false,
      }),
    );
    await retomar(LINHA_COM_SENTINELA);
    expect(hospedeiro.textContent).toContain(
      "Não foi possível consultar o pagamento agora.",
    );
    expect(hospedeiro.querySelector("iframe")).toBeNull();
    expect(botao("Pagar com PIX")).toBeUndefined();
    expect(montagensDoPagamento).toBe(0);
  });

  it("VERMELHO (na sessão): erro ambíguo do cartão abre a verificação, que acha o 3DS vivo; 'Pagar com PIX' troca para PIX, limpa o erro e marca a cobrança incerta", async () => {
    // Retomada de cartão conhecido (vaga com a order): monta o pagamento
    // em modo cartão — aqui o dublê, que devolve o erro ambíguo.
    await retomar({
      total: 149.9,
      metodo_online: "credito",
      gateway_payment_id: "ORD-3DS-VIVA",
      payment_status: "aguardando",
      status: "pending",
    });
    expect(propsDoPagamento?.metodo).toBe("cartao");
    criarPagamento.mockResolvedValue({
      verificacao: "desafio3ds",
      paymentId: "ORD-3DS-VIVA",
      desafio3ds: { url: URL_DO_DESAFIO },
      expiraEm: PRAZO_FUTURO,
    });
    const onErro = propsDoPagamento?.onErro as (
      msg: string,
      categoria: string,
      sinal?: string,
    ) => void;
    await act(async () => {
      onErro(
        "Há um pagamento com cartão em análise para este pedido.",
        "recuperavel",
        "cartaoEmAnalise",
      );
    });
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(criarPagamento).toHaveBeenCalledTimes(1);
    expect(criarPagamento.mock.calls[0][0]).toEqual({
      orderId: PEDIDO,
      metodo: "verificar",
    });
    expect(hospedeiro.querySelector("iframe")).not.toBeNull();
    const montagensAntes = montagensDoPagamento;

    expect(botao("Pagar com PIX")).toBeDefined();
    await act(async () => {
      botao("Pagar com PIX")?.click();
    });
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(montagensDoPagamento).toBeGreaterThan(montagensAntes);
    expect(propsDoPagamento?.metodo).toBe("pix");
    expect(propsDoPagamento?.orderId).toBe(PEDIDO);
    expect(propsDoPagamento?.cobrancaIncerta).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Situação do pagamento");
    expect(hospedeiro.textContent).not.toContain(
      "Não conseguimos confirmar se a tentativa",
    );
    expect(chamadasPix()).toBe(0);
  });
});
