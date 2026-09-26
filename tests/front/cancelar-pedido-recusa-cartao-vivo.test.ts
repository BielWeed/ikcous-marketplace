// Achado independente de risco (dinheiro, 26/09/2026): o cliente podia
// cancelar um pedido com uma cobrança de CARTÃO ainda viva no Mercado Pago
// (caixa âmbar do checkout / sentinela de verificação) — a flag "esta
// cobrança pode estar viva" só existia no `useState` da tela de pagamento;
// sair para "Meus pedidos" perdia a flag e o botão "Cancelar Pedido"
// aparecia com o texto de confirmação de "não pago".
//
// A DEFESA é no servidor (migration 20261180000000, `update_order_status_
// atomic` recusa o cliente nesse caso). ESTE arquivo cobre o espelho no
// front: o `Order` que `OrderDetailsView` lê (mapOrderFromDB/useOrders.ts)
// não carrega `metodo_online` nem `gateway_payment_id` hoje — sem esses dois
// campos, o botão não pode ser escondido pela MESMA condição que a RPC usa
// (varredura em `src/`: 0 ocorrência dos dois nomes fora do checkout). Por
// isso o botão CONTINUA visível, e a garantia vira: quando o servidor
// recusa, o cliente lê a mensagem HONESTA que a RPC devolveu — não um "tente
// novamente" genérico que esconderia o motivo real.
//
// `mensagemAmigavelErroAtualizacaoStatus` é o único ponto que decide se o
// texto do banco chega ao cliente ou se vira genérico — ela só repassa
// `code === "P0001"` (o SQLSTATE padrão do plpgsql, o mesmo que TODA
// exceção de `update_order_status_atomic` usa, inclusive a guarda nova, que
// não leva `USING ERRCODE` de propósito — ver o cabeçalho da migration).
// Este teste é o mesmo padrão de
// erro-de-status-e-produto-nao-mostra-texto-cru-do-banco.test.ts, focado só
// na mensagem desta guarda.
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));

function criarQueryEncadeavel(resultado: { data: any; error: any }) {
  const chain: any = {
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(resultado)),
  };
  return chain;
}

const mock = { from: vi.fn(), rpc: vi.fn() };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mock.from(...args),
    rpc: (...args: unknown[]) => mock.rpc(...args),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import {
  mensagemAmigavelErroAtualizacaoStatus,
  useOrders,
} from "@/hooks/useOrders";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const MENSAGEM_CARTAO_VIVO =
  "Este pedido tem uma cobrança no cartão em confirmação com o banco. Aguarde a confirmação ou fale com a loja antes de cancelar.";

describe("mensagemAmigavelErroAtualizacaoStatus — recusa de cancelamento com cartão vivo (20261180000000)", () => {
  it("P0001 com a mensagem da guarda nova sai verbatim — o cliente lê o motivo real, não um genérico", () => {
    const erroDoBanco = { code: "P0001", message: MENSAGEM_CARTAO_VIVO };
    expect(mensagemAmigavelErroAtualizacaoStatus(erroDoBanco)).toBe(
      MENSAGEM_CARTAO_VIVO,
    );
  });
});

describe("updateOrderStatus toasta a mensagem exata da guarda, nunca um genérico (mirror do achado 26/09/2026)", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
    mock.rpc.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("cliente tenta cancelar pedido com cartão em confirmação: a RPC recusa (P0001) e o toast mostra a MESMA frase, não 'tente novamente'", async () => {
    mock.from.mockReturnValue(
      criarQueryEncadeavel({ data: { status: "pending" }, error: null }),
    );
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: MENSAGEM_CARTAO_VIVO },
    });
    // isAdmin=false, autoFetch=true: mesma forma que OrderDetailsView usa
    // (useOrders(true, false)) para o cliente cancelar o próprio pedido.
    const { updateOrderStatus } = useOrders(true, false);

    await expect(updateOrderStatus("pedido-1", "cancelled")).rejects.toThrow();

    expect(mock.rpc).toHaveBeenCalledWith(
      "update_order_status_atomic",
      expect.objectContaining({
        p_order_id: "pedido-1",
        p_new_status: "cancelled",
      }),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(mensagemMostrada).toBe(MENSAGEM_CARTAO_VIVO);
    expect(mensagemMostrada).not.toBe(
      "Não foi possível atualizar o status do pedido agora. Tente novamente em instantes.",
    );
  });
});
