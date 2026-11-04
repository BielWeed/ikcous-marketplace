// @vitest-environment jsdom
// Loja com mais de 200 produtos: a leitura do catálogo antes parava nos 200
// mais novos (`.limit(200)`) e os mais antigos sumiam da vitrine e da busca
// sem aviso. Agora lê página por página e só entrega o catálogo quando TODAS
// as páginas chegaram -- falha no meio não vira catálogo "completo" no
// cofre offline nem tira da tela o que já estava lá.
//
// O dublê do Supabase respeita `.range()` (e `.limit()`), como o servidor.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { Product } from "@/types";

type Linha = Record<string, unknown>;
type Pedido = {
  tabela: string;
  de?: number;
  ate?: number;
  limite?: number;
  ordens: string[];
};

const controle = vi.hoisted(() => ({
  admin: false,
  loading: false,
  /** Linhas da view, já na ordem em que o servidor devolveria. */
  linhas: [] as Record<string, unknown>[],
  /** Páginas (pelo `de` do range) que falham, com a mensagem de rede. */
  paginasQueFalham: new Set<number>(),
  /** Roda quando uma página é atendida (para simular cadastro no meio). */
  aoAtender: null as null | ((pedido: unknown) => void),
  pedidos: [] as unknown[],
  produtosNoCofre: [] as unknown[],
  replaceAll: vi.fn(),
  setLastSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdmin: controle.admin,
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
      getAll: vi.fn(async () => controle.produtosNoCofre),
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

function atender(pedido: Pedido) {
  controle.pedidos.push(pedido);
  controle.aoAtender?.(pedido);
  if (pedido.de !== undefined && controle.paginasQueFalham.has(pedido.de)) {
    return { data: null, error: { message: "rede caiu" } };
  }
  if (pedido.de !== undefined && pedido.ate !== undefined) {
    return {
      data: controle.linhas.slice(pedido.de, pedido.ate + 1),
      error: null,
    };
  }
  // Sem range, o servidor devolve só o que o `limit` deixa passar.
  const limite = pedido.limite ?? controle.linhas.length;
  return { data: controle.linhas.slice(0, limite), error: null };
}

/** Consulta da view de produtos: encadeável, atendida só no `await`. */
function consultaDeProdutos(tabela: string): any {
  const pedido: Pedido = { tabela, ordens: [] };
  const consulta: any = {
    select: () => consulta,
    is: () => consulta,
    order: (coluna: string) => {
      pedido.ordens.push(coluna);
      return consulta;
    },
    limit: (n: number) => {
      pedido.limite = n;
      return consulta;
    },
    range: (de: number, ate: number) => {
      pedido.de = de;
      pedido.ate = ate;
      return consulta;
    },
    then: (resolve: (v: unknown) => void, rejeitar: (e: unknown) => void) =>
      Promise.resolve(atender(pedido)).then(resolve, rejeitar),
  };
  return consulta;
}

function construtorVazio(): any {
  const alvo: any = () => construtorVazio();
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) =>
          Promise.resolve({ data: null, error: null }).then(resolve);
      }
      return () => construtorVazio();
    },
    apply() {
      return construtorVazio();
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      tabela === "vw_produtos_public" || tabela === "vw_produtos_admin"
        ? consultaDeProdutos(tabela)
        : construtorVazio(),
    rpc: () => construtorVazio(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TAMANHO_DA_PAGINA = 200;

/** Linha da view, na ordem do servidor: i = 0 é o produto mais novo. */
function linhaDaView(i: number): Linha {
  return {
    id: `p${i}`,
    nome: `Produto ${i}`,
    preco_venda: 10,
    descricao: "",
    estoque: 5,
    ativo: true,
    categoria: "Geral",
    imagem_urls: [],
    data_cadastro: new Date(Date.UTC(2026, 0, 1) - i * 60_000).toISOString(),
    product_variants: [],
  };
}

function criarLinhas(quantas: number): Linha[] {
  return Array.from({ length: quantas }, (_, i) => linhaDaView(i));
}

function produtoDoCofre(id: string): Product {
  return {
    id,
    name: `Salvo ${id}`,
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

type Retrato = Pick<
  ReturnType<typeof useStore>,
  "products" | "loadingProducts" | "catalogoErro"
>;

describe("StoreContext -- catálogo com mais de 200 produtos", () => {
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
    await assentar();
  }

  const pedidosDeProdutos = () => controle.pedidos as Pedido[];
  const idsNaTela = () => retrato.products.map((p) => p.id);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    controle.admin = false;
    controle.loading = false;
    controle.linhas = [];
    controle.paginasQueFalham = new Set();
    controle.aoAtender = null;
    controle.pedidos = [];
    controle.produtosNoCofre = [];
    controle.replaceAll.mockResolvedValue(undefined);
    retrato = { products: [], loadingProducts: true, catalogoErro: false };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loja com 450 produtos: todos chegam à tela e ao cofre, na ordem do servidor", async () => {
    controle.linhas = criarLinhas(450);

    await renderizar();

    expect(retrato.products).toHaveLength(450);
    expect(idsNaTela()).toEqual(controle.linhas.map((l) => l.id));
    expect(retrato.loadingProducts).toBe(false);
    expect(retrato.catalogoErro).toBe(false);

    // Três páginas de 200, pedidas em sequência, sem buraco nem sobreposição.
    const ranges = pedidosDeProdutos()
      .filter((p) => p.tabela === "vw_produtos_public")
      .map((p) => [p.de, p.ate]);
    expect(ranges).toEqual([
      [0, 199],
      [200, 399],
      [400, 599],
    ]);

    // O cofre recebe o catálogo INTEIRO, uma vez só.
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    const [tabela, gravados] = controle.replaceAll.mock.calls[0];
    expect(tabela).toBe("products");
    expect(gravados).toHaveLength(450);
    expect(controle.setLastSync).toHaveBeenCalledWith("products");
  });

  it("a ordem continua por data de cadastro, com desempate por id para a página não repetir nem pular linha", async () => {
    controle.linhas = criarLinhas(250);

    await renderizar();

    const primeiro = pedidosDeProdutos().find(
      (p) => p.tabela === "vw_produtos_public",
    );
    expect(primeiro?.ordens).toEqual(["data_cadastro", "id"]);
    // Nunca o corte seco de antes.
    expect(pedidosDeProdutos().every((p) => p.limite === undefined)).toBe(true);
  });

  it("lojista (painel) também lê todas as páginas", async () => {
    controle.admin = true;
    controle.linhas = criarLinhas(450);

    await renderizar();

    expect(retrato.products).toHaveLength(450);
    expect(
      pedidosDeProdutos().every((p) => p.tabela === "vw_produtos_admin"),
    ).toBe(true);
  });

  it("loja com menos de 200 produtos faz UMA consulta só, sem página extra", async () => {
    controle.linhas = criarLinhas(37);

    await renderizar();

    expect(pedidosDeProdutos()).toHaveLength(1);
    expect(retrato.products).toHaveLength(37);
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
  });

  it("loja com exatamente 200 produtos: uma página cheia pede a próxima, vem vazia e para", async () => {
    controle.linhas = criarLinhas(TAMANHO_DA_PAGINA);

    await renderizar();

    expect(retrato.products).toHaveLength(TAMANHO_DA_PAGINA);
    expect(pedidosDeProdutos().map((p) => [p.de, p.ate])).toEqual([
      [0, 199],
      [200, 399],
    ]);
  });

  it("loja sem nenhum produto: lista vazia legítima, uma consulta e cofre limpo", async () => {
    controle.linhas = [];

    await renderizar();

    expect(pedidosDeProdutos()).toHaveLength(1);
    expect(retrato.products).toEqual([]);
    expect(retrato.catalogoErro).toBe(false);
    expect(controle.replaceAll).toHaveBeenCalledWith("products", []);
  });

  it("falha na 2ª página: o que já estava na tela fica e o cofre não recebe catálogo pela metade", async () => {
    controle.produtosNoCofre = [produtoDoCofre("salvo-1")];
    controle.linhas = criarLinhas(450);
    controle.paginasQueFalham = new Set([200]);

    await renderizar();

    // A primeira página (200) chegou, mas não é o catálogo: não substitui a tela.
    expect(idsNaTela()).toEqual(["salvo-1"]);
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(controle.setLastSync).not.toHaveBeenCalled();
    // A falha é anunciada, como qualquer falha de catálogo.
    expect(retrato.catalogoErro).toBe(true);
    expect(retrato.loadingProducts).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Com cópia na tela não há laço de tentativas, e o cofre segue intacto.
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(idsNaTela()).toEqual(["salvo-1"]);
  });

  it("falha na 2ª página sem cópia salva: tela segue vazia (não mostra 200 como se fosse tudo) e a nova tentativa completa o catálogo", async () => {
    controle.linhas = criarLinhas(450);
    controle.paginasQueFalham = new Set([200]);

    await renderizar();

    expect(retrato.products).toEqual([]);
    expect(controle.replaceAll).not.toHaveBeenCalled();
    expect(retrato.catalogoErro).toBe(true);

    // A rede volta; a primeira tentativa automática (2 s) lê tudo.
    controle.paginasQueFalham = new Set();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await assentar();

    expect(retrato.products).toHaveLength(450);
    expect(retrato.catalogoErro).toBe(false);
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    expect(controle.replaceAll.mock.calls[0][1]).toHaveLength(450);
  });

  it("produto cadastrado no meio da leitura desloca a página: nenhum produto aparece duas vezes", async () => {
    controle.linhas = criarLinhas(450);
    let jaCadastrou = false;
    controle.aoAtender = (pedido) => {
      // Depois da 1ª página, entra um produto novo no topo: tudo desce uma
      // posição e a página 2 repete a última linha da página 1.
      if (!jaCadastrou && (pedido as Pedido).de === 200) {
        jaCadastrou = true;
        controle.linhas = [linhaDaView(-1), ...controle.linhas];
      }
    };

    await renderizar();

    const ids = idsNaTela();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(450);
    // O que ficou de fora (o produto recém-cadastrado) chega pelo realtime.
    expect(ids[0]).toBe("p0");
  });

  it("teto de segurança: um servidor que nunca devolve página curta não prende a leitura num laço", async () => {
    // Dublê que sempre devolve página cheia, em qualquer posição.
    controle.aoAtender = (pedido) => {
      const p = pedido as Pedido;
      if (p.de !== undefined) {
        controle.linhas = criarLinhas(p.de + TAMANHO_DA_PAGINA);
      }
    };
    controle.linhas = criarLinhas(TAMANHO_DA_PAGINA);

    await renderizar();

    expect(pedidosDeProdutos()).toHaveLength(50);
    expect(retrato.products).toHaveLength(50 * TAMANHO_DA_PAGINA);
    expect(retrato.catalogoErro).toBe(false);
  });
});
