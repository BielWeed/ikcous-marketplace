import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    info: vi.fn(),
  },
}));

/**
 * useOrders/createOrder — a escolha entre create_marketplace_order_v23 e
 * create_marketplace_order_v24 (Fase 2 do CHECKOUT-010).
 *
 * POR QUE ESTE TESTE PRECISA "DESLIGAR" O REACT DE VERDADE: `useOrders` chama
 * useAuth() (useContext) e useLeaderElection() logo na primeira linha, e o
 * projeto não tem jsdom nem @testing-library instalados — o vitest.config.ts
 * documenta essa escolha deliberada. Renderizar o hook de verdade (via
 * renderHook) exigiria as duas dependências novas SÓ para este teste.
 *
 * Em vez disso, o teste troca `react` por um dublê mínimo: useState devolve
 * o valor inicial sem re-render, useCallback devolve a própria função sem
 * memoização, useEffect não roda (nada aqui depende de efeito) e useRef
 * devolve uma caixa {current}. Isso deixa `useOrders(...)` executável como
 * função síncrona comum, com o MESMO corpo de createOrder que o app usa —
 * é o corpo, não um substituto dele, que é exercitado abaixo. useAuth e
 * useLeaderElection são trocados por dublês próprios porque o primeiro lê
 * um Context real (sem Provider aqui) e o segundo abre BroadcastChannel.
 */
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useState: (inicial: unknown) => [
      typeof inicial === "function" ? (inicial as () => unknown)() : inicial,
      vi.fn(),
    ],
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useRef: (inicial: unknown) => ({ current: inicial }),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const { lerPedido, selecionarPedido, filtrarPedido } = vi.hoisted(() => ({
  lerPedido: vi.fn(),
  selecionarPedido: vi.fn(),
  filtrarPedido: vi.fn(),
}));

beforeEach(() => {
  lerPedido
    .mockReset()
    .mockResolvedValue({ data: { total: 100 }, error: null });
  selecionarPedido.mockReset().mockReturnValue({ eq: filtrarPedido });
  filtrarPedido.mockReset().mockReturnValue({ single: lerPedido });
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({ select: selecionarPedido })),
    rpc: vi.fn().mockResolvedValue({ data: "ped-1", error: null }),
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: {}, error: null }),
    },
  },
}));

const DADOS_MINIMOS = {
  items: [{ productId: "prod-1", quantity: 1 }],
  totalAmount: 100,
  shippingCost: 0,
  paymentMethod: "pix",
  customer: { name: "Joana", whatsapp: "11999999999" },
};

describe("createOrder escolhe a RPC — falha fechada para o lado 'na entrega'", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockClear();
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  it("sem opts chama v23", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_marketplace_order_v23",
      expect.anything(),
    );
  });

  it("opts vazio ({}) também chama v23 — omissão de comPagamentoOnline falha fechada", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS, {});
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_marketplace_order_v23",
      expect.anything(),
    );
  });

  it("comPagamentoOnline: false chama v23", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS, { comPagamentoOnline: false });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_marketplace_order_v23",
      expect.anything(),
    );
  });

  it("comPagamentoOnline: true chama v24", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS, { comPagamentoOnline: true });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_marketplace_order_v24",
      expect.anything(),
    );
  });
});

