// Bordas da conta do troco do balcão (`src/lib/troco-do-balcao.ts`) que a
// suíte de `troco-do-balcao-conta.test.ts` deixava passar por cima:
//
//  - a nota de R$ 200 É sugerida quando o total fica logo abaixo de uma
//    centena (R$ 99,99 sugere R$ 100 e R$ 200: as demais notas dão todas R$ 100);
//  - o texto do campo é aparado antes de virar centavos (espaço colado do
//    teclado ou do WhatsApp não pode virar "campo vazio");
//  - total acima do inteiro seguro não gera sugestão com número arredondado.
import { centavosDoTextoEmReais, sugerirNotas } from "@/lib/troco-do-balcao";
import { describe, expect, it } from "vitest";

describe("sugerirNotas — a nota de R$ 200 entra quando as outras empatam", () => {
  it("R$ 99,99 sugere R$ 100 e R$ 200 (5, 10, 20, 50 e 100 caem todas em R$ 100)", () => {
    expect(sugerirNotas(9999)).toEqual([10000, 20000]);
  });

  it("R$ 199,99 tem uma sugestão só: todas as notas, inclusive a de 200, dão R$ 200", () => {
    expect(sugerirNotas(19999)).toEqual([20000]);
  });
});

describe("sugerirNotas — total que não é número seguro", () => {
  it("um centavo acima do maior inteiro seguro não sugere nada", () => {
    expect(sugerirNotas(Number.MAX_SAFE_INTEGER + 1)).toEqual([]);
  });

  it("o maior inteiro seguro ainda é um total válido (não é barrado à toa)", () => {
    expect(sugerirNotas(Number.MAX_SAFE_INTEGER).length).toBeGreaterThan(0);
  });
});

describe("centavosDoTextoEmReais — espaços nas pontas", () => {
  it("apara o texto antes de ler o valor", () => {
    expect(centavosDoTextoEmReais("  50.00 ")).toBe(5000);
    expect(centavosDoTextoEmReais(" 137")).toBe(13700);
    expect(centavosDoTextoEmReais("0.05\t")).toBe(5);
  });

  it("só espaço continua sendo campo vazio", () => {
    expect(centavosDoTextoEmReais("   ")).toBeNull();
  });
});
