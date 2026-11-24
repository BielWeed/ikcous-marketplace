// @vitest-environment jsdom
//
// Quem NÃO é administrador não mexe no catálogo: preço, estoque, variações,
// lote. O banco é a barreira de verdade (RLS); a guarda `if (!isAdmin)` de cada
// função do `useProducts` é a primeira trava, e não deixa nem a consulta sair.
//
// Teste de MUTAÇÃO (24/11/2026): `hooks-do-painel-recusam-gravacao-de-nao-admin`
// e `use-products-delete-variants-nao-admin-recusa` só provam `addProduct`,
// `updateProduct`, `deleteProduct` e `deleteVariants`. Apagar a guarda das seis
// funções abaixo não derrubava teste algum (todos os vizinhos montam o hook como
// administrador). Cada caso cai se UMA guarda sumir:
//   salvarProdutoComGrade (preço e grade no mesmo salvamento), deleteProducts
//   (exclusão em lote), updateProductsStatus (ativar/desativar em lote),
//   addVariant, updateVariant (preço da variação) e deleteVariant.
// Para cada uma: não-admin recebe a recusa, o banco NÃO é tocado (nem leitura) e
// ninguém ouve "sucesso"; e o controle com administrador mostra que o dublê
// deixa a mesma chamada passar da guarda (senão a recusa não provaria nada).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useProducts } from "@/hooks/useProducts";

const h = vi.hoisted(() => ({
  admin: false,
  user: { id: "usuario-teste" },
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  rpc: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, isAdmin: h.admin, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: h.erro, success: h.sucesso, info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => {
  // O controle só precisa passar da guarda e, quando der, alcançar a gravação.
  // O banco simulado recusa depois dela, para não depender de releitura nem de
  // limpeza de mídia.
  const recusa = { data: null, error: { message: "recusa do banco simulado" } };
  function escrita() {
    const consulta = {
      eq: () => consulta,
      in: () => consulta,
      is: () => consulta,
      select: () => consulta,
      single: () => Promise.resolve(recusa),
      // biome-ignore lint/suspicious/noThenProperty: query builder thenable do Supabase
      then: (resolve: (value: typeof recusa) => unknown) =>
        Promise.resolve(recusa).then(resolve),
    };
    return consulta;
  }
  return {
    supabase: {
      from: (...args: unknown[]) => {
        h.from(...args);
        return {
          insert: (...a: unknown[]) => {
            h.insert(...a);
            return escrita();
          },
          update: (...a: unknown[]) => {
            h.update(...a);
            return escrita();
          },
          delete: (...a: unknown[]) => {
            h.delete(...a);
            return escrita();
          },
          select: () => {
            const leitura = {
              eq: () => leitura,
              is: () => leitura,
              single: () => Promise.resolve({ data: null, error: null }),
              maybeSingle: async () => ({
                data: {
                  id: "produto-teste",
                  imagem_urls: [],
                  imagem_url: null,
                },
                error: null,
              }),
              // biome-ignore lint/suspicious/noThenProperty: leitura do Supabase
              then: (resolve: (value: unknown) => unknown) =>
                Promise.resolve({ data: [], error: null }).then(resolve),
            };
            return leitura;
          },
        };
      },
      rpc: (...args: unknown[]) => {
        h.rpc(...args);
        return Promise.resolve(recusa);
      },
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Produtos = ReturnType<typeof useProducts>;
type Caso = {
  nome: string;
  chamar: (p: Produtos) => Promise<unknown>;
  /** O que a função devolve quando recusa por falta de permissão. */
  retorno: unknown;
  /** Gravação que o controle de administrador precisa alcançar (se der). */
  escrita?: "insert" | "update" | "delete";
};

const casos: Caso[] = [
  {
    nome: "salvarProdutoComGrade",
    chamar: (p) =>
      p.salvarProdutoComGrade(
        "produto-teste",
        { price: 49.9 },
        { variantes: [], apagar: [] },
      ),
    retorno: undefined,
  },
  {
    nome: "deleteProducts (lote)",
    chamar: (p) => p.deleteProducts(["produto-teste"]),
    retorno: false,
  },
  {
    nome: "updateProductsStatus (lote)",
    chamar: (p) => p.updateProductsStatus(["produto-teste"], false),
    retorno: false,
    escrita: "update",
  },
  {
    nome: "addVariant",
    chamar: (p) =>
      p.addVariant({
        productId: "produto-teste",
        name: "Cor",
        value: "Azul",
        stockIncrement: 1,
        active: true,
      } as Parameters<Produtos["addVariant"]>[0]),
    retorno: undefined,
    escrita: "insert",
  },
  {
    nome: "updateVariant (preço da variação)",
    chamar: (p) => p.updateVariant("variante-teste", { priceOverride: 10 }),
    retorno: undefined,
    escrita: "update",
  },
  {
    nome: "deleteVariant",
    chamar: (p) => p.deleteVariant("variante-teste"),
    retorno: undefined,
    escrita: "delete",
  },
];

describe("catálogo: grade, lote e variações exigem administrador antes de tocar o banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let produtos: Produtos;

  function Sonda() {
    const valor = useProducts({ autoFetch: false });
    useEffect(() => {
      produtos = valor;
    });
    return null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    h.admin = false;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar(admin: boolean) {
    h.admin = admin;
    await act(async () => {
      raiz.render(<Sonda />);
    });
    vi.clearAllMocks();
  }

  for (const caso of casos) {
    it(`${caso.nome}: não-admin recebe "Permissão negada" e o banco nem é consultado`, async () => {
      await montar(false);
      let retorno: unknown;
      await act(async () => {
        retorno = await caso.chamar(produtos);
      });

      // O efeito proibido primeiro: devolver `false`/`undefined` sozinho também
      // aconteceria se o banco recusasse depois.
      for (const toque of [h.from, h.insert, h.update, h.delete, h.rpc]) {
        expect(toque).not.toHaveBeenCalled();
      }
      expect(retorno).toBe(caso.retorno);
      expect(h.erro).toHaveBeenCalledExactlyOnceWith("Permissão negada");
      expect(h.sucesso).not.toHaveBeenCalled();
    });

    it(`${caso.nome}: o administrador passa da guarda (controle do dublê)`, async () => {
      await montar(true);
      await act(async () => {
        await caso.chamar(produtos).catch(() => undefined);
      });

      expect(h.erro).not.toHaveBeenCalledWith("Permissão negada");
      if (caso.escrita) expect(h[caso.escrita]).toHaveBeenCalledTimes(1);
    });
  }
});
