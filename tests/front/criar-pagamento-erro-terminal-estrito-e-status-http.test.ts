import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teste de MUTAÇÃO (24/11/2026) de `criarPagamento` (useOrders.ts), o que a
 * tela do PIX usa para decidir "tentar de novo" × "fim de linha".
 *
 * 1) No ramo do erro HTTP, só o booleano `true` LITERAL vira `terminal`. Trocar
 *    `typeof corpo?.terminal === "boolean"` por `Boolean(corpo?.terminal)` não
 *    derrubava teste nenhum (o teste da "string 'false'" só cobre o ramo
 *    `data?.error`, inalcançável hoje): um corpo com `terminal: "false"` ou
 *    `1` fecharia a tela do PIX sem o "Tentar de novo".
 * 2) `httpStatus` só viaja quando o status é um NÚMERO. O 503 (terminal, mas
 *    "indisponível agora") se reconhece por ele; um valor que não é número
 *    nunca pode chegar como se fosse status.
 *
 * Mesmo dublê de React de criar-pagamento-erro.test.ts.
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

const ARGS_MINIMOS = { orderId: "ped-1", metodo: "pix" as const };

// Com o React trocado por um dublê, `useOrders(...)` é uma função comum: o
// `criarPagamento` sai dela uma vez só, e o dublê do supabase é lido a cada
// chamada (cada teste põe a resposta que quer).
let criarPagamento: ReturnType<typeof useOrders>["criarPagamento"];
beforeAll(() => {
  criarPagamento = useOrders(false, true).criarPagamento;
});

type ErroLancado = Error & {
  terminal?: unknown;
  cartaoEmAnalise?: unknown;
  httpStatus?: unknown;
};

async function erroDe(
  corpo: Record<string, unknown>,
  status?: unknown,
): Promise<ErroLancado> {
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: { json: async () => corpo, status },
    },
  } as never);
  try {
    await criarPagamento(ARGS_MINIMOS);
  } catch (err) {
    return err as ErroLancado;
  }
  throw new Error("criarPagamento deveria ter lançado");
}

describe("criarPagamento (ramo do erro HTTP) — leitura estrita do corpo e do status", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockReset();
  });

  it("terminal e cartaoEmAnalise só valem como booleano literal: 'true', 'false', 1 e {} NÃO viram verdadeiro", async () => {
    for (const frouxo of ["true", "false", 1, {}]) {
      const erro = await erroDe({
        error: "Pedido inválido.",
        terminal: frouxo,
        cartaoEmAnalise: frouxo,
      });
      expect(erro.message).toBe("Pedido inválido.");
      expect(erro.terminal).toBe(false);
      expect(erro.cartaoEmAnalise).toBe(false);
    }
  });

  it("ramo data?.error (inalcançável hoje): cartaoEmAnalise e terminal frouxos também NÃO viram verdadeiro, e o booleano true literal vale", async () => {
    for (const [frouxo, esperado] of [
      ["true", false],
      [1, false],
      [true, true],
    ] as const) {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: {
          error: "Pedido inválido.",
          terminal: frouxo,
          cartaoEmAnalise: frouxo,
        },
        error: null,
      } as never);
      let erro: ErroLancado | undefined;
      try {
        await criarPagamento(ARGS_MINIMOS);
      } catch (err) {
        erro = err as ErroLancado;
      }
      expect(erro?.message).toBe("Pedido inválido.");
      expect(erro?.terminal).toBe(esperado);
      expect(erro?.cartaoEmAnalise).toBe(esperado);
    }
  });

  it("CONTROLE: o booleano true literal continua valendo nos dois campos", async () => {
    const erro = await erroDe({
      error: "Há um pagamento com cartão em análise para este pedido.",
      terminal: true,
      cartaoEmAnalise: true,
    });
    expect(erro.terminal).toBe(true);
    expect(erro.cartaoEmAnalise).toBe(true);
  });

  it("httpStatus numérico viaja junto (503 é o que separa 'indisponível agora' de 'pedido morto')", async () => {
    const erro = await erroDe(
      { error: "Pagamento indisponível.", terminal: true },
      503,
    );
    expect(erro.httpStatus).toBe(503);
  });

  it("status ausente ou que não é número: o campo httpStatus nem existe no erro", async () => {
    for (const ruim of [undefined, "503", null]) {
      const erro = await erroDe({ error: "Pedido inválido." }, ruim);
      expect("httpStatus" in erro).toBe(false);
    }
  });
});
