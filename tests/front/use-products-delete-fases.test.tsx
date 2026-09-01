// @vitest-environment jsdom
//
// Issue #99 (ADMIN-070) — em `deleteProduct` (src/hooks/useProducts.ts), a
// mídia do produto ia para `backup/` no Storage ANTES do soft-delete no
// banco. Se o UPDATE em `produtos` falhasse, o catch fazia rollback do state
// e do cache — mas os arquivos JÁ tinham sido movidos no Storage, então o
// produto "restaurado" na listagem ficava com todas as fotos quebradas
// (URLs apontando para um caminho que não existe mais).
//
// Este arquivo testa o hook isoladamente, sem montar nenhuma view — mesmo
// padrão de use-busca-cep.test.tsx: um componente sonda mínimo que só existe
// para montar `useProducts` e expor a API do hook para o teste chamar
// diretamente. `@/lib/supabase` é mockado com um dublê fluente que registra
// CADA chamada (tabela, payload, storage move) numa lista ordenada — é essa
// lista que prova a ordem das fases, não uma leitura de tela.
//
// `@/lib/mappers` é mockado com um `mapProductFromDB` "identidade" (só
// remapeia os nomes de campo) de propósito: o mapper REAL sempre substitui
// `images: []` por uma URL de placeholder (extractProductImages), então não
// dá para alcançar o caminho "produto sem imagens" através dele. O que este
// arquivo testa é o que `deleteProduct` faz com `product.images`, não o
// mapeamento de linha do banco — isso já é coberto em mappers.test.ts.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada =
  | { tipo: "update"; tabela: string; payload: any; id: string }
  // Laudo 0109 (A2): o backup da mídia era `.move` no storage e passou a
  // `.copy` — URLs legadas de imagem são compartilhadas (produto duplicado
  // antes de a duplicação copiar arquivos) e mover o arquivo do produto
  // excluído apagava as fotos do sobrevivente. A ORDEM das fases que este
  // arquivo prende não muda: só a operação do storage, que agora é cópia.
  | { tipo: "copy"; from: string; to: string };

