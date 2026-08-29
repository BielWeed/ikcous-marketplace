// @vitest-environment jsdom
//
// "A cliente volta ao app e o produto excluído continua na vitrine": a
// cliente deixa o app aberto, o celular dorme ou fica sem rede, e nesse
// intervalo a lojista pausa ou exclui um produto. Quando a cliente volta, o
// `catchUp` roda (dispara em `visibilitychange` e em `online`), apaga o
// produto do cofre local -- mas o laço de exclusão só manda
// `bc.postMessage` para as OUTRAS abas, nunca percorre `_listeners`. A
// própria aba que rodou o catchUp (a única, no celular) nunca soube que o
// cofre mudou, e a vitrine continuava exibindo o produto excluído, com
// preço e estoque, até alguém recarregar a página.
//
// Molde: dublê de `supabase` de
// tests/front/catchup-nao-ressuscita-produto-excluido.test.ts (guarda os
// filtros encadeados e devolve o que sobrevive a eles), e o padrão de
// ouvinte via `onSync` de
// tests/front/produto-excluido-nao-volta-para-o-cache.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEvent } from "@/lib/realtimeSyncEngine";

interface BancoDeTeste {
  config: any;
  categorias: any[];
  banners: any[];
  coupons: any[];
  /**
   * Uma entrada por chamada a `.from("produtos" | "vw_produtos_public")`, na
   * ordem em que o `catchUp` as faz: [0] é o RESUMO. Os dois casos deste
   * arquivo mantêm `updatedAt`/`ultima_atualizacao` iguais entre cofre e
   * servidor para nenhum produto cair em `outOfDateIds` -- assim não existe
   * ida de DETALHE, e o caso mede só o laço de exclusão/reconciliação.
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
// no eslint. Mesmo comportamento, sem dívida de lint.
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
    is(coluna: string, valor: any) {
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
    // faz `await productsQuery` -- sem isto o dublê não seria aguardável.
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase, ver tests/front/catchup-nao-ressuscita-produto-excluido.test.ts
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
    getAll: vi.fn(async () => conteudoDoCofre),
  };
}

describe("realtimeSyncEngine.catchUp — avisa a tela quando apaga produto", () => {
  let vault: ReturnType<typeof criarDubleVault>;
  let eventosRecebidos: SyncEvent[];
  let exclusoesNoInstanteDoEvento: { store: string; exclusoes: number }[];
  // `_listeners` é um singleton de módulo: ouvinte esquecido contamina o caso
  // seguinte, então cada caso registra o seu e o `afterEach` remove.
  let removerOuvinte: () => void;

  beforeEach(() => {
    eventosRecebidos = [];
    exclusoesNoInstanteDoEvento = [];
    removerOuvinte = RealtimeSyncEngine.onSync((evento) => {
      eventosRecebidos.push(evento);
      // Quantas exclusoes de produto JA tinham acontecido no instante
      // deste aviso. Sem isto, hoistar a notificacao para ANTES do laco
      // de exclusao passa nos dois casos e traz o defeito de volta: a
      // tela releria o cofre com o produto excluido ainda dentro.
      //
      // O par (evento, contagem) e guardado JUNTO de proposito: o
      // `catchUp` avisa config, categorias, banners e cupons ANTES de
      // chegar em produtos, entao olhar o primeiro evento da lista
      // mediria a contagem certa no evento errado.
      exclusoesNoInstanteDoEvento.push({
        store: evento.store,
        exclusoes: vault.deleteById.mock.calls.filter(
          ([store]) => store === "products",
        ).length,
      });
    });
  });

  afterEach(() => {
    removerOuvinte();
  });

  it("avisa a tela quando a lojista pausa ou exclui um produto enquanto a cliente está com o app fechado", async () => {
    // Cofre local tem P e Q; no servidor só Q sobrou (P foi pausado/excluído
    // -- vw_produtos_public/produtos com deleted_at filtram os dois casos
    // igual, então o teste não precisa diferenciar).
    vault = criarDubleVault([
      { id: "prod-P", updatedAt: "2026-08-22T10:00:00Z" },
      { id: "prod-Q", updatedAt: "2026-08-22T10:00:00Z" },
    ]);
    bancoAtual = criarBanco([
      [{ id: "prod-Q", ultima_atualizacao: "2026-08-22T10:00:00Z" }],
    ]);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(vault.deleteById).toHaveBeenCalledWith("products", "prod-P");

    const eventosDeProduto = eventosRecebidos.filter(
      (e) => e.store === "products",
    );
    expect(eventosDeProduto.length).toBeGreaterThan(0);

    // E o aviso de PRODUTOS saiu DEPOIS de o produto ter sido apagado do
    // cofre -- avisar antes faria a tela reler a lista com ele dentro.
    const primeiroAvisoDeProduto = exclusoesNoInstanteDoEvento.find(
      (r) => r.store === "products",
    );
    expect(
      primeiroAvisoDeProduto,
      "nenhum aviso de produtos chegou -- o caso nao montou",
    ).toBeDefined();
    expect(primeiroAvisoDeProduto?.exclusoes).toBeGreaterThan(0);
  });

  it("não avisa a tela quando o servidor devolve os mesmos produtos do cofre (controle negativo)", async () => {
    // Nada foi excluído: sem este caso, um conserto que disparasse evento de
    // 'products' incondicionalmente (não só dentro de `deletedIds.length >
    // 0`) passaria igual no caso acima.
    vault = criarDubleVault([
      { id: "prod-P", updatedAt: "2026-08-22T10:00:00Z" },
      { id: "prod-Q", updatedAt: "2026-08-22T10:00:00Z" },
    ]);
    bancoAtual = criarBanco([
      [
        { id: "prod-P", ultima_atualizacao: "2026-08-22T10:00:00Z" },
        { id: "prod-Q", ultima_atualizacao: "2026-08-22T10:00:00Z" },
      ],
    ]);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(vault.deleteById).not.toHaveBeenCalled();

    const eventosDeProduto = eventosRecebidos.filter(
      (e) => e.store === "products",
    );
    expect(eventosDeProduto).toHaveLength(0);
  });
});
