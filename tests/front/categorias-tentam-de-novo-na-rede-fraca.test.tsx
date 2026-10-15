// @vitest-environment jsdom
//
// Primeira visita com a rede falhando na consulta das CATEGORIAS: o hook avisava
// com um toast e desistia -- a vitrine ficava sem filtros ate a cliente recarregar
// a pagina, mesmo com a rede voltando segundos depois. O conserto faz ate 3 novas
// tentativas automaticas (espera crescente 1 s / 2 s / 4 s), tenta de novo quando a
// rede volta (`online`) ou a aba volta a ficar visivel, mantem UM pedido em voo por
// vez e so avisa a falha (toast) quando as tentativas acabam.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  // O que a consulta de categorias devolve agora (mutado por teste).
  resposta: { data: null as unknown, error: null as unknown },
  // Quando (relogio do teste) cada consulta foi feita.
  consultas: [] as number[],
  // Resposta que SO chega quando o teste mandar (uma consulta lenta).
  proxima: null as Promise<unknown> | null,
  // Copia salva no aparelho (IndexedDB).
  copiaSalva: [] as unknown[],
}));

const avisos = vi.hoisted(() => ({ erro: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: avisos.erro, info: vi.fn() },
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => rede.copiaSalva,
      replaceAll: async () => {},
      setLastSync: async () => {},
    }),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => {
          rede.consultas.push(Date.now());
          if (rede.proxima) {
            const lenta = rede.proxima;
            rede.proxima = null;
            return lenta;
          }
          return Promise.resolve(rede.resposta);
        },
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FALHA_DE_REDE = {
  message: "TypeError: Failed to fetch",
  details: "",
  hint: "",
  code: "",
};

function categoriaDoBanco(id: string, nome: string) {
  return {
    id,
    nome,
    slug: nome.toLowerCase(),
    descricao: "",
    ativo: true,
    created_at: "2026-10-01T00:00:00Z",
  };
}

type Retrato = { nomes: string[]; isLoading: boolean };

