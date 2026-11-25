// Bordas de `relerOCarrinhoComTeto` (`src/lib/reler-o-carrinho-com-teto.ts`)
// que o teste do módulo não pisava:
//   · o teto que o chamador passa VALE (o teste antigo só usava o padrão), tanto
//     para encurtar quanto para alongar a espera;
//   · a leitura que falha deixa rastro no console, com o erro original: sem ele,
//     "o carrinho não atualizou" ficaria sem pista nenhuma.
import { relerOCarrinhoComTeto } from "@/lib/reler-o-carrinho-com-teto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("relerOCarrinhoComTeto — teto do chamador e rastro do erro", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("teto menor que o padrão: libera nele, não nos 3 s do padrão", async () => {
    const reler = vi.fn(() => new Promise<void>(() => {}));
    let liberado = false;
    const pronto = relerOCarrinhoComTeto(reler, 500).then((r) => {
      liberado = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(liberado).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pronto).toBe("estourou");
  });

  it("teto maior que o padrão: continua esperando depois dos 3 s", async () => {
    let terminar: () => void = () => {};
    const reler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        }),
    );
    let desfecho: string | undefined;
    const pronto = relerOCarrinhoComTeto(reler, 10_000).then((r) => {
      desfecho = r;
      return r;
    });

    await vi.advanceTimersByTimeAsync(9_000);
    expect(desfecho).toBeUndefined();

    terminar();
    expect(await pronto).toBe("relido");
  });

  it("teto zero libera na hora, sem esperar uma leitura que nunca volta", async () => {
    const reler = vi.fn(() => new Promise<void>(() => {}));
    const pronto = relerOCarrinhoComTeto(reler, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(await pronto).toBe("estourou");
  });

  it("a leitura que falha registra o erro original no console", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const causa = new Error("rede caiu");

    await expect(
      relerOCarrinhoComTeto(async () => {
        throw causa;
      }),
    ).resolves.toBe("falhou");

    expect(erro).toHaveBeenCalledTimes(1);
    expect(erro.mock.calls[0][0]).toContain("Releitura do carrinho falhou");
    expect(erro.mock.calls[0][1]).toBe(causa);
  });

  it("a leitura que dá certo não escreve nada no console", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await relerOCarrinhoComTeto(async () => {});
    expect(erro).not.toHaveBeenCalled();
  });
});
