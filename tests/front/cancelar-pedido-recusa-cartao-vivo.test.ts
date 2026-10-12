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

const mock = { from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mock.from(...args),
    rpc: (...args: unknown[]) => mock.rpc(...args),
    functions: { invoke: (...args: unknown[]) => mock.invoke(...args) },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import {
  ErroCancelamentoNaoConcluido,
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

// S1 (04/10/2026, migration 20261198000000): o cancelamento de pedido ONLINE
// (ou que a tela não tem em memória, como aqui: `orders` vazio) não chama
// mais `update_order_status_atomic` — vai pela edge `criar-pagamento`
// (ação `cancelar`), que consulta a cobrança no Mercado Pago. O cartão em
// análise volta como desfecho `em_analise`, com a frase da edge; a guarda
// da 80 continua no banco para quem chamar a RPC direto.
const MENSAGEM_EM_ANALISE =
  "Há um pagamento com cartão em análise para este pedido. Ele não pode ser cancelado agora — aguarde a confirmação do banco.";

describe("updateOrderStatus: cartão em análise volta da EDGE como em_analise, com a frase dela — nunca um genérico, nunca a RPC direta", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { onLine: true });
    mock.rpc.mockReset();
    mock.invoke.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.warning).mockReset();
  });

  it("cliente tenta cancelar pedido com cartão em confirmação: a edge responde em_analise, o toast mostra a frase dela e nada chama a RPC", async () => {
    mock.invoke.mockResolvedValue({
      data: { cancelamento: "em_analise", mensagem: MENSAGEM_EM_ANALISE },
      error: null,
    });
    // isAdmin=false, autoFetch=true: mesma forma que OrderDetailsView usa
    // (useOrders(true, false)) para o cliente cancelar o próprio pedido.
    const { updateOrderStatus } = useOrders(true, false);

    const erro = await updateOrderStatus("pedido-1", "cancelled").catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroCancelamentoNaoConcluido);
    expect((erro as ErroCancelamentoNaoConcluido).desfecho).toBe("em_analise");

    expect(mock.invoke).toHaveBeenCalledWith("criar-pagamento", {
      body: { orderId: "pedido-1", metodo: "cancelar" },
    });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toBe(
      MENSAGEM_EM_ANALISE,
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
