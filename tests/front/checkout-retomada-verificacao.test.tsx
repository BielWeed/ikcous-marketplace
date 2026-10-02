// @vitest-environment jsdom
//
// C4 (M1, 02/10/2026) — a retomada de um pedido com a vaga em SENTINELA
// (`verificando:...`, cartão em dúvida). Prova do defeito no baseline
// (scratchpad recuperacao/A1/saida_front.txt): a tela não chamava nada e só
// oferecia "Ver meus pedidos" com uma promessa falsa. Aqui, com o CheckoutView
// e a VerificacaoDoPagamento DE VERDADE (o PagamentoOnline é dublê contador —
// montar = poder cobrar):
//   1. Sentinela: UMA consulta `verificar`, nada de pagamento montado.
//   2. A consulta libera a vaga (livre/recusado/pix): a retomada vai para a
//      ESCOLHA da forma — nenhuma cobrança sem toque do cliente.
//   3. "Falar com a loja" leva o número do pedido retomado.
//   4. Controle: pedido PIX comum não passa pela consulta.
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
let whatsappDaLoja: string | undefined = "34999998888";
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: whatsappDaLoja,
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

describe("CheckoutView — retomada com cartão em dúvida passa pela consulta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    criarPagamento.mockReset();
    onNavigate.mockReset();
    montagensDoPagamento = 0;
    propsDoPagamento = null;
    whatsappDaLoja = "34999998888";
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

  async function retomar(linha: Record<string, unknown>) {
    linhaDoPedido = linha;
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
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
  const botoes = () =>
    Array.from(hospedeiro.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").trim(),
    );
  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === rotulo,
    );

  for (const metodo_online of [null, "credito"]) {
    it(`sentinela (metodo_online=${metodo_online}): UMA consulta 'verificar', nenhum pagamento montado, e o texto não promete mudança sozinha`, async () => {
      criarPagamento.mockResolvedValue({
        verificacao: "sem_registro",
        paymentId: null,
        expiraEm: PRAZO_FUTURO,
        canceladoAutomaticamenteAte: "2026-10-03T15:00:00.000Z",
      });
      await retomar({
        total: 149.9,
        metodo_online,
        gateway_payment_id: SENTINELA,
        payment_status: "aguardando",
        status: "pending",
      });
      expect(criarPagamento).toHaveBeenCalledTimes(1);
      expect(criarPagamento.mock.calls[0][0]).toEqual({
        orderId: PEDIDO,
        metodo: "verificar",
      });
      expect(montagensDoPagamento).toBe(0);
      expect(hospedeiro.textContent).toContain(
        "Não conseguimos confirmar com o banco",
      );
      expect(hospedeiro.textContent).not.toContain("daqui a alguns minutos");
      expect(hospedeiro.textContent).not.toContain("Finalize o pagamento");
      expect(botoes()).toEqual([
        "Falar com a loja",
        "Verificar de novo",
        "Ver meus pedidos",
      ]);
    });
  }

  it("'Falar com a loja' abre o WhatsApp da loja com o número do pedido RETOMADO (noopener)", async () => {
    const abrir = vi.spyOn(globalThis, "open").mockReturnValue(null);
    criarPagamento.mockResolvedValue({
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
      canceladoAutomaticamenteAte: "2026-10-03T15:00:00.000Z",
    });
    await retomar({
      total: 149.9,
      metodo_online: null,
      gateway_payment_id: SENTINELA,
      payment_status: "aguardando",
      status: "pending",
    });
    act(() => {
      botao("Falar com a loja")?.click();
    });
    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0];
    expect(String(url)).toContain("https://wa.me/5534999998888?text=");
    expect(decodeURIComponent(String(url))).toContain(
      `#${PEDIDO.slice(-6).toUpperCase()}`,
    );
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
  });

  it("'Ver meus pedidos' navega para os pedidos", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "em_analise",
      paymentId: "ORD-VIVA-1",
      expiraEm: PRAZO_FUTURO,
    });
    await retomar({
      total: 149.9,
      metodo_online: null,
      gateway_payment_id: SENTINELA,
      payment_status: "aguardando",
      status: "pending",
    });
    act(() => {
      botao("Ver meus pedidos")?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("orders");
  });

  for (const verificacao of ["livre", "pix"] as const) {
    it(`consulta responde ${verificacao}: a retomada vai para a ESCOLHA da forma — nada monta, nada cobra sem toque`, async () => {
      criarPagamento.mockResolvedValue({
        verificacao,
        paymentId: verificacao === "pix" ? "123456789" : null,
        expiraEm: PRAZO_FUTURO,
      });
      await retomar({
        total: 149.9,
        metodo_online: "credito",
        gateway_payment_id: SENTINELA,
        payment_status: "aguardando",
        status: "pending",
      });
      expect(hospedeiro.textContent).toContain(
        "Como você quer pagar este pedido?",
      );
      expect(hospedeiro.textContent).not.toContain("não foi aprovado");
      expect(hospedeiro.textContent).not.toContain("não foi concluído");
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
      expect(montagensDoPagamento).toBe(0);
      expect(criarPagamento).toHaveBeenCalledTimes(1);

      // Só o toque do cliente liga o pagamento.
      await act(async () => {
        botao("Pagar com PIX")?.click();
      });
      expect(montagensDoPagamento).toBeGreaterThan(0);
      expect(criarPagamento).toHaveBeenCalledTimes(1);
    });
  }

  // Revisão do C4 (bloqueio): `recusado` do `verificar` inclui o 3DS que só
  // EXPIROU (canceled/expired vira recusado) — a tela não sabe se o banco
  // recusou, então diz "não foi concluído" (veredito A2, item 4). E o aviso
  // nasce JUNTO com a troca de tela: `role="status"` montado já cheio não é
  // anunciado (mesmo defeito do dd346db4) — `role="alert"` é.
  it("consulta responde recusado: a escolha da forma diz, em alerta, que o pagamento com cartão não foi concluído (nunca 'não foi aprovado')", async () => {
    criarPagamento.mockResolvedValue({
      verificacao: "recusado",
      paymentId: null,
      expiraEm: PRAZO_FUTURO,
    });
    await retomar({
      total: 149.9,
      metodo_online: null,
      gateway_payment_id: SENTINELA,
      payment_status: "aguardando",
      status: "pending",
    });
    expect(hospedeiro.textContent).toContain(
      "Como você quer pagar este pedido?",
    );
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "O pagamento com cartão não foi concluído.",
    );
    for (const regiao of Array.from(
      hospedeiro.querySelectorAll('[role="status"]'),
    )) {
      expect(regiao.textContent).not.toContain("não foi concluído");
    }
    expect(hospedeiro.textContent).not.toContain("não foi aprovado");
    expect(montagensDoPagamento).toBe(0);
  });

  it("CONTROLE: pedido PIX comum (sem sentinela) não passa pela consulta e retoma como antes", async () => {
    await retomar({
      total: 149.9,
      metodo_online: "pix",
      gateway_payment_id: "123456789",
      payment_status: "aguardando",
      status: "pending",
    });
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(montagensDoPagamento).toBeGreaterThan(0);
  });

  // Revisão do C4, item 5 (decisão do coordenador, 02/10/2026): o cartão com
  // id REAL na vaga (reload no meio do 3DS, cartão em análise) FICA FORA da
  // consulta — este teste PRENDE o comportamento de hoje. Na montagem nada
  // chama a edge (nem `verificar`, nem `cartao`); a tela é a do cartão
  // (PagamentoOnline em modo "cartao" → formulário; o formulário real e o
  // reenvio que devolve o MESMO desafio estão em
  // checkout-retomada-forma-do-pedido.test.tsx). Ali o servidor reaproveita
  // a vaga (mesmo desafio / em análise / pago) e o 3DS vivo mantém a saída
  // "Pagar com PIX" do ramo (f) — a consulta não oferece PIX no desafio
  // (isso é do C6), por isso este caso não passa por ela.
  for (const metodo_online of ["credito", "debito"]) {
    it(`reload com cartão de id REAL na vaga (${metodo_online}, aguardando): nenhuma chamada à edge na montagem, tela do cartão, nada da VerificacaoDoPagamento`, async () => {
      criarPagamento.mockResolvedValue({
        verificacao: "desafio3ds",
        paymentId: "ORD-3DS-VIVA",
        desafio3ds: { url: "https://www.mercadopago.com.br/3ds/x" },
        expiraEm: PRAZO_FUTURO,
      });
      await retomar({
        total: 149.9,
        metodo_online,
        gateway_payment_id: "ORD-3DS-VIVA",
        payment_status: "aguardando",
        status: "pending",
      });
      expect(criarPagamento).not.toHaveBeenCalled();
      expect(montagensDoPagamento).toBeGreaterThan(0);
      expect(propsDoPagamento?.metodo).toBe("cartao");
      expect(propsDoPagamento?.orderId).toBe(PEDIDO);
      expect(hospedeiro.textContent).toContain("Finalize o pagamento");
      for (const daVerificacao of [
        "Situação do pagamento",
        "Consultando o pagamento com o banco",
        "Não conseguimos confirmar",
        "Seu banco pediu uma confirmação de segurança",
      ]) {
        expect(hospedeiro.textContent).not.toContain(daVerificacao);
      }
      expect(botao("Verificar de novo")).toBeUndefined();
      expect(hospedeiro.querySelector("iframe")).toBeNull();
    });
  }
});
