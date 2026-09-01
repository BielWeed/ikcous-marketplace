//
// P-6 (laudo varredura profunda 01/09): o catchUp casava o resumo do
// servidor contra o catálogo local com `localProducts.find(...)` DENTRO do
// laço — O(n×m) a cada foco/retorno de conexão. O conserto constrói UM
// `Map` de id→produto local antes do laço (O(n+m)), SEM mudar a semântica:
// mesmo critério (id), primeiro-achado preservado, NENHUM .limit() no
// resumo (limpar o resumo causaria falso-sync — decisão registrada).
//
// Este teste é de CARACTERIZAÇÃO da semântica do casamento: com N produtos
// locais e M linhas de resumo, afirma que o detalhe recarregado é EXATAMENTE
// o conjunto dos desatualizados/novos, na ordem do resumo, e que o que está
// em dia e o que o servidor apagou não são tocados. A refatoração para Map
// tem que deixá-lo verde do mesmo jeito — é ele que garante que a troca não
// mudou comportamento.
//
// Roda em `node` (sem jsdom): o `catchUp` não toca em DOM e, sem `window`,
// o BroadcastChannel do módulo nasce nulo — nenhum postMessage acontece.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataVault } from "@/lib/dataVault";

// Variável de módulo lida DENTRO da factory do `vi.mock` (getter) — o mesmo
// padrão dos testes de componente deste projeto: cada caso monta o seu
// cenário de `from` no `beforeEach`.
let supabaseAtual: any = { from: () => ({}) };

vi.mock("@/lib/supabase", () => ({
  get supabase() {
    return supabaseAtual;
  },
}));

const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");

// builder cujo await devolve { data: null } — para config/categorias/
// banners, que o cenário não exercita (o catchUp pula o ramo inteiro).
function builderNulo() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: null, error: null }).then(resolve, reject);
  return builder;
}

function builderResumo(linhas: any[]) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: linhas, error: null }).then(resolve, reject);
  return builder;
}

function builderDetalhe(caixa: { idsPedidos: string[] | null }, linhas: any[]) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.in = vi.fn((_col: string, ids: string[]) => {
    caixa.idsPedidos = ids;
    return builder;
  });
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: linhas, error: null }).then(resolve, reject);
  return builder;
}

function criarVault(locais: any[]) {
  // Dublê parcial: o catchUp só usa estes métodos. O cast é honesto — o
  // teste declara QUE MÉTODOS usa, não recria o cofre inteiro.
  return {
    getAll: vi.fn(async (store: string) =>
      store === "products" ? locais : [],
    ),
    getByIndex: vi.fn(async () => []),
    deleteById: vi.fn(async () => {}),
    replaceAll: vi.fn(async () => {}),
    setLastSync: vi.fn(async () => {}),
    putMany: vi.fn(async () => {}),
  } as unknown as DataVault;
}

describe("realtimeSyncEngine.catchUp — o casamento do resumo acha o correto, na ordem do resumo", () => {
  let chamadasFrom: Map<string, any[]>;

  beforeEach(() => {
    chamadasFrom = new Map();
    supabaseAtual = {
      from: vi.fn((tabela: string) => {
        const lista = chamadasFrom.get(tabela) ?? [];
        const proximo = lista.shift();
        if (!proximo) {
          throw new Error(
            `from("${tabela}") sem builder enfileirado para esta chamada`,
          );
        }
        return proximo();
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function enfileirarCenario({
    resumo,
    detalhes,
    caixaDetalhe,
  }: {
    resumo: any[];
    detalhes: any[];
    caixaDetalhe: { idsPedidos: string[] | null };
  }) {
    chamadasFrom.set("v_store_config", [() => builderNulo()]);
    chamadasFrom.set("categorias", [() => builderNulo()]);
    chamadasFrom.set("banners", [() => builderNulo()]);
    chamadasFrom.set("vw_produtos_public", [
      () => builderResumo(resumo), // 1ª chamada: o resumo (id, ultima_atualizacao)
      () => builderDetalhe(caixaDetalhe, detalhes), // 2ª: o detalhe dos desatualizados
    ]);
  }

  it("N locais x M resumo: recarrega SÓ o desatualizado e o novo, na ordem do resumo; em dia não é tocado", async () => {
    const caixaDetalhe: { idsPedidos: string[] | null } = { idsPedidos: null };
    const resumo = [
      { id: "p1", ultima_atualizacao: "2026-09-01T12:00:00.000Z" }, // local velho → desatualizado
      { id: "p2", ultima_atualizacao: "2026-08-01T00:00:00.000Z" }, // local em dia → fora
      { id: "p3", ultima_atualizacao: "2026-09-01T00:00:00.000Z" }, // sem local → novo
    ];
    const detalhes = [
      {
        id: "p1",
        nome: "Produto 1",
        preco_venda: 10,
        created_at: "2026-08-01T00:00:00.000Z",
        ultima_atualizacao: "2026-09-01T12:00:00.000Z",
        product_variants: [],
      },
      {
        id: "p3",
        nome: "Produto 3",
        preco_venda: 30,
        created_at: "2026-09-01T00:00:00.000Z",
        ultima_atualizacao: "2026-09-01T00:00:00.000Z",
        product_variants: [],
      },
    ];
    enfileirarCenario({ resumo, detalhes, caixaDetalhe });

    const locais = [
      {
        id: "p1",
        name: "Produto 1",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "p2",
        name: "Produto 2",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    ];
    const vault = criarVault(locais);

    await RealtimeSyncEngine.catchUp(vault, false);

    // O detalhe pediu EXATAMENTE o desatualizado + o novo, NA ORDEM do
    // resumo — nem o em dia (p2) nem o excluído entraram.
    expect(caixaDetalhe.idsPedidos).toEqual(["p1", "p3"]);

    // O cofre recebeu os detalhes mapeados dos mesmos ids.
    expect(vault.putMany).toHaveBeenCalledTimes(1);
    const [, mapeados] = (vault.putMany as any).mock.calls[0];
    expect(mapeados.map((p: any) => p.id)).toEqual(["p1", "p3"]);

    // Nenhum local era fantasma (todos os ids existem no servidor):
    // nenhuma exclusão foi disparada.
    expect(vault.deleteById).not.toHaveBeenCalled();
  });

  it("local que sumiu do resumo é excluído do cofre (reconciliação) — e o resumo NÃO é limitado", async () => {
    const caixaDetalhe: { idsPedidos: string[] | null } = { idsPedidos: null };
    const resumo = [
      { id: "p1", ultima_atualizacao: "2026-08-01T00:00:00.000Z" },
    ];
    enfileirarCenario({ resumo, detalhes: [], caixaDetalhe });

    const locais = [
      {
        id: "p1",
        name: "Produto 1",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "fantasma",
        name: "Excluído no servidor",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ];
    const vault = criarVault(locais);

    await RealtimeSyncEngine.catchUp(vault, false);

    // p1 em dia: o detalhe nem chega a ser consultado.
    expect(caixaDetalhe.idsPedidos).toBeNull();
    expect(vault.putMany).not.toHaveBeenCalled();
    // O fantasma saiu do cofre.
    expect(vault.deleteById).toHaveBeenCalledWith("products", "fantasma");
  });
});
