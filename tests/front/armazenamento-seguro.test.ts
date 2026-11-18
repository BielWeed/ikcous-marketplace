// @vitest-environment jsdom
//
// O ARMAZENAMENTO SEGURO NÃO LANÇA NEM QUANDO OS MÉTODOS LANÇAM.
//
// Aparelho antigo, Safari privado antigo e armazenamento cheio fazem `setItem`
// lançar QuotaExceededError (ou SecurityError) mesmo com o ACESSO à propriedade
// funcionando. Quem escreve por aqui (abertura da loja, CEP do checkout, sessão
// do login) não pode cair por isso: a escrita que falha fica numa cópia em
// memória e o resto da visita enxerga o valor. Com o armazenamento funcionando,
// tudo vai para o armazenamento de verdade, como sempre foi.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmazenamentoComCota } from "./helpers/armazenamento-com-cota";

type Fabrica = "localStorageSeguro" | "sessionStorageSeguro";
type Nome = "localStorage" | "sessionStorage";

const CASOS: ReadonlyArray<[Fabrica, Nome]> = [
  ["localStorageSeguro", "localStorage"],
  ["sessionStorageSeguro", "sessionStorage"],
];

function erroDeCota() {
  return new DOMException("The quota has been exceeded.", "QuotaExceededError");
}

function bloquearOAcesso(nome: Nome): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, nome);
  Object.defineProperty(globalThis, nome, {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, nome, original);
    else Reflect.deleteProperty(globalThis, nome);
  };
}

type Modulo = typeof import("@/lib/armazenamento-seguro");

async function carregar(): Promise<Modulo> {
  vi.resetModules();
  return import("@/lib/armazenamento-seguro");
}

function seguroDe(modulo: Modulo, fabrica: Fabrica) {
  return fabrica === "localStorageSeguro"
    ? modulo.localStorageSeguro()
    : modulo.sessionStorageSeguro();
}

