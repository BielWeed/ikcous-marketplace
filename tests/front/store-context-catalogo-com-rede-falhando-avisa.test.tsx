// @vitest-environment jsdom
//
// PRIMEIRA visita com a rede falhando: a consulta do catálogo falhava, o
// contexto só escrevia no console, desligava o "carregando" e deixava a lista
// vazia -- a vitrine dizia "Nenhum produto agora" como se a loja não vendesse
// nada. O conserto acrescenta ao contexto `catalogoErro` (a falha NÃO é mais
// invisível), faz até 3 novas tentativas automáticas com espera crescente
// (nunca laço infinito) e mantém igual quem já tem cópia salva no aparelho.
//
// Render de verdade do StoreProvider (react-dom/client + jsdom), mesmo padrão
// de store-context-vitrine-nao-declara-sucesso-sem-conferir.test.tsx: dublê de
// contexto não prova o que o provider faz com a resposta da rede.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  // Cliente comum (não lojista): é o caminho da primeira visita pelo link.
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const rede = vi.hoisted(() => ({
  // O que a consulta pública de produtos devolve agora (mutado por teste).
  resposta: {
    data: null as unknown,
    error: null as unknown,
  },
  // Quando (relógio do teste) cada consulta pública de produtos foi feita.
  consultas: [] as number[],
  // Resposta que SÓ chega quando o teste mandar (uma consulta lenta): vale
  // para a próxima consulta pública e é consumida por ela.
  proxima: null as Promise<unknown> | null,
  // Cópia salva no aparelho (IndexedDB) -- o que o cliente que já visitou vê.
  copiaSalva: [] as unknown[],
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockImplementation(async () => ({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockImplementation(async () => rede.copiaSalva),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function construtorEncadeavel(resultado: () => unknown) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado());
      }
      return () => construtorEncadeavel(resultado);
    },
    apply() {
      return construtorEncadeavel(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "vw_produtos_public") {
        return construtorEncadeavel(() => {
          rede.consultas.push(Date.now());
          if (rede.proxima) {
            const lenta = rede.proxima;
            rede.proxima = null;
            return lenta;
          }
          return rede.resposta;
        });
      }
      return construtorEncadeavel(() => ({ data: [], error: null }));
    },
    rpc: () => construtorEncadeavel(() => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O que a vitrine lê do contexto -- `catalogoErro` é o campo NOVO.
type Retrato = {
  products: { id: string }[];
  loadingProducts: boolean;
  catalogoErro: boolean | undefined;
  fetchProducts: () => Promise<void>;
};

const FALHA_DE_REDE = {
  message: "TypeError: Failed to fetch",
  details: "",
  hint: "",
  code: "",
};

function produtoDoBanco(id: string) {
  return { id, nome: `Produto ${id}`, preco_venda: 10, estoque: 5 };
}

describe("StoreContext — rede falhando na consulta do catálogo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: { atual: Retrato | null };

  function Espiao() {
    const { products, loadingProducts, fetchProducts, ...resto } = useStore();
    const catalogoErro = (resto as { catalogoErro?: boolean }).catalogoErro;
    useEffect(() => {
      retrato.atual = {
        products: products as { id: string }[],
        loadingProducts,
        catalogoErro,
        fetchProducts,
      };
    });
    return null;
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Espiao />
        </StoreProvider>,
      );
    });
    // deixa o efeito de montagem e as promessas do cofre assentarem
    await avancar(50);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.resposta = { data: null, error: FALHA_DE_REDE };
    rede.consultas = [];
    rede.proxima = null;
    rede.copiaSalva = [];
    retrato = { atual: null };
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

  it("primeira visita sem rede: o contexto AVISA a falha em vez de parecer loja vazia", async () => {
    await montar();

    expect(retrato.atual?.products).toEqual([]);
    expect(retrato.atual?.loadingProducts).toBe(false);
    expect(retrato.atual?.catalogoErro).toBe(true);
  });

  it("loja realmente sem produtos (consulta ok, lista vazia) NÃO é erro", async () => {
    rede.resposta = { data: [], error: null };
    await montar();

    expect(retrato.atual?.products).toEqual([]);
    expect(retrato.atual?.catalogoErro).toBe(false);
  });

  it("a rede volta na nova tentativa automática: a loja aparece e o aviso some", async () => {
    await montar();
    expect(retrato.atual?.catalogoErro).toBe(true);

    rede.resposta = { data: [produtoDoBanco("p1")], error: null };
    await avancar(10_000);

    expect(retrato.atual?.products.map((p) => p.id)).toEqual(["p1"]);
    expect(retrato.atual?.catalogoErro).toBe(false);
  });

  it("rede que NÃO volta: no máximo 3 novas tentativas, com espera crescente, e para", async () => {
    await montar();
    await avancar(10 * 60_000);

    // 1 consulta inicial + no máximo 3 automáticas -- nunca laço infinito.
    expect(rede.consultas.length).toBe(4);
    const anteriores = rede.consultas.slice(0, -1);
    const esperas = rede.consultas
      .slice(1)
      .map((t, i) => t - Number(anteriores.at(i)));
    expect(esperas[1]).toBeGreaterThan(esperas[0] as number);
    expect(esperas[2]).toBeGreaterThan(esperas[1] as number);
    // passou muito tempo e continua sem consultar de novo
    await avancar(10 * 60_000);
    expect(rede.consultas.length).toBe(4);
    expect(retrato.atual?.catalogoErro).toBe(true);
  });

  it("toque manual em 'Tentar de novo' consulta na hora e ganha novo fôlego depois do teto", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas.length).toBe(4);

    rede.resposta = { data: [produtoDoBanco("p2")], error: null };
    await act(async () => {
      await retrato.atual?.fetchProducts();
    });
    await avancar(50);

    expect(rede.consultas.length).toBe(5);
    expect(retrato.atual?.products.map((p) => p.id)).toEqual(["p2"]);
    expect(retrato.atual?.catalogoErro).toBe(false);
  });

  it("toque manual que falha de novo devolve o fôlego: mais 3 tentativas automáticas, e para", async () => {
    await montar();
    await avancar(10 * 60_000);
    expect(rede.consultas.length).toBe(4);

    await act(async () => {
      await retrato.atual?.fetchProducts();
    });
    await avancar(10 * 60_000);

    // 4 + 1 manual + 3 automáticas -- e nada além disso
    expect(rede.consultas.length).toBe(8);
    expect(retrato.atual?.catalogoErro).toBe(true);
  });

  it("falha ATRASADA de uma consulta velha não acende o aviso por cima de uma que já deu certo", async () => {
    await montar();

    let falharDepois: () => void = () => {};
    rede.proxima = new Promise((resolve) => {
      falharDepois = () => resolve({ data: null, error: FALHA_DE_REDE });
    });
    const velha = retrato.atual?.fetchProducts();

    rede.resposta = { data: [produtoDoBanco("p1")], error: null };
    await act(async () => {
      await retrato.atual?.fetchProducts();
    });
    expect(retrato.atual?.catalogoErro).toBe(false);

    await act(async () => {
      falharDepois();
      await velha;
    });
    await avancar(10 * 60_000);

    expect(retrato.atual?.products.map((p) => p.id)).toEqual(["p1"]);
    expect(retrato.atual?.catalogoErro).toBe(false);
    // 1 (montagem) + 2 (velha e nova); a velha não agenda tentativa nenhuma
    expect(rede.consultas.length).toBe(3);
  });

  it.each([false, true])(
    "sucesso antigo (vazio: %s) não substitui o catálogo mais recente",
    async (vazio) => {
      rede.resposta = { data: [], error: null };
      await montar();
      let responder: (valor: unknown) => void = () => {};
      rede.proxima = new Promise((resolve) => {
        responder = resolve;
      });
      const antiga = retrato.atual?.fetchProducts();
      rede.resposta = {
        data: [{ ...produtoDoBanco("p1"), preco_venda: 30, estoque: 9 }],
        error: null,
      };
      await act(async () => {
        await retrato.atual?.fetchProducts();
      });
      await act(async () => {
        responder({
          data: vazio ? [] : [produtoDoBanco("p1")],
          error: null,
        });
        await antiga;
      });
      expect(retrato.atual?.products).toMatchObject([
        { id: "p1", price: 30, stock: 9 },
      ]);
      expect(retrato.atual?.catalogoErro).toBe(false);
    },
  );

  it("cliente com cópia salva no aparelho: a vitrine segue igual (sem tentativas extras)", async () => {
    rede.copiaSalva = [{ id: "velho", name: "Produto salvo" }];
    await montar();
    await avancar(10 * 60_000);

    expect(retrato.atual?.products.map((p) => p.id)).toEqual(["velho"]);
    expect(retrato.atual?.loadingProducts).toBe(false);
    // uma única consulta de fundo, como sempre foi
    expect(rede.consultas.length).toBe(1);
  });

  it("desmontar o provider cancela a nova tentativa pendente", async () => {
    await montar();
    act(() => {
      raiz.unmount();
    });
    await avancar(10 * 60_000);

    expect(rede.consultas.length).toBe(1);
    // afterEach desmonta de novo -- recria a raiz para não duplicar o unmount
    raiz = createRoot(hospedeiro);
  });
});