describe("total do pagamento vem do pedido gravado", () => {
  it.each([100.03, "99.97"])(
    "relê o total do ID devolvido pela RPC: %s",
    async (total) => {
      lerPedido.mockResolvedValueOnce({ data: { total }, error: null });
      const { createOrder } = useOrders(false, false);
      const pedido = await createOrder(DADOS_MINIMOS, {
        comPagamentoOnline: true,
      });
      expect(pedido.totalAmount).toBe(Number(total));
      expect(supabase.from).toHaveBeenCalledWith("marketplace_orders");
      expect(selecionarPedido).toHaveBeenCalledWith("total");
      expect(filtrarPedido).toHaveBeenCalledWith("id", "ped-1");
    },
  );

  it.each([
    null,
    {},
    { total: null },
    { total: "" },
    { total: "inválido" },
    { total: -1 },
    { total: 0 },
  ])("sem total válido não devolve o valor do cliente: %j", async (data) => {
    lerPedido.mockResolvedValueOnce({ data, error: null });
    const { createOrder } = useOrders(false, false);
    await expect(
      createOrder(DADOS_MINIMOS, { comPagamentoOnline: true }),
    ).rejects.toMatchObject({
      code: "TOTAL_DO_PEDIDO_INDISPONIVEL",
      pedidoId: "ped-1",
    });
  });

  it("falha da leitura não desfaz nem recria o pedido, e não autoriza cobrar o valor do cliente", async () => {
    lerPedido.mockResolvedValueOnce({
      data: null,
      error: { message: "sem conexão" },
    });
    const { createOrder } = useOrders(false, false);
    vi.mocked(supabase.rpc).mockClear();
    await expect(
      createOrder(DADOS_MINIMOS, { comPagamentoOnline: true }),
    ).rejects.toMatchObject({
      code: "TOTAL_DO_PEDIDO_INDISPONIVEL",
      pedidoId: "ped-1",
    });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["erro devolvido pelo banco (RLS)", "devolvido"],
    ["leitura que lança (rede)", "lancado"],
  ])(
    "a causa original da leitura falha chega ao console.error: %s",
    async (_nome, jeito) => {
      const causa = { message: "new row violates RLS", code: "42501" };
      if (jeito === "devolvido") {
        lerPedido.mockResolvedValueOnce({ data: null, error: causa });
      } else {
        lerPedido.mockRejectedValueOnce(causa);
      }
      const registro = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { createOrder } = useOrders(false, false);
        const erro = await createOrder(DADOS_MINIMOS, {
          comPagamentoOnline: true,
        }).catch((e: unknown) => e);
        // O fluxo não muda: continua bloqueando com o mesmo código.
        expect(erro).toMatchObject({ code: "TOTAL_DO_PEDIDO_INDISPONIVEL" });
        expect((erro as { cause?: unknown }).cause).toBe(causa);
        // E a causa original é o que o log recebe.
        const registrados = registro.mock.calls.flat();
        expect(
          registrados.some(
            (arg) =>
              arg === causa || (arg as { cause?: unknown })?.cause === causa,
          ),
        ).toBe(true);
      } finally {
        registro.mockRestore();
      }
    },
  );
});

/**
 * TOTAL NA ENTREGA/RETIRADA (caça 27/11/2026): o banco aceita até R$ 0,05 de
 * diferença do total enviado e grava SEMPRE o dele. 3 × R$ 19,90 na tela e o
 * lojista mudando para R$ 19,91 antes de o carrinho reler: o banco grava
 * R$ 59,73 e a tela de sucesso dizia R$ 59,70 (recibo, e-mail e Financeiro
 * dizem 59,73). Aqui o pedido JÁ nasceu e vale: a leitura só corrige o número
 * da tela, e qualquer falha dela mantém o comportamento de antes.
 */
