// @vitest-environment jsdom
//
// "Não consegui salvar o produto" (cliente pagante, 03/10/2026) -- o SKU da
// VARIAÇÃO é UNIQUE na loja inteira (`product_variants_sku_key`, baseline do
// schema; `produtos.codigo`, o do produto, não tem constraint nenhuma). Antes
// desta peça, quem repetia um SKU de variação via:
//
//   - produto NOVO: o produto era criado, o insert da grade batia no 23505, e
//     a tela voltava para a lista com "Salvo" -- um produto sem a grade e um
//     aviso que não dizia qual SKU nem por quê;
//   - produto EXISTENTE: "Não foi possível atualizar o produto agora. Confira
//     os dados" -- sem dizer QUE dado.
//
// O que se prova aqui: a tradutora diz o motivo do SKU repetido (e das duas
// outras recusas que a lojista não consegue ler: sessão/permissão e falta de
// internet), e o cadastro de produto novo confere os SKUs ANTES de gravar o
// produto, para não deixar produto órfão sem grade.
//
// Mesmo molde de use-products-codigo-de-barras-percorre-o-caminho.test.tsx:
// o dublê de `@/lib/supabase` OBSERVA cada chamada, em ordem.
import { mensagemAmigavelErroProduto, useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = {
  tabela: string;
  op: "insert" | "update" | "upsert" | "select";
  payload: any;
  opts?: any;
};

const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  chamadas: [] as Chamada[],
  // Chave "<tabela>:<operação>" -> o que aquela chamada devolve.
  resultados: {} as Record<string, { data?: any; error?: any }>,
}));

const RESULTADO_PADRAO = { data: {}, error: null };

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
  mapVariantFromDB: (row: any) => row,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mock.toastSuccess,
    error: mock.toastError,
    loading: vi.fn(),
  },
}));

function encadear(resultado: { data?: any; error?: any }) {
  const chain = Promise.resolve(resultado) as Promise<typeof resultado> & {
    eq: () => typeof chain;
    in: () => typeof chain;
    select: () => typeof chain;
    single: () => Promise<typeof resultado>;
  };
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.select = () => chain;
  chain.single = () => Promise.resolve(resultado);
  return chain;
}

function registrar(
  tabela: string,
  op: Chamada["op"],
  payload: any,
  opts?: any,
) {
  mock.chamadas.push({ tabela, op, payload, opts });
  return mock.resultados[`${tabela}:${op}`] ?? RESULTADO_PADRAO;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      // A conferência de SKU: `.select("sku, ...").in("sku", [...])`.
      select: (colunas: string) => {
        mock.chamadas.push({ tabela, op: "select", payload: colunas });
        return encadear(
          mock.resultados[`${tabela}:select`] ?? { data: [], error: null },
        );
      },
      insert: (payload: any) => encadear(registrar(tabela, "insert", payload)),
      update: (payload: any) => encadear(registrar(tabela, "update", payload)),
      upsert: (payload: any, opts: any) =>
        encadear(registrar(tabela, "upsert", payload, opts)),
    }),
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

function chamadasDe(tabela: string, op: Chamada["op"]) {
  return mock.chamadas.filter((c) => c.tabela === tabela && c.op === op);
}

const MSG_SKU_REPETIDO_NO_BANCO =
  "Este SKU já está em outra variação da loja. Cada variação precisa de um SKU diferente.";

