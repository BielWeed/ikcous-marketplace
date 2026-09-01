// @vitest-environment jsdom
//
// "O produto que a lojista excluiu durante a sincronização volta a aparecer":
// o `catchUp` faz DUAS idas separadas à rede para sincronizar produtos --
// uma de RESUMO (ids + `ultima_atualizacao`, usada para decidir o que está
// desatualizado) e outra de DETALHE (linhas completas dos ids
// desatualizados). No ramo admin o resumo aplica `.is("deleted_at", null)`,
// mas o detalhe buscava direto na tabela `produtos` sem esse filtro. Existe
// uma janela entre as duas idas: se a lojista excluir (soft-delete) um
// produto nesse intervalo, o detalhe traz o produto já excluído e ele é
// gravado no cofre como se estivesse vivo.
//
// Este arquivo exercita `RealtimeSyncEngine.catchUp` de ponta a ponta, com
// um dublê de `supabase` que se comporta como o banco: guarda os filtros
// encadeados (`.select`, `.is`, `.in`, `.order`, `.single`) e só resolve
// quando aguardado, aplicando-os sobre um dataset. O dataset de produtos
// devolvido na SEGUNDA chamada a `.from("produtos"/"vw_produtos_public")`
// (a de detalhe) já reflete o soft-delete concorrente -- é assim que a
// janela entre as duas idas é simulada sem precisar de tempo real.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface BancoDeTeste {
  config: any;
  categorias: any[];
  banners: any[];
  coupons: any[];
  /**
   * Uma entrada por chamada a `.from("produtos" | "vw_produtos_public")`, na
   * ordem em que o `catchUp` as faz: [0] é o RESUMO (roda dentro do
   * `Promise.all`), [1] é o DETALHE (roda depois, com os ids desatualizados).
   */
  produtosPorChamada: any[][];
  chamadasDeProdutos: string[];
}

function criarBanco(produtosPorChamada: any[][]): BancoDeTeste {
  return {
    config: null,
    categorias: [],
    banners: [],
    coupons: [],
    produtosPorChamada,
    chamadasDeProdutos: [],
  };
}

// Referenciado pelo factory de `vi.mock` abaixo -- precisa ser reatribuído
// (não relido) para cada `it`, então o dublê de `supabase` lê sempre o banco
// atual por clausura, nunca uma cópia presa no momento do mock.
let bancoAtual: BancoDeTeste;

// Leitura por nome de coluna via `Reflect.get`, e não por `linha[coluna]`:
// indexar objeto com chave variável dispara `security/detect-object-injection`
// no eslint, e três avisos novos estouram o teto da catraca (551) que o CI
// cobra. Mesmo comportamento, sem dívida de lint.
function lerColuna(linha: any, coluna: string): any {
  return linha == null ? undefined : Reflect.get(linha, coluna);
}

function construirQueryBuilder(tabela: string, banco: BancoDeTeste) {
  const filtros: Array<(linha: any) => boolean> = [];
  let modoUnico = false;

  const obterLinhas = (): any[] => {
    switch (tabela) {
      case "store_config":
      case "v_store_config":
        return [banco.config];
      case "categorias":
        return banco.categorias;
      case "banners":
        return banco.banners;
      case "coupons":
        return banco.coupons;
      case "produtos":
      case "vw_produtos_public": {
        const indice = banco.chamadasDeProdutos.length;
        banco.chamadasDeProdutos.push(tabela);
        const dataset = banco.produtosPorChamada.at(indice);
        if (dataset === undefined) {
          // Instrumento que falha em silêncio não é instrumento: se o
          // `catchUp` consultar produtos mais vezes do que o caso montou,
          // repetir o último dataset faria o teste medir outra coisa sem
          // avisar. Aqui ele reprova dizendo exatamente o que não bateu.
          throw new Error(
            `O dublê recebeu a chamada de produtos nº ${indice + 1} (${tabela}), ` +
              `mas o caso montou só ${banco.produtosPorChamada.length} dataset(s).`,
          );
        }
        return dataset;
      }
      default:
        throw new Error(`Tabela inesperada no dublê de supabase: ${tabela}`);
    }
  };

  const builder: any = {
    select: () => builder,
    order: () => builder,
    // P-6 (laudo varredura 01/09): o catchUp agora manda .limit(500) no
    // ramo admin de cupons — o dublê apenas encadeia.
    limit: () => builder,
    is(coluna: string, valor: any) {
      // O dublê recusa a coluna que a fonte não expõe, como o PostgREST faz
      // (42703, "column does not exist"). A projeção de `vw_produtos_public`
      // não inclui `deleted_at` -- a view já filtra por conta própria no seu
      // `WHERE` (baseline do schema, `CREATE VIEW ... vw_produtos_public`).
      // Sem esta recusa, o caso do ramo cliente ficaria verde mesmo se alguém
      // aplicasse o filtro na view, e o comentário dele prometeria uma
      // proteção que a asserção não dá.
      if (tabela === "vw_produtos_public" && coluna === "deleted_at") {
        throw new Error(
          `column ${tabela}.${coluna} does not exist (42703) -- a view não expõe esta coluna`,
        );
      }
      filtros.push((linha) => (lerColuna(linha, coluna) ?? null) === valor);
      return builder;
    },
    in(coluna: string, valores: any[]) {
      filtros.push((linha) => valores.includes(lerColuna(linha, coluna)));
      return builder;
    },
    single() {
      modoUnico = true;
      return builder;
    },
    // O builder do PostgREST é um thenable de verdade, e o código sob teste
    // faz `await detailQuery` -- sem isto o dublê não seria aguardável. Mesma
    // supressão de tests/front/qa-stats-erro-nao-e-fila-vazia.test.tsx.
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase, ver acima
    then(resolve: any, reject: any) {
      const linhas = obterLinhas().filter((linha) =>
        filtros.every((f) => f(linha)),
      );
      const resultado = modoUnico
        ? { data: linhas[0] ?? null, error: null }
        : { data: linhas, error: null };
      return Promise.resolve(resultado).then(resolve, reject);
    },
  };
  return builder;
}

