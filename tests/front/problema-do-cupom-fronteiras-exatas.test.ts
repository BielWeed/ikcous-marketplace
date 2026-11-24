// Fronteiras exatas de `problemaDoCupom` (o aviso de campanha confere o cupom
// citado contra as MESMAS regras do servidor). Achado por mutação, 24/11/2026:
// trocar `<=` por `<` na validade passava com a suíte inteira verde, e o cupom
// que vence NO INSTANTE de agora deixava a campanha sair como se valesse — o
// servidor (`valid_until > now()`) já o recusa. Mesma conta no último uso e
// no cupom cuja coluna `active` veio nula (cupom-do-banco trata nulo como
// ligado).
import { type CupomDaLoja, problemaDoCupom } from "@/lib/modelos-de-campanha";
import { describe, expect, it } from "vitest";

describe("problemaDoCupom — o instante exato e o último uso", () => {
  const agora = new Date("2026-10-14T12:00:00.000Z");
  const bom: CupomDaLoja = {
    code: "VERAO10",
    active: true,
    valid_until: null,
    usage_limit: null,
    usage_count: 0,
  };
  const problema = (extra: Partial<CupomDaLoja>) =>
    problemaDoCupom("VERAO10", [{ ...bom, ...extra }], agora);

  it("vence no ms exato de `valid_until`; esgota no último uso; `active` nulo é ligado", () => {
    // Validade: 1 ms antes de vencer vale, no ms exato e depois já venceu.
    expect(problema({ valid_until: "2026-10-14T12:00:00.001Z" })).toBeNull();
    expect(problema({ valid_until: "2026-10-14T12:00:00.000Z" })).toBe(
      "vencido",
    );
    expect(problema({ valid_until: "2026-10-14T11:59:59.999Z" })).toBe(
      "vencido",
    );

    // Limite 5: o 4º uso deixa vaga, no 5º esgotou; contagem ausente = zero.
    expect(problema({ usage_limit: 5, usage_count: 4 })).toBeNull();
    expect(problema({ usage_limit: 5, usage_count: 5 })).toBe("esgotado");
    expect(problema({ usage_limit: 1, usage_count: null })).toBeNull();

    // Só `active: false` desliga.
    expect(problema({ active: false })).toBe("desativado");
    expect(problema({ active: null })).toBeNull();
  });
});
