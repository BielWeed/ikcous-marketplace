// @vitest-environment jsdom
//
// O PEDIDO PENDENTE DO CHECKOUT sobrevive à recarga (04/10/2026). O módulo
// guarda SÓ o id do pedido — nada de valor, QR, CPF ou e-mail — no
// `sessionStorage` (some ao fechar a aba), sob uma chave que inclui o id do
// usuário logado. Storage que lança (modo privado, cota, SecurityError) nunca
// derruba o checkout: toda leitura e escrita é best-effort.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveDoPedidoPendenteDoCheckout,
  esquecerPedidoPendenteDoCheckout,
  esquecerTodosOsPedidosPendentesDoCheckout,
  guardarPedidoPendenteDoCheckout,
  lerPedidoPendenteDoCheckout,
} from "@/lib/pedido-pendente-do-checkout";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OUTRO_PEDIDO = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

function armazemDeTeste() {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
    clear: () => {
      dados.clear();
    },
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

describe("pedido pendente do checkout (sessionStorage, por usuário)", () => {
  let armazem: ReturnType<typeof armazemDeTeste>;

  beforeEach(() => {
    armazem = armazemDeTeste();
    vi.stubGlobal("sessionStorage", armazem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarda SÓ o id do pedido, sob uma chave que inclui o id do usuário", () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);

    expect([...armazem.dados.entries()]).toEqual([
      [chaveDoPedidoPendenteDoCheckout("user-1"), PEDIDO],
    ]);
    expect(chaveDoPedidoPendenteDoCheckout("user-1")).toContain("user-1");
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);
  });

  it("o pedido de um usuário nunca é lido para outro", () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);

    expect(lerPedidoPendenteDoCheckout("user-2")).toBeNull();
  });

  it("valor que não é id de pedido (adulterado, vazio, versão velha) é ignorado", () => {
    for (const lixo of ["", "nao-e-uuid", `${PEDIDO}x`, '{"id":"x"}']) {
      armazem.dados.set(chaveDoPedidoPendenteDoCheckout("user-1"), lixo);
      expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
    }
  });

  it("id inválido nem é gravado", () => {
    guardarPedidoPendenteDoCheckout("user-1", "nao-e-uuid");
    guardarPedidoPendenteDoCheckout("", PEDIDO);

    expect(armazem.dados.size).toBe(0);
  });

  it("esquecer apaga só a chave do usuário; esquecer todos apaga só as chaves deste módulo", () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    guardarPedidoPendenteDoCheckout("user-2", OUTRO_PEDIDO);
    armazem.dados.set("ikcous-rascunho-do-checkout-v1", "{}");

    esquecerPedidoPendenteDoCheckout("user-1");
    expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
    expect(lerPedidoPendenteDoCheckout("user-2")).toBe(OUTRO_PEDIDO);

    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    esquecerTodosOsPedidosPendentesDoCheckout();
    expect([...armazem.dados.keys()]).toEqual([
      "ikcous-rascunho-do-checkout-v1",
    ]);
  });

  it("storage cujos métodos lançam: nada lança, leitura volta null", () => {
    const explode = () => {
      throw new Error("QuotaExceededError");
    };
    vi.stubGlobal("sessionStorage", {
      getItem: explode,
      setItem: explode,
      removeItem: explode,
      key: explode,
      get length(): number {
        throw new Error("SecurityError");
      },
    });

    expect(() =>
      guardarPedidoPendenteDoCheckout("user-1", PEDIDO),
    ).not.toThrow();
    expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
    expect(() => esquecerPedidoPendenteDoCheckout("user-1")).not.toThrow();
    expect(() => esquecerTodosOsPedidosPendentesDoCheckout()).not.toThrow();
  });

  it("acessar o próprio sessionStorage lança (SecurityError): nada lança", () => {
    vi.stubGlobal("sessionStorage", undefined);
    const descritor = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage",
    );
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(() =>
        guardarPedidoPendenteDoCheckout("user-1", PEDIDO),
      ).not.toThrow();
      expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
      expect(() => esquecerTodosOsPedidosPendentesDoCheckout()).not.toThrow();
    } finally {
      if (descritor)
        Object.defineProperty(globalThis, "sessionStorage", descritor);
    }
  });
});
