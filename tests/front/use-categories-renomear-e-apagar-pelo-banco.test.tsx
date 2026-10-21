// @vitest-environment jsdom
//
// Renomear e apagar categoria passam SÓ pelas portas do banco (migration
// 20261237000000). A categoria do produto é guardada pelo NOME, em quatro
// lugares; trocar `categorias.nome` direto na tabela (o que `updateCategory`
// fazia) deixava o produto órfão da vitrine, o banner apontando para página
// vazia e a regra de "sem troca" da devolução apontando para um nome que não
// existe. E apagar direto da tabela apagava mesmo com produto dentro.
//
// Aqui o `useCategories` é o REAL e o Supabase é um dublê que grava tudo o que
// recebe: o que se prova é o que o hook MANDA e o que ele FAZ com a resposta
// (lista local, aviso às outras telas, mensagem da recusa).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface LinhaDeCategoria {
  id: string;
  nome: string;
  slug: string;
  descricao: string;
  ativo: boolean;
  created_at: string;
  icone?: string | null;
}

const { rpcMock, fromMock, escritasNaTabela, banco } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  // Tudo o que o hook tentou gravar/apagar DIRETO na tabela `categorias`.
  escritasNaTabela: [] as Array<{ operacao: string; payload?: unknown }>,
  banco: { categorias: [] as LinhaDeCategoria[] },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, from: fromMock },
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

function categoriasIniciais(): LinhaDeCategoria[] {
  return [
    {
      id: "c1",
      nome: "Brinquedo",
      slug: "brinquedo",
      descricao: "",
      ativo: true,
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "c2",
      nome: "Cama",
      slug: "cama",
      descricao: "",
      ativo: true,
      created_at: "2026-01-02T00:00:00Z",
    },
  ];
}