describe("pedido na entrega devolve o total que o banco gravou", () => {
  const NA_ENTREGA = { ...DADOS_MINIMOS, totalAmount: 59.7 };

  beforeEach(() => {
    vi.mocked(supabase.rpc).mockClear();
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  it.each([59.73, "59.73"])(
    "relê o total do ID devolvido pela RPC: %s",
    async (total) => {
      lerPedido.mockResolvedValueOnce({ data: { total }, error: null });
      const { createOrder } = useOrders(false, false);
      const pedido = await createOrder(NA_ENTREGA);
      expect(pedido.totalAmount).toBe(59.73);
      expect(supabase.from).toHaveBeenCalledWith("marketplace_orders");
      expect(selecionarPedido).toHaveBeenCalledWith("total");
      expect(filtrarPedido).toHaveBeenCalledWith("id", "ped-1");
      // A RPC mandou o total da tela, como sempre: a leitura vem depois.
      expect(
        (vi.mocked(supabase.rpc).mock.calls[0]?.[1] as Record<string, unknown>)
          .p_total_amount,
      ).toBe(59.7);
    },
  );

  it("pedido de R$ 0,00 (cupom de 100%) é total válido na entrega", async () => {
    lerPedido.mockResolvedValueOnce({ data: { total: 0 }, error: null });
    const { createOrder } = useOrders(false, false);
    // A tela mandou R$ 0,04 (dentro da tolerância): vale o R$ 0,00 do banco.
    const pedido = await createOrder({ ...NA_ENTREGA, totalAmount: 0.04 });
    expect(pedido.totalAmount).toBe(0);
  });

  it.each([
    ["sem linha (convidado não lê pela RLS)", null, { code: "PGRST116" }],
    ["erro do banco", null, { message: "sem conexão" }],
    ["sem total", {}, null],
    ["total nulo", { total: null }, null],
    ["total vazio", { total: "" }, null],
    ["total inválido", { total: "inválido" }, null],
    ["total negativo", { total: -1 }, null],
  ])(
    "leitura sem total válido (%s) mantém o total da tela, sem desfazer o pedido",
    async (_nome, data, error) => {
      lerPedido.mockResolvedValueOnce({ data, error });
      const { createOrder } = useOrders(false, false);
      const pedido = await createOrder(NA_ENTREGA);
      expect(pedido).toMatchObject({ id: "ped-1", totalAmount: 59.7 });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        "notify-new-order",
        { body: { orderId: "ped-1" } },
      );
    },
  );

  it("leitura que lança (rede) mantém o total da tela", async () => {
    lerPedido.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { createOrder } = useOrders(false, false);
    const pedido = await createOrder(NA_ENTREGA);
    expect(pedido.totalAmount).toBe(59.7);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("leitura pendurada não segura a tela: em 5 s fica o total da tela", async () => {
    vi.useFakeTimers();
    try {
      lerPedido.mockReturnValueOnce(new Promise(() => {}));
      const { createOrder } = useOrders(false, false);
      let pedido: { totalAmount: number } | undefined;
      const envio = createOrder(NA_ENTREGA).then((p) => {
        pedido = p;
      });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(pedido).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await envio;
      expect(pedido?.totalAmount).toBe(59.7);
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        "notify-new-order",
        { body: { orderId: "ped-1" } },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A-3 da revisão final (PEDIDO-020 x Fase 2): com a flag ligada o pedido é
 * uma RESERVA que o pg_cron cancela em 30 minutos, não um pedido definitivo.
 * Avisar o lojista no mesmo instante do clique em Finalizar faz ele separar
 * mercadoria de um pedido que pode nunca ser pago. Quem avisa no caminho
 * online passa a ser o webhook da Fase 3, quando o pagamento é confirmado.
 */
describe("createOrder avisa o lojista só quando o pedido é definitivo", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockClear();
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  it("sem opts avisa o lojista — pedido 'na entrega' é definitivo", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS);
    expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-new-order", {
      body: { orderId: "ped-1" },
    });
  });

  it("comPagamentoOnline: false avisa o lojista", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS, { comPagamentoOnline: false });
    expect(supabase.functions.invoke).toHaveBeenCalledWith("notify-new-order", {
      body: { orderId: "ped-1" },
    });
  });

  it("comPagamentoOnline: true NÃO avisa o lojista — quem avisa é o webhook da Fase 3", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS, { comPagamentoOnline: true });
    expect(supabase.functions.invoke).not.toHaveBeenCalledWith(
      "notify-new-order",
      expect.anything(),
    );
  });
});

/**
 * IDEMPOTÊNCIA DA CRIAÇÃO (laudo caça-bugs 31/08, A1): rede cai DEPOIS do
 * commit e a retentativa honesta recriava o pedido — estoque e cupom
 * debitados em dobro. A cura tem duas metades: a CHAVE (CheckoutView +
 * src/lib/chave-do-pedido.ts, provados lá) e o SERVIDOR (migration
 * 20261038000000, devolve o pedido original quando a chave já existe).
 * Este arquivo prova a COSTURA: a chave que o checkout decide é a que
 * chega à RPC — e que, sem chave nenhuma, o null segue viagem (chamador
 * antigo não quebra com o DEFAULT NULL do banco).
 */
describe("createOrder costura a chave da compra na RPC", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockClear();
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  const argumentosDaRpc = () =>
    vi.mocked(supabase.rpc).mock.calls[0]?.[1] as Record<string, unknown>;

  it("a chave que vem no pedido chega à RPC como p_idempotency_key", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder({
      ...DADOS_MINIMOS,
      idempotencyKey: "chave-da-compra-1",
    });

    expect(argumentosDaRpc().p_idempotency_key).toBe("chave-da-compra-1");
  });

  it("sem chave manda null — o chamador antigo continua funcionando", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS);

    expect(argumentosDaRpc().p_idempotency_key).toBeNull();
  });

  it("chave vazia também vira null (não string vazia)", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder({ ...DADOS_MINIMOS, idempotencyKey: "" });

    expect(argumentosDaRpc().p_idempotency_key).toBeNull();
  });
});

/**
 * UM AVISO SÓ (laudo 31/08, menor E): a falha de criação empilhava DOIS
 * toasts — o do hook e o da tela. O aviso único mora na TELA, porque é ela
 * que acrescenta o painel da recusa ao lado; o hook apenas RELANÇA.
 */
describe("createOrder não avisa por conta própria quando a RPC recusa", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockClear();
    vi.mocked(supabase.functions.invoke).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("a recusa da RPC sobe como EXCEÇÃO sem toast do hook", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: "Estoque insuficiente para o produto X" },
    } as never);

    const { createOrder } = useOrders(false, false);
    await expect(createOrder(DADOS_MINIMOS)).rejects.toThrow();

    expect(toast.error).not.toHaveBeenCalled();
  });
});
