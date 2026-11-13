// @vitest-environment jsdom
// Estoque que acabou NÃO volta a "disponível" por causa de resposta atrasada
// do catálogo. Dois cenários, com o catálogo respondendo só quando o teste
// manda (cada consulta fica pendurada até `responder`):
//
// 1. Duas consultas fora de ordem (a antiga, lenta, chega depois da nova): o
//    contador de consulta já descarta a antiga -- este teste prova isso.
// 2. UMA consulta em voo e um evento de tempo real no meio ("estoque zerou"):
//    a resposta foi tirada do servidor ANTES do evento e, ao chegar, trocava
//    a lista inteira (e o cofre offline) pela cópia velha -- o item esgotado
//    voltava a aparecer com estoque até a próxima atualização. O produto que
//    o tempo real tocou durante a consulta vale mais que a resposta.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";
import type { Product } from "@/types";

type Linha = Record<string, unknown>;
type Pendente = {
  de?: number;
  resolver: (resposta: { data: Linha[] | null; error: unknown }) => void;
};
type EventoDeSync = {
  table: string;
  store: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  newRecord?: unknown;
  oldRecord?: unknown;
};

const controle = vi.hoisted(() => ({
  pendentes: [] as unknown[],
  ouvintes: new Set<(evento: unknown) => void>(),
  /** O que o cofre tem por id (o motor grava lá ANTES de avisar a tela). */
  cofre: new Map<string, unknown>(),
  replaceAll: vi.fn(),
  setLastSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn(async (_loja: string, id: string) =>
        controle.cofre.has(id) ? controle.cofre.get(id) : null,
      ),
      getAll: vi.fn(async () => []),
      getAllOrThrow: vi.fn(async () => []),
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
    onSync: vi.fn((ouvinte: (evento: unknown) => void) => {
      controle.ouvintes.add(ouvinte);
      return () => controle.ouvintes.delete(ouvinte);
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function atender(de: number | undefined) {
  return new Promise((resolver) => {
    (controle.pendentes as Pendente[]).push({ de, resolver } as Pendente);
  });
}

function consultaDeProdutos(): any {
  let de: number | undefined;
  const consulta: any = {
    select: () => consulta,
    is: () => consulta,
    order: () => consulta,
    range: (inicio: number) => {
      de = inicio;
      return consulta;
    },
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
    then: (resolve: (v: unknown) => void, rejeitar: (e: unknown) => void) =>
      atender(de).then(resolve, rejeitar),
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
        ? consultaDeProdutos()
        : construtorVazio(),
    rpc: () => construtorVazio(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linhaDaView(id: string, estoque: number): Linha {
  return {
    id,
    nome: `Produto ${id}`,
    preco_venda: 10,
    descricao: "",
    estoque,
    ativo: true,
    categoria: "Geral",
    imagem_urls: [],
    data_cadastro: "2026-01-01T00:00:00.000Z",
    product_variants: [],
  };
}

function produtoDoCofre(id: string, estoque: number): Product {
  return {
    id,
    name: `Produto ${id}`,
    description: "",
    price: 10,
    images: [],
    category: "Geral",
    stock: estoque,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("StoreContext -- resposta tardia do catálogo não repõe estoque", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let produtos: Product[];
  let buscarDeNovo: () => Promise<void>;

  function Capturador() {
    const { products, fetchProducts } = useStore();
    useEffect(() => {
      produtos = products;
      buscarDeNovo = fetchProducts;
    }, [products, fetchProducts]);
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

  async function responder(indice: number, linhas: Linha[]) {
    const pendente = (controle.pendentes as Pendente[]).at(indice);
    if (!pendente) throw new Error(`consulta ${indice} não existe`);
    await act(async () => {
      pendente.resolver({ data: linhas, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    await assentar();
  }

  /** Aviso do motor de tempo real, depois de ele ter gravado no cofre. */
  async function avisar(evento: EventoDeSync) {
    await act(async () => {
      for (const ouvinte of controle.ouvintes) ouvinte(evento);
      await vi.advanceTimersByTimeAsync(0);
    });
    await assentar();
  }

  const estoqueNaTela = (id: string) =>
    produtos.find((p) => p.id === id)?.stock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    controle.pendentes = [];
    controle.ouvintes = new Set();
    controle.cofre = new Map();
    controle.replaceAll.mockResolvedValue(undefined);
    produtos = [];
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

  it("duas consultas fora de ordem: a antiga, lenta, que chega depois da nova, é descartada", async () => {
    await renderizar();
    // Consulta A (a do abrir do app) pendurada; a cliente toca em "Tentar de
    // novo" e nasce a B.
    await act(async () => {
      void buscarDeNovo();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(controle.pendentes).toHaveLength(2);

    // A nova (B) chega primeiro, com o estoque já zerado.
    await responder(1, [linhaDaView("p1", 0)]);
    expect(estoqueNaTela("p1")).toBe(0);

    // A antiga (A) chega depois, ainda com 5 em estoque: não vale.
    await responder(0, [linhaDaView("p1", 5)]);
    expect(estoqueNaTela("p1")).toBe(0);
    // E não vai para o cofre offline: só a gravação da nova.
    expect(controle.replaceAll).toHaveBeenCalledTimes(1);
    const gravados = controle.replaceAll.mock.calls[0][1] as Product[];
    expect(gravados.find((p) => p.id === "p1")?.stock).toBe(0);
  });

  it("estoque zerado pelo tempo real DURANTE a consulta: a resposta velha não repõe o estoque, nem na tela nem no cofre", async () => {
    await renderizar();
    expect(controle.pendentes).toHaveLength(1);

    // O motor já gravou no cofre o produto zerado e avisa a tela.
    controle.cofre.set("p1", produtoDoCofre("p1", 0));
    await avisar({
      table: "produtos",
      store: "products",
      eventType: "UPDATE",
      newRecord: { id: "p1" },
    });

    // A resposta da consulta foi tirada do servidor antes da venda.
    await responder(0, [linhaDaView("p1", 5), linhaDaView("p2", 7)]);

    expect(estoqueNaTela("p1")).toBe(0);
    // O que o evento não tocou vem da resposta, como sempre.
    expect(estoqueNaTela("p2")).toBe(7);
    const gravados = controle.replaceAll.mock.calls[0][1] as Product[];
    expect(gravados.find((p) => p.id === "p1")?.stock).toBe(0);
    expect(gravados.find((p) => p.id === "p2")?.stock).toBe(7);
  });

  it("produto excluído pelo tempo real durante a consulta não ressuscita com a resposta velha", async () => {
    await renderizar();

    await avisar({
      table: "produtos",
      store: "products",
      eventType: "DELETE",
      oldRecord: { id: "p1" },
    });
    await responder(0, [linhaDaView("p1", 5), linhaDaView("p2", 7)]);

    expect(produtos.map((p) => p.id)).toEqual(["p2"]);
    const gravados = controle.replaceAll.mock.calls[0][1] as Product[];
    expect(gravados.map((p) => p.id)).toEqual(["p2"]);
  });

  it("produto novo que o tempo real trouxe durante a consulta (a resposta ainda não o conhecia) não some", async () => {
    await renderizar();

    controle.cofre.set("p9", produtoDoCofre("p9", 4));
    await avisar({
      table: "produtos",
      store: "products",
      eventType: "INSERT",
      newRecord: { id: "p9" },
    });
    await responder(0, [linhaDaView("p1", 5)]);

    expect(produtos.map((p) => p.id).sort()).toEqual(["p1", "p9"]);
  });

  it("evento de ANTES da consulta nova não vale mais que ela: a nova leitura do servidor já o inclui", async () => {
    await renderizar();
    // Consulta A em voo; o evento zera o p1; depois a cliente pede de novo (B).
    controle.cofre.set("p1", produtoDoCofre("p1", 0));
    await avisar({
      table: "produtos",
      store: "products",
      eventType: "UPDATE",
      newRecord: { id: "p1" },
    });
    await act(async () => {
      void buscarDeNovo();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(controle.pendentes).toHaveLength(2);

    // A lojista repôs 4 unidades; a consulta B, começada DEPOIS do evento,
    // leu o servidor já com 4. O evento antigo não pode sobrescrever.
    await responder(1, [linhaDaView("p1", 4)]);
    expect(estoqueNaTela("p1")).toBe(4);
  });

  it("evento que chega DEPOIS da resposta segue o caminho de sempre (merge fino)", async () => {
    await renderizar();
    await responder(0, [linhaDaView("p1", 5)]);
    expect(estoqueNaTela("p1")).toBe(5);

    controle.cofre.set("p1", produtoDoCofre("p1", 0));
    await avisar({
      table: "produtos",
      store: "products",
      eventType: "UPDATE",
      newRecord: { id: "p1" },
    });
    expect(estoqueNaTela("p1")).toBe(0);

    // E uma consulta nova que termina sem evento no meio vale por inteiro:
    // o registro de "tocados" da consulta anterior não vaza para a próxima.
    await act(async () => {
      void buscarDeNovo();
      await vi.advanceTimersByTimeAsync(0);
    });
    await responder(1, [linhaDaView("p1", 3)]);
    expect(estoqueNaTela("p1")).toBe(3);
  });
});
