// Achado por mutação, 25/11/2026, em `erroDaFaixaDeCepLocal`: a dica "faltou a
// vírgula entre dois CEPs" (`"separador"`) só deve aparecer quando CADA CEP colado
// tem 8 dígitos, e vale para qualquer espaçamento entre eles. Três mudanças de
// uma linha passavam verdes:
//   · `every` -> `some` (bastava UM dos CEPs ter 8 dígitos);
//   · `=== 8` -> `>= 8` (CEP com 9 dígitos contava como completo);
//   · `split(/\s+/)` -> `split(" ")` (dois espaços ou uma tabulação entre os CEPs
//     criavam um "CEP" vazio e a dica de vírgula sumia).
// Resposta errada aqui manda a lojista corrigir a coisa errada: a dica de vírgula
// num CEP com dígito sobrando faz ela inserir uma vírgula e o erro continuar.
import { erroDaFaixaDeCepLocal } from "@/lib/cep-local";
import { describe, expect, it } from "vitest";

describe("erroDaFaixaDeCepLocal — dois CEPs colados sem vírgula", () => {
  it("dois CEPs de 8 dígitos separados por espaço: falta a vírgula", () => {
    expect(erroDaFaixaDeCepLocal("01310100 01310200")).toBe("separador");
  });

  it("espaço duplo ou tabulação entre os CEPs também é falta de vírgula", () => {
    expect(erroDaFaixaDeCepLocal("01310100  01310200")).toBe("separador");
    expect(erroDaFaixaDeCepLocal("01310100\t01310200")).toBe("separador");
    expect(erroDaFaixaDeCepLocal("  01310100   01310200  ")).toBe("separador");
  });

  it("se um dos dois tem dígito demais, o problema é o dígito, não a vírgula", () => {
    expect(erroDaFaixaDeCepLocal("01310100 013101000")).toBe("digitos-demais");
    expect(erroDaFaixaDeCepLocal("013101000 01310100")).toBe("digitos-demais");
    expect(erroDaFaixaDeCepLocal("013101000 013102000")).toBe("digitos-demais");
  });

  it("CEPs com pontos e hífen entre os dígitos contam pelos DÍGITOS: 8 cada, falta a vírgula", () => {
    expect(erroDaFaixaDeCepLocal("01.310-100 01.310-200")).toBe("separador");
    expect(erroDaFaixaDeCepLocal("01.310.100 01.310.200")).toBe("separador");
  });

  it("se um dos dois tem dígito de menos, também não é falta de vírgula", () => {
    expect(erroDaFaixaDeCepLocal("01310100 0131020")).toBe("digitos-demais");
  });
});
