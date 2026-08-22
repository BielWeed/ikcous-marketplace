/**
 * Dois pontos do defeito, seguindo o MESMO padrão que
 * erro-de-pedido-nao-mostra-texto-cru-do-banco.test.ts já prova para
 * createOrder/fetchOrdersByOtp:
 *
 *   - useOrders.ts, `updateOrderStatus` (RPC update_order_status_atomic):
 *     quem mexe no status do pedido (lojista) lia `err.message` cru.
 *   - useProducts.ts, `addProduct`/`updateProduct` (INSERT/UPDATE em
 *     `vw_produtos_admin`): a lojista lia `err.message` cru ao cadastrar ou
 *     atualizar um produto.
 *
 * `mensagemAmigavelErroAtualizacaoStatus` e `mensagemAmigavelErroProduto`
 * são exportadas dos respectivos hooks pela mesma razão que
 * `mensagemAmigavelErroPedido`: são funções PURAS, testáveis sem montar o
 * hook inteiro — e o teste de integração (mais abaixo) prova que a função
 * está de fato LIGADA ao toast, não só que ela existe.
 *
 * Mesmo truque de mock de "react" que erro-de-pedido-nao-mostra-texto-cru-
 * do-banco.test.ts usa (useState/useCallback/useEffect/useRef viram
 * passagens diretas) — os dois hooks rodam como função síncrona comum, com
 * o MESMO corpo que o app usa.
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
  useAuth: () => ({ user: null, isAdmin: true }),
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
import { mensagemAmigavelErroProduto, useProducts } from "@/hooks/useProducts";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("mensagemAmigavelErroAtualizacaoStatus — as causas de update_order_status_atomic", () => {
  it("P0001 (RAISE EXCEPTION da RPC) é confiável — sai em português, específica", () => {
    const erroDoBanco = {
      code: "P0001",
      message: "Apenas pedidos pendentes podem ser cancelados pelo usuário.",
    };
    expect(mensagemAmigavelErroAtualizacaoStatus(erroDoBanco)).toBe(
      "Apenas pedidos pendentes podem ser cancelados pelo usuário.",
    );
  });

  it("validação local (validateStatusUpdate, sem `code`) passa direto — evita um SEGUNDO toast com texto diferente do primeiro", () => {
    expect(
      mensagemAmigavelErroAtualizacaoStatus(
        new Error("Usuários só podem cancelar pedidos"),
      ),
    ).toBe("Usuários só podem cancelar pedidos");
    expect(
      mensagemAmigavelErroAtualizacaoStatus(
        new Error("Apenas pedidos pendentes podem ser cancelados"),
      ),
    ).toBe("Apenas pedidos pendentes podem ser cancelados");
  });

  it("erro técnico cru do banco (código de servidor, texto de constraint): frase genérica, nunca o texto técnico", () => {
    const erroTecnico = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "marketplace_order_history_pkey"',
    };
    const msg = mensagemAmigavelErroAtualizacaoStatus(erroTecnico);
    expect(msg).not.toContain("constraint");
    expect(msg).not.toContain("duplicate key");
    expect(msg).toBe(
      "Não foi possível atualizar o status do pedido agora. Tente novamente em instantes.",
    );
  });

  it("falha de rede pura (TypeError sem `code`, texto diferente das duas frases de validação): cai no genérico, não vaza o texto técnico", () => {
    const erroDeRede = new Error("TypeError: Failed to fetch");
    const msg = mensagemAmigavelErroAtualizacaoStatus(erroDeRede);
    expect(msg).not.toContain("TypeError");
    expect(msg).not.toContain("Failed to fetch");
    expect(msg).toBe(
      "Não foi possível atualizar o status do pedido agora. Tente novamente em instantes.",
    );
  });
});

describe("mensagemAmigavelErroProduto — as causas de INSERT/UPDATE em vw_produtos_admin", () => {
  it("mensagem do TruthGate (validação local, sem chamada de rede): passa direto — é a única causa possível nos três pontos que a usam", () => {
    const erroDeValidacao = new Error(
      "Validação de Produto Falhou: Axiom violation: price_non_negative",
    );
    expect(mensagemAmigavelErroProduto(erroDeValidacao, "cadastrar")).toBe(
      "Validação de Produto Falhou: Axiom violation: price_non_negative",
    );
    expect(mensagemAmigavelErroProduto(erroDeValidacao, "atualizar")).toBe(
      "Validação de Produto Falhou: Axiom violation: price_non_negative",
    );
  });

  it("erro técnico cru do PostgREST: frase genérica de acordo com a ação, nunca o texto técnico", () => {
    const erroTecnico = {
      code: "23514",
      message:
        'new row for relation "produtos" violates check constraint "produtos_estoque_check"',
    };
    expect(mensagemAmigavelErroProduto(erroTecnico, "cadastrar")).toBe(
      "Não foi possível cadastrar o produto agora. Confira os dados e tente novamente.",
    );
    const msgAtualizar = mensagemAmigavelErroProduto(erroTecnico, "atualizar");
    expect(msgAtualizar).not.toContain("constraint");
    expect(msgAtualizar).not.toContain("relation");
    expect(msgAtualizar).toBe(
      "Não foi possível atualizar o produto agora. Confira os dados e tente novamente.",
    );
  });
});

describe("updateOrderStatus toasta a versão traduzida, nunca o err.message cru (Ponto 4)", () => {
  beforeEach(() => {
    mock.rpc.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("RPC recusa com erro técnico cru: o toast NUNCA mostra o texto técnico", async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "marketplace_order_history_pkey"',
      },
    });
    const { updateOrderStatus } = useOrders(false, true);

    await expect(updateOrderStatus("order-1", "shipping")).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(mensagemMostrada).not.toContain("constraint");
    expect(mensagemMostrada).not.toContain("duplicate key");
    expect(mensagemMostrada).toBe(
      "Não foi possível atualizar o status do pedido agora. Tente novamente em instantes.",
    );
  });
});

describe("addProduct/updateProduct toastam a versão traduzida, nunca o err.message cru (Pontos 5 e 6)", () => {
  const produtoValido = {
    name: "Produto Teste",
    description: "",
    price: 100,
    costPrice: 50,
    stock: 10,
    category: "Geral",
    images: [] as string[],
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    sold: 0,
  } as any;

  beforeEach(() => {
    mock.from.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("addProduct: INSERT recusado com erro técnico cru — o toast NUNCA mostra o texto técnico", async () => {
    mock.from.mockReturnValue(
      criarQueryEncadeavel({
        data: null,
        error: {
          code: "23514",
          message:
            'new row for relation "produtos" violates check constraint "produtos_estoque_check"',
        },
      }),
    );
    const { addProduct } = useProducts({ autoFetch: false });

    await expect(addProduct(produtoValido)).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(mensagemMostrada).not.toContain("constraint");
    expect(mensagemMostrada).not.toContain("relation");
    expect(mensagemMostrada).toBe(
      "Não foi possível cadastrar o produto agora. Confira os dados e tente novamente.",
    );
  });

  it("updateProduct: UPDATE recusado com erro técnico cru — o toast NUNCA mostra o texto técnico", async () => {
    mock.from.mockReturnValue(
      criarQueryEncadeavel({
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "produtos_codigo_key"',
        },
      }),
    );
    const { updateProduct } = useProducts({ autoFetch: false });

    await expect(
      updateProduct("prod-1", { price: 120, stock: 5 }),
    ).rejects.toThrow();

    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(mensagemMostrada).not.toContain("constraint");
    expect(mensagemMostrada).not.toContain("duplicate key");
    expect(mensagemMostrada).toBe(
      "Não foi possível atualizar o produto agora. Confira os dados e tente novamente.",
    );
  });
});
