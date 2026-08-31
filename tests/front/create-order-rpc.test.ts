import { toast } from "sonner";
import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
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
