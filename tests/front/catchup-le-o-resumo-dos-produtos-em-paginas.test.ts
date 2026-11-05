// @vitest-environment jsdom
//
// "Loja com mais de 1.000 produtos perde produtos da vitrine ao voltar para o
// app": o `catchUp` pedia o RESUMO (id + ultima_atualizacao) numa chamada só.
// O servidor corta em 1.000 linhas sem avisar, e o laço de exclusão tratava
// todo produto do aparelho que não estava no resumo como "excluído pela
// lojista" -- apagava do cofre local (e as variações dele) o que só tinha
// ficado depois da linha 1.000. A vitrine relia o cofre e encolhia.
//
// O conserto lê o resumo em páginas POR CHAVE (`.gt("id", ultimoLido)
// .order("id").limit(1000)`) até vir uma página menor que 1.000, e só
// reconcilia exclusões com o resumo COMPLETO e coerente. Por posição
// (`.range`), um produto excluído no servidor entre a página 1 e a 2 empurrava
// a lista uma linha para cima e a linha da fronteira nunca era lida -- o
// produto vivo parecia "ausente" e era apagado do aparelho por engano.
//
// Molde: dublê de `supabase` de
// tests/front/catchup-avisa-a-tela-quando-apaga-produto.test.ts, agora com o
// teto de 1.000 linhas por chamada que o servidor real impõe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncEvent } from "@/lib/realtimeSyncEngine";

const TETO_DO_SERVIDOR = 1000;
const CARIMBO = "2026-11-05T10:00:00Z";

interface PedidoDeResumo {
  /** Valor passado ao `.gt("id", ...)`; null na primeira página. */
  depoisDoId: string | null;
  /** Valor passado ao `.limit(...)`; null se não houve. */
  limite: number | null;
  /** Coluna passada ao `.order()`. */
  ordenacao: string | null;
  /** O pedido usou `.range()` (paginação por posição). */
  usouFaixa: boolean;
}

interface ServidorDeTeste {
  /** Linhas do resumo (o dublê as devolve ordenadas por `id`). */
  produtos: any[];
  /** Se definido, o pedido de resumo de NÚMERO n (1 = primeira página) falha. */
  falharNoPedido: number | null;
  /** Um registro por pedido de resumo recebido. */
  pedidos: PedidoDeResumo[];
  /** Roda DEPOIS de o servidor entregar o pedido n (o catálogo anda no meio). */
  aposEntregar: ((numeroDoPedido: number) => void) | null;
  /** Servidor quebrado: ignora o `.gt` e devolve sempre a mesma página. */
  ignoraOGt: boolean;
}

