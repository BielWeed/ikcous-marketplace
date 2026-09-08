// @vitest-environment jsdom
//
// A VITRINE NÃO PODE ESVAZIAR PORQUE O SERVIDOR NÃO RESPONDEU.
//
// `StoreContext.fetchProducts` tratava "o servidor não respondeu" e "a loja
// não tem produto" como a mesma coisa. Para um cliente comum (`isAdmin`
// false) a consulta de admin nem roda, então a variável `error` era SEMPRE
// nula; quando a consulta pública falhava (rede oscilou), `publicRes.error &&
// error` dava falso, nada era lançado, `data` seguia nulo e o fluxo caía no
// `else` que troca o catálogo por lista vazia — inclusive o catálogo que veio
// do cache offline e já estava na tela. O cliente via "nenhum produto" numa
// loja cheia.
//
// A invariante que estes testes trancam: SÓ uma resposta de verdade do
// servidor substitui o catálogo. Ausência de resposta não substitui nada.
//
// POR QUE RENDER DE VERDADE DO StoreProvider (react-dom/client + jsdom):
// mesmo padrão de store-context-vitrine-nao-declara-sucesso-sem-conferir —
// o que interessa é o estado observável que o contexto entrega (`products`),
// não uma chamada interna.
//
// POR QUE UM PORTÃO (promessa segurada pelo teste) NO DUBLÊ DO SUPABASE:
// o carregamento do cofre (IndexedDB) e o `fetchProducts` disparam no mesmo
// render, e quem resolve primeiro depende de quantos `await` cada caminho
// tem. Sem controle de ordem, um teste verde não diria se o catálogo do cache
// SOBREVIVEU à resposta ruim ou se apenas chegou DEPOIS dela. O portão fixa a
// causalidade do defeito real: o cache entra na tela primeiro (e cada teste
// afirma isso antes de soltar), e só então a resposta do servidor chega.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { Product } from "@/types";

