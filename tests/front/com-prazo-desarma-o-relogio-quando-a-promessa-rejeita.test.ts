// `comPrazo` (src/utils/com-prazo.ts): quando a promessa REJEITA dentro do
// prazo, o relógio é desarmado — a tela que falhou rápido não deixa um timer
// de 20 s correndo (e, no estouro, ele chamaria `aoEstourar` de uma operação
// que já acabou). O teste vizinho prova o caminho do sucesso e do estouro; este
// prova o da rejeição antes do prazo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { comPrazo } from "@/utils/com-prazo";

describe("comPrazo — rejeição dentro do prazo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("repassa a rejeição da promessa, não deixa timer pendente e nunca chama aoEstourar depois", async () => {
    const aoEstourar = vi.fn();
    const dela = new Error("falhou rápido");

    await expect(
      comPrazo(Promise.reject(dela), 20_000, aoEstourar),
    ).rejects.toBe(dela);

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(aoEstourar).not.toHaveBeenCalled();
  });
});