// `realtimeSyncEngine.ts` importa `@/lib/supabase` no topo do módulo, e o
// client real falha ao construir em jsdom (sem Web Worker). O dublê evita
// isso -- nenhum caso deste arquivo chama a rede de verdade.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(tabela: string) {
      return construirQueryBuilder(tabela, bancoAtual);
    },
  },
}));

const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");

function criarDubleVault(conteudoDoCofre: any[] = []) {
  return {
    put: vi.fn(async (_store: string, _registro: any) => undefined),
    putMany: vi.fn(async (_store: string, _itens: any[]) => undefined),
    replaceAll: vi.fn(async (_store: string, _itens: any[]) => undefined),
    deleteById: vi.fn(async (_store: string, _id: string) => undefined),
    setLastSync: vi.fn(async () => undefined),
    getById: vi.fn(async () => undefined),
    getByIndex: vi.fn(async () => []),
    // Padrão: cofre vazio, que representa o primeiro carregamento (ou o
    // pós-`clear` de emergência do `StoreContext`). É o cenário em que a
    // janela entre resumo e detalhe se torna visível -- com o cofre vazio,
    // TODO id do resumo cai em `outOfDateIds` e força a ida de detalhe. O
    // caso da reconciliação começa com o cofre JÁ populado, porque é dele
    // que sai a lista de "está aqui e não está no servidor".
    getAll: vi.fn(async () => conteudoDoCofre),
  };
}

function idsGravadosComoProduto(vault: ReturnType<typeof criarDubleVault>) {
  const chamada = vault.putMany.mock.calls.find(
    ([store]) => store === "products",
  );
  expect(
    chamada,
    "vault.putMany não foi chamado para 'products'",
  ).toBeDefined();
  const [, produtos] = chamada!;
  return (produtos as any[]).map((p) => p.id);
}

