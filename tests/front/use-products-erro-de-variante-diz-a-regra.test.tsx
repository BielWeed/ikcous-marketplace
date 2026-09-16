// @vitest-environment jsdom
//
// useProducts-1608 — `mensagemAmigavelErroProduto` existe para deixar passar
// a frase do TruthGate ("Validação de Variante Falhou: ...") e só cair no
// genérico para o resto, mas os cinco catches de variante (addVariant,
// updateVariant, deleteVariant, deleteVariants, upsertVariants) trocavam
// QUALQUER erro — inclusive o do TruthGate, que é lançado ANTES de qualquer
// rede — por uma frase fixa de quatro palavras. A lojista que estourasse um
// axioma (ex.: estoque de variante acima de 10.000) só lia "Erro ao
// adicionar/atualizar/salvar variante(s)" e não tinha como saber qual regra
// violou, nem que o problema não era rede/SKU/imagem.
//
// Mesmo padrão de use-products-delete-fases.test.tsx e
// use-products-upsert-variantes-novas-e-antigas.test.tsx: um componente sonda
// só monta `useProducts` e expõe a API pro teste chamar direto. `TruthGate`
// NÃO é mockado — é o comportamento real dele (lançar antes de qualquer
// chamada de rede) que este teste prova que sobrevive até o toast.
import { mensagemAmigavelErroProduto, useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mesma razão de `vi.hoisted` dos dois arquivos-irmãos citados acima: import
// estático de `@/hooks/useProducts` no topo (a Sonda usa o hook em JSX) roda
// antes de qualquer `const` comum do módulo.
const mock = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  fetchProductsContext: vi.fn().mockResolvedValue(undefined),
  // Os três caminhos que passam pelo TruthGate (add/update/upsertVariants)
  // não devem tocar a rede quando o axioma estoura — `permitirRede: false`
  // faz `supabase.from` explodir com uma mensagem própria se algum desses
  // caminhos chamar rede antes de o TruthGate abortar, o que faria o teste
  // falhar pelo motivo ERRADO em vez de confirmar a ordem certa.
  permitirRede: false,
  resultadoSelect: { data: null, error: null } as { data: any; error: any },
  resultadoDelete: { error: null } as { error: any },
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

// Encadeamento mínimo: a base é uma Promise DE VERDADE (então `await` direto
// funciona sem precisar de `.single()`, como em `.delete().eq(...)` e
// `.select(...).in(...)`) com `.eq()`/`.in()`/`.single()` pendurados nela —
// diferente de um objeto plano com `then` próprio (proibido pelo Biome,
// noThenProperty, por ser uma fonte clássica de thenable acidental).
function encadear(resultado: { data?: any; error: any }) {
  const chain = Promise.resolve(resultado) as Promise<typeof resultado> & {
    eq: () => typeof chain;
    in: () => typeof chain;
    single: () => Promise<typeof resultado>;
  };
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.single = () => Promise.resolve(resultado);
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "product_variants") {
        throw new Error(`Tabela não mockada neste teste: ${tabela}`);
      }
      if (!mock.permitirRede) {
        // Prova de que a validação do TruthGate aborta ANTES de qualquer
        // chamada de rede — se algum dos três caminhos chegar aqui, o teste
        // falha apontando exatamente essa regressão de ordem.
        throw new Error(
          "supabase não deveria ser chamado: TruthGate deveria ter abortado antes",
        );
      }
      return {
        select: () => encadear(mock.resultadoSelect),
        delete: () => encadear(mock.resultadoDelete),
      };
    },
    auth: { refreshSession: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// dois arquivos-irmãos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiUseProducts = ReturnType<typeof useProducts>;

function Sonda({ onReady }: { onReady: (api: ApiUseProducts) => void }) {
  const api = useProducts({ autoFetch: false });
  useEffect(() => {
    onReady(api);
  });
  return null;
}

// Estoque acima de 10.000 é o axioma mais simples de estourar sem precisar de
// `costPrice` do produto pai (que estes testes deixam de fora de propósito).
const FRASE_TRUTHGATE_ESTOQUE =
  "Validação de Variante Falhou: Axiom violation: variant_stock_limit_exceeded";
// O que a lojista lê: o código do axioma traduzido para a regra em português
// (o erro lançado continua cru, para quem depura).
const FRASE_TRADUZIDA_ESTOQUE =
  "Validação de Variante Falhou: o estoque da variação não pode passar de 10.000 unidades.";

const MENSAGEM_GENERICA_ATUALIZAR = mensagemAmigavelErroProduto(
  { message: "erro de postgres qualquer, sem relação com o TruthGate" },
  "atualizar",
);

describe("useProducts — #useProducts-1608 os cinco erros de variante mostram qual regra falhou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let apiRef: ApiUseProducts | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock.fetchProductsContext.mockResolvedValue(undefined);
    mock.permitirRede = false;
    mock.resultadoSelect = { data: null, error: null };
    mock.resultadoDelete = { error: null };
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

  const varianteComEstoqueExcessivo = {
    id: "temp-1",
    productId: "prod-1",
    name: "Tamanho",
    value: "G",
    sku: "CAM-G",
    stockIncrement: 20000,
    priceOverride: null,
    active: true,
    imageUrl: null,
  };

  it("addVariant: mostra a frase do TruthGate, não 'Erro ao adicionar variante'", async () => {
    await montar();

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.addVariant(varianteComEstoqueExcessivo as any);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado?.message).toBe(FRASE_TRUTHGATE_ESTOQUE);
    expect(mock.toastError).toHaveBeenCalledWith(FRASE_TRADUZIDA_ESTOQUE);
    expect(mock.toastError).not.toHaveBeenCalledWith(
      "Erro ao adicionar variante",
    );
  });

  it("updateVariant: mostra a frase do TruthGate, não 'Erro ao atualizar variante'", async () => {
    await montar();

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.updateVariant("var-1", {
          stockIncrement: 20000,
        } as any);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado?.message).toBe(FRASE_TRUTHGATE_ESTOQUE);
    expect(mock.toastError).toHaveBeenCalledWith(FRASE_TRADUZIDA_ESTOQUE);
    expect(mock.toastError).not.toHaveBeenCalledWith(
      "Erro ao atualizar variante",
    );
  });

  it("upsertVariants: mostra a frase do TruthGate, não 'Erro ao salvar as variantes'", async () => {
    await montar();

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.upsertVariants("prod-1", [varianteComEstoqueExcessivo]);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado?.message).toBe(FRASE_TRUTHGATE_ESTOQUE);
    expect(mock.toastError).toHaveBeenCalledWith(FRASE_TRADUZIDA_ESTOQUE);
    expect(mock.toastError).not.toHaveBeenCalledWith(
      "Erro ao salvar as variantes",
    );
  });

  // deleteVariant/deleteVariants não rodam o TruthGate (não há axioma a
  // violar num delete) — o que este par de testes prova é que os dois
  // pararam de usar a frase fixa e passaram pela mesma tradutora dos outros
  // três, então um erro de Postgres qualquer sai com a frase genérica de
  // `mensagemAmigavelErroProduto`, não mais com "Erro ao remover variante(s)".
  it("deleteVariant: usa mensagemAmigavelErroProduto, não 'Erro ao remover variante'", async () => {
    mock.permitirRede = true;
    mock.resultadoDelete = {
      error: { message: "falha de rede qualquer", code: "500" },
    };
    await montar();

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.deleteVariant("var-1");
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado).toBeTruthy();
    expect(mock.toastError).toHaveBeenCalledWith(MENSAGEM_GENERICA_ATUALIZAR);
    expect(mock.toastError).not.toHaveBeenCalledWith(
      "Erro ao remover variante",
    );
  });

  it("deleteVariants: usa mensagemAmigavelErroProduto, não 'Erro ao remover variantes'", async () => {
    mock.permitirRede = true;
    mock.resultadoDelete = {
      error: { message: "falha de rede qualquer", code: "500" },
    };
    await montar();

    let erroCapturado: any;
    await act(async () => {
      try {
        await apiRef!.deleteVariants(["var-1", "var-2"]);
      } catch (err) {
        erroCapturado = err;
      }
    });

    expect(erroCapturado).toBeTruthy();
    expect(mock.toastError).toHaveBeenCalledWith(MENSAGEM_GENERICA_ATUALIZAR);
    expect(mock.toastError).not.toHaveBeenCalledWith(
      "Erro ao remover variantes",
    );
  });
});
