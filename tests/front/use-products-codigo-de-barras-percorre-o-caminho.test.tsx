// @vitest-environment jsdom
//
// C5.1 — `codigoBarras` (domínio) tem de virar `codigo_barras` (banco) nos 3
// dbUpdates, nos 4 inserts e nas 2 leituras manuais de useProducts.ts, e o
// 23505 do índice único de código de barras (migration 20261160000000) tem
// de virar a mensagem amigável — sem mexer em nenhum outro campo.
//
// Mesmo padrão de tests/front/use-products-upsert-variantes-novas-e-antigas.test.tsx
// e tests/front/use-products-erro-de-variante-diz-a-regra.test.tsx: um
// componente sonda só monta `useProducts` e expõe a API pro teste chamar
// direto; o dublê de `@/lib/supabase` OBSERVA o corpo de cada chamada numa
// lista ordenada, por tabela e operação — é isso que prova QUAL payload
// chegou até o banco, e não só que o hook "não quebrou".
import { mensagemAmigavelErroProduto, useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada = {
  tabela: string;
  op: "insert" | "update" | "upsert";
  payload: any;
  opts?: any;
};

// Mesma razão de `vi.hoisted` dos arquivos-irmãos: este arquivo importa
// `@/hooks/useProducts` estaticamente no topo (a Sonda usa o hook em JSX), e
// os factories de `vi.mock` (hoisted pro topo do arquivo) rodam nesse
// momento — um `const` comum ainda estaria em TDZ.
const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  chamadas: [] as Chamada[],
  // Chave "<tabela>:<operação>" → o que aquela chamada específica devolve.
  // Sem entrada, o default abaixo (sucesso vazio) resolve.
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

// Encadeamento mínimo (molde: use-products-erro-de-variante-diz-a-regra.test.tsx):
// a base é uma Promise DE VERDADE, com `.eq()/.select()/.single()` pendurados
// nela — funciona tanto para quem só faz `await .insert(payload)` (upsertVariants)
// quanto para quem encadeia `.update().eq().select().single()`.
function encadear(resultado: { data?: any; error?: any }) {
  const chain = Promise.resolve(resultado) as Promise<typeof resultado> & {
    eq: () => typeof chain;
    select: () => typeof chain;
    single: () => Promise<typeof resultado>;
  };
  chain.eq = () => chain;
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
      insert: (payload: any) => encadear(registrar(tabela, "insert", payload)),
      update: (payload: any) => encadear(registrar(tabela, "update", payload)),
      upsert: (payload: any, opts: any) =>
        encadear(registrar(tabela, "upsert", payload, opts)),
    }),
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// arquivos-irmãos.
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

