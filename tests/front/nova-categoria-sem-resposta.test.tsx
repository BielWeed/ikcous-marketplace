// @vitest-environment jsdom
// Folha + useCategories REAIS. Só a fronteira Supabase/cofre é dublada:
// um callback falso não provaria que o INSERT pendurado solta a folha.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  inserir: vi.fn(),
  atualizar: vi.fn(),
  sucesso: vi.fn(),
  erro: vi.fn(),
  aviso: vi.fn(),
  criada: vi.fn(),
  fechou: vi.fn(),
  dispensar: vi.fn(),
  // O que o "servidor" lista: a Geral, e a Jogos só se ele chegou a gravá-la.
  servidor: vi.fn(),
}));
const registro = {
  id: "c2",
  nome: "Jogos",
  slug: "jogos",
  descricao: "",
  ativo: true,
  created_at: "2026-01-02T00:00:00Z",
};
const GERAL = { ...registro, id: "c1", nome: "Geral", slug: "geral" };
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: async () => ({ data: h.servidor(), error: null }),
      }),
      insert: (valores: unknown) => ({
        select: () => ({ single: () => h.inserir(valores) }),
      }),
      update: (valores: unknown) => ({
        eq: (_coluna: string, id: string) => ({
          select: () => h.atualizar(valores, id),
        }),
      }),
    }),
    rpc: vi.fn(),
  },
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
  toast: {
    loading: vi.fn(() => "criacao"),
    dismiss: h.dispensar,
    success: h.sucesso,
    error: h.erro,
    warning: h.aviso,
  },
}));

