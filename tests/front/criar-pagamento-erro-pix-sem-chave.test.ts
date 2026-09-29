import { useOrders } from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1 do PR #711 (29/09/2026): o 409 "Para pagar com Pix, a loja precisa
 * cadastrar a chave de assinatura do webhook…" (criar-pagamento/index.ts)
 * carrega `pixSemChaveDeAssinatura: true` e `terminal: true`. Para o checkout
 * poder oferecer "Pagar com cartão" no lugar (pedido retomado, ou PIX que
 * escapou da sonda), `criarPagamento` precisa propagar o campo no Error que
 * lança — MESMO padrão de `.terminal` e `.cartaoEmAnalise`
 * (criar-pagamento-erro-cartao-em-analise.test.ts): o contrato é o CAMPO do
 * corpo, nunca comparação de texto.
 *
 * Mesmo dublê de React dos vizinhos: `useOrders` chama useAuth/
 * useLeaderElection na primeira linha e o projeto não tem @testing-library.
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

const ARGS_PIX = { orderId: "ped-1", metodo: "pix" as const };
const TEXTO_409 =
  "Para pagar com Pix, a loja precisa cadastrar a chave de assinatura do webhook do Mercado Pago.";

async function capturar(
  criarPagamento: ReturnType<typeof useOrders>["criarPagamento"],
  corpo: Record<string, unknown>,
) {
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: null,
    error: erroDeInvokeComCorpo(corpo),
  } as any);
  try {
    await criarPagamento(ARGS_PIX);
  } catch (err) {
    return err as any;
  }
  throw new Error("criarPagamento deveria ter lançado");
}

describe("useOrders/criarPagamento propaga pixSemChaveDeAssinatura do 409 (P1 #711)", () => {
  beforeEach(() => {
    vi.mocked(supabase.functions.invoke).mockReset();
  });

  it("409 com pixSemChaveDeAssinatura:true e terminal:true lança Error com os DOIS campos", async () => {
    const { criarPagamento } = useOrders(false, true);
    const erro = await capturar(criarPagamento, {
      error: TEXTO_409,
      terminal: true,
      pixSemChaveDeAssinatura: true,
    });
    expect(erro).toBeInstanceOf(Error);
    expect(erro.message).toBe(TEXTO_409);
    expect(erro.terminal).toBe(true);
    expect(erro.pixSemChaveDeAssinatura).toBe(true);
  });

  it("erro comum (sem o campo) NÃO carrega a flag — falha fechada", async () => {
    const { criarPagamento } = useOrders(false, true);
    const erro = await capturar(criarPagamento, {
      error: "Pagamento indisponível.",
    });
    expect(erro.pixSemChaveDeAssinatura).not.toBe(true);
  });

  it.each([
    ["string 'true'", "true"],
    ["número 1", 1],
    ["objeto", {}],
    ["false", false],
  ])(
    "pixSemChaveDeAssinatura como %s não vira true — só o booleano literal conta",
    async (_nome, valor) => {
      const { criarPagamento } = useOrders(false, true);
      const erro = await capturar(criarPagamento, {
        error: TEXTO_409,
        pixSemChaveDeAssinatura: valor,
      });
      expect(erro.pixSemChaveDeAssinatura).not.toBe(true);
    },
  );

  it("a MESMA mensagem sem a flag não conta: o contrato é o campo, não o texto", async () => {
    const { criarPagamento } = useOrders(false, true);
    const erro = await capturar(criarPagamento, {
      error: TEXTO_409,
      terminal: true,
    });
    expect(erro.message).toBe(TEXTO_409);
    expect(erro.pixSemChaveDeAssinatura).not.toBe(true);
  });

  it("os outros campos seguem intactos com a flag presente (cartaoEmAnalise não é contaminado)", async () => {
    const { criarPagamento } = useOrders(false, true);
    const erro = await capturar(criarPagamento, {
      error: TEXTO_409,
      terminal: true,
      pixSemChaveDeAssinatura: true,
    });
    expect(erro.cartaoEmAnalise).not.toBe(true);
  });
});
