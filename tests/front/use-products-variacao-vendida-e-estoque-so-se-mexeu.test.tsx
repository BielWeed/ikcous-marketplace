// @vitest-environment jsdom
//
// Dois fatos do hook `useProducts` que o formulário de produto usa ao salvar a
// grade de variações:
//
// 1) VARIAÇÃO JÁ VENDIDA NÃO SE APAGA. `marketplace_order_items.variant_id` tem
//    chave estrangeira para `product_variants` sem regra de exclusão: apagar uma
//    variação que já está num pedido volta 23503. Antes, a lojista lia o
//    genérico "Não foi possível atualizar o produto agora..." sem saber que o
//    caminho é DESLIGAR a variação (o botão de ligar/desligar da linha, que
//    guarda o cadastro e tira da loja). Agora a frase diz isso.
//
// 2) O ESTOQUE DA VARIAÇÃO SÓ VAI QUANDO A LOJISTA MEXEU. O formulário omite
//    `stockIncrement` das variações cujo número ela não mudou; o hook então não
//    pode mandar a coluna `stock_increment` para essas linhas (mandar `null`
//    zeraria o estoque, mandar o velho desfaria a venda que acabou de acontecer).
//    Como o postgrest-js monta `columns` com a UNIÃO das chaves do lote, as
//    linhas COM e SEM estoque vão em requisições separadas (mesma razão do lote
//    misto id/sem-id do use-products-upsert-variantes-novas-e-antigas).
import { mensagemAmigavelErroProduto, useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada =
  | { tipo: "insert"; payload: any[] }
  | { tipo: "upsert"; payload: any[]; opts: any };

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  ordem: [] as Chamada[],
  // id -> erro que o banco devolve ao apagar aquela variação (ausente = apaga).
  recusadas: new Map<string, any>(),
  apagadas: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: mock.fetchProductsContext,
  }),
}));