beforeEach(() => {
  vi.resetModules();
  escritasNaTabela.length = 0;
  banco.categorias = categoriasIniciais();
  rpcMock.mockReset();
  fromMock.mockReset();

  fromMock.mockImplementation((tabela: string) => {
    expect(tabela).toBe("categorias");
    return {
      select: () => ({
        order: async () => ({ data: [...banco.categorias], error: null }),
      }),
      update: (payload: Record<string, unknown>) => {
        escritasNaTabela.push({ operacao: "update", payload });
        return {
          eq: (_coluna: string, id: string) => ({
            select: async () => {
              const alvo = banco.categorias.find((c) => c.id === id);
              if (alvo && "ativo" in payload)
                alvo.ativo = payload.ativo as boolean;
              if (alvo && "icone" in payload)
                alvo.icone = payload.icone as string | null;
              return { data: alvo ? [{ id }] : [], error: null };
            },
          }),
        };
      },
      delete: () => {
        escritasNaTabela.push({ operacao: "delete" });
        return { eq: async () => ({ error: null }) };
      },
    };
  });

  rpcMock.mockImplementation(
    async (nome: string, args: { p_id: string; p_novo_nome?: string }) => {
      const alvo = banco.categorias.find((c) => c.id === args.p_id);
      if (nome === "renomear_categoria" && alvo) {
        const antigo = alvo.nome;
        alvo.nome = (args.p_novo_nome ?? "").trim();
        alvo.slug = alvo.nome.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        return {
          data: {
            id: alvo.id,
            nome_antigo: antigo,
            nome: alvo.nome,
            slug: alvo.slug,
            mudou: antigo !== alvo.nome,
            produtos: 3,
            banners: 1,
            regra_devolucao: 0,
          },
          error: null,
        };
      }
      if (nome === "apagar_categoria_vazia" && alvo) {
        banco.categorias = banco.categorias.filter((c) => c.id !== alvo.id);
        return {
          data: { id: alvo.id, nome: alvo.nome, apagada: true },
          error: null,
        };
      }
      return {
        data: null,
        error: { code: "P0002", message: "Categoria não encontrada." },
      };
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function montar() {
  const { useCategories } = await import("@/hooks/useCategories");
  const bus = await import("@/lib/avisos-de-categoria");
  const { ErroDeCategoria } = await import("@/lib/gestao-de-categorias");
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz: Root = createRoot(hospedeiro);
  const ref: { atual: ReturnType<typeof useCategories> | null } = {
    atual: null,
  };
  function Sonda() {
    const atual = useCategories();
    // Guardado no efeito (não durante o render) para o teste enxergar a
    // versão mais recente do hook sem violar a regra de imutabilidade.
    useEffect(() => {
      ref.atual = atual;
    });
    return (
      <ul>
        {atual.categories.map((c) => (
          <li key={c.id}>{`${c.name}|${c.slug}|${c.isActive}`}</li>
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
  const eventos: unknown[] = [];
  const parar = bus.assinarMudancasDeCategoria((m) => eventos.push(m));
  return {
    hook: () => ref.atual as NonNullable<typeof ref.atual>,
    linhas: () =>
      [...hospedeiro.querySelectorAll("li")].map((li) => li.textContent),
    eventos,
    ErroDeCategoria,
    desmontar: () => {
      parar();
      act(() => raiz.unmount());
      hospedeiro.remove();
    },
  };
}

describe("useCategories — ícone opcional", () => {
  it("lê a chave explícita e tolera campo ausente em banco antigo", async () => {
    banco.categorias[0].icone = "casa";
    const t = await montar();
    expect(t.hook().categories[0].icone).toBe("casa");
    expect(t.hook().categories[1].icone ?? null).toBeNull();
    t.desmontar();
  });

  it("erro sintético de coluna aciona a releitura defensiva dos campos antigos", async () => {
    // PostgREST real não produz este erro por faltar icone num select("*").
    // O caso anterior prova a tolerância normal ao campo ausente; este
    // dublê injeta a falha só para conservar a cobertura da defesa.
    const selecoes: string[] = [];
    fromMock.mockImplementation(() => ({
      select: (campos: string) => {
        selecoes.push(campos);
        return {
          order: async () =>
            campos === "*"
              ? {
                  data: null,
                  error: {
                    code: "42703",
                    message: "column categorias.icone does not exist",
                  },
                }
              : { data: categoriasIniciais(), error: null },
        };
      },
    }));
    const t = await montar();
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|true", "Cama|cama|true"]);
    expect(selecoes).toEqual(["*", "id,nome,slug,descricao,ativo,created_at"]);
    t.desmontar();
  });

  it("salva só o ícone e atualiza o retrato local após a confirmação", async () => {
    const t = await montar();
    await act(async () => {
      await t.hook().updateCategory("c1", { icone: "casa" });
    });
    expect(escritasNaTabela).toEqual([
      { operacao: "update", payload: { icone: "casa" } },
    ]);
    expect(t.hook().categories[0].icone).toBe("casa");
    await act(async () => {
      await t.hook().updateCategory("c1", { icone: null });
    });
    expect(t.hook().categories[0].icone).toBeNull();
    t.desmontar();
  });

  it("não anuncia sucesso nem muda o ícone quando a política não retorna linha", async () => {
    const t = await montar();
    let falha: unknown;
    await act(async () => {
      try {
        await t.hook().updateCategory("inexistente", { icone: "casa" });
      } catch (e) {
        falha = e;
      }
    });
    expect(falha).toBeInstanceOf(Error);
    expect(t.hook().categories[0].icone ?? null).toBeNull();
    t.desmontar();
  });
});

describe("useCategories — renomear passa SÓ pela porta do banco", () => {
  it("renameCategory chama renomear_categoria com o id e o nome novo, e NÃO escreve na tabela", async () => {
    const t = await montar();
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|true", "Cama|cama|true"]);

    let resultado:
      | Awaited<ReturnType<ReturnType<typeof t.hook>["renameCategory"]>>
      | undefined;
    await act(async () => {
      resultado = await t.hook().renameCategory("c1", "Brinquedos de Montar");
    });

    expect(rpcMock).toHaveBeenCalledWith("renomear_categoria", {
      p_id: "c1",
      p_novo_nome: "Brinquedos de Montar",
    });
    expect(escritasNaTabela).toEqual([]);
    expect(resultado).toMatchObject({
      nomeAntigo: "Brinquedo",
      nome: "Brinquedos de Montar",
      mudou: true,
      produtos: 3,
      banners: 1,
    });
    // a lista local já mostra o nome E o slug que o BANCO calculou
    expect(t.linhas()).toEqual([
      "Brinquedos de Montar|brinquedos-de-montar|true",
      "Cama|cama|true",
    ]);
    t.desmontar();
  });

  it("'Todas' e 'all' (o filtro da vitrine e o do painel) nao passam: nem renomear nem criar, e o banco nem e' chamado", async () => {
    const t = await montar();
    for (const nome of ["Todas", " todas ", "all", "ALL"]) {
      let erro: unknown;
      await act(async () => {
        try {
          await t.hook().renameCategory("c1", nome);
        } catch (e) {
          erro = e;
        }
      });
      expect(erro).toBeInstanceOf(t.ErroDeCategoria);
      expect((erro as Error).message, nome).toMatch(
        /já é do filtro que mostra todos os produtos/,
      );
      await act(async () => {
        erro = undefined;
        try {
          await t
            .hook()
            .addCategory({ name: nome, description: "", isActive: true }, true);
        } catch (e) {
          erro = e;
        }
      });
      expect(erro, `criar ${nome}`).toBeInstanceOf(t.ErroDeCategoria);
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(escritasNaTabela).toEqual([]);
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|true", "Cama|cama|true"]);
    expect(t.eventos).toEqual([]);
    t.desmontar();
  });

  it("avisa as outras telas (filtro lembrado da lista, campo do formulário) com o nome antigo e o novo", async () => {
    const t = await montar();
    await act(async () => {
      await t.hook().renameCategory("c1", "Brinquedos");
    });
    expect(t.eventos).toEqual([
      { tipo: "renomeada", de: "Brinquedo", para: "Brinquedos" },
    ]);
    t.desmontar();
  });

  it("nome igual (o banco devolve mudou=false): nada a avisar", async () => {
    const t = await montar();
    await act(async () => {
      await t.hook().renameCategory("c1", "Brinquedo");
    });
    expect(t.eventos).toEqual([]);
    t.desmontar();
  });

  it("recusa do banco (nome repetido): sobe a frase do banco, a lista não muda e ninguém é avisado", async () => {
    const t = await montar();
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "23505",
        message: 'Já existe uma categoria chamada "Cama". Escolha outro nome.',
      },
    });
    let erro: unknown;
    await act(async () => {
      try {
        await t.hook().renameCategory("c1", "cama");
      } catch (e) {
        erro = e;
      }
    });
    expect(erro).toBeInstanceOf(t.ErroDeCategoria);
    expect((erro as Error).message).toBe(
      'Já existe uma categoria chamada "Cama". Escolha outro nome.',
    );
    expect((erro as { code?: string }).code).toBe("23505");
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|true", "Cama|cama|true"]);
    expect(t.eventos).toEqual([]);
    t.desmontar();
  });

  it("resposta torta do servidor é erro, nunca 'deu certo'", async () => {
    const t = await montar();
    rpcMock.mockResolvedValueOnce({ data: { ok: true }, error: null });
    await act(async () => {
      await expect(t.hook().renameCategory("c1", "Outro")).rejects.toThrow(
        /Resposta inesperada/,
      );
    });
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|true", "Cama|cama|true"]);
    expect(t.eventos).toEqual([]);
    t.desmontar();
  });

  it("updateCategory com nome: usa a porta e NUNCA manda nome nem slug para a tabela", async () => {
    const t = await montar();
    await act(async () => {
      await t.hook().updateCategory("c1", { name: "Brinquedos" });
    });
    expect(rpcMock).toHaveBeenCalledWith("renomear_categoria", {
      p_id: "c1",
      p_novo_nome: "Brinquedos",
    });
    for (const escrita of escritasNaTabela) {
      expect(JSON.stringify(escrita.payload ?? {})).not.toMatch(/nome|slug/);
    }
    t.desmontar();
  });
});

describe("useCategories — apagar passa SÓ pela porta do banco", () => {
  it("deleteCategory chama apagar_categoria_vazia e NÃO apaga direto da tabela", async () => {
    const t = await montar();
    await act(async () => {
      await t.hook().deleteCategory("c2");
    });
    expect(rpcMock).toHaveBeenCalledWith("apagar_categoria_vazia", {
      p_id: "c2",
    });
    expect(escritasNaTabela.filter((e) => e.operacao === "delete")).toEqual([]);
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|true"]);
    expect(t.eventos).toEqual([{ tipo: "apagada", nome: "Cama" }]);
    t.desmontar();
  });

  it("categoria em uso: o banco recusa, a frase dele sobe e a categoria FICA na lista", async () => {
    const t = await montar();
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        code: "55006",
        message: 'A categoria "Brinquedo" ainda está em uso: 3 produtos.',
      },
    });
    let erro: unknown;
    await act(async () => {
      try {
        await t.hook().deleteCategory("c1");
      } catch (e) {
        erro = e;
      }
    });
    expect((erro as Error).message).toBe(
      'A categoria "Brinquedo" ainda está em uso: 3 produtos.',
    );
    // Não é apagada "para ver se cola": nada de remoção otimista que depois volta.
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|true", "Cama|cama|true"]);
    expect(t.eventos).toEqual([]);
    t.desmontar();
  });
});

describe("useCategories — esconder da vitrine é só a coluna `ativo`", () => {
  it("setCategoryActive muda `ativo` e nada mais, e avisa a vitrine/lista", async () => {
    const t = await montar();
    await act(async () => {
      await t.hook().setCategoryActive("c1", false);
    });
    expect(escritasNaTabela).toEqual([
      { operacao: "update", payload: { ativo: false } },
    ]);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(t.linhas()).toEqual(["Brinquedo|brinquedo|false", "Cama|cama|true"]);
    expect(t.eventos).toEqual([{ tipo: "visibilidade" }]);
    t.desmontar();
  });

  it("0 linhas mudadas (a política de acesso não deixou) é falha, não sucesso", async () => {
    const t = await montar();
    let erro: unknown;
    await act(async () => {
      try {
        await t.hook().setCategoryActive("não-existe", false);
      } catch (e) {
        erro = e;
      }
    });
    expect(erro).toBeInstanceOf(t.ErroDeCategoria);
    expect(t.eventos).toEqual([]);
    t.desmontar();
  });
});

describe("useCategories — as outras telas releem na hora", () => {
  it("duas telas com a lista: renomear numa atualiza a outra sem esperar o Realtime", async () => {
    const t = await montar();
    // segunda cópia da lista (o formulário do produto, por exemplo) montada ao lado
    const { useCategories } = await import("@/hooks/useCategories");
    const hospedeiro2 = document.createElement("div");
    document.body.appendChild(hospedeiro2);
    const raiz2 = createRoot(hospedeiro2);
    function Segunda() {
      const { categories } = useCategories();
      return <p>{categories.map((c) => c.name).join(",")}</p>;
    }
    await act(async () => {
      raiz2.render(<Segunda />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hospedeiro2.textContent).toBe("Brinquedo,Cama");

    await act(async () => {
      await t.hook().renameCategory("c1", "Brinquedos");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hospedeiro2.textContent).toBe("Brinquedos,Cama");

    act(() => raiz2.unmount());
    hospedeiro2.remove();
    t.desmontar();
  });
});
