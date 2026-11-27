// Reler a configuração da loja quando o frete mudou com o checkout aberto
// (27/11/2026). A peça pede só a config (`onlyConfig`), espera com teto e
// nunca prende a cliente: porta ausente, leitura que falha ou rede pendurada
// liberam.
import { relerAConfigDaLoja } from "@/lib/reler-config-da-loja";
import { TETO_DA_RELEITURA_DO_CARRINHO_MS } from "@/lib/reler-o-carrinho-com-teto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("relerAConfigDaLoja", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pede SÓ a configuração e diz que leu", async () => {
    const refresh = vi.fn(async () => {});

    await expect(relerAConfigDaLoja(refresh)).resolves.toBe("relido");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ onlyConfig: true });
  });

  it("sem a porta de releitura: segue sem reler e sem quebrar", async () => {
    await expect(relerAConfigDaLoja(undefined)).resolves.toBe("falhou");
  });

  it("a releitura falha: libera e diz que falhou, sem rejeitar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refresh = vi.fn(async () => {
      throw new Error("rede fora");
    });

    await expect(relerAConfigDaLoja(refresh)).resolves.toBe("falhou");
  });

  it("a releitura pendura: o teto libera", async () => {
    const refresh = vi.fn(() => new Promise<void>(() => {}));

    const pronto = relerAConfigDaLoja(refresh);
    await vi.advanceTimersByTimeAsync(TETO_DA_RELEITURA_DO_CARRINHO_MS);

    await expect(pronto).resolves.toBe("estourou");
  });
});
