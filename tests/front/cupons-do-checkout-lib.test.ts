// Frente B (28/09/2026): o texto que a cliente lê nos cartões de cupom e a
// leitura defensiva da RPC `cupons_do_checkout`.
import {
  descricaoDoCupom,
  destaqueDoCupom,
  lerCuponsDoCheckout,
  melhorCupom,
  progressoAteOMinimo,
  validadeDoCupom,
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

describe("lerCuponsDoCheckout", () => {
  it("lê a linha do contrato", () => {
    expect(lerCuponsDoCheckout([linha({ exclusivo: true })])).toEqual([
      {
        codigo: "VITRINE10",
        tipo: "percentage",
        valor: 10,
        minimo: 100,
        validoAte: null,
        exclusivo: true,
        aplica: true,
        falta: 0,
        desconto: 12,
      },
    ]);
  });

  it("descarta linha fora do contrato em vez de consertar", () => {
    const lidos = lerCuponsDoCheckout([
      null,
      "x",
      linha({ codigo: "" }),
      linha({ codigo: "TIPO", tipo: "frete" }),
      linha({ codigo: "ZERO", valor: 0 }),
      linha({ codigo: "NAN", valor: "abc" }),
      linha({ codigo: "OK", valor: "15.5", tipo: "fixed" }),
    ]);
    expect(lidos.map((c) => [c.codigo, c.valor])).toEqual([["OK", 15.5]]);
  });

  it("não repete código (maiúscula/minúscula) e não aceita não-array", () => {
    expect(
      lerCuponsDoCheckout([linha(), linha({ codigo: "vitrine10" })]),
    ).toHaveLength(1);
    expect(lerCuponsDoCheckout({ codigo: "X" })).toEqual([]);
    expect(lerCuponsDoCheckout(null)).toEqual([]);
  });

  it("exclusivo só com true de verdade; data inválida vira sem prazo", () => {
    const [c] = lerCuponsDoCheckout([
      linha({ exclusivo: "true", valido_ate: "não é data" }),
    ]);
    expect(c.exclusivo).toBe(false);
    expect(c.validoAte).toBeNull();
  });
});

describe("texto do cartão", () => {
  it("descrição legível com e sem mínimo", () => {
    expect(
      descricaoDoCupom({ tipo: "percentage", valor: 10, minimo: 100 }),
    ).toBe("10% OFF acima de R$ 100,00");
    expect(descricaoDoCupom({ tipo: "fixed", valor: 15, minimo: 0 })).toBe(
      "R$ 15,00 OFF em qualquer compra",
    );
    expect(
      descricaoDoCupom({ tipo: "percentage", valor: 12.5, minimo: 0 }),
    ).toBe("12,5% OFF em qualquer compra");
  });

  it("destaque curto do canhoto", () => {
    expect(destaqueDoCupom({ tipo: "percentage", valor: 10 })).toBe("10%");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 15 })).toBe("R$ 15");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 9.9 })).toBe("R$ 9,90");
  });

  it("validade no fuso de quem olha", () => {
    const agora = new Date(2026, 8, 28, 10, 0, 0);
    expect(validadeDoCupom(null, agora)).toBeNull();
    expect(
      validadeDoCupom(new Date(2026, 8, 28, 23, 59).toISOString(), agora),
    ).toBe("Vence hoje");
    expect(
      validadeDoCupom(new Date(2026, 8, 29, 23, 59).toISOString(), agora),
    ).toBe("Vence amanhã");
    expect(
      validadeDoCupom(new Date(2026, 9, 5, 23, 59).toISOString(), agora),
    ).toBe("Válido até 05/10");
    expect(
      validadeDoCupom(new Date(2027, 0, 2, 23, 59).toISOString(), agora),
    ).toBe("Válido até 02/01/2027");
  });
});

describe("melhorCupom e progresso", () => {
  const cupons = lerCuponsDoCheckout([
    linha({ codigo: "A", desconto: 10 }),
    linha({ codigo: "B", desconto: 25 }),
    linha({ codigo: "C", aplica: false, desconto: 0, falta: 30 }),
  ]);

  it("o que mais economiza entre os que valem", () => {
    expect(melhorCupom(cupons)).toBe("B");
  });

  it("um cupom só, ou nenhum valendo, não tem 'melhor'", () => {
    expect(melhorCupom(cupons.slice(0, 1))).toBeNull();
    expect(melhorCupom([cupons[2], cupons[2]])).toBeNull();
  });

  it("progresso até o mínimo, preso entre 0 e 100", () => {
    expect(progressoAteOMinimo({ minimo: 100, falta: 30 })).toBe(70);
    expect(progressoAteOMinimo({ minimo: 0, falta: 0 })).toBe(100);
    expect(progressoAteOMinimo({ minimo: 100, falta: 150 })).toBe(0);
  });
});
