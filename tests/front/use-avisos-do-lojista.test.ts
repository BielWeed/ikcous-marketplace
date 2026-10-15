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

import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  STATUS_PARA_PREPARAR,
} from "@/lib/pedidos-para-preparar";

// Reatribuiveis e lidos no momento da consulta: e assim que um caso troca
// uma fonte por uma que falha sem remontar o dible inteiro.
let RESPOSTA_PEDIDOS: unknown = { data: [], error: null };
let RESPOSTA_PERGUNTAS: unknown = { data: { total_count: 0 }, error: null };
// Quinta fonte (plano 2026-09-26): `admin_devolucoes_listar` com a contagem
// por status — so `solicitada` acende o sino.
let RESPOSTA_DEVOLUCOES: unknown = {
  data: { total: 0, contagem: { solicitada: 0 }, itens: [] },
  error: null,
};
let RESPOSTA_AVALIACOES: unknown = { data: [], error: null };
// Sexta fonte (14/10/2026): cancelamentos do CLIENTE, lidos do historico do
// pedido (so o administrador le a linha dos outros), mais os papeis dos
// autores (`profiles`) para excluir o admin.
let RESPOSTA_CANCELAMENTOS: unknown = { data: [], error: null };
let RESPOSTA_PERFIS: unknown = { data: [], error: null };
const FILTROS_DO_HISTORICO: Array<[string, ...unknown[]]> = [];

// `loadProducts` do useProducts engole o erro e devolve `null`. `null` aqui
// NAO e "zero produtos", e "nao sei" — e o hook tem de tratar como falha.
let RESPOSTA_PRODUTOS: unknown = { products: [], total: 0 };

