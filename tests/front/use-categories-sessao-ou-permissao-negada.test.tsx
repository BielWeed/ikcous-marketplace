// @vitest-environment jsdom
//
// Lojista sem permissão (cargo removido, login ainda vivo) criava ou editava
// categoria e lia só "Erro ao criar/atualizar categoria" — sem saber que o
// problema era a sessão/permissão. Produto, cupom, banner e pedido já usam
// `mensagemDeErroDeSessaoDoPainel`; categoria agora também. Os outros ramos
// (23505, ErroDeCategoria, sem resposta, erro qualquer) seguem como eram.
//
// `useCategories` é o REAL; o Supabase é um dublê.
import { MENSAGEM_SESSAO_OU_PERMISSAO } from "@/lib/erro-de-sessao-do-painel";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { fromMock, resposta } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  resposta: {
    erro: null as null | { code?: string; message: string; status?: number },
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
  resposta.erro = null;
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
        single: async () => ({ data: null, error: resposta.erro }),
      }),
    }),
    update: () => ({
      eq: async () => ({ error: resposta.erro }),
    }),
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function montar() {
  const { useCategories } = await import("@/hooks/useCategories");
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
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return {
    hook: () => ref.atual as NonNullable<typeof ref.atual>,
    desmontar: () => {
      act(() => raiz.unmount());
      hospedeiro.remove();
    },
  };
}

const NOVA = { name: "Calçados", description: "", isActive: true };

const NEGADOS = [
  { code: "42501", message: "new row violates row-level security policy" },
  { code: "PGRST301", message: "JWT expired" },
  { message: "JWT expired" },
  { status: 401, message: "Unauthorized" },
];

describe("useCategories — sessão ou permissão negada", () => {
  it.each(NEGADOS)(
    "criar: %j diz a frase de sessão/permissão",
    async (erro) => {
      resposta.erro = erro;
      const t = await montar();

      await act(async () => {
        await t
          .hook()
          .addCategory(NOVA)
          .catch(() => {});
      });

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError.mock.calls[0][0]).toBe(MENSAGEM_SESSAO_OU_PERMISSAO);
      t.desmontar();
    },
  );

  it.each(NEGADOS)(
    "atualizar: %j diz a frase de sessão/permissão",
    async (erro) => {
      resposta.erro = erro;
      const t = await montar();

      await act(async () => {
        await t
          .hook()
          .updateCategory("c1", { description: "nova" })
          .catch(() => {});
      });

      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastError.mock.calls[0][0]).toBe(MENSAGEM_SESSAO_OU_PERMISSAO);
      t.desmontar();
    },
  );

  it("criar: outra falha segue como era (Erro ao criar categoria)", async () => {
    resposta.erro = { code: "08006", message: "connection failure" };
    const t = await montar();

    await act(async () => {
      await t
        .hook()
        .addCategory(NOVA)
        .catch(() => {});
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toBe("Erro ao criar categoria");
    t.desmontar();
  });

  it("atualizar: outra falha segue como era (Erro ao atualizar categoria)", async () => {
    resposta.erro = { code: "08006", message: "connection failure" };
    const t = await montar();

    await act(async () => {
      await t
        .hook()
        .updateCategory("c1", { description: "nova" })
        .catch(() => {});
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toBe("Erro ao atualizar categoria");
    t.desmontar();
  });

  it("criar: 23505 continua dizendo que a categoria já existe", async () => {
    resposta.erro = { code: "23505", message: "duplicate key" };
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
});
