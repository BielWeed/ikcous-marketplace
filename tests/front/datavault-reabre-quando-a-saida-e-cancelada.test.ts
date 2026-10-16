// @vitest-environment jsdom
//
// SAÍDA CANCELADA NÃO DEIXA O COFRE MORTO (revisão da 1.5.33, 16/10/2026).
//
// O DataVault fecha a conexão no `beforeunload`. Só que `beforeunload` também
// dispara quando a pessoa CANCELA a saída no diálogo de "alterações não
// salvas" — e a página segue viva. O singleton continuava apontando para a
// conexão fechada: `init()` devolvia a instância morta (`isClosed()` falso) e
// `getAll()` engolia o erro e devolvia `[]`, lido como "cofre vazio".
//
// Sem fake-indexeddb no projeto, o `indexedDB` é um dublê mínimo: `open`
// responde com uma conexão que só sabe fechar e dizer que a transação falhou.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataVault } from "@/lib/dataVault";

interface ConexaoFalsa {
  objectStoreNames: string[];
  close: ReturnType<typeof vi.fn>;
  transaction: () => never;
  onversionchange: (() => void) | null;
}

let conexoes: ConexaoFalsa[];

beforeEach(() => {
  conexoes = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("indexedDB", {
    open: () => {
      const conexao: ConexaoFalsa = {
        objectStoreNames: [],
        close: vi.fn(),
        // Conexão fechada: o navegador lança aqui, e `getAll` vira `[]`.
        transaction: () => {
          throw new DOMException("closing", "InvalidStateError");
        },
        onversionchange: null,
      };
      conexoes.push(conexao);
      const pedido: { result: ConexaoFalsa; onsuccess: (() => void) | null } = {
        result: conexao,
        onsuccess: null,
      };
      queueMicrotask(() => pedido.onsuccess?.());
      return pedido;
    },
  });
});

afterEach(() => {
  DataVault.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DataVault depois de um beforeunload que a pessoa cancelou", () => {
  it("a instância antiga sabe que morreu e init() abre uma conexão nova", async () => {
    const antes = await DataVault.init();
    expect(antes.isClosed()).toBe(false);
    // Controle: sem nenhum evento, init() devolve a MESMA instância.
    expect(await DataVault.init()).toBe(antes);
    expect(conexoes).toHaveLength(1);

    // A pessoa tentou sair, o diálogo apareceu e ela escolheu ficar.
    window.dispatchEvent(new Event("beforeunload"));
    expect(conexoes[0].close).toHaveBeenCalledTimes(1);
    expect(antes.isClosed()).toBe(true);

    const depois = await DataVault.init();
    expect(depois).not.toBe(antes);
    expect(depois.isClosed()).toBe(false);
    expect(conexoes).toHaveLength(2);
  });
});