describe.each(CASOS)("%s", (fabrica, nome) => {
  // Um armazenamento de mentira por teste: o `localStorage` do Node 25 não é uma
  // Storage completa (ver setup-build-identity.ts), então não dá para depender
  // de `Storage.prototype`. Os métodos do dublê é que são espionados.
  let real: ArmazenamentoComCota;

  beforeEach(() => {
    real = new ArmazenamentoComCota(1_000_000);
    vi.stubGlobal(nome, real);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("controle: com o armazenamento funcionando, grava e lê no de verdade", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    const gravar = vi.spyOn(real, "setItem");

    seguro.setItem("chave", "valor");

    expect(gravar).toHaveBeenCalledWith("chave", "valor");
    expect(real.getItem("chave")).toBe("valor");
    expect(seguro.getItem("chave")).toBe("valor");
    expect(seguro.getItem("ausente")).toBeNull();

    // O de verdade manda: o que outra aba escreveu depois aparece (sem cópia
    // velha em memória por cima).
    real.setItem("chave", "de-outra-aba");
    expect(seguro.getItem("chave")).toBe("de-outra-aba");

    seguro.removeItem("chave");
    expect(real.getItem("chave")).toBeNull();
    expect(seguro.getItem("chave")).toBeNull();
  });

  it("setItem lançando (cota cheia): não lança e a leitura seguinte vê o valor", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    vi.spyOn(real, "setItem").mockImplementation(() => {
      throw erroDeCota();
    });

    expect(() => seguro.setItem("chave", "valor")).not.toThrow();

    expect(seguro.getItem("chave")).toBe("valor");
  });

  it("armazenamento com cota estourada (helper): escrever grande não lança e lê de volta", async () => {
    const modulo = await carregar();
    vi.stubGlobal(nome, new ArmazenamentoComCota(20));
    const seguro = seguroDe(modulo, fabrica);

    expect(() => seguro.setItem("sessao", "x".repeat(100))).not.toThrow();

    expect(seguro.getItem("sessao")).toBe("x".repeat(100));
  });

  it("getItem lançando: devolve null em vez de lançar", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    vi.spyOn(real, "getItem").mockImplementation(() => {
      throw new DOMException("insecure", "SecurityError");
    });

    expect(() => seguro.getItem("chave")).not.toThrow();
    expect(seguro.getItem("chave")).toBeNull();
  });

  it("removeItem lançando: não lança e apaga a cópia em memória", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    vi.spyOn(real, "setItem").mockImplementation(() => {
      throw erroDeCota();
    });
    vi.spyOn(real, "removeItem").mockImplementation(() => {
      throw new DOMException("insecure", "SecurityError");
    });
    seguro.setItem("chave", "valor");

    expect(() => seguro.removeItem("chave")).not.toThrow();

    expect(seguro.getItem("chave")).toBeNull();
  });

  it("valor antigo no de verdade + escrita que falha: vale o NOVO, nunca o antigo", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    real.setItem("sessao", "antiga");
    vi.spyOn(real, "setItem").mockImplementation(() => {
      throw erroDeCota();
    });

    seguro.setItem("sessao", "nova");

    expect(seguro.getItem("sessao")).toBe("nova");
  });

  it("escrita que falha com valor antigo no de verdade: o de verdade NÃO guarda mais o antigo (recarregar não o traz de volta)", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    real.setItem("sessao", "da-conta-A");
    vi.spyOn(real, "setItem").mockImplementation(() => {
      throw erroDeCota();
    });

    seguro.setItem("sessao", "da-conta-B");

    expect(real.getItem("sessao")).toBeNull();
    expect(seguro.getItem("sessao")).toBe("da-conta-B");
    // Recarregar a página: a memória some e o de verdade não pode devolver o
    // valor da conta anterior.
    const recarregado = seguroDe(await carregar(), fabrica);
    expect(recarregado.getItem("sessao")).toBeNull();
  });

  it("escrita que falha e o de verdade também recusa apagar: não lança e vale o novo", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    real.setItem("sessao", "antiga");
    vi.spyOn(real, "setItem").mockImplementation(() => {
      throw erroDeCota();
    });
    vi.spyOn(real, "removeItem").mockImplementation(() => {
      throw new DOMException("insecure", "SecurityError");
    });

    expect(() => seguro.setItem("sessao", "nova")).not.toThrow();

    expect(seguro.getItem("sessao")).toBe("nova");
  });

  it("quando a escrita volta a funcionar, o de verdade volta a mandar", async () => {
    const modulo = await carregar();
    const seguro = seguroDe(modulo, fabrica);
    const gravar = vi.spyOn(real, "setItem");
    gravar.mockImplementationOnce(() => {
      throw erroDeCota();
    });
    seguro.setItem("chave", "so-na-memoria");
    expect(seguro.getItem("chave")).toBe("so-na-memoria");

    seguro.setItem("chave", "agora-no-real");
    expect(real.getItem("chave")).toBe("agora-no-real");

    real.setItem("chave", "de-outra-aba");
    expect(seguro.getItem("chave")).toBe("de-outra-aba");
  });

  it("o ACESSO à propriedade lançando: grava e lê na memória, sem lançar", async () => {
    const modulo = await carregar();
    const desfazer = bloquearOAcesso(nome);
    const seguro = seguroDe(modulo, fabrica);
    try {
      expect(seguro.getItem("chave")).toBeNull();
      expect(() => seguro.setItem("chave", "valor")).not.toThrow();
      expect(seguro.getItem("chave")).toBe("valor");
      expect(() => seguro.removeItem("chave")).not.toThrow();
      expect(seguro.getItem("chave")).toBeNull();
    } finally {
      desfazer();
    }
  });

  it("não vaza entre local e sessão: cada um tem a sua memória", async () => {
    const modulo = await carregar();
    vi.spyOn(real, "setItem").mockImplementation(() => {
      throw erroDeCota();
    });
    const outro = seguroDe(
      modulo,
      fabrica === "localStorageSeguro"
        ? "sessionStorageSeguro"
        : "localStorageSeguro",
    );

    seguroDe(modulo, fabrica).setItem("chave", "valor");

    expect(outro.getItem("chave")).toBeNull();
  });
});
