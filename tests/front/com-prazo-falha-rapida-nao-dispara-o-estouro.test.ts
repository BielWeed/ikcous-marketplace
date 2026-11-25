// `comPrazo` (`src/utils/com-prazo.ts`): o relógio é desarmado também quando a
// promessa FALHA antes do prazo. Se ele ficasse armado, passado o prazo ele
// chamaria `aoEstourar` num fluxo que já terminou com erro — e quem usa esse
// gancho para "não iniciar o upload de uma foto atrasada" marcaria o fluxo
// seguinte como estourado sem ter estourado. E o erro de prazo diz de quantos
// milissegundos era o prazo.
//
// Relógio de mentira: nenhum teste espera tempo real.
import { PrazoEsgotado, comPrazo } from "@/utils/com-prazo";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("comPrazo — falha rápida", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("promessa que falha antes do prazo não dispara aoEstourar depois do prazo", async () => {
    const aoEstourar = vi.fn<() => void>();
    const falha = new Error("boom");
    await expect(
      comPrazo(Promise.reject(falha), 1000, aoEstourar),
    ).rejects.toBe(falha);
    await vi.advanceTimersByTimeAsync(5000);
    expect(aoEstourar).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("promessa que responde antes do prazo também não dispara aoEstourar", async () => {
    const aoEstourar = vi.fn<() => void>();
    await expect(
      comPrazo(Promise.resolve("ok"), 1000, aoEstourar),
    ).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(5000);
    expect(aoEstourar).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("PrazoEsgotado — o que o erro diz", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("guarda o prazo em milissegundos e o escreve na mensagem", async () => {
    const capturado = comPrazo(new Promise<string>(() => {}), 1500).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(1500);
    const erro = await capturado;
    expect(erro).toBeInstanceOf(PrazoEsgotado);
    expect((erro as PrazoEsgotado).prazoMs).toBe(1500);
    expect((erro as PrazoEsgotado).message).toBe("Prazo de 1500 ms esgotado");
  });
});
