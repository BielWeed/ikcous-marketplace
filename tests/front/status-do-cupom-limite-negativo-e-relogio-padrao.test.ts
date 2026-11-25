// Duas bordas que ficavam sem teste em `status-do-cupom`:
//
//  1. Teto de usos NEGATIVO é "sem limite", igual a 0/ausente (o checkout só
//     esgota com `usage_limit > 0`). Trocar `!(usageLimit > 0)` por
//     `usageLimit === 0` marcava como "Esgotado" um cupom com limite -1 — e
//     nenhum teste usava limite negativo.
//  2. Sem o argumento `agora`, a conferência usa o relógio de VERDADE. Todos os
//     testes antigos passavam a data por fora; trocar o padrão por uma data
//     fixa no passado deixava nenhum cupom vencer na tela, e ninguém via.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cupomEstaEsgotado,
  cupomEstaExpirado,
  rotuloDoCupom,
} from "@/utils/status-do-cupom";

describe("cupomEstaEsgotado — teto inválido nunca esgota", () => {
  it("teto negativo conta como sem limite, mesmo com usos acima dele", () => {
    expect(cupomEstaEsgotado(-1, 0)).toBe(false);
    expect(cupomEstaEsgotado(-5, 3)).toBe(false);
  });

  it("teto que não é número (NaN) não esgota", () => {
    expect(cupomEstaEsgotado(Number.NaN, 7)).toBe(false);
  });

  it("o rótulo de um cupom ligado com teto negativo é Ativo", () => {
    expect(rotuloDoCupom({ active: true, usageLimit: -1, usageCount: 4 })).toBe(
      "Ativo",
    );
  });
});

describe("cupomEstaExpirado e rotuloDoCupom — sem `agora`, vale o relógio atual", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("validade de 1 ms atrás já venceu; a do instante exato também; a de 1 ms à frente não", () => {
    expect(cupomEstaExpirado("2026-06-15T11:59:59.999Z")).toBe(true);
    expect(cupomEstaExpirado("2026-06-15T12:00:00.000Z")).toBe(true);
    expect(cupomEstaExpirado("2026-06-15T12:00:00.001Z")).toBe(false);
  });

  it("o rótulo usa o relógio atual: ligado e vencido é Expirado, ligado e no prazo é Ativo", () => {
    expect(
      rotuloDoCupom({ active: true, validUntil: "2026-06-14T23:59:59.999Z" }),
    ).toBe("Expirado");
    expect(
      rotuloDoCupom({ active: true, validUntil: "2026-06-16T02:59:59.999Z" }),
    ).toBe("Ativo");
  });
});
