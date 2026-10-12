import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C5 (front B2, 02/10/2026): o 503 `{ error, verificacao: "indisponivel" }`
 * do C3 (cartão sobre sentinela com a busca do MP falhando) chega ao front
 * como erro. Sem o campo, a tela do cartão só via "erro recuperável" — e o
 * caminho de sempre era pedir o cartão de NOVO (token novo) sobre uma
 * cobrança em dúvida. `criarPagamento` passa a propagar o campo no Error,
 * com a MESMA régua estrita de `terminal`/`cartaoEmAnalise`: só o literal
 * exato conta.
 *
 * Mesmo dublê de React de criar-pagamento-erro-cartao-em-analise.test.ts.
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

function erroDeInvokeComCorpo(corpo: Record<string, unknown>) {
  return {
    message: "Edge Function returned a non-2xx status code",
    context: { json: async () => corpo },
  };
}

const ARGS_CARTAO = {
  orderId: "ped-1",
  metodo: "cartao" as const,
  token: "tok-1",
  paymentMethodId: "master",
  paymentTypeId: "credit_card" as const,
  parcelas: 1,
  documento: { type: "CPF" as const, number: "12345678909" },
};

type CriarPagamento = ReturnType<typeof useOrders>["criarPagamento"];

async function erroDe(
  criarPagamento: CriarPagamento,
  corpo: Record<string, unknown>,
): Promise<any> {
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: null,
    error: erroDeInvokeComCorpo(corpo),
  } as any);
  try {
    await criarPagamento(ARGS_CARTAO);
  } catch (err) {
    return err;
  }
  throw new Error("criarPagamento deveria ter lançado");
}

describe("useOrders/criarPagamento propaga verificacao 'indisponivel' do 503 (C5)", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockClear();
  });

  it("503 com verificacao 'indisponivel' lança Error com .verificacao === 'indisponivel' (e a frase da edge)", async () => {
    const { criarPagamento } = useOrders(false, true);
    const erro = await erroDe(criarPagamento, {
      error: "Não foi possível consultar o pagamento agora.",
      verificacao: "indisponivel",
    });
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe("Não foi possível consultar o pagamento agora.");
    expect(erro.verificacao).toBe("indisponivel");
    expect(erro.terminal).toBe(false);
  });

  it("só o literal exato conta: outro valor, outra caixa ou ausente não marca", async () => {
    const { criarPagamento } = useOrders(false, true);
    for (const verificacao of [
      "Indisponivel",
      "indisponivel ",
      "sem_registro",
      true,
      undefined,
    ]) {
      const erro = await erroDe(criarPagamento, {
        error: "Não foi possível consultar o pagamento agora.",
        verificacao,
      });
      expect(erro.verificacao).toBeUndefined();
    }
  });

  it("corpo de erro em data (ramo inalcançável do supabase-js v2) segue a mesma régua", async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: {
        error: "Não foi possível consultar o pagamento agora.",
        verificacao: "indisponivel",
      },
      error: null,
    } as any);
    const { criarPagamento } = useOrders(false, true);
    const erro: any = await criarPagamento(ARGS_CARTAO).catch((e) => e);
    expect(erro.verificacao).toBe("indisponivel");
  });
});