function botao(texto: string) {
  const encontrado = [...document.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
  if (!encontrado) throw new Error(`Botão ausente: ${texto}`);
  return encontrado;
}

describe("Nova categoria — rede pendurada com hook real", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let responder!: (valor: unknown) => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.inserir.mockReset().mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    h.servidor.mockReset().mockReturnValue([GERAL]);
    h.atualizar
      .mockReset()
      .mockResolvedValue({ data: [{ id: "c2" }], error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A galeria é real, mas o catálogo externo não faz parte desta prova.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
    );
    const { useCategories } = await import("@/hooks/useCategories");
    const { FolhaDeNovaCategoria } = await import(
      "@/components/admin/products/FolhaDeNovaCategoria"
    );
    function Formulario() {
      const categorias = useCategories();
      const [aberta, setAberta] = useState(true);
      const [selecionada, setSelecionada] = useState("Geral");
      return (
        <>
          <output data-testid="selecionada">{selecionada}</output>
          <ul>
            {categorias.categories.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setAberta(true)}>
            Nova categoria
          </button>
          {aberta ? (
            <FolhaDeNovaCategoria
              categoriasDaLoja={categorias.categories}
              adicionar={categorias.addCategory}
              atualizarIcone={categorias.updateCategory}
              aoCriada={(nome) => {
                h.criada(nome);
                setSelecionada(nome);
              }}
              aoFechar={() => {
                h.fechou();
                setAberta(false);
              }}
            />
          ) : null}
        </>
      );
    }
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Formulario />);
    });
    await passar(0);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  async function tocar(texto: string) {
    await act(async () => {
      botao(texto).click();
    });
  }
  async function digitar(nome: string) {
    const campo = document.getElementById("cat-name") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, nome);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(200);
    });
  }

  it.each(["Cancelar", "Fechar", "Escape"])(
    "aos 20 s mostra incerteza, libera %s e não interfere na nova folha ao chegar resposta tardia",
    async (saida) => {
      await digitar("Jogos");
      await tocar("Criar categoria");
      expect(botao("Cancelar").disabled).toBe(true);
      expect(botao("Fechar").disabled).toBe(true);
      await passar(19_999);
      expect(botao("Cancelar").disabled).toBe(true);
      await passar(1);

      expect(botao("Cancelar").disabled).toBe(false);
      expect(botao("Fechar").disabled).toBe(false);
      expect(h.erro).toHaveBeenCalledTimes(1);
      const frase = String(h.erro.mock.calls[0][0]);
      expect(frase).toMatch(/Sem resposta da rede/);
      expect(frase).toMatch(/Não sabemos se a categoria foi criada/);
      expect(frase).toMatch(/Confira na lista/);
      expect(frase).not.toMatch(/nada foi|não foi criad/i);
      expect(h.criada).not.toHaveBeenCalled();
      expect(h.sucesso).not.toHaveBeenCalled();

      if (saida === "Escape") {
        await act(async () => {
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        });
      } else await tocar(saida);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await tocar("Nova categoria");
      await digitar("Outra categoria");
      await act(async () => {
        responder({ data: registro, error: null });
      });

      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(
        (document.getElementById("cat-name") as HTMLInputElement).value,
      ).toBe("Outra categoria");
      expect(hospedeiro.querySelector("output")?.textContent).toBe("Geral");
      expect(
        [...hospedeiro.querySelectorAll("li")].map((li) => li.textContent),
      ).toEqual(["Geral"]);
      expect(h.criada).not.toHaveBeenCalled();
      expect(h.fechou).toHaveBeenCalledTimes(1);
      expect(h.sucesso).not.toHaveBeenCalled();
      expect(h.atualizar).not.toHaveBeenCalled();
      // O aviso já virou erro: fechar não pode apagá-lo.
      expect(h.dispensar).not.toHaveBeenCalled();
    },
  );

  it("sem resposta, a lista é relida: a categoria que o servidor gravou aparece e repetir não cria outra", async () => {
    await digitar("Jogos");
    await tocar("Criar categoria");
    h.servidor.mockReturnValue([GERAL, registro]); // gravou, sem responder
    await passar(20_000);
    await passar(0);

    expect(h.erro).toHaveBeenCalledTimes(1);
    expect(String(h.erro.mock.calls[0][0])).toMatch(
      /Não sabemos se a categoria foi criada/,
    );
    expect(h.sucesso).not.toHaveBeenCalled();
    expect(h.criada).not.toHaveBeenCalled();
    expect(
      [...hospedeiro.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["Geral", "Jogos"]);

    // Repetir não cai em "já existe" vindo do banco: a folha já a enxerga.
    await tocar("Criar categoria");
    expect(h.inserir).toHaveBeenCalledTimes(1);
    expect(h.erro).toHaveBeenLastCalledWith(
      "Já existe uma categoria parecida: Jogos",
    );
  });

  it.each(["sucesso", "erro"])(
    "desmontar com INSERT pendente dispensa só seu aviso; resposta tardia de %s não tem efeitos",
    async (resultado) => {
      await digitar("Jogos");
      await tocar("Criar categoria");
      expect(h.dispensar).not.toHaveBeenCalled();
      // Sair por navegação desmonta a folha, mesmo durante a espera.
      await act(async () => {
        raiz.render(<p>Outra tela</p>);
      });
      expect(h.dispensar).toHaveBeenCalledTimes(1);
      expect(h.dispensar).toHaveBeenCalledWith("criacao");

      await act(async () => {
        responder(
          resultado === "sucesso"
            ? { data: registro, error: null }
            : { data: null, error: { code: "08006", message: "sem resposta" } },
        );
      });
      expect(h.criada).not.toHaveBeenCalled();
      expect(h.fechou).not.toHaveBeenCalled();
      expect(h.sucesso).not.toHaveBeenCalled();
      expect(h.erro).not.toHaveBeenCalled();
      expect(h.aviso).not.toHaveBeenCalled();
      expect(h.dispensar).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["sucesso", "erro"])(
    "desmontar com ícone pendente dispensa só seu aviso; resposta tardia de %s não tem efeitos",
    async (resultado) => {
      let responderIcone!: (valor: unknown) => void;
      h.atualizar.mockReturnValueOnce(
        new Promise((resolve) => {
          responderIcone = resolve;
        }),
      );
      await digitar("Jogos");
      await tocar("Ícone Casa para Jogos");
      await tocar("Criar categoria");
      await act(async () => {
        responder({ data: registro, error: null });
      });
      // A categoria já foi confirmada; só o ícone ainda aguarda resposta.
      expect(h.criada).toHaveBeenCalledTimes(1);
      expect(h.dispensar).not.toHaveBeenCalled();
      await act(async () => {
        raiz.render(<p>Outra tela</p>);
      });
      expect(h.dispensar).toHaveBeenCalledTimes(1);
      expect(h.dispensar).toHaveBeenCalledWith("criacao");

      await act(async () => {
        responderIcone(
          resultado === "sucesso"
            ? { data: [{ id: "c2" }], error: null }
            : { data: null, error: { code: "08006", message: "sem resposta" } },
        );
      });
      expect(h.criada).toHaveBeenCalledTimes(1);
      expect(h.fechou).not.toHaveBeenCalled();
      expect(h.sucesso).not.toHaveBeenCalled();
      expect(h.erro).not.toHaveBeenCalled();
      expect(h.aviso).not.toHaveBeenCalled();
      expect(h.dispensar).toHaveBeenCalledTimes(1);
    },
  );

  it("não dispensa aviso já convertido em falha do ícone ao fechar normalmente", async () => {
    h.atualizar.mockResolvedValueOnce({
      data: null,
      error: { code: "08006", message: "sem resposta" },
    });
    await digitar("Jogos");
    await tocar("Ícone Casa para Jogos");
    await tocar("Criar categoria");
    await act(async () => {
      responder({ data: registro, error: null });
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(h.aviso).toHaveBeenCalledWith(
      "Categoria criada, mas o ícone não foi salvo. Escolha o ícone em Organizar categorias.",
      { id: "criacao" },
    );
    expect(h.dispensar).not.toHaveBeenCalled();
  });

  it("uma resposta dentro do prazo mantém seleção, ícone e sucesso de sempre", async () => {
    await digitar("Jogos");
    await tocar("Ícone Casa para Jogos");
    await tocar("Criar categoria");
    await act(async () => {
      responder({ data: registro, error: null });
    });
    expect(hospedeiro.querySelector("output")?.textContent).toBe("Jogos");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(h.atualizar).toHaveBeenCalledWith(
      { icone: "casa", icone_forma: null },
      "c2",
    );
    expect(h.sucesso).toHaveBeenCalledWith("Categoria criada com sucesso!", {
      id: "criacao",
    });
    expect(h.aviso).not.toHaveBeenCalled();
    expect(h.dispensar).not.toHaveBeenCalled();
  });
});
