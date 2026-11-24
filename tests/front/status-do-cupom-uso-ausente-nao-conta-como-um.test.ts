import { describe, expect, it } from "vitest";

import { cupomEstaEsgotado, rotuloDoCupom } from "@/utils/status-do-cupom";

// Caça por mutação em `cupomEstaEsgotado`: trocar o `usageCount ?? 0` por
// `?? 1` deixava os testes vizinhos verdes. Cupom de uso único (limite 1) cujo
// contador de usos ainda não chegou (ausente ou nulo) NÃO foi usado nenhuma vez:
// o selo tem de ser "Ativo", não "Esgotado".
const AGORA = new Date("2026-11-24T15:00:00.000Z");

describe("cupomEstaEsgotado — contador ausente conta como zero usos", () => {
  it("limite 1 com contador ausente ou nulo não está esgotado", () => {
    expect(cupomEstaEsgotado(1, undefined)).toBe(false);
    expect(cupomEstaEsgotado(1, null)).toBe(false);
  });

  it("limite 1 com 1 uso esgota (controle)", () => {
    expect(cupomEstaEsgotado(1, 1)).toBe(true);
  });

  it("o rótulo do cupom de uso único ainda sem contador é 'Ativo'", () => {
    expect(
      rotuloDoCupom({ active: true, usageLimit: 1, usageCount: null }, AGORA),
    ).toBe("Ativo");
    expect(rotuloDoCupom({ active: true, usageLimit: 1 }, AGORA)).toBe("Ativo");
  });
});
