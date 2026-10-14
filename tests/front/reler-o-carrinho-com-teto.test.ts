// Reler o carrinho ANTES de levar a cliente até ele (14/10/2026).
//
// A recusa "Os valores do pedido mudaram. Atualize o carrinho..." leva a
// cliente ao carrinho, mas nada relia o catálogo: ela chegava lá com os MESMOS
// preços e levava a mesma recusa de novo. Esta peça é a espera que vem entre o
// toque e a navegação: refaz a leitura, mas NUNCA prende a cliente — rede
// pendurada ou leitura que falha não impedem que ela chegue ao carrinho.
import {
  TETO_DA_RELEITURA_DO_CARRINHO_MS,
  relerOCarrinhoComTeto,
} from "@/lib/reler-o-carrinho-com-teto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("relerOCarrinhoComTeto", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("espera a releitura terminar e diz que ela terminou", async () => {
    const ordem: string[] = [];
    const reler = vi.fn(async () => {
      ordem.push("lendo");
      await new Promise((r) => setTimeout(r, 400));
      ordem.push("lido");
    });

    const pronto = relerOCarrinhoComTeto(reler).then((r) => {
      ordem.push("liberado");
      return r;
    });
    await vi.advanceTimersByTimeAsync(400);

    expect(await pronto).toBe("relido");
    expect(ordem).toEqual(["lendo", "lido", "liberado"]);
    expect(reler).toHaveBeenCalledTimes(1);
  });

  it("rede PENDURADA: libera quando o teto estoura, sem esperar a leitura", async () => {
    const reler = vi.fn(() => new Promise<void>(() => {}));
    let liberado = false;
    const pronto = relerOCarrinhoComTeto(reler).then((r) => {
      liberado = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(TETO_DA_RELEITURA_DO_CARRINHO_MS - 1);
    expect(liberado).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pronto).toBe("estourou");
    expect(liberado).toBe(true);
  });

  it("o teto é curto: a cliente não espera mais que poucos segundos", () => {
    expect(TETO_DA_RELEITURA_DO_CARRINHO_MS).toBeGreaterThanOrEqual(1000);
    expect(TETO_DA_RELEITURA_DO_CARRINHO_MS).toBeLessThanOrEqual(5000);
  });

  it("releitura que FALHA: libera na hora e não propaga o erro", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const reler = vi.fn(async () => {
      throw new Error("rede caiu");
    });

    await expect(relerOCarrinhoComTeto(reler)).resolves.toBe("falhou");
    expect(reler).toHaveBeenCalledTimes(1);
    erro.mockRestore();
  });

  it("releitura que lança de forma SÍNCRONA (ação ausente): também libera", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const semAcao = undefined as unknown as () => Promise<unknown>;

    await expect(relerOCarrinhoComTeto(semAcao)).resolves.toBe("falhou");
    erro.mockRestore();
  });

  it("não deixa relógio pendente depois de terminar (nada vaza)", async () => {
    await relerOCarrinhoComTeto(async () => {});
    expect(vi.getTimerCount()).toBe(0);
  });
});
