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
    async mutate<T>(
      store: string,
      _id: string,
      update: (current: T | undefined) => T | undefined,
    ) {
      const registro = update(produtoNoCofre as unknown as T | undefined);
      if (registro !== undefined) await this.put(store, registro);
      return registro;
    },
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

  // Achado da revisao, e e o caso que mais dói: TODO produto simples esta no
  // cofre com `variants: []` (o mapeamento sempre grava esse campo). Sem o
  // `?.length` na guarda, cada edicao da lojista recalcularia o estoque desses
  // produtos somando uma lista VAZIA -- zero -- e a loja inteira viraria
  // "Esgotado" a cada salvamento. A mutacao que tira o `?.length` sobrevivia
  // aos quatro casos anteriores.
  it("produto sem variacao no cofre continua com o estoque que veio no evento", async () => {
    const config = configDe("produtos");
    const vault = criarDubleVault({
      id: "prod-simples",
      name: "Caneca",
      variants: [],
      stock: 9,
    });

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      config,
      "UPDATE",
      {
        id: "prod-simples",
        nome: "Caneca",
        preco_venda: 19.9,
        estoque: 4,
        ativo: true,
      },
      {},
    );

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

// Produto com TODAS as variações desligadas (ou a última apagada) continua
// vendável pelo estoque de base -- é o que `mapProductFromDB` já mostra na
// carga normal (`some(active) ? soma das ativas : estoque`). O motor somava só
// as ativas SEM esse "senão" e, com nenhuma ativa, zerava o estoque: a vitrine
// ao vivo dizia "Esgotado" num produto que o servidor ainda vende, até a
// página recarregar.
describe("realtimeSyncEngine — sem variação ativa o estoque de base vale, nunca zero", () => {
  let removerOuvinte: () => void;

  beforeEach(() => {
    removerOuvinte = RealtimeSyncEngine.onSync(() => {});
  });

  afterEach(() => {
    removerOuvinte();
  });

  const variacaoDoCofre = (id: string, estoque: number, active: boolean) => ({
    id,
    productId: "prod-camiseta",
    name: "Tamanho",
    value: id,
    stockIncrement: estoque,
    active,
  });

  // Dublê com os dois cofres que o motor toca nos eventos de variação: o de
  // `product_variants` (para achar o produto da variação apagada) e o de
  // `products`.
  function criarCofreDeProdutoEVariacoes(
    produtoInicial: any,
    variacaoApagada?: any,
  ) {
    let produto = produtoInicial;
    return {
      async mutate<T>(
        store: string,
        _id: string,
        update: (current: T | undefined) => T | undefined,
      ) {
        const registro = update(produto as unknown as T | undefined);
        if (registro !== undefined) await this.put(store, registro);
        return registro;
      },
      put: vi.fn(async (store: string, registro: any) => {
        if (store === "products") produto = registro;
      }),
      deleteById: vi.fn(async (_store: string, _id: string) => undefined),
      setLastSync: vi.fn(async () => undefined),
      getById: vi.fn(async (store: string, _id: string) =>
        store === "product_variants" ? variacaoApagada : produto,
      ),
      getByIndex: vi.fn(async () => []),
    };
  }

  // Sem guardar a base do evento de produtos, o último evento de variação
  // reaproveita a soma anterior (5), em vez do zero gravado pela lojista.
  it.each(["UPDATE", "DELETE"] as const)(
    "%s da última variação ativa usa a base recebida antes, não a soma antiga",
    async (ultimoEvento) => {
      const vault = criarCofreDeProdutoEVariacoes(
        {
          id: "prod-camiseta",
          name: "Camiseta",
          stock: 8,
          variants: [
            variacaoDoCofre("var-p", 3, true),
            variacaoDoCofre("var-m", 5, true),
          ],
        },
        variacaoDoCofre("var-m", 5, true),
      );

      // A RPC grava produtos antes de desligar as variações.
      await RealtimeSyncEngine._applyChangeAndNotify(
        vault as any,
        configDe("produtos"),
        "UPDATE",
        {
          id: "prod-camiseta",
          nome: "Camiseta",
          preco_venda: 49.9,
          estoque: 0,
          ativo: true,
        },
        {},
      );
      expect((await vault.getById("products", "prod-camiseta")).stock).toBe(8);

      await RealtimeSyncEngine._applyChangeAndNotify(
        vault as any,
        configDe("product_variants"),
        "UPDATE",
        {
          id: "var-p",
          product_id: "prod-camiseta",
          name: "Tamanho",
          value: "P",
          stock_increment: 3,
          active: false,
        },
        {},
      );
      // Enquanto sobrar uma ativa, vale a soma, mesmo com base zero.
      expect((await vault.getById("products", "prod-camiseta")).stock).toBe(5);

      await RealtimeSyncEngine._applyChangeAndNotify(
        vault as any,
        configDe("product_variants"),
        ultimoEvento,
        ultimoEvento === "UPDATE"
          ? {
              id: "var-m",
              product_id: "prod-camiseta",
              name: "Tamanho",
              value: "M",
              stock_increment: 5,
              active: false,
            }
          : {},
        ultimoEvento === "DELETE" ? { id: "var-m" } : {},
      );

      const gravado = await vault.getById("products", "prod-camiseta");
      expect(gravado.variants.every((v: any) => !v.active)).toBe(true);
      expect(gravado.stock).toBe(0);
    },
  );

  it("UPDATE de produtos com as variações do cofre todas desligadas: fica o estoque de base (7), não 0", async () => {
    const vault = criarCofreDeProdutoEVariacoes({
      id: "prod-camiseta",
      name: "Camiseta",
      stock: 7,
      variants: [
        variacaoDoCofre("var-p", 3, false),
        variacaoDoCofre("var-m", 5, false),
      ],
    });

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      configDe("produtos"),
      "UPDATE",
      {
        id: "prod-camiseta",
        nome: "Camiseta",
        preco_venda: 49.9,
        estoque: 7,
        ativo: true,
      },
      {},
    );

    const [, gravado] = vault.put.mock.calls[0];
    expect(gravado.variants).toHaveLength(2);
    expect(gravado.stock).toBe(7);
  });

  it("evento de uma variação desligada, sem nenhuma ativa no produto: o estoque do produto não vira 0", async () => {
    const vault = criarCofreDeProdutoEVariacoes({
      id: "prod-camiseta",
      name: "Camiseta",
      stock: 7,
      variants: [
        variacaoDoCofre("var-p", 3, false),
        variacaoDoCofre("var-m", 5, false),
      ],
    });

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      configDe("product_variants"),
      "UPDATE",
      {
        id: "var-m",
        product_id: "prod-camiseta",
        name: "Tamanho",
        value: "var-m",
        stock_increment: 5,
        active: false,
      },
      {},
    );

    const gravadoNoProduto = vault.put.mock.calls.find(
      ([store]) => store === "products",
    )?.[1];
    expect(gravadoNoProduto.stock).toBe(7);
  });

  it("apagar a última variação: o produto segue com o estoque que tinha, não 0", async () => {
    const vault = criarCofreDeProdutoEVariacoes(
      {
        id: "prod-camiseta",
        name: "Camiseta",
        stock: 7,
        variants: [variacaoDoCofre("var-p", 3, false)],
      },
      variacaoDoCofre("var-p", 3, false),
    );

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      configDe("product_variants"),
      "DELETE",
      {},
      { id: "var-p" },
    );

    const gravadoNoProduto = vault.put.mock.calls.find(
      ([store]) => store === "products",
    )?.[1];
    expect(gravadoNoProduto.variants).toEqual([]);
    expect(gravadoNoProduto.stock).toBe(7);
  });

  it("controle: com uma variação ativa e outra apagada, a soma das ativas continua valendo", async () => {
    const vault = criarCofreDeProdutoEVariacoes(
      {
        id: "prod-camiseta",
        name: "Camiseta",
        stock: 8,
        variants: [
          variacaoDoCofre("var-p", 3, true),
          variacaoDoCofre("var-m", 5, true),
        ],
      },
      variacaoDoCofre("var-m", 5, true),
    );

    await RealtimeSyncEngine._applyChangeAndNotify(
      vault as any,
      configDe("product_variants"),
      "DELETE",
      {},
      { id: "var-m" },
    );

    const gravadoNoProduto = vault.put.mock.calls.find(
      ([store]) => store === "products",
    )?.[1];
    expect(gravadoNoProduto.stock).toBe(3);
  });
});
