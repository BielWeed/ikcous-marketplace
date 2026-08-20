import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O comprovante de pedido (PEDIDO-070, #106) visto do lado do app.
 *
 * O QUE ESTE ARQUIVO PROVA
 *   1. Que o comprovante é disparado quando o pedido nasce definitivo.
 *   2. Que ele NÃO é disparado no caminho de pagamento online, onde o pedido é
 *      uma reserva que o pg_cron cancela em 30 min.
 *   3. Que falha no envio não derruba a criação do pedido — critério 3 da
 *      issue, e a razão de o disparo ser sem `await`.
 *
 * O dublê de `react` e os mocks de useAuth/useLeaderElection são copiados de
 * `create-order-rpc.test.ts`, pelo mesmo motivo descrito lá: o projeto não tem
 * jsdom nem @testing-library, e trocar os hooks por dublês mínimos deixa
 * `useOrders(...)` executável como função comum — exercitando o corpo REAL de
 * `createOrder`, não um substituto dele.
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

/** Os nomes de função que `createOrder` disparou, na ordem. */
const funcoesChamadas = (): string[] =>
  vi.mocked(supabase.functions.invoke).mock.calls.map((c) => String(c[0]));

describe("comprovante de pedido para o cliente", () => {
  beforeEach(() => {
    // Só `mockClear`: `mockReset`/`mockResolvedValue` aqui exigiriam montar um
    // PostgrestSingleResponse inteiro (success, count, status, statusText) para
    // satisfazer o tipo, e o valor da fábrica do mock já é o que estes testes
    // querem. Vale lembrar que `vitest run` NÃO checa tipo neste projeto — quem
    // reprova isso é o `npm run typecheck`, que o CI roda.
    vi.mocked(supabase.rpc).mockClear();
    vi.mocked(supabase.functions.invoke).mockClear();
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {},
      error: null,
    });
  });

  it("dispara o comprovante quando o pedido nasce definitivo", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS);

    expect(funcoesChamadas()).toContain("send-order-confirmation");
    const chamada = vi
      .mocked(supabase.functions.invoke)
      .mock.calls.find((c) => c[0] === "send-order-confirmation");
    // O corpo leva SÓ o id: nome, itens e valores são lidos do banco dentro da
    // edge function. Se algum dia entrar texto aqui, alguém de fora passa a
    // escrever no e-mail de outra pessoa.
    expect(chamada?.[1]).toEqual({ body: { orderId: "ped-1" } });
  });

  it("NÃO dispara o comprovante no caminho de pagamento online", async () => {
    const { createOrder } = useOrders(false, false);
    await createOrder(DADOS_MINIMOS, { comPagamentoOnline: true });

    // Ali o pedido é uma reserva que o pg_cron cancela em 30 min: dizer
    // "recebemos seu pedido" seria afirmar o que o próprio app pode desfazer.
    expect(funcoesChamadas()).not.toContain("send-order-confirmation");
    expect(funcoesChamadas()).not.toContain("notify-new-order");
  });

  it("falha no envio do comprovante não derrruba a criação do pedido", async () => {
    vi.mocked(supabase.functions.invoke).mockRejectedValue(
      new Error("edge function fora do ar"),
    );

    const { createOrder } = useOrders(false, false);
    const pedido = await createOrder(DADOS_MINIMOS);

    // O critério 3 da issue: o pedido volta normalmente mesmo com o envio
    // falhando. Se o disparo ganhar um `await` algum dia, esta expectativa cai.
    expect(pedido?.id).toBe("ped-1");
  });

  it("promessa rejeitada do invoke não vira erro não tratado", async () => {
    vi.mocked(supabase.functions.invoke).mockRejectedValue(
      new Error("rede caiu"),
    );

    const { createOrder } = useOrders(false, false);
    await expect(createOrder(DADOS_MINIMOS)).resolves.toBeTruthy();
  });
});