describe("mensagemAmigavelErroProduto -- recusas que a lojista não conseguia ler", () => {
  it("23505 do índice de SKU da variação diz que o SKU já existe", () => {
    const erro = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "product_variants_sku_key"',
      details: "Key (sku)=(CAM-P) already exists.",
    };
    expect(mensagemAmigavelErroProduto(erro, "atualizar")).toBe(
      MSG_SKU_REPETIDO_NO_BANCO,
    );
    expect(mensagemAmigavelErroProduto(erro, "cadastrar")).toBe(
      MSG_SKU_REPETIDO_NO_BANCO,
    );
  });

  it("23505 de OUTRO índice continua no genérico (não inventa causa)", () => {
    const erro = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "produtos_pkey"',
    };
    expect(mensagemAmigavelErroProduto(erro, "atualizar")).toBe(
      "Não foi possível atualizar o produto agora. Confira os dados e tente novamente.",
    );
  });

  it("sessão vencida ou sem permissão (42501 / JWT expired) manda entrar de novo", () => {
    const frase =
      "Sua sessão expirou ou você não tem permissão para salvar. Saia da conta, entre de novo e tente outra vez.";
    expect(
      mensagemAmigavelErroProduto(
        {
          code: "42501",
          message: 'new row violates row-level security policy for table "x"',
        },
        "cadastrar",
      ),
    ).toBe(frase);
    expect(
      mensagemAmigavelErroProduto(
        { code: "PGRST301", message: "JWT expired" },
        "atualizar",
      ),
    ).toBe(frase);
  });

  it("falta de internet (TypeError do fetch) diz que é a conexão", () => {
    const frase =
      "Sem conexão com a internet. Confira a conexão e tente salvar de novo.";
    expect(
      mensagemAmigavelErroProduto(
        new TypeError("Failed to fetch"),
        "cadastrar",
      ),
    ).toBe(frase);
    expect(
      mensagemAmigavelErroProduto(
        new TypeError("NetworkError when attempting to fetch resource."),
        "atualizar",
      ),
    ).toBe(frase);
  });
});

