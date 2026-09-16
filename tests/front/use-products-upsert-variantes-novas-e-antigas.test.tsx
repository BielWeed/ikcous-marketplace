// @vitest-environment jsdom
//
// useProducts-1591 — `upsertVariants` montava um lote MISTO (variante já
// salva com `id` real + variante nova sem `id`, porque o formulário só dá a
// ela um `id: "temp-..."` que o hook filtra fora) e mandava tudo num único
// `.upsert()`. O postgrest-js (node_modules/@supabase/postgrest-js) monta o
// parâmetro `columns` com a UNIÃO das chaves de TODAS as linhas do lote e só
// manda `Prefer: missing=default` quando `defaultToNull: false` é passado —
// não era. Com `columns` incluindo `id` e a linha nova sem essa chave, o
// PostgREST grava NULL nela — e `product_variants.id` é PK NOT NULL. O lote
// inteiro abortava com 23502: a variante nova nunca era salva E a existente
// também não (é uma instrução só).
//
// Este arquivo testa o hook isoladamente (mesmo padrão de
// use-products-delete-fases.test.tsx): um componente sonda só monta
// `useProducts` e expõe a API pro teste chamar direto. O dublê de
// `@/lib/supabase` OBSERVA o corpo de cada chamada (`insert`/`upsert`) numa
// lista ordenada — é isso que prova que o lote foi separado por operação, não
// um `vi.fn()` genérico dublando `upsertVariants` inteiro (que é como todos
// os testes de AdminProductFormView cobrem isto hoje, e por isso o bug
// sobreviveu).
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chamada =
  | { tipo: "insert"; tabela: string; payload: any[] }
  | { tipo: "upsert"; tabela: string; payload: any[]; opts: any };

// Mesma razão de `vi.hoisted` do use-products-delete-fases.test.tsx: este
// arquivo importa `@/hooks/useProducts` estaticamente no topo (a Sonda usa o
// hook em JSX), e os factories de `vi.mock` (hoisted pro topo do arquivo)
// rodam nesse momento — um `const` comum ainda estaria em TDZ.
const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  ordem: [] as Chamada[],
  resultadoInsert: { error: null } as { error: any },
  resultadoUpsert: { error: null } as { error: any },
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
          mock.ordem.push({ tipo: "insert", tabela, payload });
          return Promise.resolve(mock.resultadoInsert);
        },
        upsert: (payload: any[], opts: any) => {
          mock.ordem.push({ tipo: "upsert", tabela, payload, opts });
          return Promise.resolve(mock.resultadoUpsert);
        },
      };
    },
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// use-products-delete-fases.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

const variantePExistente = {
  id: "var-p-existente-uuid",
  productId: "prod-1",
  name: "Tamanho",
  value: "P",
  sku: "CAM-P",
  stockIncrement: 5,
  priceOverride: null,
  active: true,
  imageUrl: null,
};

const varianteMNova = {
  // O formulário dá `id: temp-...` à variante recém-criada na tela
  // (AdminProductFormView.tsx) — upsertVariants tem de reconhecer esse
  // prefixo e NÃO mandar essa chave pro banco.
  id: "temp-1758000000000",
  productId: "prod-1",
  name: "Tamanho",
  value: "M",
  sku: "CAM-M",
  stockIncrement: 3,
  priceOverride: null,
  active: true,
  imageUrl: null,
};