describe("useCategories — rede falhando na consulta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retratos: Map<number, Retrato>;

  async function montarHook() {
    const { useCategories } = await import("@/hooks/useCategories");
    function Espiao({ indice }: { indice: number }) {
      const { categories, isLoading } = useCategories();
      useEffect(() => {
        retratos.set(indice, {
          nomes: categories.map((c) => c.name),
          isLoading,
        });
      });
      return null;
    }
    return Espiao;
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar(quantas = 1) {
    const Espiao = await montarHook();
    await act(async () => {
      raiz.render(
        <>
          <Espiao indice={0} />
          {quantas > 1 && <Espiao indice={1} />}
        </>,
      );
    });
    await avancar(50);
  }

  beforeEach(() => {
    // Cada cenario comeca sem cache de modulo nem pedido pendente do anterior.
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    rede.resposta = { data: null, error: FALHA_DE_REDE };
    rede.consultas = [];
    rede.proxima = null;
    rede.copiaSalva = [];
    avisos.erro.mockClear();
    retratos = new Map();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("primeira falha: NAO avisa na hora, espera e tenta de novo; rede volta e os filtros aparecem", async () => {
    await montar();
    expect(rede.consultas).toHaveLength(1);
    expect(retratos.get(0)?.nomes).toEqual([]);
    expect(avisos.erro).not.toHaveBeenCalled();

    rede.resposta = {
      data: [
        categoriaDoBanco("c1", "Camisas"),
        categoriaDoBanco("c2", "Bones"),
      ],
      error: null,
    };
    await avancar(1_000);

    expect(rede.consultas).toHaveLength(2);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas", "Bones"]);
    expect(avisos.erro).not.toHaveBeenCalled();
  });

  it("rede que NAO volta: 3 novas tentativas com espera crescente, 1 aviso no fim, e para", async () => {
    await montar();
    await avancar(10 * 60_000);

    // 1 consulta inicial + 3 automaticas -- nunca laco infinito.
    expect(rede.consultas).toHaveLength(4);
    const esperas = rede.consultas
      .slice(1)
      .map((t, i) => t - (rede.consultas.at(i) ?? 0));
    expect(esperas).toEqual([1_000, 2_000, 4_000]);
    // o erro continua visivel para quem usa, uma vez so, no caso final
    expect(avisos.erro).toHaveBeenCalledTimes(1);
    expect(avisos.erro).toHaveBeenCalledWith("Erro ao carregar categorias");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("depois de esgotar, a rede voltar (online) tenta na hora, com folego novo", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    rede.resposta = {
      data: [categoriaDoBanco("c1", "Camisas")],
      error: null,
    };
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await avancar(50);

    expect(rede.consultas).toHaveLength(5);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
  });

  it("rede voltou (online) mas a consulta falha de novo: ganha mais 3 tentativas automaticas, e para", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await avancar(10 * 60_000);

    // 4 + 1 (online) + 3 automaticas -- e nada alem disso
    expect(rede.consultas).toHaveLength(8);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("evento de rede com consulta pendente NAO renova o folego: as tentativas continuam acabando", async () => {
    await montar();
    await avancar(1_000);
    let falhar: (v: unknown) => void = () => {};
    rede.proxima = new Promise((resolve) => {
      falhar = resolve;
    });
    await avancar(2_000); // 3a consulta fica PENDENTE
    await avancar(5_000); // ...tempo bastante para o piso entre retomadas passar
    expect(rede.consultas).toHaveLength(3);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      falhar({ data: null, error: FALHA_DE_REDE });
    });
    await avancar(10 * 60_000);

    // 1 inicial + 3 automaticas, exatamente como sem o evento
    expect(rede.consultas).toHaveLength(4);
  });

  it("falhou de vez com duas telas: as duas saem do 'carregando'", async () => {
    await montar(2);
    await avancar(10 * 60_000);

    expect(retratos.get(0)?.isLoading).toBe(false);
    expect(retratos.get(1)?.isLoading).toBe(false);
  });

  it("aba que volta a ficar visivel tenta de novo; aba escondida nao", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    const visibilidade = vi.spyOn(document, "visibilityState", "get");
    visibilidade.mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await avancar(50);
    expect(rede.consultas).toHaveLength(4);

    visibilidade.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await avancar(50);
    expect(rede.consultas).toHaveLength(5);
  });

  it("um pedido em voo por vez: online com consulta pendente nao dispara outra", async () => {
    await montar();
    await avancar(1_000); // 2a consulta (automatica) ja falhou
    expect(rede.consultas).toHaveLength(2);

    let responder: (v: unknown) => void = () => {};
    rede.proxima = new Promise((resolve) => {
      responder = resolve;
    });
    await avancar(2_000); // 3a consulta fica PENDENTE
    expect(rede.consultas).toHaveLength(3);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
    });
    await avancar(50);
    expect(rede.consultas).toHaveLength(3);

    await act(async () => {
      responder({ data: [categoriaDoBanco("c1", "Camisas")], error: null });
    });
    await avancar(50);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
  });

  it("rajada de eventos nao martela: no maximo uma consulta a cada poucos segundos", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas).toHaveLength(4);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await avancar(50);
    expect(rede.consultas).toHaveLength(5);
    // falhou de novo, e a cliente fica trocando de aba / o sinal pisca
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await avancar(50);
    expect(rede.consultas).toHaveLength(5);
  });

  it("carregou direito: nao sobra relogio nem insiste com evento de rede", async () => {
    rede.resposta = {
      data: [categoriaDoBanco("c1", "Camisas")],
      error: null,
    };
    await montar();
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await avancar(60_000);
    expect(rede.consultas).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("loja SEM categorias (consulta ok, lista vazia) nao e falha: sem aviso, sem nova tentativa", async () => {
    rede.resposta = { data: [], error: null };
    await montar();
    await avancar(60_000);

    expect(rede.consultas).toHaveLength(1);
    expect(avisos.erro).not.toHaveBeenCalled();
  });

  it("cliente com copia salva no aparelho: nenhuma tentativa extra, aviso como sempre", async () => {
    rede.copiaSalva = [categoriaDoBanco("c0", "Antigas")].map((c) => ({
      id: c.id,
      name: c.nome,
      slug: c.slug,
      description: "",
      isActive: true,
      createdAt: c.created_at,
    }));
    await montar();
    const depoisDeMontar = rede.consultas.length;
    await avancar(10 * 60_000);

    expect(retratos.get(0)?.nomes).toEqual(["Antigas"]);
    expect(rede.consultas).toHaveLength(depoisDeMontar);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("duas telas usando o hook: a nova tentativa e UMA, e as duas recebem as categorias", async () => {
    await montar(2);
    expect(rede.consultas).toHaveLength(1);

    rede.resposta = {
      data: [categoriaDoBanco("c1", "Camisas")],
      error: null,
    };
    await avancar(1_000);

    expect(rede.consultas).toHaveLength(2);
    expect(retratos.get(0)?.nomes).toEqual(["Camisas"]);
    expect(retratos.get(1)?.nomes).toEqual(["Camisas"]);
    expect(retratos.get(1)?.isLoading).toBe(false);
  });

  it("sair da tela cancela a nova tentativa pendente e solta os ouvidos de rede", async () => {
    const entram = vi.spyOn(window, "addEventListener");
    const saem = vi.spyOn(window, "removeEventListener");
    const entramNoDocumento = vi.spyOn(document, "addEventListener");
    const saemDoDocumento = vi.spyOn(document, "removeEventListener");
    await montar();
    act(() => {
      raiz.unmount();
    });
    // cada ouvido que entrou (online / visibilitychange) saiu com a MESMA funcao
    const entrou = entram.mock.calls.filter(([tipo]) => tipo === "online");
    expect(entrou.length).toBeGreaterThan(0);
    for (const [, funcao] of entrou) {
      expect(
        saem.mock.calls.some(([t, f]) => t === "online" && f === funcao),
      ).toBe(true);
    }
    const entrouNoDocumento = entramNoDocumento.mock.calls.filter(
      ([tipo]) => tipo === "visibilitychange",
    );
    expect(entrouNoDocumento.length).toBeGreaterThan(0);
    for (const [, funcao] of entrouNoDocumento) {
      expect(
        saemDoDocumento.mock.calls.some(
          ([t, f]) => t === "visibilitychange" && f === funcao,
        ),
      ).toBe(true);
    }
    await avancar(10 * 60_000);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await avancar(50);

    expect(rede.consultas).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    // afterEach desmonta de novo -- recria a raiz para nao duplicar o unmount
    raiz = createRoot(hospedeiro);
  });
});