// Todo o estado mutável referenciado DENTRO dos factories de `vi.mock` abaixo
// precisa nascer via `vi.hoisted` — este arquivo tem um `import` estático de
// `@/hooks/useProducts` no topo (obrigatório: `Sonda` usa o hook como JSX),
// e imports estáticos avaliam ANTES de qualquer `const` do módulo. Como
// `vi.mock` é hoisted para o topo do arquivo, os factories rodam nesse
// momento (ao carregar `@/hooks/useProducts`, que importa `sonner` e
// `@/lib/supabase`) — um `const toastSuccess = vi.fn()` comum ainda estaria
// em TDZ nesse ponto. Mesmo problema documentado no comentário de
// `mockConfig` em address-form-cep-race.test.tsx.
const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  ordem: [] as Chamada[],
  resultadoUpdateProdutos: [] as Array<{ error: any }>,
  resultadoMove: (async () => ({ error: null })) as () => Promise<{
    error: any;
  }>,
  resultadoUpdateVariant: { error: null } as { error: any },
  rpcRowsAdmin: [] as any[],
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
  mapProductFromDB: (row: any) => ({
    id: row.id,
    name: row.nome,
    description: row.descricao || "",
    price: row.preco_venda,
    stock: row.estoque,
    category: row.categoria || "Geral",
    images: row.imagem_urls || [],
    isActive: row.ativo ?? true,
    isBestseller: false,
    freeShipping: false,
    sold: 0,
    variants: (row.product_variants || []).map((v: any) => ({
      id: v.id,
      productId: v.product_id,
      name: v.name,
      value: v.value,
      sku: v.sku,
      stockIncrement: v.stock_increment,
      priceOverride: v.price_override,
      active: v.active,
      imageUrl: v.image_url,
    })),
    createdAt: "2026-01-01T00:00:00.000Z",
  }),
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
    rpc: (nome: string) => {
      if (nome === "get_admin_products_paged") {
        return {
          abortSignal: () =>
            Promise.resolve({
              data: {
                data: mock.rpcRowsAdmin,
                total_count: mock.rpcRowsAdmin.length,
              },
              error: null,
            }),
        };
      }
      throw new Error(`RPC não mockada neste teste: ${nome}`);
    },
    from: (tabela: string) => ({
      update: (payload: any) => ({
        eq: async (_col: string, id: string) => {
          if (tabela === "produtos") {
            mock.ordem.push({ tipo: "update", tabela, payload, id });
            const proximo = mock.resultadoUpdateProdutos.shift();
            return proximo ?? { error: null };
          }
          if (tabela === "product_variants") {
            mock.ordem.push({ tipo: "update", tabela, payload, id });
            return mock.resultadoUpdateVariant;
          }
          return { error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        copy: async (from: string, to: string) => {
          mock.ordem.push({ tipo: "copy", from, to });
          return mock.resultadoMove();
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://proj.supabase.co/storage/v1/object/public/products/${path}`,
          },
        }),
      }),
    },
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

const produtoComDuasImagens = {
  id: "prod-del-1",
  nome: "Produto Teste Delete",
  descricao: "Descrição",
  preco_venda: 50,
  estoque: 3,
  categoria: "Geral",
  imagem_urls: [
    "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg",
    "https://proj.supabase.co/storage/v1/object/public/products/foto2.jpg",
  ],
  ativo: true,
  product_variants: [
    {
      id: "var-1",
      product_id: "prod-del-1",
      name: "Cor",
      value: "Azul",
      sku: "SKU-1",
      stock_increment: 3,
      price_override: null,
      active: true,
      image_url:
        "https://proj.supabase.co/storage/v1/object/public/products/variante1.jpg",
    },
  ],
};

const produtoSemImagens = {
  id: "prod-del-2",
  nome: "Produto Sem Fotos",
  descricao: "Descrição",
  preco_venda: 20,
  estoque: 1,
  categoria: "Geral",
  imagem_urls: [],
  ativo: true,
  product_variants: [],
};

describe("useProducts.deleteProduct — #99 ordem das fases", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // `vi.clearAllMocks()` — não `resetAllMocks`/`restoreAllMocks` — de
    // propósito: as duas outras apagam a implementação dos `vi.fn()`
    // guardados em `mock` (criado uma única vez via `vi.hoisted`), incluindo
    // o `mockResolvedValue` de `fetchProductsContext` abaixo. Isso já
    // quebrou o SEGUNDO teste da suíte inteira (o primeiro `afterEach` com
    // `restoreAllMocks()` zerava `fetchProductsContext` para um stub sem
    // implementação, e o `Sonda` nem chegava a montar).
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.ordem.length = 0;
    mock.resultadoUpdateProdutos.length = 0;
    mock.resultadoMove = async () => ({ error: null });
    mock.resultadoUpdateVariant = { error: null };
    mock.rpcRowsAdmin = [produtoComDuasImagens];
    apiRef = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // useProducts.ts tem um efeito não relacionado ao que este arquivo testa
    // (sincronizar fila offline) que, com `navigator.onLine` true (padrão do
    // jsdom), agenda um `setTimeout(..., 1000)` REAL a cada montagem — sem
    // isto, esse timer sobrevive ao `raiz.unmount()` (não tem cleanup
    // próprio) e explode depois que o teste já terminou, tentando ler
    // `localStorage` de um ambiente já desmontado ("Unhandled Rejection").
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

  async function montarECarregar() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(api) => {
            apiRef = api;
          }}
        />,
      );
    });
    await act(async () => {
      await apiRef!.loadProducts(0, 10);
    });
  }

  it("soft-delete no banco acontece ANTES de mover qualquer mídia para backup/", async () => {
    await montarECarregar();

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProduct("prod-del-1");
    });

    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("Produto removido");

    // A primeira chamada de toda a operação tem de ser o UPDATE em
    // `produtos` (o soft-delete) — nenhum `move` de Storage pode vir antes.
    expect(mock.ordem[0]).toMatchObject({
      tipo: "update",
      tabela: "produtos",
      id: "prod-del-1",
    });
    expect((mock.ordem[0] as any).payload).toMatchObject({
      ativo: false,
    });
    expect((mock.ordem[0] as any).payload.deleted_at).toBeTruthy();

    // As chamadas de `move` (mídia) só podem aparecer DEPOIS do índice 0.
    const indicesDeMove = mock.ordem
      .map((c, i) => (c.tipo === "copy" ? i : -1))
      .filter((i) => i >= 0);
    expect(indicesDeMove.length).toBeGreaterThan(0);
    expect(Math.min(...indicesDeMove)).toBeGreaterThan(0);
  });

  it("falha no soft-delete: NUNCA move mídia, e o rollback restaura o produto na lista", async () => {
    await montarECarregar();
    mock.resultadoUpdateProdutos = [{ error: { message: "conexão perdida" } }];

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProduct("prod-del-1");
    });

    expect(resultado).toBe(false);
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produto");

    // Critério de aceite central da #99: se o UPDATE falha, nenhuma foto foi
    // movida — antes do conserto, o laço de backup rodava ANTES do UPDATE,
    // então uma falha aqui já deixava as imagens órfãs no Storage mesmo com
    // o produto de volta na listagem.
    const chamadasDeMove = mock.ordem.filter((c) => c.tipo === "copy");
    expect(chamadasDeMove).toHaveLength(0);

    // Rollback: o produto continua na lista local.
    expect(apiRef!.products.map((p) => p.id)).toContain("prod-del-1");
  });

  // Achado da revisão de contexto limpo (Trilha 1, #98/#99): o nome original
  // deste teste prometia provar que uma falha de mídia não desfaz o
  // soft-delete — mas `mock.resultadoMove` só simula uma falha "suave" (o
  // Storage responde `{ error }`), e `backupStorageFile` (useProducts.ts)
  // ENGOLE esse tipo de erro: registra em console.error e devolve a URL
  // ORIGINAL, nunca `null` nem uma exceção. Ou seja, mesmo o código ANTERIOR
  // à #99 (mídia antes do soft-delete, sem try/catch dedicado) chegava ao
  // mesmo resultado — `resultado === true`, `toastSuccess` chamado,
  // `toastError` não chamado, UPDATE de soft-delete presente — porque a
  // "falha" nunca vira uma exceção capaz de estourar o try/catch de nenhuma
  // das duas versões. Nenhuma das quatro asserções abaixo distingue antes de
  // depois.
  //
  // Renomeado para o que ele realmente prova: uma guarda de regressão de que
  // o comportamento atual (falha suave de Storage não impede o soft-delete
  // nem gera erro pro admin) continua valendo — não um teste que provaria a
  // ordem da #99 (essa prova já está no teste anterior, que compara índices
  // em `mock.ordem`).
  it("guarda de regressão: falha suave de Storage na fase de mídia não desfaz o soft-delete nem devolve erro ao admin", async () => {
    await montarECarregar();
    mock.resultadoMove = async () => ({
      error: { message: "Storage indisponível" },
    });

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProduct("prod-del-1");
    });

    // O soft-delete já tinha sido confirmado com sucesso — a falha de mídia
    // (best-effort, depois) não pode reverter isso nem virar "Erro ao
    // excluir produto" para o admin.
    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("Produto removido");
    expect(mock.toastError).not.toHaveBeenCalled();
    expect(apiRef!.products.map((p) => p.id)).not.toContain("prod-del-1");

    // O soft-delete de fato rodou antes da falha de mídia.
    expect(
      mock.ordem.some(
        (c) =>
          c.tipo === "update" &&
          c.tabela === "produtos" &&
          c.id === "prod-del-1",
      ),
    ).toBe(true);
  });

  it("produto sem imagens não escreve imagem_urls/imagem_url à toa", async () => {
    mock.rpcRowsAdmin = [produtoSemImagens];
    await montarECarregar();

    await act(async () => {
      await apiRef!.deleteProduct("prod-del-2");
    });

    // Sem imagens para mover, a fase de mídia não tem nada a fazer — o único
    // UPDATE em `produtos` é o soft-delete, sem um segundo UPDATE zerando
    // imagem_urls/imagem_url à toa (o que o código antigo fazia sempre,
    // mesmo sem imagem nenhuma).
    const updatesEmProdutos = mock.ordem.filter(
      (c) => c.tipo === "update" && c.tabela === "produtos",
    );
    expect(updatesEmProdutos).toHaveLength(1);
    expect((updatesEmProdutos[0] as any).payload.imagem_urls).toBeUndefined();

    expect(mock.ordem.filter((c) => c.tipo === "copy")).toHaveLength(0);
  });

  it("os dois backups de imagem rodam em paralelo (Promise.all), não em sequência", async () => {
    await montarECarregar();

    const pendentes = new Map<string, () => void>();
    mock.resultadoMove = () =>
      new Promise((resolve) => {
        // Cada chamada de move() pendura sua própria resolução — se o
        // código ainda usasse `for...of` com `await` sequencial, a SEGUNDA
        // chamada de move() só apareceria em `ordem` depois que a primeira
        // resolvesse. Com Promise.all, as duas aparecem antes de qualquer
        // uma resolver.
        pendentes.set(`resolver-${pendentes.size}`, () =>
          resolve({ error: null }),
        );
      });

    const promessaDelete = act(async () => {
      return apiRef!.deleteProduct("prod-del-1");
    });

    // Dá tempo do soft-delete (síncrono no mock) e do início da fase de
    // mídia rodarem antes de inspecionar `ordem`.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    try {
      const chamadasDeMovePendentes = mock.ordem.filter(
        (c) => c.tipo === "copy",
      );
      // As DUAS chamadas de move (uma por imagem) já foram disparadas, mesmo
      // com nenhuma delas ainda resolvida — só um Promise.all alcança isso.
      expect(chamadasDeMovePendentes).toHaveLength(2);
    } finally {
      // SEMPRE drena os resolvers pendentes, mesmo se a asserção acima
      // falhar (RED, antes do conserto) — senão `promessaDelete` fica presa
      // para sempre e vaza um `act()` aberto para o próximo teste do
      // arquivo (foi exatamente isso que aconteceu na primeira versão deste
      // arquivo: o teste seguinte quebrava com "Cannot read properties of
      // undefined" porque este aqui nunca soltava o `act()`). Roda um número
      // FIXO de rodadas, sem sair cedo quando `pendentes` estiver vazio no
      // meio do caminho: no código ANTIGO (sequencial) a segunda/terceira
      // chamada de move() só nasce alguns microtasks DEPOIS da anterior
      // resolver — sair no primeiro "vazio" corta o dreno antes dela
      // aparecer e trava `promessaDelete` para sempre (foi o que aconteceu
      // na segunda versão: "Test timed out in 5000ms").
      for (let rodada = 0; rodada < 15; rodada++) {
        const pendentesAgora = [...pendentes.values()];
        pendentes.clear();
        for (const resolver of pendentesAgora) resolver();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
      await promessaDelete;
    }
  });

  it("o erro do UPDATE de product_variants não é mais descartado em silêncio", async () => {
    await montarECarregar();
    mock.resultadoUpdateVariant = { error: { message: "RLS negou o update" } };

    await act(async () => {
      await apiRef!.deleteProduct("prod-del-1");
    });

    expect(
      consoleErrorSpy.mock.calls.some((call: unknown[]) =>
        call.some(
          (arg: unknown) =>
            typeof arg === "object" &&
            arg !== null &&
            (arg as any).message === "RLS negou o update",
        ),
      ),
    ).toBe(true);
  });

  // Conserto 5 (revisão da Trilha 1, #98/#99): `backupStorageFile` nunca
  // devolve `null` numa falha de Storage — ela é engolida e a URL ORIGINAL
  // volta (verdadeira). Antes, `if (!newUrl) return;` nunca barrava esse
  // caso, então toda falha de backup de imagem de variante ainda disparava
  // um UPDATE em `product_variants` gravando o valor que já estava lá — uma
  // ida ao banco à toa por variante. Este teste falha se essa comparação
  // (`newUrl === v.imageUrl`) for removida.
  it("conserto 5: falha suave no backup da imagem da variante não gera UPDATE em product_variants (URL não mudou)", async () => {
    await montarECarregar();
    mock.resultadoMove = async () => ({
      error: { message: "Storage indisponível" },
    });

    await act(async () => {
      await apiRef!.deleteProduct("prod-del-1");
    });

    const updatesEmVariantes = mock.ordem.filter(
      (c) => c.tipo === "update" && c.tabela === "product_variants",
    );
    expect(updatesEmVariantes).toHaveLength(0);
  });
});