describe("useProducts.upsertVariants — #useProducts-1591 lote misto (variante existente + nova)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.ordem.length = 0;
    mock.resultadoInsert = { error: null };
    mock.resultadoUpsert = { error: null };
    apiRef = undefined;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Mesmo motivo do use-products-delete-fases.test.tsx: sem isto, o efeito
    // de sincronizar fila offline agenda um setTimeout real que sobrevive ao
    // unmount e explode depois do teste terminar.
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

  it("separa o lote em INSERT (variante nova, sem `id`) e UPSERT com onConflict:'id' (variante existente) — nunca um único upsert misto", async () => {
    await montar();

    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await apiRef!.upsertVariants("prod-1", [
        variantePExistente,
        varianteMNova,
      ]);
    });

    expect(resultado).toBe(true);
    expect(mock.toastSuccess).toHaveBeenCalledWith("Variantes salvas");
    expect(mock.toastError).not.toHaveBeenCalled();

    const inserts = mock.ordem.filter((c) => c.tipo === "insert");
    const upserts = mock.ordem.filter((c) => c.tipo === "upsert");

    // A variante nova vai por INSERT, sozinha, e SEM a chave `id` — é
    // exatamente essa ausência que, misturada num upsert só, gerava o id
    // NULL contra a PK NOT NULL.
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as any).payload).toHaveLength(1);
    expect((inserts[0] as any).payload[0]).not.toHaveProperty("id");
    expect((inserts[0] as any).payload[0]).toMatchObject({
      value: "M",
      sku: "CAM-M",
    });

    // A variante existente vai por UPSERT com onConflict:'id', sozinha, e
    // CARREGANDO o id real.
    expect(upserts).toHaveLength(1);
    expect((upserts[0] as any).payload).toHaveLength(1);
    expect((upserts[0] as any).payload[0]).toMatchObject({
      id: "var-p-existente-uuid",
      value: "P",
    });
    expect((upserts[0] as any).opts).toMatchObject({ onConflict: "id" });

    // Nenhuma chamada pode misturar as duas variantes num lote só — é
    // precisamente essa mistura que reproduz o bug (columns = união das
    // chaves, sem Prefer: missing=default).
    for (const chamada of mock.ordem) {
      expect((chamada as any).payload).toHaveLength(1);
    }
  });

  it("lote só com variantes novas: um único INSERT, nenhum UPSERT", async () => {
    await montar();

    await act(async () => {
      await apiRef!.upsertVariants("prod-1", [varianteMNova]);
    });

    expect(mock.ordem.filter((c) => c.tipo === "insert")).toHaveLength(1);
    expect(mock.ordem.filter((c) => c.tipo === "upsert")).toHaveLength(0);
  });

  it("lote só com variantes existentes: um único UPSERT, nenhum INSERT", async () => {
    await montar();

    await act(async () => {
      await apiRef!.upsertVariants("prod-1", [variantePExistente]);
    });

    expect(mock.ordem.filter((c) => c.tipo === "insert")).toHaveLength(0);
    expect(mock.ordem.filter((c) => c.tipo === "upsert")).toHaveLength(1);
  });

  it("erro no UPSERT das existentes aborta antes do INSERT das novas e propaga o erro", async () => {
    await montar();
    // A fase idempotente (upsert por id) roda PRIMEIRO de propósito: se ela
    // falhar, nenhuma variante nova foi gravada e o "Salvar" de novo não
    // duplica nada (revisão de useProducts-1591).
    mock.resultadoUpsert = {
      error: { message: "conflito de id", code: "23505" },
    };

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.upsertVariants("prod-1", [
          variantePExistente,
          varianteMNova,
        ]);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado?.code).toBe("23505");
    // useProducts-1608: o catch parou de usar uma frase fixa e passou a usar
    // `mensagemAmigavelErroProduto` — erro de Postgres (não é o TruthGate)
    // cai no genérico de "atualizar", não mais em "Erro ao salvar as
    // variantes". Ver use-products-erro-de-variante-diz-a-regra.test.tsx
    // para a cobertura de que a frase do TruthGate passa reto.
    expect(mock.toastError).toHaveBeenCalledWith(
      "Não foi possível atualizar o produto agora. Confira os dados e tente novamente.",
    );
    // O UPSERT falhou antes de o INSERT das novas ser sequer tentado —
    // nenhuma linha nova órfã no banco.
    expect(mock.ordem.filter((c) => c.tipo === "insert")).toHaveLength(0);
    expect(mock.ordem.filter((c) => c.tipo === "upsert")).toHaveLength(1);
  });
});
