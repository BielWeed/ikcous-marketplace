// @vitest-environment jsdom
//
// O hook que junta as quatro fontes de aviso do lojista (pedido, pergunta,
// avaliacao, estoque) numa lista so.
//
// A regra que este arquivo existe para prender e a de FALHA PARCIAL: cada
// consulta e independente, e uma que cai nao pode derrubar a tela. Tela de
// avisos em branco por causa de uma consulta e pior que tela incompleta e
// honesta — o lojista deixa de ver o pedido que estava esperando por causa
// de uma tabela de avaliacoes com problema.
//
// A segunda regra e a do CRACHA: nem todo aviso conta na bolinha. Estoque
// baixo so termina se o lojista repuser, entao ele fica na lista mas fora
// da contagem. Por isso os casos abaixo assertam `quantidadeNoCracha` e
// `avisos.length` na MESMA rodada, com valores diferentes de proposito:
// asserir so um dos dois deixaria passar um `avisos.length` no lugar do
// filtro.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STATUS_PEDIDOS_COM_ACAO_PENDENTE } from "@/components/layouts/AdminLayout";

// Reatribuiveis e lidos no momento da consulta: e assim que um caso troca
// uma fonte por uma que falha sem remontar o dible inteiro.
let RESPOSTA_PEDIDOS: unknown = { data: [], error: null };
let RESPOSTA_PERGUNTAS: unknown = { data: { total_count: 0 }, error: null };
let RESPOSTA_AVALIACOES: unknown = { data: [], error: null };

// `loadProducts` do useProducts engole o erro e devolve `null`. `null` aqui
// NAO e "zero produtos", e "nao sei" — e o hook tem de tratar como falha.
let RESPOSTA_PRODUTOS: unknown = { products: [], total: 0 };

const CHAMADAS_DE_IN: Array<[string, string[]]> = [];
let tabelasConsultadas: string[] = [];

const { loadProductsFalso } = vi.hoisted(() => ({
  loadProductsFalso: vi.fn(),
}));

function criarBuilder(tabela: string) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn((coluna: string, valores: readonly string[]) => {
    CHAMADAS_DE_IN.push([coluna, [...valores]]);
    return builder;
  });
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: dible do query builder thenable do Supabase — mesmo padrao de sino-do-painel-leva-onde-o-alerta-aponta.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve(
      tabela === "reviews" ? RESPOSTA_AVALIACOES : RESPOSTA_PEDIDOS,
    ).then(resolve as never, reject as never);
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      tabelasConsultadas.push(tabela);
      return criarBuilder(tabela);
    }),
    rpc: vi.fn(() => Promise.resolve(RESPOSTA_PERGUNTAS)),
  },
}));

// `loadProducts` precisa ter identidade ESTAVEL entre renderizacoes: o
// `buscar` do hook depende dele, e o efeito de montagem depende do `buscar`.
// Uma funcao nova a cada render faria o efeito disparar para sempre. No
// codigo real ele e um `useCallback`; aqui e uma so, criada uma vez.
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: loadProductsFalso }),
}));

// @ts-expect-error flag interna do React, sem tipo publico — mesmo padrao
// dos vizinhos deste diretorio.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface AvisoLido {
  tipo: string;
  contaNoCracha: boolean;
  titulo: string;
}
interface LeituraDoHook {
  avisos: AvisoLido[];
  quantidadeNoCracha: number;
  carregando: boolean;
  fontesComFalha: string[];
  recarregar: () => void;
}

const raizes: Array<{ unmount: () => void }> = [];

async function montarSonda() {
  const { useAvisosDoLojista } = await import("@/hooks/useAvisosDoLojista");
  const leituras: LeituraDoHook[] = [];

  function Sonda() {
    leituras.push(useAvisosDoLojista() as unknown as LeituraDoHook);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);

  await act(async () => {
    root.render(createElement(Sonda));
  });
  // Segunda passada: a primeira solta o `render`, esta drena as promessas
  // das quatro consultas e o `setState` que vem depois delas.
  await act(async () => {});

  return {
    leituras,
    atual: () => leituras[leituras.length - 1],
  };
}

function pedidoDeExemplo() {
  return {
    id: "ped-1",
    customer_name: "Maria",
    total: 90,
    created_at: "2026-08-24T10:00:00.000Z",
  };
}

function avaliacaoDeExemplo() {
  return {
    id: "av-1",
    product_id: "prod-1",
    rating: 2,
    created_at: "2026-08-24T09:00:00.000Z",
  };
}

