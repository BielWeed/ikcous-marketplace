// @vitest-environment jsdom
//
// "Loja com mais de 1.000 produtos perde produtos da vitrine ao voltar para o
// app": o `catchUp` pedia o RESUMO (id + ultima_atualizacao) numa chamada só.
// O servidor corta em 1.000 linhas sem avisar, e o laço de exclusão tratava
// todo produto do aparelho que não estava no resumo como "excluído pela
// lojista" -- apagava do cofre local (e as variações dele) o que só tinha
// ficado depois da linha 1.000. A vitrine relia o cofre e encolhia.
//
// O conserto lê o resumo em páginas (`.order("id").range(...)`) até acabar, e
// só reconcilia exclusões com o resumo COMPLETO e coerente.
//
// Molde: dublê de `supabase` de
// tests/front/catchup-avisa-a-tela-quando-apaga-produto.test.ts, agora com o
// teto de 1.000 linhas por chamada que o servidor real impõe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEvent } from "@/lib/realtimeSyncEngine";

const TETO_DO_SERVIDOR = 1000;
const CARIMBO = "2026-11-05T10:00:00Z";

interface ServidorDeTeste {
  /** Linhas do resumo, na ordem em que o servidor as guarda. */
  produtos: any[];
  /** Se definido, a página que COMEÇA nesta linha responde com erro. */
  falharNaPaginaQueComecaEm: number | null;
  /** Uma entrada por página pedida: [de, ate] do `.range()`. */
  faixasPedidas: Array<[number, number]>;
  /** Uma entrada por pedido de resumo: coluna passada ao `.order()`. */
  ordenacoesPedidas: string[];
  /** Quantos pedidos de resumo foram feitos SEM `.range()`. */
  pedidosSemFaixa: number;
}

function criarServidor(
  produtos: any[],
  falharNaPaginaQueComecaEm: number | null = null,
): ServidorDeTeste {
  return {
    produtos,
    falharNaPaginaQueComecaEm,
    faixasPedidas: [],
    ordenacoesPedidas: [],
    pedidosSemFaixa: 0,
  };
}

let servidorAtual: ServidorDeTeste;

// Leitura por nome de coluna via `Reflect.get`, e não por `linha[coluna]`:
// indexar objeto com chave variável dispara `security/detect-object-injection`.
function lerColuna(linha: any, coluna: string): any {
  return linha == null ? undefined : Reflect.get(linha, coluna);
}

function construirQueryBuilder(tabela: string, servidor: ServidorDeTeste) {
  const filtros: Array<(linha: any) => boolean> = [];
  let modoUnico = false;
  let faixa: [number, number] | null = null;

  const obterLinhas = (): any[] => {
    switch (tabela) {
      case "store_config":
      case "v_store_config":
        return [null];
      case "categorias":
      case "banners":
        return [];
      case "produtos":
      case "vw_produtos_public":
        return servidor.produtos;
      default:
        throw new Error(`Tabela inesperada no dublê de supabase: ${tabela}`);
    }
  };

  const builder: any = {
    select: () => builder,
    limit: () => builder,
    order(coluna: string) {
      if (tabela === "produtos" || tabela === "vw_produtos_public") {
        servidor.ordenacoesPedidas.push(coluna);
      }
      return builder;
    },
    range(de: number, ate: number) {
      faixa = [de, ate];
      return builder;
    },
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
    // faz `await` nele.
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase, ver tests/front/catchup-avisa-a-tela-quando-apaga-produto.test.ts
    then(resolve: any, reject: any) {
      const ehResumo = tabela === "produtos" || tabela === "vw_produtos_public";
      if (ehResumo) {
        if (faixa === null) servidor.pedidosSemFaixa += 1;
        else servidor.faixasPedidas.push(faixa);
      }
      const de = faixa === null ? 0 : faixa[0];
      if (ehResumo && servidor.falharNaPaginaQueComecaEm === de) {
        return Promise.resolve({
          data: null,
          error: { message: "falha de rede na página do resumo" },
        }).then(resolve, reject);
      }
      let linhas = obterLinhas().filter((linha) =>
        filtros.every((f) => f(linha)),
      );
      if (ehResumo) {
        // O servidor real corta em 1.000 linhas por chamada, mesmo quando o
        // `.range()` pede mais (ou quando não há `.range()`).
        const ate = faixa === null ? Number.POSITIVE_INFINITY : faixa[1];
        const fim = Math.min(ate + 1, de + TETO_DO_SERVIDOR);
        linhas = linhas.slice(de, fim);
      }
      const resultado = modoUnico
        ? { data: linhas[0] ?? null, error: null }
        : { data: linhas, error: null };
      return Promise.resolve(resultado).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from(tabela: string) {
      return construirQueryBuilder(tabela, servidorAtual);
    },
  },
}));