describe("useProducts.deleteProducts (lote) — #99 mesma ordem do unitário", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.ordem.length = 0;
    mock.resultadoUpdateProdutos.length = 0;
    mock.resultadoMove = async () => ({ error: null });
    mock.resultadoUpdateVariant = { error: null };
    mock.rpcRowsAdmin = [produtoComDuasImagens, produtoSemImagens];
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

  async function montarECarregar() {
    await act(async () => {
      raiz.render(
        <Sonda
          onReady={(api) => {
            apiRef = api;
          }}
        />,
      );
    });
    await act(async () => {
      await apiRef!.loadProducts(0, 10);
    });
  }

  it("soft-delete de cada produto acontece ANTES de mover a mídia daquele produto — mesmo defeito da #99, 90 linhas abaixo", async () => {
    await montarECarregar();

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProducts(["prod-del-1"]);
    });

    expect(resultado).toBe(true);

    // A primeira chamada de toda a operação tem de ser o UPDATE em
    // `produtos` (o soft-delete) — nenhum `move` de Storage pode vir antes.
    // Antes do conserto, as linhas 926-957 (mídia) rodavam ANTES do UPDATE
    // com `imagem_urls` — exatamente o defeito da #99, sem chamador nenhum
    // até hoje.
    expect(mock.ordem[0]).toMatchObject({
      tipo: "update",
      tabela: "produtos",
      id: "prod-del-1",
    });
    expect((mock.ordem[0] as any).payload).toMatchObject({ ativo: false });
    expect((mock.ordem[0] as any).payload.imagem_urls).toBeUndefined();

    const indicesDeMove = mock.ordem
      .map((c, i) => (c.tipo === "copy" ? i : -1))
      .filter((i) => i >= 0);
    expect(indicesDeMove.length).toBeGreaterThan(0);
    expect(Math.min(...indicesDeMove)).toBeGreaterThan(0);
  });

  it("falha no soft-delete de um produto do lote NUNCA move mídia, e o rollback restaura o lote inteiro", async () => {
    await montarECarregar();
    mock.resultadoUpdateProdutos = [{ error: { message: "conexão perdida" } }];

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProducts(["prod-del-1", "prod-del-2"]);
    });

    expect(resultado).toBe(false);
    expect(mock.toastError).toHaveBeenCalledWith("Erro ao excluir produtos");

    // O primeiro produto do lote já falha no soft-delete — nenhuma foto foi
    // movida para nenhum dos dois produtos.
    const chamadasDeMove = mock.ordem.filter((c) => c.tipo === "copy");
    expect(chamadasDeMove).toHaveLength(0);

    expect(apiRef!.products.map((p) => p.id)).toContain("prod-del-1");
    expect(apiRef!.products.map((p) => p.id)).toContain("prod-del-2");
  });

  it("lote com sucesso: mídia depois do soft-delete de CADA produto, best-effort", async () => {
    await montarECarregar();

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.deleteProducts(["prod-del-1", "prod-del-2"]);
    });

    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("2 produtos removidos");

    const updatesEmProdutos = mock.ordem.filter(
      (c) => c.tipo === "update" && c.tabela === "produtos",
    );
    // prod-del-1 tem imagens: 1 UPDATE de soft-delete + 1 UPDATE de mídia
    // (imagem_urls). prod-del-2 não tem imagens: só o soft-delete — sem um
    // segundo UPDATE zerando imagem_urls/imagem_url à toa.
    expect(updatesEmProdutos).toHaveLength(3);

    const updatesDoProd2 = updatesEmProdutos.filter(
      (c: any) => c.id === "prod-del-2",
    );
    expect(updatesDoProd2).toHaveLength(1);
    expect((updatesDoProd2[0] as any).payload.imagem_urls).toBeUndefined();
  });
});