const CHAMADAS_DE_IN: Array<[string, string[]]> = [];
const CHAMADAS_DE_OR: string[] = [];
// Pedidos com PIX/cartao ainda nao pago (status aberto e `aguardando`): o
// dible do banco so os devolve se a consulta NAO aplicar o `.or` da regra
// unica "para preparar" (onda F, F2b). Vazio por padrao.
let PIX_AGUARDANDO_NO_BANCO: unknown[] = [];
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
  let filtrouOPagamento = false;
  builder.or = vi.fn((filtro: string) => {
    CHAMADAS_DE_OR.push(filtro);
    if (filtro === FILTRO_POSTGREST_PARA_PREPARAR) filtrouOPagamento = true;
    return builder;
  });
  builder.is = vi.fn(() => builder);
  const registrar = (nome: string) =>
    vi.fn((...argumentos: unknown[]) => {
      if (tabela === "marketplace_order_history") {
        FILTROS_DO_HISTORICO.push([nome, ...argumentos]);
      }
      return builder;
    });
  builder.eq = registrar("eq");
  builder.not = registrar("not");
  builder.gte = registrar("gte");
  builder.order = registrar("order");
  builder.limit = registrar("limit");
  const respostaDosPedidos = () => {
    const resposta = RESPOSTA_PEDIDOS as { data: unknown; error: unknown };
    if (filtrouOPagamento || !Array.isArray(resposta.data)) return resposta;
    return {
      ...resposta,
      data: [...resposta.data, ...PIX_AGUARDANDO_NO_BANCO],
    };
  };
  // biome-ignore lint/suspicious/noThenProperty: dible do query builder thenable do Supabase — mesmo padrao de sino-do-painel-leva-onde-o-alerta-aponta.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve(
      tabela === "reviews"
        ? RESPOSTA_AVALIACOES
        : tabela === "marketplace_order_history"
          ? RESPOSTA_CANCELAMENTOS
          : tabela === "profiles"
            ? RESPOSTA_PERFIS
            : respostaDosPedidos(),
    ).then(resolve as never, reject as never);
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      tabelasConsultadas.push(tabela);
      return criarBuilder(tabela);
    }),
    rpc: vi.fn((nome: string) =>
      Promise.resolve(
        nome === "admin_devolucoes_listar"
          ? RESPOSTA_DEVOLUCOES
          : RESPOSTA_PERGUNTAS,
      ),
    ),
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
  CHAMADAS_DE_OR.length = 0;
  PIX_AGUARDANDO_NO_BANCO = [];
  tabelasConsultadas = [];
  FILTROS_DO_HISTORICO.length = 0;
  RESPOSTA_CANCELAMENTOS = { data: [], error: null };
  RESPOSTA_PERFIS = { data: [], error: null };
  RESPOSTA_PEDIDOS = { data: [pedidoDeExemplo()], error: null };
  RESPOSTA_PERGUNTAS = { data: { total_count: 3 }, error: null };
  RESPOSTA_AVALIACOES = { data: [avaliacaoDeExemplo()], error: null };
  RESPOSTA_PRODUTOS = { products: [produtoDeExemplo()], total: 1 };
  RESPOSTA_DEVOLUCOES = {
    data: { total: 0, contagem: { solicitada: 0 }, itens: [] },
    error: null,
  };
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
      [...STATUS_PARA_PREPARAR],
    ]);
    expect(tabelasConsultadas).toContain("marketplace_orders");
    expect(tabelasConsultadas).toContain("reviews");
  });

  it("PIX/cartao ainda nao pago nao vira 'esperando voce': a consulta leva o filtro de pagamento", async () => {
    // Onda F (F2b): o PIX gerado e ainda nao pago espera a CLIENTE, nao o
    // lojista. A lista do sino aplica a mesma regra do selo de Pedidos e do
    // "Pedidos para preparar" do Inicio.
    PIX_AGUARDANDO_NO_BANCO = [
      {
        id: "ped-pix",
        customer_name: "Joana",
        total: 120,
        created_at: "2026-08-24T11:00:00.000Z",
      },
    ];

    const { atual } = await montarSonda();

    expect(CHAMADAS_DE_OR).toContain(FILTRO_POSTGREST_PARA_PREPARAR);
    const titulosDePedido = atual()
      .avisos.filter((a) => a.tipo === "pedido")
      .map((a) => a.titulo);
    expect(titulosDePedido).toEqual(["Pedido de Maria esperando você"]);
    expect(titulosDePedido.join(" ")).not.toContain("Joana");
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

  it("com todas caindo, a tela fica vazia e honesta — e nao presa carregando", async () => {
    RESPOSTA_PEDIDOS = { data: null, error: { message: "caiu" } };
    RESPOSTA_PERGUNTAS = { data: null, error: { message: "caiu" } };
    RESPOSTA_AVALIACOES = { data: null, error: { message: "caiu" } };
    RESPOSTA_PRODUTOS = null;
    RESPOSTA_DEVOLUCOES = { data: null, error: { message: "caiu" } };
    RESPOSTA_CANCELAMENTOS = { data: null, error: { message: "caiu" } };

    const { atual } = await montarSonda();

    expect(atual().avisos).toEqual([]);
    expect(atual().quantidadeNoCracha).toBe(0);
    expect(atual().carregando).toBe(false);
    expect(new Set(atual().fontesComFalha)).toEqual(
      new Set([
        "pedido",
        "pergunta",
        "avaliacao",
        "estoque",
        "devolucao",
        "cancelamento",
      ]),
    );
  });

  it("devolucao solicitada vira aviso que conta no cracha e abre a tela de Devolucoes", async () => {
    RESPOSTA_DEVOLUCOES = {
      data: {
        total: 2,
        contagem: { solicitada: 2, aprovada: 5 },
        itens: [],
      },
      error: null,
    };

    const { atual } = await montarSonda();

    const aviso = atual().avisos.find((a) => a.tipo === "devolucao") as
      | (AvisoLido & { destino?: { view: string } })
      | undefined;
    expect(aviso?.titulo).toBe("2 devoluções esperando sua resposta");
    expect(aviso?.contaNoCracha).toBe(true);
    expect(aviso?.destino?.view).toBe("admin-devolucoes");
    // Aprovada nao acende o sino: a bola esta com o cliente.
    expect(atual().quantidadeNoCracha).toBe(4);
    expect(atual().fontesComFalha).toEqual([]);
  });

  it("forma inesperada da RPC de devolucoes e falha da fonte, nao 'zero'", async () => {
    RESPOSTA_DEVOLUCOES = { data: { total_count: 3 }, error: null };

    const { atual } = await montarSonda();

    expect(atual().fontesComFalha).toEqual(["devolucao"]);
    expect(atual().avisos.map((a) => a.tipo)).not.toContain("devolucao");
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

  it("a rodada velha nao sobrescreve a nova, mesmo respondendo depois", async () => {
    // O `loadProducts` real ABORTA a consulta anterior quando uma nova comeca,
    // e devolve `null` para a abortada — que aqui significa "falha da fonte
    // estoque". Sem token de rodada, a rodada velha termina por ultimo, com a
    // falha, e apaga o resultado bom da rodada nova: a tela acende "nao
    // consegui conferir produtos" com a rede inteira saudavel.
    let responderPrimeira: (() => void) | null = null;
    const primeira = new Promise<null>((resolve) => {
      responderPrimeira = () => resolve(null);
    });
    loadProductsFalso.mockImplementationOnce(() => primeira);

    const { atual } = await montarSonda();

    // Rodada 2: responde na hora, com a lista boa.
    await act(async () => {
      atual().recarregar();
    });
    await act(async () => {});

    // Só agora a rodada 1 responde — velha, e com a falha.
    await act(async () => {
      responderPrimeira?.();
    });
    await act(async () => {});

    expect(atual().fontesComFalha).toEqual([]);
    expect(atual().avisos.map((a) => a.tipo)).toContain("estoque");
    expect(atual().carregando).toBe(false);
  });

  it("catalogo maior que o teto conta como falha da fonte de estoque", async () => {
    // 250 produtos no total e so 1 na resposta: a varredura NAO viu o
    // catalogo inteiro. Dizer "nenhum produto acabando" seria mentira sobre
    // 249 produtos que ninguem olhou.
    RESPOSTA_PRODUTOS = { products: [produtoDeExemplo()], total: 250 };

    const { atual } = await montarSonda();

    expect(atual().fontesComFalha).toEqual(["estoque"]);
    // E o que ELA viu continua valendo: aviso incompleto e honesto e melhor
    // que lista vazia.
    expect(atual().avisos.map((a) => a.tipo)).toContain("estoque");
  });

  it("estoqueMinimo zero e escolha legitima, nao ausencia de limiar", async () => {
    // `?? null` e nao `|| null`: zero quer dizer "nunca me avise por este
    // produto". Com `||`, o zero viraria `null` na fronteira do hook, o
    // limiar padrao (5) entraria no lugar e o produto com 3 em estoque
    // geraria um aviso que o lojista desligou de proposito.
    RESPOSTA_PRODUTOS = {
      products: [produtoDeExemplo({ stock: 3, estoqueMinimo: 0 })],
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

// O lojista fica sabendo quando o CLIENTE cancela (14/10/2026): a sexta fonte.
describe("useAvisosDoLojista — cancelamento do cliente", () => {
  const CLIENTE = "c1111111-1111-4111-8111-111111111111";
  const ADMIN = "a1111111-1111-4111-8111-111111111111";
  const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

  function linhaDoHistorico(extra: Record<string, unknown> = {}) {
    return {
      id: "h1",
      order_id: PEDIDO,
      old_status: "pending",
      created_by: CLIENTE,
      created_at: "2026-10-14T11:57:00.000Z",
      marketplace_orders: {
        id: PEDIDO,
        user_id: CLIENTE,
        customer_name: "Maria Silva",
        total: 149.9,
        payment_status: "pago",
        status: "cancelled",
        cancelled_after_shipping: false,
      },
      ...extra,
    };
  }

  it("cliente cancelou pedido pago: o sino ganha o item, que abre AQUELE pedido e nao conta no cracha", async () => {
    RESPOSTA_CANCELAMENTOS = { data: [linhaDoHistorico()], error: null };
    RESPOSTA_PERFIS = {
      data: [{ id: CLIENTE, role: "customer" }],
      error: null,
    };

    const { atual } = await montarSonda();

    const aviso = atual().avisos.find((a) => a.tipo === "cancelamento") as
      | (AvisoLido & { destino?: { view: string; id?: string } })
      | undefined;
    expect(aviso?.titulo).toBe("Maria Silva cancelou o pedido #4F5A6B");
    expect(aviso?.destino).toEqual({ view: "admin-orders", id: PEDIDO });
    expect(aviso?.contaNoCracha).toBe(false);
    expect(atual().fontesComFalha).toEqual([]);
    // O cracha segue sendo so o que conta: pedido, pergunta, avaliacao.
    expect(atual().quantidadeNoCracha).toBe(3);
  });

  it("cliente cancelou pedido a pagar na entrega (sem pagamento online): o sino avisa 'Nao precisa separar nem enviar', sem consulta extra", async () => {
    RESPOSTA_CANCELAMENTOS = {
      data: [
        linhaDoHistorico({
          marketplace_orders: {
            id: PEDIDO,
            user_id: CLIENTE,
            customer_name: "Maria Silva",
            total: 149.9,
            payment_status: null,
            status: "cancelled",
            cancelled_after_shipping: false,
          },
        }),
      ],
      error: null,
    };
    RESPOSTA_PERFIS = {
      data: [{ id: CLIENTE, role: "customer" }],
      error: null,
    };

    const { atual } = await montarSonda();

    const aviso = atual().avisos.find((a) => a.tipo === "cancelamento") as
      | (AvisoLido & { detalhe?: string })
      | undefined;
    expect(aviso?.titulo).toBe("Pedido #4F5A6B cancelado pela cliente");
    expect(aviso?.detalhe).toBe("Não precisa separar nem enviar.");
    expect(atual().fontesComFalha).toEqual([]);
    // A mesma leitura do historico serve aos dois ramos: nada de tabela nova.
    expect(
      tabelasConsultadas.filter((t) => t === "marketplace_order_history"),
    ).toHaveLength(1);
  });

  it("a consulta le SO cancelamentos das ultimas 24 h, com autor, e os papeis dos autores", async () => {
    RESPOSTA_CANCELAMENTOS = { data: [linhaDoHistorico()], error: null };
    RESPOSTA_PERFIS = {
      data: [{ id: CLIENTE, role: "customer" }],
      error: null,
    };
    const antes = Date.now();

    await montarSonda();

    expect(FILTROS_DO_HISTORICO).toContainEqual([
      "eq",
      "new_status",
      "cancelled",
    ]);
    expect(FILTROS_DO_HISTORICO).toContainEqual([
      "not",
      "created_by",
      "is",
      null,
    ]);
    const gte = FILTROS_DO_HISTORICO.find((f) => f[0] === "gte");
    expect(gte?.[1]).toBe("created_at");
    const desde = Date.parse(String(gte?.[2]));
    // 24 h antes de "agora", com folga de alguns segundos de relogio de teste.
    expect(Math.abs(antes - 24 * 3600 * 1000 - desde)).toBeLessThan(10_000);
    expect(tabelasConsultadas).toContain("profiles");
  });

  it("ADMIN cancelando nao vira item (o papel vem de profiles)", async () => {
    RESPOSTA_CANCELAMENTOS = {
      data: [linhaDoHistorico({ created_by: ADMIN })],
      error: null,
    };
    RESPOSTA_PERFIS = { data: [{ id: ADMIN, role: "admin" }], error: null };

    const { atual } = await montarSonda();

    expect(atual().avisos.map((a) => a.tipo)).not.toContain("cancelamento");
    expect(atual().fontesComFalha).toEqual([]);
  });

  it("papeis ilegiveis: a fonte cai (falha honesta) e NINGUEM entra sem saber quem e admin", async () => {
    RESPOSTA_CANCELAMENTOS = { data: [linhaDoHistorico()], error: null };
    RESPOSTA_PERFIS = { data: null, error: { message: "profiles caiu" } };

    const { atual } = await montarSonda();

    expect(atual().fontesComFalha).toEqual(["cancelamento"]);
    expect(atual().avisos.map((a) => a.tipo)).not.toContain("cancelamento");
  });

  it("historico fora do ar: so a fonte de cancelamento cai, as outras seguem", async () => {
    RESPOSTA_CANCELAMENTOS = { data: null, error: { message: "caiu" } };

    const { atual } = await montarSonda();

    expect(atual().fontesComFalha).toEqual(["cancelamento"]);
    expect(new Set(atual().avisos.map((a) => a.tipo))).toEqual(
      new Set(["pedido", "pergunta", "avaliacao", "estoque"]),
    );
  });

  it("sem cancelamento nenhum a loja nao consulta os papeis", async () => {
    await montarSonda();

    expect(tabelasConsultadas).not.toContain("profiles");
  });
});
