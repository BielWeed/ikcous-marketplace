import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B3 da revisão de risco pré-publicação (26/09/2026): o 409 "Há um pagamento
 * com cartão em análise para este pedido." (criar-pagamento/index.ts) tem que
 * chegar ao CheckoutView como um sinal PRÓPRIO, não só como mais um erro
 * recuperável — cancelar o pedido enquanto o cartão ainda pode ser aprovado
 * pelo banco é dinheiro cobrado por um pedido morto. O contrato combinado com
 * a revisão do edge: o corpo do 409 vai carregar `cartaoEmAnalise: true`, e
 * `criarPagamento` precisa propagar esse campo no Error que lança — MESMO
 * padrão de `.terminal` (ver criar-pagamento-erro.test.ts), que este arquivo
 * não toca.
 *
 * Mesmo dublê de React de create-order-rpc.test.ts / criar-pagamento-erro.
 * test.ts: `useOrders` chama useAuth/useLeaderElection na primeira linha, e o
 * projeto não tem @testing-library — o dublê deixa `useOrders(...)`
 * executável como função síncrona comum, com o MESMO corpo de
 * `criarPagamento` que o app usa.
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
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

/**
 * Reproduz o formato real do erro que o supabase-js v2 devolve quando
 * `functions.invoke` recebe uma resposta NÃO-2xx: `data` vem null e o corpo
 * fica em `error.context`, que é um `Response`.
 */
function erroDeInvokeComCorpo(corpo: Record<string, unknown>) {
  return {
    message: "Edge Function returned a non-2xx status code",
    context: { json: async () => corpo },
  };
}

const ARGS_PIX = { orderId: "ped-1", metodo: "pix" as const };

describe("useOrders/criarPagamento propaga o campo cartaoEmAnalise do 409 (B3)", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  it("409 com cartaoEmAnalise:true lança Error com .cartaoEmAnalise === true", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "Há um pagamento com cartão em análise para este pedido.",
        cartaoEmAnalise: true,
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_PIX);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.message).toBe(
      "Há um pagamento com cartão em análise para este pedido.",
    );
    expect(erroCapturado.cartaoEmAnalise).toBe(true);
  });

  it("409 comum (sem cartaoEmAnalise) lança Error com .cartaoEmAnalise !== true — falha fechada", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "Não foi possível gerar a cobrança.",
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_PIX);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect(erroCapturado.cartaoEmAnalise).not.toBe(true);
  });

  it("cartaoEmAnalise: 'true' (string) não vira true — só o booleano literal conta", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: erroDeInvokeComCorpo({
        error: "Há um pagamento com cartão em análise para este pedido.",
        cartaoEmAnalise: "true",
      }),
    } as any);

    const { criarPagamento } = useOrders(false, true);

    let erroCapturado: any;
    try {
      await criarPagamento(ARGS_PIX);
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado.cartaoEmAnalise).not.toBe(true);
  });
});