const controle = vi.hoisted(() => {
  const criarPortao = () => {
    let liberar!: () => void;
    const promessa = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    return { promessa, liberar };
  };
  return {
    criarPortao,
    isAdmin: false,
    produtosNoCofre: [] as unknown[],
    respostaAdmin: { data: null as unknown, error: null as unknown },
    respostaPublica: { data: null as unknown, error: null as unknown },
    portao: criarPortao(),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdmin: controle.isAdmin,
    loading: false,
    user: controle.isAdmin ? { id: "admin-1" } : null,
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      // É daqui que sai o catálogo que o cliente já está VENDO quando a
      // consulta ao servidor volta ruim.
      getAll: vi.fn(async () => controle.produtosNoCofre),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
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

// Builder encadeável e "thenable" — mesmo padrão do teste irmão, cobre
// `.from().select().single()` (fetchConfig) e
// `.from().select().is().limit().order()` (fetchProducts) sem replicar
// assinatura. Aqui ele recebe uma FUNÇÃO, porque a resposta de cada tabela é
// decidida no momento do `await` (e pode ficar presa no portão).
function construtorEncadeavel(
  obterResultado: () => Promise<{ data: unknown; error: unknown }>,
): any {
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
    from: (nome: string) => {
      if (nome === "vw_produtos_admin") {
        return construtorEncadeavel(async () => {
          await controle.portao.promessa;
          return controle.respostaAdmin;
        });
      }
      if (nome === "vw_produtos_public") {
        return construtorEncadeavel(async () => {
          await controle.portao.promessa;
          return controle.respostaPublica;
        });
      }
      // Qualquer outra tabela (store_config / v_store_config): sem dado e sem
      // erro, para não interferir no que está sendo medido aqui.
      return construtorEncadeavel(async () => ({ data: null, error: null }));
    },
    rpc: () => construtorEncadeavel(async () => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const alvo: { produtos: Product[] } = { produtos: [] };

function Capturador() {
  const { products } = useStore();
  useEffect(() => {
    alvo.produtos = products;
  }, [products]);
  return null;
}

/** Produto já mapeado, do jeito que o cache offline devolve. */
function produtoDoCofre(id: string, nome: string) {
  return {
    id,
    name: nome,
    description: "",
    price: 99,
    images: ["https://exemplo.com/foto.png"],
    category: "Geral",
    stock: 3,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdTime: 1767225600000,
    rating: 5,
  };
}

/** Linha crua da view, do jeito que o Supabase devolve. */
function linhaDaView(id: string, nome: string) {
  return {
    id,
    nome,
    preco_venda: 99,
    descricao: "",
    estoque: 3,
    ativo: true,
    categoria: "Geral",
    imagem_urls: ["https://exemplo.com/foto.png"],
    data_cadastro: "2026-01-01T00:00:00.000Z",
    product_variants: [],
  };
}

/**
 * O que o `catch` do fetchProducts registrou como causa. O `catch` só loga —
 * o console é a ÚNICA superfície observável dessa falha, e é por ela que
 * alguém vai descobrir, em produção, que a vitrine não atualizou por causa da
 * rede. Registrar a causa errada custa a próxima investigação.
 */
function causaRegistrada(espia: ReturnType<typeof vi.spyOn>): unknown {
  const chamada = espia.mock.calls.find(
    (argumentos: unknown[]) =>
      argumentos[0] === "[StoreContext] Products fetch error:",
  );
  return chamada?.[1];
}

describe("StoreContext.fetchProducts — ausência de resposta não substitui o catálogo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let espiaDeErro: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Sem `mockImplementation`: o log continua saindo, só passa a ser contado.
    espiaDeErro = vi.spyOn(console, "error");
    controle.isAdmin = false;
    controle.produtosNoCofre = [];
    controle.respostaAdmin = { data: null, error: null };
    controle.respostaPublica = { data: null, error: null };
    controle.portao = controle.criarPortao();
    alvo.produtos = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    espiaDeErro.mockRestore();
    // Solta o portão para não deixar promessa pendurada entre testes.
    controle.portao.liberar();
  });

  /** Monta o provider e espera o cofre (IndexedDB) entrar na tela. */
  async function montarEEsperarOCofre() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Capturador />
        </StoreProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  /** Libera a resposta do servidor e deixa o React assentar. */
  async function deixarOServidorResponder() {
    await act(async () => {
      controle.portao.liberar();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("(a) O DEFEITO — cliente comum, consulta pública falha: a vitrine mantém os produtos que já estavam na tela", async () => {
    controle.isAdmin = false;
    controle.produtosNoCofre = [
      produtoDoCofre("cache-1", "Anel de prata"),
      produtoDoCofre("cache-2", "Colar de pérola"),
    ];
    controle.respostaPublica = { data: null, error: { message: "network" } };

    await montarEEsperarOCofre();
    // Causalidade: o catálogo do cache está na tela ANTES da resposta ruim.
    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);

    await deixarOServidorResponder();

    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);
    // E a causa registrada é a REAL (a rede), não um genérico "voltou sem
    // dados e sem erro" — que seria mentira, já que a pública devolveu erro.
    expect(causaRegistrada(espiaDeErro)).toEqual({ message: "network" });
  });

  it("(b) O CONTROLE — cliente comum, servidor responde lista vazia de verdade: a vitrine esvazia", async () => {
    controle.isAdmin = false;
    controle.produtosNoCofre = [
      produtoDoCofre("cache-1", "Anel de prata"),
      produtoDoCofre("cache-2", "Colar de pérola"),
    ];
    controle.respostaPublica = { data: [], error: null };

    await montarEEsperarOCofre();
    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);

    await deixarOServidorResponder();

    expect(alvo.produtos).toEqual([]);
  });

  it("(c) ADMIN — consulta de admin falha e a pública responde: a pública salva o dia e a vitrine mostra o que ela trouxe", async () => {
    controle.isAdmin = true;
    controle.produtosNoCofre = [
      produtoDoCofre("cache-1", "Anel de prata"),
      produtoDoCofre("cache-2", "Colar de pérola"),
    ];
    controle.respostaAdmin = { data: null, error: { message: "PGRST205" } };
    controle.respostaPublica = {
      data: [linhaDaView("publico-1", "Brinco de ouro")],
      error: null,
    };

    await montarEEsperarOCofre();
    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);

    await deixarOServidorResponder();

    expect(alvo.produtos.map((p) => p.id)).toEqual(["publico-1"]);
    expect(alvo.produtos[0].name).toBe("Brinco de ouro");
  });

  it("(d) ADMIN — as duas consultas falham: lança, e a vitrine continua com o que tinha", async () => {
    controle.isAdmin = true;
    controle.produtosNoCofre = [
      produtoDoCofre("cache-1", "Anel de prata"),
      produtoDoCofre("cache-2", "Colar de pérola"),
    ];
    controle.respostaAdmin = { data: null, error: { message: "PGRST205" } };
    controle.respostaPublica = { data: null, error: { message: "network" } };

    await montarEEsperarOCofre();
    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);

    await deixarOServidorResponder();

    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);
  });

  it("(e) ADMIN — consulta de admin volta sem dado E sem erro (a pública nem chega a rodar): a vitrine continua com o que tinha", async () => {
    controle.isAdmin = true;
    controle.produtosNoCofre = [
      produtoDoCofre("cache-1", "Anel de prata"),
      produtoDoCofre("cache-2", "Colar de pérola"),
    ];
    controle.respostaAdmin = { data: null, error: null };
    // A pública nem é consultada: `!isAdmin || loading || error` é falso.
    controle.respostaPublica = { data: null, error: null };

    await montarEEsperarOCofre();
    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);

    await deixarOServidorResponder();

    expect(alvo.produtos.map((p) => p.id)).toEqual(["cache-1", "cache-2"]);
  });
});
