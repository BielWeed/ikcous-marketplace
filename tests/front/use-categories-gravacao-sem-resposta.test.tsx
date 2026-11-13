// @vitest-environment jsdom
//
// Rede "pendurada" conecta e não responde. Renomear, apagar, esconder e trocar
// o ícone da categoria esperavam para sempre: a folha de Gerenciar categorias
// ficava em "Salvando…/Apagando…" com todos os botões apagados, e só reabrir a
// folha destravava. Com o prazo, a ESPERA termina com um erro de "sem resposta"
// cuja frase diz que NÃO se sabe se gravou (o servidor pode ter gravado) e manda
// conferir a lista — nunca "nada foi mudado". A lista local não muda sozinha.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  atualizar: vi.fn(),
  inserir: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  // O que o "servidor" devolve na leitura, e quantas leituras já fez.
  linhas: [] as Record<string, unknown>[],
  leituras: 0,
}));
const BRINQUEDO = {
  id: "c1",
  nome: "Brinquedo",
  slug: "brinquedo",
  descricao: "",
  ativo: true,
  created_at: "2026-01-01T00:00:00Z",
};
const JOGOS = {
  id: "c2",
  nome: "Jogos",
  slug: "jogos",
  descricao: "",
  ativo: true,
  created_at: "2026-01-02T00:00:00Z",
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({
      select: () => ({
        order: async () => {
          h.leituras += 1;
          return { data: h.linhas, error: null };
        },
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
  toast: { success: h.toastSuccess, error: h.toastError, loading: vi.fn() },
}));

const pendurada = () => new Promise<never>(() => {});
const PRAZO_ESTOURADO_MS = 25_000;

describe("useCategories — gravação que nunca responde", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook!: () => ReturnType<
    typeof import("@/hooks/useCategories").useCategories
  >;
  let ehConsultaSemResposta!: (erro: unknown) => boolean;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.rpc.mockReset().mockImplementation(pendurada);
    h.atualizar.mockReset().mockImplementation(pendurada);
    h.inserir.mockReset().mockImplementation(pendurada);
    h.toastSuccess.mockReset();
    h.toastError.mockReset();
    h.linhas = [BRINQUEDO];
    h.leituras = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { useCategories } = await import("@/hooks/useCategories");
    ({ ehConsultaSemResposta } = await import("@/lib/prazo-da-requisicao"));
    let atual!: ReturnType<typeof useCategories>;
    function Sonda() {
      const valor = useCategories();
      useEffect(() => {
        atual = valor;
      });
      return (
        <ul>
          {valor.categories.map((c) => (
            <li key={c.id}>{`${c.name}|${c.isActive}`}</li>
          ))}
        </ul>
      );
    }
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    hook = () => atual;
    expect(hospedeiro.textContent).toBe("Brinquedo|true");
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function esperarOPrazo(operacao: () => Promise<unknown>) {
    let erro: unknown;
    let terminou = false;
    await act(async () => {
      operacao().then(
        () => {
          terminou = true;
        },
        (e) => {
          erro = e;
          terminou = true;
        },
      );
      await vi.advanceTimersByTimeAsync(PRAZO_ESTOURADO_MS);
    });
    return { erro, terminou };
  }

  function confereFraseDeQueNaoSeSabe(erro: unknown, oQue: string) {
    expect(ehConsultaSemResposta(erro)).toBe(true);
    const frase = (erro as Error).message;
    expect(frase).toContain("Sem resposta da rede");
    expect(frase).toContain(`Não sabemos se ${oQue}`);
    expect(frase).toContain("Confira na lista");
    // Nunca promete que nada mudou: o servidor pode ter gravado.
    expect(frase).not.toMatch(/nada foi mudado/i);
  }

  it.each([true, false])(
    "criar (silencioso=%s): encerra aos 20 s, retira a provisória e ignora sucesso tardio",
    async (silencioso) => {
      let responder!: (resposta: unknown) => void;
      h.inserir.mockReturnValue(
        new Promise((resolve) => {
          responder = resolve;
        }),
      );
      let erro: unknown;
      let terminou = false;
      await act(async () => {
        void hook()
          .addCategory(
            { name: "Jogos", description: "", isActive: true },
            silencioso,
          )
          .catch((e) => {
            erro = e;
            terminou = true;
          });
      });
      expect(hospedeiro.textContent).toBe("Brinquedo|trueJogos|true");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(19_999);
      });
      expect(terminou).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(terminou).toBe(true);
      confereFraseDeQueNaoSeSabe(erro, "a categoria foi criada");
      expect(hospedeiro.textContent).toBe("Brinquedo|true");
      if (silencioso) expect(h.toastError).not.toHaveBeenCalled();
      else expect(h.toastError).toHaveBeenCalledWith((erro as Error).message);

      await act(async () => {
        responder({
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
      });
      expect(hospedeiro.textContent).toBe("Brinquedo|true");
      expect(h.toastSuccess).not.toHaveBeenCalled();
      expect(h.inserir).toHaveBeenCalledTimes(1);
    },
  );

  // Estourou o prazo da CRIAÇÃO: o servidor pode ter gravado. A tela não diz
  // "criada" nem "falhou": solta a espera e RELÊ a lista real.
  async function estourarACriacao() {
    h.inserir.mockReturnValue(pendurada());
    let erro: unknown;
    await act(async () => {
      void hook()
        .addCategory({ name: "Jogos", description: "", isActive: true }, true)
        .catch((e) => {
          erro = e;
        });
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return erro;
  }

  it("criar sem resposta: relê a lista e mostra a categoria que o servidor gravou", async () => {
    expect(h.leituras).toBe(1);
    h.linhas = [BRINQUEDO, JOGOS]; // gravou, mas a resposta nunca chegou
    const erro = await estourarACriacao();

    confereFraseDeQueNaoSeSabe(erro, "a categoria foi criada");
    expect(h.leituras).toBe(2);
    expect(hospedeiro.textContent).toBe("Brinquedo|trueJogos|true");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("criar sem resposta: se o servidor não gravou, a lista continua sem ela", async () => {
    const erro = await estourarACriacao();

    confereFraseDeQueNaoSeSabe(erro, "a categoria foi criada");
    expect(h.leituras).toBe(2);
    expect(hospedeiro.textContent).toBe("Brinquedo|true");
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("criar que o banco recusa de verdade não relê a lista", async () => {
    h.inserir.mockResolvedValue({
      data: null,
      error: { code: "08006", message: "connection failure" },
    });
    await act(async () => {
      await hook()
        .addCategory({ name: "Jogos", description: "", isActive: true }, true)
        .catch(() => {});
    });
    expect(h.leituras).toBe(1);
    expect(hospedeiro.textContent).toBe("Brinquedo|true");
  });

  it("renomear: solta a espera com a frase de não saber se trocou", async () => {
    const r = await esperarOPrazo(() => hook().renameCategory("c1", "Jogos"));

    expect(r.terminou).toBe(true);
    confereFraseDeQueNaoSeSabe(r.erro, "o nome foi trocado");
    expect(h.rpc).toHaveBeenCalledWith("renomear_categoria", {
      p_id: "c1",
      p_novo_nome: "Jogos",
    });
    // A lista local não muda sozinha: quem confirma é a releitura da tela.
    expect(hospedeiro.textContent).toBe("Brinquedo|true");
  });

  it("apagar: solta a espera e a categoria continua na lista", async () => {
    const r = await esperarOPrazo(() => hook().deleteCategory("c1"));

    expect(r.terminou).toBe(true);
    confereFraseDeQueNaoSeSabe(r.erro, "a categoria foi apagada");
    expect(h.rpc).toHaveBeenCalledWith("apagar_categoria_vazia", {
      p_id: "c1",
    });
    expect(hospedeiro.textContent).toBe("Brinquedo|true");
  });

  it("esconder da vitrine: solta a espera", async () => {
    const r = await esperarOPrazo(() => hook().setCategoryActive("c1", false));

    expect(r.terminou).toBe(true);
    confereFraseDeQueNaoSeSabe(r.erro, "a vitrine mudou");
    expect(h.atualizar).toHaveBeenCalledWith({ ativo: false }, "c1");
    expect(hospedeiro.textContent).toBe("Brinquedo|true");
  });

  it("trocar o ícone: solta a espera e o aviso silencioso não é disparado", async () => {
    const r = await esperarOPrazo(() =>
      hook().updateCategory("c1", { icone: "casa", iconeForma: null }, true),
    );

    expect(r.terminou).toBe(true);
    confereFraseDeQueNaoSeSabe(r.erro, "o ícone mudou");
    expect(h.atualizar).toHaveBeenCalledWith(
      { icone: "casa", icone_forma: null },
      "c1",
    );
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it("resposta que chega dentro do prazo segue como sempre", async () => {
    h.rpc.mockReset().mockResolvedValue({
      data: {
        id: "c1",
        nome_antigo: "Brinquedo",
        nome: "Jogos",
        slug: "jogos",
        mudou: true,
        produtos: 0,
        banners: 0,
        regra_devolucao: 0,
      },
      error: null,
    });
    let resultado:
      | Awaited<ReturnType<ReturnType<typeof hook>["renameCategory"]>>
      | undefined;
    await act(async () => {
      resultado = await hook().renameCategory("c1", "Jogos");
    });

    expect(resultado).toMatchObject({ nome: "Jogos", mudou: true });
  });
});
