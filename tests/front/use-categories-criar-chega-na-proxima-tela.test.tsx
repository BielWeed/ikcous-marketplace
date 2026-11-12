// @vitest-environment jsdom
//
// A lojista cria uma categoria no formulário do produto ("Categoria criada com
// sucesso!") e, em menos de um minuto, abre OUTRA tela que lista categorias
// (outra aba do painel, o próximo produto). A tela nova nasce da lista que o
// módulo guarda em memória e pula a rede dentro do minuto de espera: se criar
// não atualizar essa lista, a categoria recém-criada não aparece lá. Renomear e
// apagar já atualizavam; criar não.
//
// `useCategories` é o REAL; o Supabase é um dublê que conta as leituras.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { fromMock, banco } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  banco: {
    leituras: 0,
    erroDoInsert: null as null | { code: string; message: string },
    liberarInsert: null as null | (() => void),
    segurarInsert: false,
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
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

const LINHA_NOVA = {
  id: "c2",
  nome: "Calçados",
  slug: "calcados",
  descricao: "",
  ativo: true,
  created_at: "2026-01-02T00:00:00Z",
};

beforeEach(() => {
  vi.resetModules();
  banco.leituras = 0;
  banco.erroDoInsert = null;
  banco.liberarInsert = null;
  banco.segurarInsert = false;
  fromMock.mockReset();
  fromMock.mockImplementation(() => ({
    // O banco "antigo": a leitura nunca devolve a categoria nova. Se a tela
    // seguinte a mostrar, veio da memória, não da rede.
    select: () => ({
      order: async () => {
        banco.leituras += 1;
        return {
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
        };
      },
    }),
    insert: () => ({
      select: () => ({
        single: async () => {
          if (banco.segurarInsert) {
            await new Promise<void>((r) => {
              banco.liberarInsert = r;
            });
          }
          return banco.erroDoInsert
            ? { data: null, error: banco.erroDoInsert }
            : { data: LINHA_NOVA, error: null };
        },
      }),
    }),
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function montarTela() {
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

const NOVA = { name: "Calçados", description: "", isActive: true };

describe("useCategories.addCategory — a próxima tela já enxerga a categoria criada", () => {
  it("tela aberta DEPOIS de criar mostra a nova, sem esperar nem repetir a leitura da rede", async () => {
    const a = await montarTela();
    expect(a.linhas()).toEqual(["Vestuário"]);
    expect(banco.leituras).toBe(1);

    await act(async () => {
      await a.hook().addCategory(NOVA, true);
    });
    expect(a.linhas()).toEqual(["Calçados", "Vestuário"]);

    const b = await montarTela();
    expect(b.linhas()).toEqual(["Calçados", "Vestuário"]);
    // Dentro do minuto de espera: nenhuma leitura nova explica o que a tela viu.
    expect(banco.leituras).toBe(1);

    b.desmontar();
    a.desmontar();
  });

  it("a categoria provisória (ainda sem resposta do banco) não vaza para a tela seguinte", async () => {
    const a = await montarTela();
    banco.segurarInsert = true;

    let pendente: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pendente = a.hook().addCategory(NOVA, true);
      await new Promise((r) => setTimeout(r, 0));
    });
    // Na tela de quem criou, a provisória já aparece.
    expect(a.linhas()).toEqual(["Calçados", "Vestuário"]);

    const b = await montarTela();
    expect(b.linhas()).toEqual(["Vestuário"]);

    await act(async () => {
      banco.liberarInsert?.();
      await pendente;
    });
    b.desmontar();
    a.desmontar();
  });

  it("criar que o banco recusa não deixa nada na memória: a tela seguinte só tem o que existe", async () => {
    const a = await montarTela();
    banco.erroDoInsert = { code: "08006", message: "connection failure" };

    await act(async () => {
      await a
        .hook()
        .addCategory(NOVA, true)
        .catch(() => {});
    });
    expect(a.linhas()).toEqual(["Vestuário"]);

    const b = await montarTela();
    expect(b.linhas()).toEqual(["Vestuário"]);

    b.desmontar();
    a.desmontar();
  });
});