vi.mock("@/lib/mappers", () => ({
  mapProductFromDB: (row: any) => row,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mock.toastSuccess,
    error: mock.toastError,
    loading: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "product_variants") {
        throw new Error(`Tabela não mockada neste teste: ${tabela}`);
      }
      return {
        insert: (payload: any[]) => {
          mock.ordem.push({ tipo: "insert", payload });
          return Promise.resolve({ error: null });
        },
        upsert: (payload: any[], opts: any) => {
          mock.ordem.push({ tipo: "upsert", payload, opts });
          return Promise.resolve({ error: null });
        },
        select: () => ({ in: () => Promise.resolve({ data: [] }) }),
        delete: () => ({
          // Um DELETE em lote (`in`) é atômico no Postgres: uma recusada segura
          // o lote inteiro e nenhuma sai.
          in: (_coluna: string, ids: string[]) => {
            const erro = ids.map((id) => mock.recusadas.get(id)).find(Boolean);
            if (!erro) mock.apagadas.push(...ids);
            return Promise.resolve({ error: erro ?? null });
          },
          eq: (_coluna: string, id: string) => {
            const erro = mock.recusadas.get(id);
            if (!erro) mock.apagadas.push(id);
            return Promise.resolve({ error: erro ?? null });
          },
        }),
      };
    },
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

// O erro que o Postgres devolve ao apagar variação que está num pedido.
const ERRO_VARIACAO_VENDIDA = {
  code: "23503",
  message:
    'update or delete on table "product_variants" violates foreign key constraint "marketplace_order_items_variant_id_fkey" on table "marketplace_order_items"',
  details:
    'Key (id)=(v-1) is still referenced from table "marketplace_order_items".',
  hint: "",
};

describe("mensagemAmigavelErroProduto — variação que já tem vendas", () => {
  it("23503 da chave de pedidos diz que a variação já vendeu e manda DESLIGAR em vez de excluir", () => {
    const frase = mensagemAmigavelErroProduto(
      ERRO_VARIACAO_VENDIDA,
      "atualizar",
    );

    expect(frase).toMatch(/já tem vendas/i);
    expect(frase).toMatch(/desligue|desative/i);
    expect(frase).not.toMatch(/Não foi possível atualizar o produto agora/);
  });

  it("reconhece pelo texto mesmo se o Postgres só devolver um dos dois pedaços (nome da chave OU a mensagem da tabela)", () => {
    const soNome = mensagemAmigavelErroProduto(
      {
        code: "23503",
        message:
          "violates foreign key constraint marketplace_order_items_variant_id_fkey",
      },
      "atualizar",
    );
    const soTabela = mensagemAmigavelErroProduto(
      {
        code: "23503",
        message:
          'update or delete on table "product_variants" violates foreign key',
      },
      "atualizar",
    );

    expect(soNome).toMatch(/já tem vendas/i);
    expect(soTabela).toMatch(/já tem vendas/i);
  });

  it("outro 23503 (ex.: gravar variação de produto que não existe) NÃO ganha a frase de vendas", () => {
    const frase = mensagemAmigavelErroProduto(
      {
        code: "23503",
        message:
          'insert or update on table "product_variants" violates foreign key constraint "product_variants_product_id_fkey"',
      },
      "atualizar",
    );

    expect(frase).not.toMatch(/vendas/i);
    expect(frase).toMatch(/Não foi possível atualizar o produto agora/);
  });

  it("a frase de vendas só vale com o código 23503 (texto parecido sem código não conta)", () => {
    const frase = mensagemAmigavelErroProduto(
      { message: "marketplace_order_items_variant_id_fkey" },
      "atualizar",
    );

    expect(frase).not.toMatch(/vendas/i);
  });
});

describe("useProducts — apagar variação vendida e gravar estoque só do que mudou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.ordem.length = 0;
    mock.recusadas.clear();
    mock.apagadas.length = 0;
    apiRef = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    consoleErrorSpy.mockRestore();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(api) => {
            apiRef = api;
          }}
        />,
      );
    });
  }

  it("deleteVariants: recusa de variação vendida avisa com a frase de vendas e devolve o erro (quem chama decide o que fazer)", async () => {
    await montar();
    mock.recusadas = new Map(Object.entries({ "v-1": ERRO_VARIACAO_VENDIDA }));

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.deleteVariants(["v-1"]);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado?.code).toBe("23503");
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    expect(mock.toastError.mock.calls[0][0]).toMatch(/já tem vendas/i);
  });

  it("deleteVariants: lote só com sucesso faz UMA recarga e UM aviso, e apaga todas", async () => {
    await montar();

    await act(async () => {
      await apiRef!.deleteVariants(["v-1", "v-2", "v-3"]);
    });

    expect(mock.apagadas).toEqual(["v-1", "v-2", "v-3"]);
    expect(mock.fetchProductsContext).toHaveBeenCalledTimes(1);
    expect(mock.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mock.toastError).not.toHaveBeenCalled();
  });

  it("deleteVariants: a vendida não segura as outras — as demais saem, UMA recarga, UM aviso (o de erro), e o erro diz quais ficaram", async () => {
    await montar();
    mock.recusadas = new Map(Object.entries({ "v-2": ERRO_VARIACAO_VENDIDA }));

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.deleteVariants(["v-1", "v-2", "v-3"]);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(mock.apagadas).toEqual(["v-1", "v-3"]);
    expect(erroCapturado?.recusadas).toEqual(["v-2"]);
    expect(erroCapturado?.code).toBe("23503");
    // As que saíram de verdade precisam aparecer na tela: uma recarga só.
    expect(mock.fetchProductsContext).toHaveBeenCalledTimes(1);
    expect(mock.toastSuccess).not.toHaveBeenCalled();
    expect(mock.toastError).toHaveBeenCalledTimes(1);
    expect(mock.toastError.mock.calls[0][0]).toMatch(/já tem vendas/i);
  });

  it("deleteVariants: se NENHUMA saiu, não há o que recarregar", async () => {
    await montar();
    mock.recusadas = new Map(
      Object.entries({
        "v-1": ERRO_VARIACAO_VENDIDA,
        "v-2": ERRO_VARIACAO_VENDIDA,
      }),
    );

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.deleteVariants(["v-1", "v-2"]);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado?.recusadas).toEqual(["v-1", "v-2"]);
    expect(mock.fetchProductsContext).not.toHaveBeenCalled();
    expect(mock.toastError).toHaveBeenCalledTimes(1);
  });

  it("upsertVariants: variação existente SEM `stockIncrement` vai SEM a coluna stock_increment (nem null, nem o número velho)", async () => {
    await montar();

    await act(async () => {
      await apiRef!.upsertVariants("prod-1", [
        {
          id: "v-1",
          productId: "prod-1",
          name: "Cor",
          value: "Rosa",
          active: true,
        },
      ]);
    });

    const upserts = mock.ordem.filter((c) => c.tipo === "upsert");
    expect(upserts).toHaveLength(1);
    const linha = (upserts[0] as any).payload[0];
    expect(linha).toMatchObject({ id: "v-1", value: "Rosa", active: true });
    expect(Object.keys(linha)).not.toContain("stock_increment");
  });

  it("upsertVariants: existente COM estoque e existente SEM estoque vão em requisições separadas — nunca o lote misto", async () => {
    await montar();

    await act(async () => {
      await apiRef!.upsertVariants("prod-1", [
        {
          id: "v-1",
          productId: "prod-1",
          name: "Cor",
          value: "Rosa",
          stockIncrement: 9,
          active: true,
        },
        {
          id: "v-2",
          productId: "prod-1",
          name: "Cor",
          value: "Azul",
          active: true,
        },
      ]);
    });

    const upserts = mock.ordem.filter((c) => c.tipo === "upsert") as Array<{
      payload: any[];
    }>;
    expect(upserts).toHaveLength(2);
    const comEstoque = upserts.find((u) =>
      Object.keys(u.payload[0]).includes("stock_increment"),
    );
    const semEstoque = upserts.find(
      (u) => !Object.keys(u.payload[0]).includes("stock_increment"),
    );
    expect(comEstoque?.payload.map((l) => l.id)).toEqual(["v-1"]);
    expect(comEstoque?.payload[0].stock_increment).toBe(9);
    expect(semEstoque?.payload.map((l) => l.id)).toEqual(["v-2"]);
  });

  it("upsertVariants: variação NOVA sem estoque informado continua nascendo com o número (o formulário sempre o manda)", async () => {
    await montar();

    await act(async () => {
      await apiRef!.upsertVariants("prod-1", [
        {
          id: "temp-1",
          productId: "prod-1",
          name: "Cor",
          value: "Verde",
          stockIncrement: 4,
          active: true,
        },
      ]);
    });

    const inserts = mock.ordem.filter((c) => c.tipo === "insert");
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as any).payload[0].stock_increment).toBe(4);
  });
});