describe("useProducts.addProduct -- SKU de variação conferido ANTES de gravar o produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.chamadas.length = 0;
    mock.resultados = {};
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

  const variante = (extra: Record<string, unknown>) => ({
    id: `temp-${Math.random()}`,
    productId: "",
    name: "Tamanho",
    value: "P",
    stockIncrement: 1,
    active: true,
    ...extra,
  });

  const produto = (variants: unknown[]) => ({
    name: "Camiseta",
    description: "Algodão",
    price: 50,
    stock: 2,
    images: [] as string[],
    variants,
  });

  async function tentarCadastrar(variants: unknown[]) {
    let erro: any;
    await act(async () => {
      try {
        await apiRef!.addProduct(produto(variants) as any);
      } catch (e) {
        erro = e;
      }
    });
    return erro;
  }

  it("SKU que já é de OUTRA variação da loja: não cria o produto e diz o SKU", async () => {
    mock.resultados["product_variants:select"] = {
      data: [
        {
          sku: "CAM-P",
          product_id: "outro-produto",
          produtos: { nome: "Camiseta Antiga", deleted_at: null },
        },
      ],
      error: null,
    };
    await montar();
    const erro = await tentarCadastrar([variante({ sku: "CAM-P" })]);

    expect(erro).toBeDefined();
    // Nada foi gravado: nem o produto (órfão sem grade), nem a grade.
    expect(chamadasDe("vw_produtos_admin", "insert")).toHaveLength(0);
    expect(chamadasDe("product_variants", "insert")).toHaveLength(0);
    const [frase] = mock.toastError.mock.calls[0] as [string];
    expect(frase).toContain("CAM-P");
    expect(frase).toContain("Camiseta Antiga");
  });

  it("SKU preso a um produto EXCLUÍDO: diz que o produto foi excluído mas o SKU segue reservado", async () => {
    mock.resultados["product_variants:select"] = {
      data: [
        {
          sku: "CAM-P",
          product_id: "produto-apagado",
          produtos: {
            nome: "Camiseta Velha",
            deleted_at: "2026-09-01T10:00:00Z",
          },
        },
      ],
      error: null,
    };
    await montar();
    await tentarCadastrar([variante({ sku: "CAM-P" })]);

    expect(chamadasDe("vw_produtos_admin", "insert")).toHaveLength(0);
    const [frase] = mock.toastError.mock.calls[0] as [string];
    expect(frase).toContain("CAM-P");
    expect(frase).toMatch(/exclu[ií]d/i);
  });

  it("dois SKUs iguais na MESMA grade: recusa antes de qualquer gravação", async () => {
    await montar();
    const erro = await tentarCadastrar([
      variante({ value: "P", sku: "CAM" }),
      variante({ value: "M", sku: "CAM" }),
    ]);

    expect(erro).toBeDefined();
    expect(chamadasDe("vw_produtos_admin", "insert")).toHaveLength(0);
    const [frase] = mock.toastError.mock.calls[0] as [string];
    expect(frase).toContain("CAM");
    expect(frase).toMatch(/mais de uma varia/i);
  });

  it("variações SEM SKU (vazio ou ausente) não colidem: vão como null e nem consultam o banco", async () => {
    mock.resultados["vw_produtos_admin:insert"] = {
      data: { id: "prod-novo" },
      error: null,
    };
    mock.resultados["product_variants:insert"] = { data: [], error: null };
    await montar();
    const erro = await tentarCadastrar([
      variante({ value: "P", sku: "", codigoBarras: "" }),
      variante({ value: "M", sku: undefined }),
    ]);

    expect(erro).toBeUndefined();
    expect(chamadasDe("product_variants", "select")).toHaveLength(0);
    const [insercao] = chamadasDe("product_variants", "insert");
    expect(insercao.payload.map((v: any) => v.sku)).toEqual([null, null]);
    expect(insercao.payload.map((v: any) => v.codigo_barras)).toEqual([
      null,
      null,
    ]);
  });

  it("a consulta de SKU falhou (rede): NÃO bloqueia -- o cadastro segue", async () => {
    mock.resultados["product_variants:select"] = {
      data: null,
      error: { code: "57014", message: "canceling statement due to timeout" },
    };
    mock.resultados["vw_produtos_admin:insert"] = {
      data: { id: "prod-novo" },
      error: null,
    };
    mock.resultados["product_variants:insert"] = { data: [], error: null };
    await montar();
    const erro = await tentarCadastrar([variante({ sku: "CAM-P" })]);

    expect(erro).toBeUndefined();
    expect(chamadasDe("vw_produtos_admin", "insert")).toHaveLength(1);
    expect(chamadasDe("product_variants", "insert")).toHaveLength(1);
  });

  it("a corrida: o SKU livre na conferência é tomado antes do insert -- o aviso da grade diz o MOTIVO", async () => {
    mock.resultados["vw_produtos_admin:insert"] = {
      data: { id: "prod-novo" },
      error: null,
    };
    mock.resultados["product_variants:insert"] = {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "product_variants_sku_key"',
      },
    };
    await montar();
    await tentarCadastrar([variante({ sku: "CAM-P" })]);

    const [frase] = mock.toastError.mock.calls[0] as [string];
    // Continua dizendo que o produto foi criado sem a grade...
    expect(frase).toContain('"Camiseta"');
    expect(frase).toMatch(/VARIA..ES n.o foram salvas/);
    // ...e agora diz por quê.
    expect(frase).toContain(MSG_SKU_REPETIDO_NO_BANCO);
  });
});

describe("useProducts.upsertVariants -- produto existente, SKU repetido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.chamadas.length = 0;
    mock.resultados = {};
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

  it("o toast diz que o SKU está repetido, não 'confira os dados'", async () => {
    mock.resultados["product_variants:insert"] = {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "product_variants_sku_key"',
      },
    };
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
      try {
        await apiRef!.upsertVariants("prod-1", [
          {
            id: "temp-1",
            name: "Tamanho",
            value: "G",
            sku: "CAM-G",
            stockIncrement: 1,
            active: true,
          },
        ]);
      } catch {
        // o hook relança; o que importa é o toast
      }
    });
    expect(mock.toastError).toHaveBeenCalledWith(MSG_SKU_REPETIDO_NO_BANCO);
  });
});
