// @vitest-environment jsdom
//
// `addCategory` e' a porta de TODO chamador que cria categoria. O banco so recusa nome sem letra nem
// numero e nome acima de 80 letras no RENOMEAR; no INSERT direto a segunda categoria "🔥" colidia no
// endereco vazio e a lojista lia "ja existe uma categoria com esse nome", que e' falso. Agora o hook
// recusa os dois ANTES de qualquer INSERT, com as mesmas frases do renomear. A frase de duplicado
// tambem nao manda "usar a que ja existe" quando ela pode estar escondida.
//
// `useCategories` e' o REAL; o Supabase e' um duble.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { fromMock, insertMock, resposta } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  insertMock: vi.fn(),
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
  insertMock.mockReset();
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
    insert: (linha: unknown) => {
      insertMock(linha);
      return {
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
      };
    },
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

async function tentar(t: Awaited<ReturnType<typeof montar>>, name: string) {
  let erro: unknown;
  await act(async () => {
    erro = await t
      .hook()
      .addCategory({ name, description: "", isActive: true }, true)
      .catch((e) => e);
  });
  return erro;
}

describe("useCategories.addCategory — nome que o renomear recusa", () => {
  it.each(["🔥", "!!!", "   ★  "])(
    "o nome %j (sem letra nem número) é recusado sem tocar no banco",
    async (nome) => {
      const t = await montar();
      const erro = await tentar(t, nome);

      expect(erro).toBeInstanceOf(t.ErroDeCategoria);
      expect((erro as Error).message).toBe(
        "O nome da categoria precisa ter pelo menos uma letra ou um número.",
      );
      expect((erro as { code?: string }).code).toBe("22023");
      expect(insertMock).not.toHaveBeenCalled();
      // Nem a categoria provisória chegou a entrar na lista.
      expect(t.linhas()).toEqual(["Vestuário"]);
      t.desmontar();
    },
  );

  it("nome acima de 80 letras é recusado sem tocar no banco; com 80 passa", async () => {
    const t = await montar();
    const erro = await tentar(t, "a".repeat(81));
    expect((erro as Error).message).toBe(
      "O nome da categoria pode ter no máximo 80 letras.",
    );
    expect(insertMock).not.toHaveBeenCalled();

    await tentar(t, "a".repeat(80));
    expect(insertMock).toHaveBeenCalledTimes(1);
    t.desmontar();
  });

  it("sem o modo silencioso, a frase também vai ao aviso", async () => {
    const t = await montar();
    await act(async () => {
      await t
        .hook()
        .addCategory({ name: "🔥", description: "", isActive: true })
        .catch(() => {});
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toMatch(/letra ou um número/);
    t.desmontar();
  });

  it("emoji com letra junto continua valendo", async () => {
    const t = await montar();
    const erro = await tentar(t, "🔥 Promoção");

    expect(erro).not.toBeInstanceOf(Error);
    expect(insertMock).toHaveBeenCalledTimes(1);
    t.desmontar();
  });
});

describe("useCategories.addCategory — a frase de duplicado diz a verdade", () => {
  it("o 23505 não manda 'usar a que já existe' sem avisar que ela pode estar escondida", async () => {
    resposta.erroDoInsert = { code: "23505", message: "duplicate key" };
    const t = await montar();
    const erro = await tentar(t, "VESTUARIO");

    expect(erro).toBeInstanceOf(t.ErroDeCategoria);
    const mensagem = (erro as Error).message;
    expect(mensagem).toMatch(/^Já existe uma categoria/);
    expect(mensagem).toMatch(/escondida/);
    expect(mensagem).toContain("Organizar categorias");
    t.desmontar();
  });
});
