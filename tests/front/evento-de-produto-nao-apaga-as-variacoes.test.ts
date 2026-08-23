// @vitest-environment jsdom
//
// "O card volta a deixar comprar sem escolher a variação": a guarda que a
// vitrine usa para exigir a escolha de uma variação lê `product.variants`.
// O payload de UPDATE/INSERT que o Supabase Realtime manda para `produtos`
// é a linha PURA da tabela -- sem `product_variants` embutido, diferente da
// `vw_produtos_public` que o `fetchProducts`/`catchUp` usam. Sem preservar o
// que já está no cofre, qualquer edição da lojista (mudar nome, preço,
// qualquer campo) apaga as variações do produto no IndexedDB: o card volta a
// dizer "Carrinho" e chama `onAddToCart` sem `variantId` -- pedido com
// `variant_id = NULL`, cobrando `preco_venda` e debitando `produtos.estoque`.
//
// Molde: o dublê de `DataVault` e o padrão de chamar
// `_applyChangeAndNotify` direto vêm de
// tests/front/produto-excluido-nao-volta-para-o-cache.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `realtimeSyncEngine.ts` importa `@/lib/supabase` no topo do módulo, e o
// client real falha ao construir em jsdom (sem Web Worker). O dublê evita
// isso -- nenhum caso deste arquivo chama a rede, timer ou IndexedDB de
// verdade.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const { RealtimeSyncEngine, TABLE_CONFIGS } = await import(
  "@/lib/realtimeSyncEngine"
);

function configDe(tabela: string) {
  const config = TABLE_CONFIGS.find((c) => c.table === tabela);
  expect(config, `TABLE_CONFIGS não tem a tabela "${tabela}"`).toBeDefined();
  return config!;
}

function criarDubleVault(produtoNoCofre: any = undefined) {
  return {
    put: vi.fn(async (_store: string, _registro: any) => undefined),
    deleteById: vi.fn(async (_store: string, _id: string) => undefined),
    setLastSync: vi.fn(async () => undefined),
    getById: vi.fn(async (_store: string, _id: string) => produtoNoCofre),
    getByIndex: vi.fn(async () => []),
  };
}

describe("realtimeSyncEngine — evento de produto não apaga as variações já sincronizadas", () => {
  let removerOuvinte: () => void;

  beforeEach(() => {
    removerOuvinte = RealtimeSyncEngine.onSync(() => {});
  });

  afterEach(() => {
    removerOuvinte();
  });

  it("mantém as variações do cofre quando o UPDATE de produtos não traz product_variants", async () => {
    const config = configDe("produtos");
    const produtoNoCofre = {
      id: "prod-camiseta",
      name: "Camiseta",
      stock: 8,
      variants: [
        {
          id: "var-p",
          productId: "prod-camiseta",
          name: "Tamanho",
          value: "P",
          stockIncrement: 3,
          active: true,
        },
        {
          id: "var-m",
          productId: "prod-camiseta",
          name: "Tamanho",
          value: "M",
          stockIncrement: 5,
          active: true,
        },
      ],
    };
    const vault = criarDubleVault(produtoNoCofre);

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-camiseta",
        nome: "Camiseta Azul",
        preco_venda: 49.9,
        estoque: 0,
        ativo: true,
      },
      {},
    );

    expect(vault.put).toHaveBeenCalledTimes(1);
    const [store, gravado] = vault.put.mock.calls[0];
    expect(store).toBe("products");
    expect(gravado.variants).toHaveLength(2);
    expect(gravado.variants.map((v: any) => v.id).sort()).toEqual([
      "var-m",
      "var-p",
    ]);
    // O estoque some junto com as variações no mapper (`row.estoque`, que é
    // 0 aqui): recalculado com a mesma fórmula do motor, é a soma das ATIVAS.
    expect(gravado.stock).toBe(8);
  });

  it("controle negativo: quando o payload TRAZ product_variants, vale o que veio nele", async () => {
    const config = configDe("produtos");
    const produtoNoCofre = {
      id: "prod-camiseta",
      name: "Camiseta",
      stock: 8,
      variants: [
        {
          id: "var-p",
          productId: "prod-camiseta",
          name: "Tamanho",
          value: "P",
          stockIncrement: 3,
          active: true,
        },
        {
          id: "var-m",
          productId: "prod-camiseta",
          name: "Tamanho",
          value: "M",
          stockIncrement: 5,
          active: true,
        },
      ],
    };
    const vault = criarDubleVault(produtoNoCofre);

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-camiseta",
        nome: "Camiseta Azul",
        preco_venda: 49.9,
        estoque: 0,
        ativo: true,
        product_variants: [
          {
            id: "var-g",
            product_id: "prod-camiseta",
            name: "Tamanho",
            value: "G",
            stock_increment: 9,
            active: true,
          },
        ],
      },
      {},
    );

    expect(vault.put).toHaveBeenCalledTimes(1);
    const [, gravado] = vault.put.mock.calls[0];
    expect(gravado.variants).toHaveLength(1);
    expect(gravado.variants[0].id).toBe("var-g");
  });

  it("produto novo (cofre ainda sem ele): grava o mapeado como veio, sem inventar variação", async () => {
    const config = configDe("produtos");
    const vault = criarDubleVault(undefined);

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "INSERT",
      {
        id: "prod-novo",
        nome: "Caneca",
        preco_venda: 19.9,
        estoque: 4,
        ativo: true,
      },
      {},
    );

    expect(vault.put).toHaveBeenCalledTimes(1);
    const [, gravado] = vault.put.mock.calls[0];
    expect(gravado.variants).toEqual([]);
    expect(gravado.stock).toBe(4);
  });

  it("variação inativa não entra na conta do estoque preservado", async () => {
    const config = configDe("produtos");
    const produtoNoCofre = {
      id: "prod-camiseta",
      name: "Camiseta",
      stock: 8,
      variants: [
        {
          id: "var-p",
          productId: "prod-camiseta",
          name: "Tamanho",
          value: "P",
          stockIncrement: 3,
          active: true,
        },
        {
          id: "var-m",
          productId: "prod-camiseta",
          name: "Tamanho",
          value: "M",
          stockIncrement: 5,
          active: false,
        },
      ],
    };
    const vault = criarDubleVault(produtoNoCofre);

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-camiseta",
        nome: "Camiseta Azul",
        preco_venda: 49.9,
        estoque: 0,
        ativo: true,
      },
      {},
    );

    const [, gravado] = vault.put.mock.calls[0];
    expect(gravado.stock).toBe(3);
  });
});
