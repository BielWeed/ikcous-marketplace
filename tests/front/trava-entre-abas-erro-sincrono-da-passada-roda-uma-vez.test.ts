// `comTravaEntreAbas` (`src/lib/trava-entre-abas.ts`): a passada que lança de
// forma SÍNCRONA (um erro antes de devolver a promessa) já rodou com o lock na
// mão. O erro dela sobe a quem chamou UMA vez só; não pode cair no caminho de
// "o navegador recusou o pedido" e rodar a passada de novo, o que repetiria o
// efeito (duas vezes o mesmo envio da fila offline). O teste que já existia
// cobre a passada que REJEITA; aqui é a que LANÇA.
//
// Também fixa o prazo da trava da fila: 2 minutos, o valor que os hooks de
// produtos e de pedidos usam para soltar uma passada travada.
import {
  PRAZO_DA_TRAVA_DA_FILA_MS,
  comTravaEntreAbas,
} from "@/lib/trava-entre-abas";
import { afterEach, describe, expect, it, vi } from "vitest";

type Callback = (lock: { name: string } | null) => unknown;

function instalarLocks(
  request: (nome: string, opcoes: unknown, cb: Callback) => Promise<unknown>,
) {
  vi.stubGlobal("navigator", { locks: { request } });
}

describe("comTravaEntreAbas — passada que lança de forma síncrona", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("o erro sobe a quem chamou e a passada roda uma vez só", async () => {
    instalarLocks(async (_nome, _opcoes, cb) => cb({ name: "x" }));
    const passada = vi.fn<() => Promise<number>>(() => {
      throw new Error("lançou antes de devolver a promessa");
    });

    await expect(comTravaEntreAbas("fila", -1, passada)).rejects.toThrow(
      "lançou antes de devolver a promessa",
    );
    expect(passada).toHaveBeenCalledTimes(1);
  });

  it("com prazo, o erro síncrono também sobe e a passada roda uma vez só", async () => {
    instalarLocks(async (_nome, _opcoes, cb) => cb({ name: "x" }));
    const passada = vi.fn<() => Promise<number>>(() => {
      throw new Error("lançou com prazo");
    });

    await expect(comTravaEntreAbas("fila", -1, passada, 5_000)).rejects.toThrow(
      "lançou com prazo",
    );
    expect(passada).toHaveBeenCalledTimes(1);
  });
});

describe("PRAZO_DA_TRAVA_DA_FILA_MS", () => {
  it("são 2 minutos", () => {
    expect(PRAZO_DA_TRAVA_DA_FILA_MS).toBe(120_000);
  });
});
