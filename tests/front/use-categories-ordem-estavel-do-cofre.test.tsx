// @vitest-environment jsdom
//
// Os botões de categoria da vitrine (e a lista do painel) mudavam de ordem
// sozinhos depois de uma sincronização ou sem internet: o cofre do aparelho
// (IndexedDB, chave = uuid) devolve os registros em ordem de uuid, e só a
// consulta de rede vinha em ordem de nome. Agora toda lista que chega à tela
// sai em ordem de nome (a mesma régua da tela Gerenciar categorias), seja qual
// for a origem: cópia do aparelho na abertura, releitura depois da
// sincronização, categoria nova ou renomeada.
//
// `useCategories` é o REAL; cofre, Supabase e o aviso de sincronização são dublês.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cat = (id: string, nome: string) => ({
  id,
  name: nome,
  slug: nome.toLowerCase(),
  description: "",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
});

const estado = vi.hoisted(() => ({
  // Ordem de uuid, de propósito fora da ordem alfabética.
  cofre: [] as unknown[],
  aoSincronizar: null as null | (() => Promise<void>),
  // Resposta da rede (linhas do banco); null = rede sem resposta.
  rede: null as null | Record<string, unknown>[],
}));

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => estado.cofre,
      getAllOrThrow: async () => estado.cofre,
      replaceAll: async () => {},
      setLastSync: async () => {},
    }),
  },
}));
vi.mock("@/hooks/useDataVault", () => ({
  useSyncListener: (_stores: string[], aoMudar: () => Promise<void>) => {
    estado.aoSincronizar = aoMudar;
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  estado.cofre = [];
  estado.aoSincronizar = null;
  estado.rede = null;
  rpcMock.mockReset();
  fromMock.mockReset();
  // Por padrão a rede não responde: o que a tela mostra vem SÓ do cofre do aparelho.
  fromMock.mockImplementation(() => ({
    select: () => ({
      order: () =>
        estado.rede
          ? Promise.resolve({ data: estado.rede, error: null })
          : new Promise(() => {}),
    }),
    insert: () => ({
      select: () => ({
        single: async () => ({
          data: {
            id: "z-nova",
            nome: "Moda",
            slug: "moda",
            descricao: "",
            ativo: true,
            created_at: "2026-01-02T00:00:00Z",
          },
          error: null,
        }),
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
    desmontar: () => {
      act(() => raiz.unmount());
      hospedeiro.remove();
    },
  };
}

describe("useCategories — a ordem não depende da origem da lista", () => {
  it("cópia do aparelho na abertura chega em ordem de nome, não de uuid", async () => {
    estado.cofre = [
      cat("1-zeta", "Zeta"),
      cat("2-alfa", "Alfa"),
      cat("3-mae", "Mãe"),
    ];
    const t = await montar();

    expect(t.linhas()).toEqual(["Alfa", "Mãe", "Zeta"]);
    t.desmontar();
  });

  it("releitura do aparelho depois de sincronizar também sai em ordem de nome", async () => {
    estado.cofre = [cat("1-alfa", "Alfa")];
    const t = await montar();
    expect(t.linhas()).toEqual(["Alfa"]);

    estado.cofre = [
      cat("1-zeta", "Zeta"),
      cat("2-alfa", "Alfa"),
      cat("3-bolsas", "Bolsas"),
    ];
    await act(async () => {
      await estado.aoSincronizar?.();
    });

    expect(t.linhas()).toEqual(["Alfa", "Bolsas", "Zeta"]);
    t.desmontar();
  });

  it("a resposta da rede segue a mesma régua do aparelho (acento e maiúscula)", async () => {
    const linha = (id: string, nome: string) => ({
      id,
      nome,
      slug: nome.toLowerCase(),
      descricao: "",
      ativo: true,
      created_at: "2026-01-01T00:00:00Z",
    });
    // Ordem "do banco" que não é a de nome em português.
    estado.rede = [
      linha("1", "Zeta"),
      linha("2", "Ótica"),
      linha("3", "Bolsas"),
      linha("4", "alfa"),
    ];
    const t = await montar();

    expect(t.linhas()).toEqual(["alfa", "Bolsas", "Ótica", "Zeta"]);
    t.desmontar();
  });

  it("categoria nova entra no lugar dela, não no fim", async () => {
    estado.cofre = [cat("1-alfa", "Alfa"), cat("2-zeta", "Zeta")];
    const t = await montar();

    await act(async () => {
      await t
        .hook()
        .addCategory({ name: "Moda", description: "", isActive: true }, true);
    });

    expect(t.linhas()).toEqual(["Alfa", "Moda", "Zeta"]);
    t.desmontar();
  });

  it("categoria renomeada vai para o lugar do nome novo", async () => {
    estado.cofre = [
      cat("1-alfa", "Alfa"),
      cat("2-moda", "Moda"),
      cat("3-zeta", "Zeta"),
    ];
    rpcMock.mockResolvedValue({
      data: {
        id: "1-alfa",
        nome_antigo: "Alfa",
        nome: "Zulu",
        slug: "zulu",
        mudou: true,
        produtos: 0,
        banners: 0,
        regra_devolucao: 0,
      },
      error: null,
    });
    const t = await montar();

    await act(async () => {
      await t.hook().renameCategory("1-alfa", "Zulu");
    });

    expect(t.linhas()).toEqual(["Moda", "Zeta", "Zulu"]);
    t.desmontar();
  });
});
