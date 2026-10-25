// @vitest-environment jsdom
//
// Criar categoria com nome que o banco já tem (nome único e endereço único, e
// "Vestuário" e "vestuario" têm o mesmo endereço) voltava o erro cru, e a tela
// dizia só "Erro ao salvar categoria". Agora o 23505 vira uma frase para a
// lojista, a categoria provisória sai da lista, e as outras falhas seguem como
// eram.
//
// `useCategories` é o REAL; o Supabase é um dublê.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { fromMock, resposta } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  resposta: {
    erroDoInsert: null as null | { code: string; message: string },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), from: fromMock },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: async () => {},
      setLastSync: async () => {},
    }),
  },
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError, loading: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  toastError.mockClear();
  resposta.erroDoInsert = null;
  fromMock.mockReset();
  fromMock.mockImplementation(() => ({
    select: () => ({
      order: async () => ({
        data: [
          {
            id: "c1",
            nome: "Vestuário",
            slug: "vestuario",
            descricao: "",
            ativo: true,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      }),
    }),
    insert: () => ({
      select: () => ({
        single: async () =>
          resposta.erroDoInsert
            ? { data: null, error: resposta.erroDoInsert }
            : {
                data: {
                  id: "c2",
                  nome: "Calçados",
                  slug: "calcados",
                  descricao: "",
                  ativo: true,
                  created_at: "2026-01-02T00:00:00Z",
                },
                error: null,
              },
      }),
    }),
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function montar() {
  const { useCategories } = await import("@/hooks/useCategories");
  const { ErroDeCategoria } = await import("@/lib/gestao-de-categorias");
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz: Root = createRoot(hospedeiro);
  const ref: { atual: ReturnType<typeof useCategories> | null } = {
    atual: null,
  };
  function Sonda() {
    const atual = useCategories();
    useEffect(() => {
      ref.atual = atual;
    });
    return (
      <ul>
        {atual.categories.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    );
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    hook: () => ref.atual as NonNullable<typeof ref.atual>,
    linhas: () =>
      [...hospedeiro.querySelectorAll("li")].map((li) => li.textContent),
    ErroDeCategoria,
    desmontar: () => {
      act(() => raiz.unmount());
      hospedeiro.remove();
    },
  };
}

const NOVA = { name: "VESTUARIO", description: "", isActive: true };

describe("useCategories.addCategory — nome que o banco já tem", () => {
  it("o 23505 vira uma frase para a lojista (ErroDeCategoria) e a provisória sai da lista", async () => {
    resposta.erroDoInsert = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "categorias_slug_key"',
    };
    const t = await montar();

    let erro: unknown;
    await act(async () => {
      erro = await t
        .hook()
        .addCategory(NOVA, true)
        .catch((e) => e);
    });

    expect(erro).toBeInstanceOf(t.ErroDeCategoria);
    const mensagem = (erro as Error).message;
    expect(mensagem).toMatch(/Já existe uma categoria/);
    expect(mensagem).not.toMatch(/duplicate|constraint|categorias_slug_key/i);
    expect(t.linhas()).toEqual(["Vestuário"]);
    t.desmontar();
  });

  it("sem o modo silencioso, a frase também vai ao aviso", async () => {
    resposta.erroDoInsert = { code: "23505", message: "duplicate key" };
    const t = await montar();

    await act(async () => {
      await t
        .hook()
        .addCategory(NOVA)
        .catch(() => {});
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toMatch(/Já existe/);
    t.desmontar();
  });

  it("outra falha segue como era: o erro original sobe e a provisória sai", async () => {
    const original = { code: "08006", message: "connection failure" };
    resposta.erroDoInsert = original;
    const t = await montar();

    let erro: unknown;
    await act(async () => {
      erro = await t
        .hook()
        .addCategory(NOVA, true)
        .catch((e) => e);
    });

    expect(erro).toBe(original);
    expect(t.linhas()).toEqual(["Vestuário"]);
    t.desmontar();
  });

  it("nome realmente novo cria e entra na lista", async () => {
    const t = await montar();

    await act(async () => {
      await t
        .hook()
        .addCategory(
          { name: "Calçados", description: "", isActive: true },
          true,
        );
    });

    expect(t.linhas()).toEqual(["Vestuário", "Calçados"]);
    t.desmontar();
  });
});
