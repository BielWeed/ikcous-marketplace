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
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: h.consultar }),
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

  beforeEach(async () => {
    vi.resetModules();
    h.consultar.mockReset().mockResolvedValue(resposta("antigo"));
    h.salvar.mockReset().mockResolvedValue(undefined);
    h.erro.mockReset();
    const { useCategories, categoriasEmMemoria } = await import(
      "@/hooks/useCategories"
    );
    emMemoria = categoriasEmMemoria;
    let atual!: ReturnType<typeof useCategories>;
    function Sonda() {
      const valor = useCategories();
      useEffect(() => {
        atual = valor;
      });
      return <p>{valor.categories.map((c) => c.icone).join(",")}</p>;
    }
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
    hook = () => atual;
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
          await esperaAntiga;
        });
        await act(async () => {
          nova.responder(resposta("novo"));
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
