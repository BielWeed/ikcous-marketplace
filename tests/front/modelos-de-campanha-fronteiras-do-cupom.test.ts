// O aviso da lojista cita um cupom ("Use o cupom BEMVINDO"). Antes de enviar, o
// painel confere se a cliente conseguiria usá-lo. Estes testes prendem os
// LIMITES exatos dessa conferência — onde um "<" no lugar de "<=" (ou o tamanho
// mínimo do código) mudaria a decisão sem que nenhum outro teste percebesse.
import { describe, expect, it } from "vitest";

import {
  type CupomDaLoja,
  codigosDeCupomCitados,
  problemaDoCupom,
} from "@/lib/modelos-de-campanha";

const cupom = (extra: Partial<CupomDaLoja> = {}): CupomDaLoja => ({
  code: "VERAO10",
  active: true,
  valid_until: null,
  usage_limit: null,
  usage_count: 0,
  ...extra,
});

describe("problemaDoCupom — o instante exato do vencimento", () => {
  const agora = new Date("2026-11-24T15:00:00.000Z");

  it("no instante exato em que o cupom vence, ele JÁ está vencido", () => {
    const venceAgora = cupom({ valid_until: "2026-11-24T15:00:00.000Z" });
    expect(problemaDoCupom("VERAO10", [venceAgora], agora)).toBe("vencido");
  });

  it("um milissegundo antes de vencer ainda serve, e um depois já não serve", () => {
    const venceJaJa = cupom({ valid_until: "2026-11-24T15:00:00.001Z" });
    const venceuHa1ms = cupom({ valid_until: "2026-11-24T14:59:59.999Z" });
    expect(problemaDoCupom("VERAO10", [venceJaJa], agora)).toBeNull();
    expect(problemaDoCupom("VERAO10", [venceuHa1ms], agora)).toBe("vencido");
  });
});

describe("codigosDeCupomCitados — o menor código que vale e o hífen solto no fim", () => {
  it("um código de EXATAMENTE 3 caracteres é citação de cupom", () => {
    expect(codigosDeCupomCitados("Use o cupom ABC hoje")).toEqual(["ABC"]);
    expect(codigosDeCupomCitados("Use o cupom A1B")).toEqual(["A1B"]);
  });

  it("um código de 2 caracteres não é citação (é palavra solta em maiúsculas)", () => {
    expect(codigosDeCupomCitados("cupom AB")).toEqual([]);
  });

  it("o hífen ou sublinhado que sobra no fim sai do código, e o que resta ainda conta se tiver 3", () => {
    // "ABC-" → "ABC" (3 caracteres: vale)
    expect(codigosDeCupomCitados("Use o cupom ABC- e aproveite")).toEqual([
      "ABC",
    ]);
    // "AB-" → "AB" (2 caracteres: o resto não chega a 3, não vale)
    expect(codigosDeCupomCitados("Use o cupom AB- e aproveite")).toEqual([]);
  });

  it("o mesmo código citado duas vezes (título e corpo) aparece uma vez só", () => {
    expect(
      codigosDeCupomCitados("Cupom VERAO10 só hoje", "Digite o cupom VERAO10"),
    ).toEqual(["VERAO10"]);
  });
});
