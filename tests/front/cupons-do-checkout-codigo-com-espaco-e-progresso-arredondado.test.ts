// Fronteiras da lista de cupons do checkout que passavam com a suíte inteira
// verde (achadas por mutação, 24/11/2026):
//  - tirar o `trim()` do código: o servidor devolvendo "  VITRINE10 " mostrava
//    o código com espaço no cartão, mandava o espaço ao tocar em "Aplicar"
//    (cupom "inexistente") e deixava passar o código só de espaços;
//  - trocar o arredondamento da barra do "faltam R$ X" (`Math.round`) por
//    piso ou teto: a barra dizia 66% ou 34% onde a conta diz 67% e 33%.
// DINHEIRO: valores fictícios, só o texto/porcentagem que a cliente lê.
import {
  lerCuponsDoCheckout,
  progressoAteOMinimo,
} from "@/lib/cupons-do-checkout";
import { describe, expect, it } from "vitest";

const linha = (extra: Record<string, unknown> = {}) => ({
  codigo: "VITRINE10",
  tipo: "percentage",
  valor: 10,
  minimo: 100,
  valido_ate: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto: 12,
  ...extra,
});

describe("lerCuponsDoCheckout — espaço em volta do código", () => {
  it("o código perde o espaço das pontas: é o que aparece no cartão e vai ao 'Aplicar'", () => {
    const [c] = lerCuponsDoCheckout([linha({ codigo: "  VITRINE10 \n" })]);
    expect(c.codigo).toBe("VITRINE10");
  });

  it("código só de espaços é descartado, como o código vazio", () => {
    expect(lerCuponsDoCheckout([linha({ codigo: "   " })])).toEqual([]);
  });

  it("'VITRINE10' e ' vitrine10 ' são o mesmo cupom (não repete no cartão)", () => {
    const lidos = lerCuponsDoCheckout([
      linha(),
      linha({ codigo: " vitrine10 " }),
    ]);
    expect(lidos.map((c) => c.codigo)).toEqual(["VITRINE10"]);
  });
});

describe("progressoAteOMinimo — arredonda ao inteiro mais próximo", () => {
  it("2/3 do mínimo vira 67% (nem 66 de piso)", () => {
    // minimo 3, faltando 1: o carrinho já cobre 2 de 3 = 66,67%.
    expect(progressoAteOMinimo({ minimo: 3, falta: 1 })).toBe(67);
  });

  it("1/3 do mínimo vira 33% (nem 34 de teto)", () => {
    expect(progressoAteOMinimo({ minimo: 3, falta: 2 })).toBe(33);
  });
});