const { RealtimeSyncEngine } = await import("@/lib/realtimeSyncEngine");

function criarDubleVault(conteudoDoCofre: any[]) {
  return {
    put: vi.fn(async (_store: string, _registro: any) => undefined),
    putMany: vi.fn(async (_store: string, _itens: any[]) => undefined),
    replaceAll: vi.fn(async (_store: string, _itens: any[]) => undefined),
    deleteById: vi.fn(async (_store: string, _id: string) => undefined),
    setLastSync: vi.fn(async () => undefined),
    getById: vi.fn(async () => undefined),
    getByIndex: vi.fn(async () => []),
    getAll: vi.fn(async () => conteudoDoCofre),
    getAllOrThrow: vi.fn(async () => conteudoDoCofre),
  };
}

function idDoProduto(posicao: number): string {
  return `prod-${String(posicao).padStart(4, "0")}`;
}

function produtosDoCofre(quantidade: number): any[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: idDoProduto(i),
    updatedAt: CARIMBO,
  }));
}

function resumoDoServidor(quantidade: number): any[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    id: idDoProduto(i),
    ultima_atualizacao: CARIMBO,
  }));
}

describe("realtimeSyncEngine.catchUp — resumo dos produtos lido em páginas", () => {
  let eventosRecebidos: SyncEvent[];
  let removerOuvinte: () => void;

  beforeEach(() => {
    eventosRecebidos = [];
    removerOuvinte = RealtimeSyncEngine.onSync((evento) => {
      eventosRecebidos.push(evento);
    });
  });

  afterEach(() => {
    removerOuvinte();
  });

  it("loja com 1.500 produtos: nenhum é apagado e a 2ª página é pedida com .range(1000, 1999)", async () => {
    const vault = criarDubleVault(produtosDoCofre(1500));
    servidorAtual = criarServidor(resumoDoServidor(1500));

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(servidorAtual.pedidosSemFaixa).toBe(0);
    expect(servidorAtual.faixasPedidas).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // Ordenação estável nas duas páginas: sem ela, o corte de 1.000 linhas
    // cairia em produtos arbitrários a cada chamada.
    expect(servidorAtual.ordenacoesPedidas).toEqual(["id", "id"]);
    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(eventosRecebidos.filter((e) => e.store === "products")).toHaveLength(
      0,
    );
  });

  it("falha na 2ª página do resumo: a rodada NÃO apaga nada (resumo incompleto)", async () => {
    const vault = criarDubleVault(produtosDoCofre(1500));
    servidorAtual = criarServidor(resumoDoServidor(1500), 1000);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(servidorAtual.faixasPedidas).toContainEqual([0, 999]);
    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(eventosRecebidos.filter((e) => e.store === "products")).toHaveLength(
      0,
    );
  });

  it("loja com 1.500 produtos: o que a lojista excluiu de fato (além da linha 1.000) continua sendo apagado", async () => {
    // Controle negativo do conserto: paginar não pode desligar a reconciliação.
    const vault = criarDubleVault(produtosDoCofre(1500));
    servidorAtual = criarServidor(resumoDoServidor(1499));

    await RealtimeSyncEngine.catchUp(vault as any, true);

    const apagados = vault.deleteById.mock.calls
      .filter(([store]) => store === "products")
      .map(([, id]) => id);
    expect(apagados).toEqual([idDoProduto(1499)]);
    expect(eventosRecebidos.filter((e) => e.store === "products").length).toBe(
      1,
    );
  });

  it("resumo incoerente (id repetido, sinal de que a lista andou durante a leitura): não apaga ninguém", async () => {
    // 1.499 ids distintos + um repetido = 1.500 linhas; falta prod-1499. Sem a
    // defesa, ele seria apagado por um resumo que não merece confiança.
    const vault = criarDubleVault(produtosDoCofre(1500));
    const resumo = resumoDoServidor(1499);
    resumo.push({ id: idDoProduto(0), ultima_atualizacao: CARIMBO });
    servidorAtual = criarServidor(resumo);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(eventosRecebidos.filter((e) => e.store === "products")).toHaveLength(
      0,
    );
  });
});
