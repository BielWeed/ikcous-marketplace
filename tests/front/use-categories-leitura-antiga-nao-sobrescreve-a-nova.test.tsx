// @vitest-environment jsdom
// A releitura anterior à troca do ícone não pode desfazer a confirmação nova,
// nem na tela, nem na memória, nem na cópia salva no aparelho.
import type { Category } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  salvar: vi.fn(),
  erro: vi.fn(),
  inserir: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: h.consultar }),
      insert: () => ({ select: () => ({ single: h.inserir }) }),
      update: () => ({
        eq: () => ({
          select: async () => ({ data: [{ id: "c1" }], error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: h.salvar,
      setLastSync: async () => {},
    }),
  },
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: h.erro },
}));

function resposta(icone: string) {
  return {
    data: [
      {
        id: "c1",
        nome: "Brinquedo",
        slug: "brinquedo",
        descricao: "",
        ativo: true,
        icone,
        icone_forma: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    error: null,
  };
}

function leituraControlada() {
  let responder!: (valor: ReturnType<typeof resposta>) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<ReturnType<typeof resposta>>(
    (resolve, reject) => {
      responder = resolve;
      rejeitar = reject;
    },
  );
  return { promessa, responder, rejeitar };
}

describe("useCategories — leitura antiga não sobrescreve a nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook!: () => ReturnType<
    typeof import("@/hooks/useCategories").useCategories
  >;
  let emMemoria!: () => Category[] | null;
  let segunda!: typeof hook;
  let montarDuas!: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    h.consultar.mockReset().mockResolvedValue(resposta("antigo"));
    h.salvar.mockReset().mockResolvedValue(undefined);
    h.erro.mockReset();
    h.inserir.mockReset().mockResolvedValue({
      data: {
        id: "c2",
        nome: "Jogos",
        slug: "jogos",
        descricao: "",
        ativo: true,
        created_at: "2026-01-02T00:00:00Z",
      },
      error: null,
    });
    const { useCategories, categoriasEmMemoria } = await import(
      "@/hooks/useCategories"
    );
    emMemoria = categoriasEmMemoria;
    const atuais = new Map<number, ReturnType<typeof useCategories>>();
    function Sonda({ indice }: { indice: number }) {
      const valor = useCategories();
      useEffect(() => {
        atuais.set(indice, valor);
      });
      return <p>{valor.categories.map((c) => c.icone).join(",")}</p>;
    }
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda indice={0} />));
    hook = () => atuais.get(0)!;
    segunda = () => atuais.get(1)!;
    montarDuas = async () => {
      await act(async () =>
        raiz.render(
          <>
            <Sonda indice={0} />
            <Sonda indice={1} />
          </>,
        ),
      );
      expect(hospedeiro.textContent).toBe("antigoantigo");
    };
    expect(hospedeiro.textContent).toBe("antigo");
    h.salvar.mockClear();
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  function conferirNovo() {
    expect(hospedeiro.textContent).toBe("novo");
    expect(emMemoria()?.[0].icone).toBe("novo");
    expect(h.salvar).toHaveBeenLastCalledWith(
      "categories",
      expect.arrayContaining([expect.objectContaining({ icone: "novo" })]),
    );
  }

  it.each([false, true])(
    "a troca do ícone prevalece (leitura antiga termina primeiro=%s)",
    async (antigaPrimeiro) => {
      const antiga = leituraControlada();
      const nova = leituraControlada();
      h.consultar
        .mockReturnValueOnce(antiga.promessa)
        .mockReturnValueOnce(nova.promessa);
      let esperaAntiga!: Promise<void>;
      await act(async () => {
        esperaAntiga = hook().fetchCategories(true, true);
      });
      // A gravação real do hook dispara a releitura forçada pelo ouvinte.
      await act(async () => {
        await hook().updateCategory("c1", { icone: "novo" }, true);
      });
      if (antigaPrimeiro) {
        await act(async () => {
          antiga.responder(resposta("antigo"));
        });
        await act(async () => {
          nova.responder(resposta("novo"));
          await esperaAntiga;
        });
      } else {
        await act(async () => {
          nova.responder(resposta("novo"));
        });
        conferirNovo();
        const gravacoes = h.salvar.mock.calls.length;
        await act(async () => {
          antiga.responder(resposta("antigo"));
          await esperaAntiga;
        });
        conferirNovo();
        expect(h.salvar).toHaveBeenCalledTimes(gravacoes);
      }
      conferirNovo();
      expect(h.erro).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "duas instâncias recebem a leitura nova e encerram a espera (antiga primeiro=%s)",
    async (antigaPrimeiro) => {
      await montarDuas();
      const antiga = leituraControlada();
      const nova = leituraControlada();
      h.consultar
        .mockReturnValueOnce(antiga.promessa)
        .mockReturnValueOnce(nova.promessa);
      let esperaAntiga!: Promise<void>;
      let esperaNova!: Promise<void>;
      await act(async () => {
        esperaAntiga = hook().fetchCategories(false, true);
        esperaNova = segunda().fetchCategories(false, true);
      });
      expect(hook().isLoading).toBe(true);
      expect(segunda().isLoading).toBe(true);
      if (antigaPrimeiro) {
        await act(async () => {
          antiga.responder(resposta("antigo"));
        });
        // A tela X continua esperando B; A não solta a consulta global de B.
        expect(hook().isLoading).toBe(true);
        expect(segunda().isLoading).toBe(true);
        await act(async () => {
          nova.responder(resposta("novo"));
        });
      } else {
        await act(async () => {
          nova.responder(resposta("novo"));
        });
        const gravacoes = h.salvar.mock.calls.length;
        await act(async () => {
          antiga.responder(resposta("antigo"));
        });
        expect(h.salvar).toHaveBeenCalledTimes(gravacoes);
      }
      await act(async () => {
        await Promise.all([esperaAntiga, esperaNova]);
      });
      expect(hospedeiro.textContent).toBe("novonovo");
      expect(hook().isLoading).toBe(false);
      expect(segunda().isLoading).toBe(false);
      expect(emMemoria()?.[0].icone).toBe("novo");
      expect(h.salvar).toHaveBeenLastCalledWith(
        "categories",
        expect.arrayContaining([expect.objectContaining({ icone: "novo" })]),
      );
      expect(h.erro).not.toHaveBeenCalled();
    },
  );

  it("a falha da leitura nova alcança as duas instâncias que a aguardam", async () => {
    await montarDuas();
    const antiga = leituraControlada();
    const nova = leituraControlada();
    h.consultar
      .mockReturnValueOnce(antiga.promessa)
      .mockReturnValueOnce(nova.promessa);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let esperaAntiga!: Promise<void>;
    let esperaNova!: Promise<void>;
    await act(async () => {
      esperaAntiga = hook().fetchCategories(false, true);
      esperaNova = segunda().fetchCategories(false, true);
    });
    await act(async () => {
      antiga.responder(resposta("antigo"));
    });
    await act(async () => {
      nova.rejeitar(new Error("Falha da leitura nova"));
      await Promise.all([esperaAntiga, esperaNova]);
    });
    expect(hospedeiro.textContent).toBe("antigoantigo");
    expect(hook().isLoading).toBe(false);
    expect(segunda().isLoading).toBe(false);
    expect(emMemoria()?.[0].icone).toBe("antigo");
    expect(h.salvar).not.toHaveBeenCalled();
    expect(h.erro).toHaveBeenCalledTimes(2);
    // Mesmo id nas duas chamadas: o Sonner mostra UM aviso só.
    expect(h.erro).toHaveBeenCalledWith("Erro ao carregar categorias", {
      id: "Erro ao carregar categorias",
    });
  });

  it("uma única leitura aplica normalmente na tela, memória e cofre", async () => {
    h.consultar.mockResolvedValueOnce(resposta("novo"));
    await act(async () => {
      await hook().fetchCategories(true, true);
    });
    conferirNovo();
  });

  it("quem pegou carona na leitura antiga não restaura o ícone velho", async () => {
    const antiga = leituraControlada();
    const nova = leituraControlada();
    h.consultar
      .mockReturnValueOnce(antiga.promessa)
      .mockReturnValueOnce(nova.promessa);
    let esperaAntiga!: Promise<void>;
    let carona!: Promise<void>;
    await act(async () => {
      esperaAntiga = hook().fetchCategories(true, true);
      carona = hook().fetchCategories(true);
    });
    await act(async () => {
      await hook().updateCategory("c1", { icone: "novo" }, true);
    });
    await act(async () => {
      nova.responder(resposta("novo"));
    });
    await act(async () => {
      antiga.responder(resposta("antigo"));
      await Promise.all([esperaAntiga, carona]);
    });
    conferirNovo();
    expect(h.consultar).toHaveBeenCalledTimes(3); // carga inicial, A e B
  });

  // Criar categoria (sem ícone, sem trocar nada depois) também confirma uma
  // lista nova: a leitura iniciada ANTES da criação não a conhece e não pode
  // apagá-la da tela, da memória do módulo nem da cópia do aparelho.
  const nomesNaTela = () => hook().categories.map((c) => c.name);
  const conferirComJogos = () => {
    expect(nomesNaTela()).toEqual(["Brinquedo", "Jogos"]);
    expect(emMemoria()?.map((c) => c.name)).toEqual(["Brinquedo", "Jogos"]);
    expect(h.salvar).toHaveBeenLastCalledWith(
      "categories",
      expect.arrayContaining([expect.objectContaining({ name: "Jogos" })]),
    );
  };
  const NOVA = { name: "Jogos", description: "", isActive: true };

  it.each(["responde", "falha"])(
    "criar sem ícone: a leitura em voo iniciada antes que %s depois não apaga a categoria",
    async (fim) => {
      const antiga = leituraControlada();
      h.consultar.mockReturnValueOnce(antiga.promessa);
      vi.spyOn(console, "error").mockImplementation(() => {});
      let esperaAntiga!: Promise<void>;
      await act(async () => {
        esperaAntiga = hook().fetchCategories(true, true);
      });
      await act(async () => {
        await hook().addCategory(NOVA, true);
      });
      conferirComJogos();
      const gravacoes = h.salvar.mock.calls.length;
      await act(async () => {
        if (fim === "responde") antiga.responder(resposta("antigo"));
        else antiga.rejeitar(new Error("Falha da consulta antiga"));
        await esperaAntiga;
      });
      conferirComJogos();
      expect(h.salvar).toHaveBeenCalledTimes(gravacoes);
      expect(h.erro).not.toHaveBeenCalled();
      expect(h.consultar).toHaveBeenCalledTimes(2); // carga inicial e a antiga
    },
  );

  it("criar que o banco recusa deixa a leitura em voo valer como sempre", async () => {
    const antiga = leituraControlada();
    h.consultar.mockReturnValueOnce(antiga.promessa);
    h.inserir.mockResolvedValue({
      data: null,
      error: { code: "08006", message: "connection failure" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let esperaAntiga!: Promise<void>;
    await act(async () => {
      esperaAntiga = hook().fetchCategories(true, true);
    });
    await act(async () => {
      await hook()
        .addCategory(NOVA, true)
        .catch(() => {});
    });
    expect(nomesNaTela()).toEqual(["Brinquedo"]);
    await act(async () => {
      antiga.responder(resposta("lida"));
      await esperaAntiga;
    });
    // Nada foi confirmado: a leitura em voo continua sendo a verdade mais nova.
    expect(hospedeiro.textContent).toBe("lida");
    expect(emMemoria()?.[0].icone).toBe("lida");
  });

  it("criar sem leitura em voo não faz leitura nova nem mexe na ordem", async () => {
    await act(async () => {
      await hook().addCategory(NOVA, true);
    });
    conferirComJogos();
    expect(h.consultar).toHaveBeenCalledTimes(1);
  });

  it("falha tardia da leitura superada não avisa nem altera a lista nova", async () => {
    const antiga = leituraControlada();
    h.consultar
      .mockReturnValueOnce(antiga.promessa)
      .mockResolvedValueOnce(resposta("novo"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    let esperaAntiga!: Promise<void>;
    await act(async () => {
      esperaAntiga = hook().fetchCategories(true, true);
    });
    await act(async () => {
      await hook().updateCategory("c1", { icone: "novo" }, true);
    });
    await act(async () => {
      antiga.rejeitar(new Error("Falha da consulta antiga"));
      await esperaAntiga;
    });
    conferirNovo();
    expect(h.erro).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});