function criarServidor(
  produtos: any[],
  falharNoPedido: number | null = null,
): ServidorDeTeste {
  return {
    produtos,
    falharNoPedido,
    pedidos: [],
    aposEntregar: null,
    ignoraOGt: false,
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
  let limite: number | null = null;
  let depoisDoId: string | null = null;
  let ordenacao: string | null = null;

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
    limit(n: number) {
      limite = n;
      return builder;
    },
    order(coluna: string) {
      ordenacao = coluna;
      return builder;
    },
    range(de: number, ate: number) {
      faixa = [de, ate];
      return builder;
    },
    gt(coluna: string, valor: string) {
      if (coluna === "id") depoisDoId = valor;
      if (!servidor.ignoraOGt) {
        filtros.push((linha) => lerColuna(linha, coluna) > valor);
      }
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
      let numeroDoPedido = 0;
      if (ehResumo) {
        servidor.pedidos.push({
          depoisDoId,
          limite,
          ordenacao,
          usouFaixa: faixa !== null,
        });
        numeroDoPedido = servidor.pedidos.length;
        if (servidor.falharNoPedido === numeroDoPedido) {
          return Promise.resolve({
            data: null,
            error: { message: "falha de rede na página do resumo" },
          }).then(resolve, reject);
        }
      }
      let linhas = obterLinhas().filter((linha) =>
        filtros.every((f) => f(linha)),
      );
      if (ehResumo) {
        if (ordenacao !== null) {
          const coluna = ordenacao;
          linhas = [...linhas].sort((a, b) => {
            const va = lerColuna(a, coluna);
            const vb = lerColuna(b, coluna);
            return va < vb ? -1 : va > vb ? 1 : 0;
          });
        }
        // O servidor real corta em 1.000 linhas por chamada, mesmo quando o
        // `.range()`/`.limit()` pede mais (ou quando não há nenhum dos dois).
        const de = faixa === null ? 0 : faixa[0];
        const pedido =
          faixa !== null
            ? faixa[1] - faixa[0] + 1
            : (limite ?? Number.POSITIVE_INFINITY);
        linhas = linhas.slice(de, de + Math.min(pedido, TETO_DO_SERVIDOR));
      }
      const resultado = modoUnico
        ? { data: linhas[0] ?? null, error: null }
        : { data: linhas, error: null };
      const resposta = Promise.resolve(resultado).then(resolve, reject);
      if (ehResumo) servidor.aposEntregar?.(numeroDoPedido);
      return resposta;
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

function idsApagadosDoCofre(vault: ReturnType<typeof criarDubleVault>) {
  return vault.deleteById.mock.calls
    .filter(([store]) => store === "products")
    .map(([, id]) => id);
}

describe("realtimeSyncEngine.catchUp — resumo dos produtos lido em páginas por chave", () => {
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

  it("loja com 1.500 produtos: nenhum é apagado e a 2ª página é pedida DEPOIS do último id da 1ª (.gt), sem .range", async () => {
    const vault = criarDubleVault(produtosDoCofre(1500));
    servidorAtual = criarServidor(resumoDoServidor(1500));

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(servidorAtual.pedidos).toEqual([
      { depoisDoId: null, limite: 1000, ordenacao: "id", usouFaixa: false },
      {
        depoisDoId: idDoProduto(999),
        limite: 1000,
        ordenacao: "id",
        usouFaixa: false,
      },
    ]);
    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(eventosRecebidos.filter((e) => e.store === "products")).toHaveLength(
      0,
    );
  });

  it("loja com exatamente 1.000 produtos: pede uma 2ª página (vazia) para ter certeza de que acabou", async () => {
    const vault = criarDubleVault(produtosDoCofre(1000));
    servidorAtual = criarServidor(resumoDoServidor(1000));

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(servidorAtual.pedidos.map((p) => p.depoisDoId)).toEqual([
      null,
      idDoProduto(999),
    ]);
    expect(vault.deleteById).not.toHaveBeenCalled();
  });

  it("falha na 2ª página do resumo: a rodada NÃO apaga nada (resumo incompleto)", async () => {
    const vault = criarDubleVault(produtosDoCofre(1500));
    servidorAtual = criarServidor(resumoDoServidor(1500), 2);

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(servidorAtual.pedidos).toHaveLength(2);
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

    expect(idsApagadosDoCofre(vault)).toEqual([idDoProduto(1499)]);
    expect(eventosRecebidos.filter((e) => e.store === "products").length).toBe(
      1,
    );
  });

  it("produto excluído no servidor DEPOIS de a 1ª página ser entregue: nenhum produto vivo é apagado (por posição, a linha da fronteira era pulada)", async () => {
    // O caso que motiva a paginação por chave. A lojista exclui o produto
    // prod-0999 (última linha da 1ª página) enquanto a 2ª página ainda não foi
    // pedida. Por posição, o servidor reentregava a partir da linha 1.000 de
    // uma lista que encolheu: prod-1000 virava a linha 999 e nunca era lido --
    // vivo no servidor, "ausente" do resumo, apagado do aparelho por engano.
    const vault = criarDubleVault(produtosDoCofre(1500));
    servidorAtual = criarServidor(resumoDoServidor(1500));
    servidorAtual.aposEntregar = (numeroDoPedido) => {
      if (numeroDoPedido !== 1) return;
      servidorAtual.produtos = servidorAtual.produtos.filter(
        (p) => p.id !== idDoProduto(999),
      );
    };

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(idsApagadosDoCofre(vault)).toEqual([]);
    expect(servidorAtual.pedidos[1]?.depoisDoId).toBe(idDoProduto(999));
    expect(eventosRecebidos.filter((e) => e.store === "products")).toHaveLength(
      0,
    );
  });

  it("resumo incoerente (id repetido, defesa em profundidade): não apaga ninguém", async () => {
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

  it("servidor que ignora o .gt e repete a mesma página (a chave não avança): pára cedo e NÃO apaga nada", async () => {
    // Sem o freio de "a chave tem de avançar", o laço pediria 100 páginas
    // iguais e só então desistiria. A 2ª resposta, idêntica à 1ª, já derruba
    // a leitura; a rodada pula a reconciliação dos produtos.
    const vault = criarDubleVault(produtosDoCofre(1500));
    servidorAtual = criarServidor(resumoDoServidor(1500));
    servidorAtual.ignoraOGt = true;

    await RealtimeSyncEngine.catchUp(vault as any, true);

    expect(servidorAtual.pedidos).toHaveLength(2);
    expect(vault.deleteById).not.toHaveBeenCalled();
    expect(eventosRecebidos.filter((e) => e.store === "products")).toHaveLength(
      0,
    );
  });
});