describe("realtimeSyncEngine.catchUp — produto excluído não ressuscita", () => {
  let vault: ReturnType<typeof criarDubleVault>;

  beforeEach(() => {
    vault = criarDubleVault();
  });

  it("não grava no cofre o produto que foi excluído na janela entre resumo e detalhe (admin)", async () => {
    bancoAtual = criarBanco([
      // Resumo (T0): nem P nem Q têm `deleted_at` ainda.
      [
        { id: "prod-P", ultima_atualizacao: "2026-08-22T10:00:00Z" },
        { id: "prod-Q", ultima_atualizacao: "2026-08-22T10:00:00Z" },
      ],
      // Detalhe (T1): P já foi excluído pela lojista noutra aba nesse meio-tempo.
      [
        {
          id: "prod-P",
          nome: "Produto P",
          preco_venda: 10,
          estoque: 1,
          ativo: true,
          deleted_at: "2026-08-22T10:00:05Z",
          ultima_atualizacao: "2026-08-22T10:00:05Z",
          product_variants: [],
        },
        {
          id: "prod-Q",
          nome: "Produto Q",
          preco_venda: 20,
          estoque: 2,
          ativo: true,
          deleted_at: null,
          ultima_atualizacao: "2026-08-22T10:00:00Z",
          product_variants: [],
        },
      ],
    ]);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    const ids = idsGravadosComoProduto(vault);
    expect(ids).not.toContain("prod-P");
    expect(ids).toContain("prod-Q");
  });

  it("continua gravando normalmente o produto que não foi excluído (controle negativo)", async () => {
    bancoAtual = criarBanco([
      [
        { id: "prod-P", ultima_atualizacao: "2026-08-22T10:00:00Z" },
        { id: "prod-Q", ultima_atualizacao: "2026-08-22T10:00:00Z" },
      ],
      // Detalhe: desta vez ninguém foi excluído no meio-tempo.
      [
        {
          id: "prod-P",
          nome: "Produto P",
          preco_venda: 10,
          estoque: 1,
          ativo: true,
          deleted_at: null,
          ultima_atualizacao: "2026-08-22T10:00:00Z",
          product_variants: [],
        },
        {
          id: "prod-Q",
          nome: "Produto Q",
          preco_venda: 20,
          estoque: 2,
          ativo: true,
          deleted_at: null,
          ultima_atualizacao: "2026-08-22T10:00:00Z",
          product_variants: [],
        },
      ],
    ]);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    const ids = idsGravadosComoProduto(vault);
    expect(ids.sort()).toEqual(["prod-P", "prod-Q"]);
  });

  it("ramo cliente continua buscando em vw_produtos_public, sem aplicar filtro de deleted_at", async () => {
    bancoAtual = criarBanco([
      [{ id: "prod-R", ultima_atualizacao: "2026-08-22T10:00:00Z" }],
      [
        {
          id: "prod-R",
          nome: "Produto R",
          preco_venda: 15,
          estoque: 4,
          ativo: true,
          ultima_atualizacao: "2026-08-22T10:00:00Z",
          product_variants: [],
        },
      ],
    ]);

    await RealtimeSyncEngine.catchUp(vault as any, false);

    const ids = idsGravadosComoProduto(vault);
    expect(ids).toContain("prod-R");
    // As duas idas (resumo e detalhe) foram para a view pública, nunca para
    // a tabela `produtos` -- é a view que já filtra excluído/inativo, e
    // aplicar `.is("deleted_at", ...)` nela quebraria em produção (a coluna
    // não é exposta).
    expect(bancoAtual.chamadasDeProdutos).toEqual([
      "vw_produtos_public",
      "vw_produtos_public",
    ]);
  });

  // O conserto acima diz espelhar o filtro da consulta de RESUMO -- e a metade
  // espelhada não tinha asserção nenhuma: tirar `.is("deleted_at", null)` do
  // resumo deixava os três casos acima verdes. Este caso fecha o par, e o que
  // ele protege é a rede de segurança que todo o resto depende: é a
  // reconciliação por `serverIds` que apaga do cofre o produto excluído que o
  // evento ao vivo não alcançou.
  it("apaga do cofre o produto que o servidor não lista mais (reconciliação)", async () => {
    // O cofre já tem P e Q de antes; no servidor, P foi excluído.
    // Os dois com `updatedAt` igual ao do servidor, de propósito: assim
    // nenhum entra em `outOfDateIds` e este caso mede SÓ a reconciliação, sem
    // a ida de detalhe no meio. Sem isso o arranjo dependeria de um `NaN` por
    // acaso, e um dia mudaria de significado sem ninguém perceber.
    vault = criarDubleVault([
      { id: "prod-P", updatedAt: "2026-08-22T10:00:05Z" },
      { id: "prod-Q", updatedAt: "2026-08-22T10:00:00Z" },
    ]);
    bancoAtual = criarBanco([
      // Resumo: a tabela ainda tem as duas linhas, mas P carrega `deleted_at`
      // -- é o filtro do resumo que precisa deixá-lo de fora.
      [
        {
          id: "prod-P",
          ultima_atualizacao: "2026-08-22T10:00:05Z",
          deleted_at: "2026-08-22T10:00:05Z",
        },
        {
          id: "prod-Q",
          ultima_atualizacao: "2026-08-22T10:00:00Z",
          deleted_at: null,
        },
      ],
    ]);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    const apagados = vault.deleteById.mock.calls
      .filter(([store]) => store === "products")
      .map(([, id]) => id);
    expect(apagados).toContain("prod-P");
    expect(apagados).not.toContain("prod-Q");
  });
});
