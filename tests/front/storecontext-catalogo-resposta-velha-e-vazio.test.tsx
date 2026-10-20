// @vitest-environment jsdom
// Harness do provider real, como em
// vitrine-nao-esvazia-quando-a-consulta-publica-falha.test.tsx.
// Cada consulta fica presa até o teste escolher a ordem das respostas.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import { DataVault } from "@/lib/dataVault";
import type { Product } from "@/types";

type Resposta = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

const controle = vi.hoisted(() => {
  const criarConsulta = () => {
    let responder!: (resposta: Resposta) => void;
    const promessa = new Promise<Resposta>((resolve) => {
      responder = resolve;
    });
    return { promessa, responder };
  };
  return {
    criarConsulta,
    loading: true,
    consultas: [] as ReturnType<typeof criarConsulta>[],
    produtosNoCofre: [] as Product[],
    getAll: vi.fn<() => Promise<Product[]>>(),
    replaceAll: vi.fn(),
    setLastSync: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdmin: false,
    loading: controle.loading,
    user: null,
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: controle.getAll,
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: controle.replaceAll,
      setLastSync: controle.setLastSync,
      clear: vi.fn().mockResolvedValue(undefined),
    }),
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

function construtorEncadeavel(obterResultado: () => Promise<Resposta>): any {
  const alvo: any = () => construtorEncadeavel(obterResultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (
          resolve: (v: unknown) => void,
          rejeitar: (e: unknown) => void,
        ) => obterResultado().then(resolve, rejeitar);
      }
      return () => construtorEncadeavel(obterResultado);
    },
    apply() {
      return construtorEncadeavel(obterResultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "vw_produtos_public") {
        const consulta = controle.criarConsulta();
        controle.consultas.push(consulta);
        return construtorEncadeavel(() => consulta.promessa);
      }
      return construtorEncadeavel(async () => ({ data: [], error: null }));
    },
    rpc: () => construtorEncadeavel(async () => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Retrato = Pick<
  ReturnType<typeof useStore>,
  "products" | "loadingProducts" | "catalogoErro"
>;

function linhaDaView(preco: number) {
  return {
    id: "p1",
    nome: "Anel de prata",
    preco_venda: preco,
    estoque: preco === 20 ? 0 : 5,
    ativo: true,
    data_cadastro: "2026-01-01T00:00:00.000Z",
    product_variants: [],
  };
}

function produtoDoCofre(): Product {
  return {
    id: "cache-1",
    name: "Produto salvo",
    description: "",
    price: 99,
    images: [],
    category: "Geral",
    stock: 3,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("StoreContext — resposta superada e catálogo vazio no cache", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: Retrato;

  function Capturador() {
    const { products, loadingProducts, catalogoErro } = useStore();
    useEffect(() => {
      retrato = { products, loadingProducts, catalogoErro };
    }, [products, loadingProducts, catalogoErro]);
    return null;
  }

  async function assentar() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function renderizar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      );
    });
    await assentar();
  }

  async function responder(indice: number, resposta: Resposta) {
    const consulta = controle.consultas.at(indice);
    if (!consulta) throw new Error(`Consulta ${indice} não iniciada`);
    await act(async () => {
      consulta.responder(resposta);
      await consulta.promessa;
    });
    await assentar();
  }

  function atrasarCache(produtos: Product[]) {
    let liberar!: () => void;
    const leitura = new Promise<Product[]>((resolve) => {
      liberar = () => resolve(produtos);
    });
    controle.getAll.mockReturnValueOnce(leitura);
    return async () => {
      await act(async () => {
        liberar();
        await leitura;
      });
      await assentar();
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    controle.loading = true;
    controle.consultas = [];
    controle.produtosNoCofre = [];
    controle.getAll.mockImplementation(async () => controle.produtosNoCofre);
    controle.replaceAll.mockImplementation(
      async (_tabela: string, produtos: Product[]) => {
        controle.produtosNoCofre = produtos;
      },
    );
    retrato = { products: [], loadingProducts: true, catalogoErro: false };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      // Não deixa consultas penduradas entre testes; o provider já desmontou.
      for (const consulta of controle.consultas) {
        consulta.responder({ data: [], error: null });
      }
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cache lento não sobrescreve o preço e o estoque já atualizados pela rede", async () => {
    const liberarCache = atrasarCache([
      { ...produtoDoCofre(), id: "p1", price: 10, stock: 5 },
    ]);
    await renderizar();
    expect(retrato.products).toEqual([]);

    await responder(0, { data: [linhaDaView(20)], error: null });
    expect(retrato.products).toEqual([
      expect.objectContaining({ id: "p1", price: 20, stock: 0 }),
    ]);

    await liberarCache();
    expect(retrato.products).toEqual([
      expect.objectContaining({ id: "p1", price: 20, stock: 0 }),
    ]);
    expect(retrato.loadingProducts).toBe(false);
    expect(retrato.catalogoErro).toBe(false);
  });

  it.each([true, false])(
    "cache lento continua disponível sem resposta válida da rede (rede já falhou: %s)",
    async (redeFalhou) => {
      const salvos = [produtoDoCofre()];
      const liberarCache = atrasarCache(salvos);
      await renderizar();
      expect(retrato.products).toEqual([]);

      if (redeFalhou) {
        await responder(0, { data: null, error: { message: "network" } });
      }
      await liberarCache();
      expect(retrato.products).toEqual(salvos);
      expect(retrato.loadingProducts).toBe(false);
      expect(retrato.catalogoErro).toBe(redeFalhou);
    },
  );

  it("cache rápido aparece enquanto a rede espera e depois recebe preço e estoque atuais", async () => {
    controle.produtosNoCofre = [
      { ...produtoDoCofre(), id: "p1", price: 10, stock: 5 },
    ];
    await renderizar();
    expect(retrato.products).toEqual([
      expect.objectContaining({ id: "p1", price: 10, stock: 5 }),
    ]);

    await responder(0, { data: [linhaDaView(20)], error: null });
    expect(retrato.products).toEqual([
      expect.objectContaining({ id: "p1", price: 20, stock: 0 }),
    ]);
  });

  it("cache lento não repõe produtos depois de uma resposta vazia legítima da rede", async () => {
    const liberarCache = atrasarCache([produtoDoCofre()]);
    await renderizar();

    await responder(0, { data: [], error: null });
    expect(retrato.products).toEqual([]);
    expect(retrato.loadingProducts).toBe(false);
    expect(retrato.catalogoErro).toBe(false);

    await liberarCache();
    expect(retrato.products).toEqual([]);
    expect(retrato.loadingProducts).toBe(false);
    expect(retrato.catalogoErro).toBe(false);
  });

  it("respostas fora de ordem mantêm preço e estoque da consulta mais nova na tela e no cache", async () => {
    await renderizar();
    expect(controle.consultas).toHaveLength(1);

    // A conclusão da autenticação dispara a segunda consulta na inicialização.
    controle.loading = false;
    await renderizar();
    expect(controle.consultas).toHaveLength(2);

    await responder(1, { data: [linhaDaView(20)], error: null });
    expect(retrato.products).toEqual([
      expect.objectContaining({ id: "p1", price: 20, stock: 0 }),
    ]);
    expect(controle.produtosNoCofre).toEqual(retrato.products);
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);

    await responder(0, { data: [linhaDaView(10)], error: null });
    expect(retrato.products).toEqual([
      expect.objectContaining({ id: "p1", price: 20, stock: 0 }),
    ]);
    expect(controle.produtosNoCofre).toEqual(retrato.products);
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    expect(controle.setLastSync).toHaveBeenCalledTimes(1);
    expect(retrato.loadingProducts).toBe(false);
    expect(retrato.catalogoErro).toBe(false);
  });

  it("resposta superada não encerra o carregamento enquanto a consulta mais nova está pendente", async () => {
    await renderizar();
    controle.loading = false;
    await renderizar();

    await responder(0, { data: [linhaDaView(10)], error: null });
    expect(retrato.products).toEqual([]);
    expect(retrato.loadingProducts).toBe(true);
    expect(controle.replaceAll).not.toHaveBeenCalled();

    await responder(1, { data: [linhaDaView(20)], error: null });
    expect(retrato.loadingProducts).toBe(false);
    expect(retrato.products).toEqual([
      expect.objectContaining({ price: 20, stock: 0 }),
    ]);
  });

  it("consulta nova com resultado igual persiste mesmo se a gravação anterior ficou esperando o cofre", async () => {
    await renderizar();
    const cofre = await DataVault.init();
    let liberarCofre!: () => void;
    const esperaDoCofre = new Promise<void>((resolve) => {
      liberarCofre = resolve;
    });
    vi.mocked(DataVault.init).mockImplementationOnce(async () => {
      await esperaDoCofre;
      return cofre;
    });

    await responder(0, { data: [linhaDaView(20)], error: null });
    expect(retrato.products).toEqual([expect.objectContaining({ price: 20 })]);
    expect(controle.replaceAll).not.toHaveBeenCalled();

    controle.loading = false;
    await renderizar();
    await responder(1, { data: [linhaDaView(20)], error: null });
    expect(controle.produtosNoCofre).toEqual(retrato.products);
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);

    await act(async () => {
      liberarCofre();
    });
    await assentar();
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    expect(controle.setLastSync).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    "resposta vazia bem-sucedida grava lista vazia no cache (com cópia anterior: %s)",
    async (comCopiaAnterior) => {
      controle.produtosNoCofre = comCopiaAnterior ? [produtoDoCofre()] : [];
      await renderizar();
      expect(retrato.products).toEqual(controle.produtosNoCofre);

      await responder(0, { data: [], error: null });

      expect(retrato.products).toEqual([]);
      expect(controle.replaceAll).toHaveBeenCalledWith("products", []);
      expect(controle.produtosNoCofre).toEqual([]);
      expect(controle.setLastSync).toHaveBeenCalledWith("products");
      expect(retrato.catalogoErro).toBe(false);
      expect(retrato.loadingProducts).toBe(false);
    },
  );

  it("erro de consulta preserva o cache e os produtos que já estavam na tela", async () => {
    const salvos = [produtoDoCofre()];
    controle.produtosNoCofre = salvos;
    await renderizar();
    expect(retrato.products).toEqual(salvos);

    await responder(0, { data: null, error: { message: "network" } });

    expect(retrato.products).toEqual(salvos);
    expect(controle.produtosNoCofre).toEqual(salvos);
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(controle.setLastSync).not.toHaveBeenCalled();
    expect(retrato.catalogoErro).toBe(true);
    expect(retrato.loadingProducts).toBe(false);
  });
});
