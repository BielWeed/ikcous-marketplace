// O estouro de prazo é identificado no código por `instanceof PrazoEsgotado`
// (MercadoPagoSection, useAddresses, AuthContext...), mas é o `name` que
// aparece no relatório de erro e no log: "PrazoEsgotado: Prazo de 8000 ms
// esgotado" se agrupa e se busca; "Error: ..." some no meio de qualquer outro
// erro. Trocar o `name` não derrubava nenhum teste.
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrazoEsgotado, comPrazo } from "@/utils/com-prazo";

describe("PrazoEsgotado — identidade do erro", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("é um Error com nome próprio, mensagem com o prazo e o prazo guardado", () => {
    const erro = new PrazoEsgotado(1500);

    expect(erro).toBeInstanceOf(Error);
    expect(erro).toBeInstanceOf(PrazoEsgotado);
    expect(erro.name).toBe("PrazoEsgotado");
    expect(erro.message).toBe("Prazo de 1500 ms esgotado");
    expect(erro.prazoMs).toBe(1500);
    expect(String(erro)).toBe("PrazoEsgotado: Prazo de 1500 ms esgotado");
  });

  it("o erro que comPrazo rejeita no estouro carrega esse mesmo nome e o prazo pedido", async () => {
    vi.useFakeTimers();
    const nuncaResponde = new Promise<string>(() => {});

    const resultado = comPrazo(nuncaResponde, 250);
    const capturado = resultado.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(250);
    const erro = await capturado;

    expect(erro).toBeInstanceOf(PrazoEsgotado);
    expect((erro as PrazoEsgotado).name).toBe("PrazoEsgotado");
    expect((erro as PrazoEsgotado).prazoMs).toBe(250);
  });
});
