// A trava entre abas das filas offline (Web Lock com `ifAvailable`). Aqui o
// contrato da peça isolada; o efeito nas filas de produtos e de pedidos está em
// useproducts-/useorders-fila-offline-trava-entre-abas.
import { comTravaEntreAbas } from "@/lib/trava-entre-abas";
import { afterEach, describe, expect, it, vi } from "vitest";

type Callback = (lock: { name: string } | null) => unknown;

function instalarLocks(
  request: (nome: string, opcoes: unknown, cb: Callback) => Promise<unknown>,
) {
  vi.stubGlobal("navigator", { locks: { request } });
}

describe("comTravaEntreAbas", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("com o lock: roda a passada, devolve o resultado dela e pede ifAvailable", async () => {
    const request = vi.fn(async (_n: string, _o: unknown, cb: Callback) =>
      cb({ name: "x" }),
    );
    instalarLocks(request);
    const passada = vi.fn(async () => 42);

    expect(await comTravaEntreAbas("fila", -1, passada)).toBe(42);

    expect(passada).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "fila",
      { ifAvailable: true },
      expect.any(Function),
    );
  });

  it("outra aba tem o lock: devolve o valor de 'sem lock' e NÃO roda a passada", async () => {
    instalarLocks(async (_n, _o, cb) => cb(null));
    const passada = vi.fn(async () => 42);

    expect(await comTravaEntreAbas("fila", -1, passada)).toBe(-1);
    expect(passada).not.toHaveBeenCalled();
  });

  it("sem navigator.locks: roda a passada direto", async () => {
    vi.stubGlobal("navigator", {});
    const passada = vi.fn(async () => 42);

    expect(await comTravaEntreAbas("fila", -1, passada)).toBe(42);
    expect(passada).toHaveBeenCalledTimes(1);
  });

  it("erro da PRÓPRIA passada sobe a quem chamou, uma vez só, e o lock é solto", async () => {
    let solto = false;
    instalarLocks(async (_n, _o, cb) => {
      try {
        return await cb({ name: "x" });
      } finally {
        solto = true;
      }
    });
    const passada = vi.fn(async () => {
      throw new Error("falhou no meio");
    });

    await expect(comTravaEntreAbas("fila", false, passada)).rejects.toThrow(
      "falhou no meio",
    );
    expect(passada).toHaveBeenCalledTimes(1);
    expect(solto).toBe(true);
  });

  it("navegador recusa o pedido sem rodar nada: roda a passada direto, uma vez", async () => {
    instalarLocks(async () => {
      throw new DOMException("sem locks aqui", "SecurityError");
    });
    const passada = vi.fn(async () => 42);

    expect(await comTravaEntreAbas("fila", -1, passada)).toBe(42);
    expect(passada).toHaveBeenCalledTimes(1);
  });

  it("com prazo: passada travada solta o lock no prazo, e quem a chamou continua com a promessa dela", async () => {
    vi.useFakeTimers();
    let soltoEm: number | null = null;
    const inicio = Date.now();
    instalarLocks(async (_n, _o, cb) => {
      try {
        return await cb({ name: "x" });
      } finally {
        soltoEm = Date.now() - inicio;
      }
    });
    let terminar: (v: number) => void = () => {};
    const passada = () =>
      new Promise<number>((resolve) => {
        terminar = resolve;
      });

    const chamada = comTravaEntreAbas("fila", -1, passada, 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(soltoEm).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(soltoEm).toBe(5_000);

    // A passada orfã termina depois e o chamador recebe o resultado DELA.
    terminar(7);
    expect(await chamada).toBe(7);
  });

  it("com prazo: passada que termina antes não deixa timer pendente", async () => {
    vi.useFakeTimers();
    instalarLocks(async (_n, _o, cb) => cb({ name: "x" }));

    expect(await comTravaEntreAbas("fila", -1, async () => 1, 5_000)).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