function produtoDeExemplo(extra: Record<string, unknown> = {}) {
  return {
    id: "prod-1",
    name: "Caneta 3D",
    stock: 1,
    estoqueMinimo: null,
    isActive: true,
    createdAt: "2026-08-20T10:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  CHAMADAS_DE_IN.length = 0;
  tabelasConsultadas = [];
  RESPOSTA_PEDIDOS = { data: [pedidoDeExemplo()], error: null };
  RESPOSTA_PERGUNTAS = { data: { total_count: 3 }, error: null };
  RESPOSTA_AVALIACOES = { data: [avaliacaoDeExemplo()], error: null };
  RESPOSTA_PRODUTOS = { products: [produtoDeExemplo()], total: 1 };
  loadProductsFalso.mockImplementation(() =>
    Promise.resolve(RESPOSTA_PRODUTOS),
  );
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => {
      raiz.unmount();
    });
  }
  document.body.innerHTML = "";
});

describe("useAvisosDoLojista", () => {
  it("com as quatro fontes respondendo, a lista tem os quatro tipos", async () => {
    const { atual } = await montarSonda();

    expect(atual().carregando).toBe(false);
    expect(new Set(atual().avisos.map((a) => a.tipo))).toEqual(
      new Set(["pedido", "pergunta", "avaliacao", "estoque"]),
    );
    expect(atual().fontesComFalha).toEqual([]);
  });

  it("consulta os pedidos com os status de acao pendente do painel", async () => {
    await montarSonda();

    expect(CHAMADAS_DE_IN).toContainEqual([
      "status",
      [...STATUS_PEDIDOS_COM_ACAO_PENDENTE],
    ]);
    expect(tabelasConsultadas).toContain("marketplace_orders");
    expect(tabelasConsultadas).toContain("reviews");
  });

  it("o cracha conta so os avisos que contam, e isso e diferente do total", async () => {
    const { atual } = await montarSonda();

    // 4 avisos na lista (pedido, pergunta, avaliacao, estoque) e 3 no
    // cracha: o de estoque fica de fora. Os dois numeros na mesma rodada,
    // diferentes de proposito — se `quantidadeNoCracha` virar
    // `avisos.length`, esta asserção cai.
    expect(atual().avisos).toHaveLength(4);
    expect(atual().quantidadeNoCracha).toBe(3);
    expect(atual().quantidadeNoCracha).toBe(
      atual().avisos.filter((a) => a.contaNoCracha).length,
    );
  });

  it("uma fonte que cai nao derruba as outras tres", async () => {
    RESPOSTA_AVALIACOES = {
      data: null,
      error: { message: "relation reviews indisponivel" },
    };

    const { atual } = await montarSonda();

    expect(atual().carregando).toBe(false);
    expect(atual().fontesComFalha).toEqual(["avaliacao"]);
    expect(new Set(atual().avisos.map((a) => a.tipo))).toEqual(
      new Set(["pedido", "pergunta", "estoque"]),
    );
  });

  it("com as quatro caindo, a tela fica vazia e honesta — e nao presa carregando", async () => {
    RESPOSTA_PEDIDOS = { data: null, error: { message: "caiu" } };
    RESPOSTA_PERGUNTAS = { data: null, error: { message: "caiu" } };
    RESPOSTA_AVALIACOES = { data: null, error: { message: "caiu" } };
    RESPOSTA_PRODUTOS = null;

    const { atual } = await montarSonda();

    expect(atual().avisos).toEqual([]);
    expect(atual().quantidadeNoCracha).toBe(0);
    expect(atual().carregando).toBe(false);
    expect(new Set(atual().fontesComFalha)).toEqual(
      new Set(["pedido", "pergunta", "avaliacao", "estoque"]),
    );
  });

  it("produto desativado nao vira aviso de estoque", async () => {
    RESPOSTA_PRODUTOS = {
      products: [
        produtoDeExemplo({ id: "prod-off", stock: 0, isActive: false }),
      ],
      total: 1,
    };

    const { atual } = await montarSonda();

    expect(atual().avisos.map((a) => a.tipo)).not.toContain("estoque");
    expect(atual().fontesComFalha).toEqual([]);
  });

  it("recarregar dispara as consultas de novo", async () => {
    const { atual } = await montarSonda();

    const antes = tabelasConsultadas.length;
    const chamadasDeProdutoAntes = loadProductsFalso.mock.calls.length;

    await act(async () => {
      atual().recarregar();
    });
    await act(async () => {});

    expect(tabelasConsultadas.length).toBeGreaterThan(antes);
    expect(loadProductsFalso.mock.calls.length).toBeGreaterThan(
      chamadasDeProdutoAntes,
    );
  });
});