describe("useProducts — C5.1 codigoBarras percorre o caminho inteiro do dado", () => {
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
    // Mesmo motivo dos arquivos-irmãos: sem isto, o efeito de sincronizar a
    // fila offline agenda um setTimeout real que sobrevive ao unmount.
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

  describe("(a) updateProduct — dbUpdates de vw_produtos_admin", () => {
    it("codigoBarras preenchido manda codigo_barras no update", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", {
          codigoBarras: "7891234567890",
        });
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada.payload).toMatchObject({
        codigo_barras: "7891234567890",
      });
    });

    it("codigoBarras vazio manda codigo_barras: null (limpa o código, como o sku)", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { codigoBarras: "" });
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada.payload.codigo_barras).toBeNull();
    });

    it("sem o campo codigoBarras no patch, a chave codigo_barras não é mandada", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateProduct("prod-1", { name: "Novo nome" });
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "update");
      expect(chamada.payload).not.toHaveProperty("codigo_barras");
      // Confere que nenhum OUTRO campo mudou de comportamento por esta tarefa.
      expect(chamada.payload).toMatchObject({ nome: "Novo nome" });
    });
  });

  describe("(b) updateVariant — dbUpdates de product_variants", () => {
    it("codigoBarras preenchido manda codigo_barras no update", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateVariant("var-1", {
          codigoBarras: "7891234567890",
        });
      });
      const [chamada] = chamadasDe("product_variants", "update");
      expect(chamada.payload).toMatchObject({
        codigo_barras: "7891234567890",
      });
    });

    it("codigoBarras vazio manda codigo_barras: null", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateVariant("var-1", { codigoBarras: "" });
      });
      const [chamada] = chamadasDe("product_variants", "update");
      expect(chamada.payload.codigo_barras).toBeNull();
    });

    it("sem o campo codigoBarras no patch, a chave codigo_barras não é mandada", async () => {
      await montar();
      await act(async () => {
        await apiRef!.updateVariant("var-1", { sku: "CAM-P" });
      });
      const [chamada] = chamadasDe("product_variants", "update");
      expect(chamada.payload).not.toHaveProperty("codigo_barras");
      expect(chamada.payload).toMatchObject({ sku: "CAM-P" });
    });
  });

  describe("(c) addProduct — insert do produto e das variantes novas", () => {
    const produtoComVariante = {
      name: "Caneca Térmica",
      price: 79.9,
      stock: 10,
      images: [] as string[],
      codigoBarras: "7891234567890",
      variants: [
        {
          id: "temp-1",
          productId: "",
          name: "Cor",
          value: "Azul",
          codigoBarras: "1112223334445",
          stockIncrement: 3,
          active: true,
        },
      ],
    };

    it("insert de vw_produtos_admin carrega codigo_barras do produto", async () => {
      mock.resultados["vw_produtos_admin:insert"] = {
        data: { id: "prod-novo" },
        error: null,
      };
      mock.resultados["product_variants:insert"] = {
        data: [],
        error: null,
      };
      await montar();
      await act(async () => {
        await apiRef!.addProduct(produtoComVariante as any);
      });
      const [chamada] = chamadasDe("vw_produtos_admin", "insert");
      expect(chamada.payload).toMatchObject({
        codigo_barras: "7891234567890",
      });
    });

    it("insert de product_variants (grade nova) carrega codigo_barras de cada variante", async () => {
      mock.resultados["vw_produtos_admin:insert"] = {
        data: { id: "prod-novo" },
        error: null,
      };
      mock.resultados["product_variants:insert"] = {
        data: [],
        error: null,
      };
      await montar();
      await act(async () => {
        await apiRef!.addProduct(produtoComVariante as any);
      });
      const [chamada] = chamadasDe("product_variants", "insert");
      expect(chamada.payload[0]).toMatchObject({
        codigo_barras: "1112223334445",
      });
    });
  });

  describe("(d) upsertVariants — carrega codigo_barras nas duas fases", () => {
    it("fase UPSERT (variante já existente) carrega codigo_barras", async () => {
      mock.resultados["product_variants:upsert"] = { error: null };
      await montar();
      await act(async () => {
        await apiRef!.upsertVariants("prod-1", [
          {
            id: "var-existente",
            productId: "prod-1",
            name: "Tamanho",
            value: "P",
            codigoBarras: "5556667778889",
            stockIncrement: 5,
            active: true,
          },
        ]);
      });
      const [chamada] = chamadasDe("product_variants", "upsert");
      expect(chamada.payload[0]).toMatchObject({
        codigo_barras: "5556667778889",
      });
    });

    it("fase INSERT (variante nova, id temp-) carrega codigo_barras", async () => {
      mock.resultados["product_variants:insert"] = { error: null };
      await montar();
      await act(async () => {
        await apiRef!.upsertVariants("prod-1", [
          {
            id: "temp-2",
            productId: "prod-1",
            name: "Tamanho",
            value: "M",
            codigoBarras: "9998887776665",
            stockIncrement: 5,
            active: true,
          },
        ]);
      });
      const [chamada] = chamadasDe("product_variants", "insert");
      expect(chamada.payload[0]).toMatchObject({
        codigo_barras: "9998887776665",
      });
    });
  });

  describe("(e) 23505 do índice de código de barras vira a mensagem amigável", () => {
    it("23505 citando o índice de codigo_barras vira a frase amigável", async () => {
      mock.resultados["vw_produtos_admin:update"] = {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "produtos_codigo_barras_unico"',
        },
      };
      await montar();
      let erroCapturado: any;
      await act(async () => {
        try {
          await apiRef!.updateProduct("prod-1", {
            codigoBarras: "7891234567890",
          });
        } catch (err) {
          erroCapturado = err;
        }
      });
      expect(erroCapturado?.code).toBe("23505");
      expect(mock.toastError).toHaveBeenCalledWith(
        "Este código de barras já está em outro produto ou variação.",
      );
    });

    it("23505 de OUTRO índice (não é o de codigo_barras) mantém a mensagem genérica de sempre", async () => {
      mock.resultados["vw_produtos_admin:update"] = {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "produtos_pkey"',
        },
      };
      await montar();
      let erroCapturado: any;
      await act(async () => {
        try {
          await apiRef!.updateProduct("prod-1", { name: "Qualquer" });
        } catch (err) {
          erroCapturado = err;
        }
      });
      expect(erroCapturado?.code).toBe("23505");
      // A mensagem genérica de "atualizar" — não a de código de barras, e não
      // uma frase inventada por este teste (usa a própria tradutora).
      expect(mock.toastError).toHaveBeenCalledWith(
        mensagemAmigavelErroProduto(
          {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "produtos_pkey"',
          },
          "atualizar",
        ),
      );
      expect(mock.toastError).not.toHaveBeenCalledWith(
        "Este código de barras já está em outro produto ou variação.",
      );
    });
  });
});
