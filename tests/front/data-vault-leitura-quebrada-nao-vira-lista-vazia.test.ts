// @vitest-environment jsdom
//
// O cofre local (IndexedDB) tem DOIS jeitos de devolver uma lista vazia, e
// confundi-los já custou caro: `getAll` engole a falha de leitura e resolve
// `[]`, indistinguível de "a store está vazia de verdade". Quem lê esse `[]`
// e apaga a tela — os ouvintes de sincronização de produtos, banners e
// categorias — esvaziava a vitrine da loja por causa de uma leitura quebrada,
// com o catálogo intacto no servidor.
//
// `getAllOrThrow` existe só para separar os dois casos: ele REJEITA onde o
// `getAll` mascara. Este arquivo é a prova de que a diferença entre os dois
// realmente existe -- sem ele, transformar `getAllOrThrow` numa cópia do
// `getAll` (um `resolve([])` no lugar do `reject`) passa despercebido por
// toda a suíte, e o defeito volta inteiro.
//
// A gêmea vive em `tests/front/ultimo-item-excluido-some-da-tela.test.tsx`,
// que cobre a camada de cima (a tela) com o cofre dublado. Aqui a camada de
// baixo (o cofre) é exercitada de verdade, sem IndexedDB: os testes que
// mockam `@/lib/dataVault` nunca avaliam este módulo, então nada em
// `dataVault.ts` tinha cobertura.
import { describe, expect, it } from "vitest";

import { DataVault } from "@/lib/dataVault";

// A classe tem `private constructor` (só compile-time) e um campo `db`
// privado. Instanciar pelo protótipo permite injetar um `IDBDatabase` falso
// sem abrir o `indexedDB` global -- que não existe no jsdom puro.
function cofreCom(db: unknown): DataVault {
  const cofre = Object.create(DataVault.prototype) as DataVault;
  (cofre as unknown as { db: unknown }).db = db;
  return cofre;
}

/** Conexão fechada: `transaction()` lança de forma síncrona, como o navegador
 *  faz quando outra aba apagou o banco e o `onversionchange` fechou esta. */
const bancoQueLancaNaTransacao = {
  transaction() {
    throw new DOMException(
      "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
      "InvalidStateError",
    );
  },
};

/** Transação abre, mas a requisição falha depois (o outro caminho de erro). */
const bancoCujaRequisicaoFalha = {
  transaction() {
    return {
      objectStore() {
        return {
          getAll() {
            const request: Record<string, unknown> = {
              error: new DOMException("boom", "UnknownError"),
            };
            queueMicrotask(() => {
              (request.onerror as (() => void) | undefined)?.();
            });
            return request;
          },
        };
      },
    };
  },
};

describe("DataVault — leitura quebrada não pode virar lista vazia", () => {
  it("getAllOrThrow rejeita quando a conexão com o cofre está fechada", async () => {
    const cofre = cofreCom(bancoQueLancaNaTransacao);

    await expect(cofre.getAllOrThrow("products")).rejects.toBeInstanceOf(
      DOMException,
    );
  });

  it("getAllOrThrow rejeita quando a leitura falha depois de abrir", async () => {
    const cofre = cofreCom(bancoCujaRequisicaoFalha);

    await expect(cofre.getAllOrThrow("products")).rejects.toBeDefined();
  });

  // O controle negativo, e é ele que dá sentido aos dois de cima: se o
  // `getAll` também rejeitasse, `getAllOrThrow` não seria necessário e os
  // testes acima estariam medindo uma diferença que não existe.
  it("getAll, ao contrário, DEVOLVE lista vazia na conexão fechada -- é essa a armadilha", async () => {
    const cofre = cofreCom(bancoQueLancaNaTransacao);

    await expect(cofre.getAll("products")).resolves.toEqual([]);
  });

  it("os dois concordam quando a leitura dá certo: devolvem o que está na store", async () => {
    const linhas = [{ id: "p1" }, { id: "p2" }];
    const bancoBom = {
      transaction() {
        return {
          objectStore() {
            return {
              getAll() {
                const request: Record<string, unknown> = { result: linhas };
                queueMicrotask(() => {
                  (request.onsuccess as (() => void) | undefined)?.();
                });
                return request;
              },
            };
          },
        };
      },
    };

    await expect(cofreCom(bancoBom).getAll("products")).resolves.toEqual(
      linhas,
    );
    await expect(cofreCom(bancoBom).getAllOrThrow("products")).resolves.toEqual(
      linhas,
    );
  });
});
