// Frente B (28/09/2026): o texto que a cliente lê nos cartões de cupom e a
// leitura defensiva da RPC `cupons_do_checkout`.
import {
  descricaoDoCupom,
  destaqueDoCupom,
  lerCuponsDoCheckout,
  melhorCupom,
  porcentagem,
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
    // A casa decimal sai com vírgula; o painel usa a MESMA função (`porcentagem`).
    expect(porcentagem(12.5)).toBe("12,5%");
    expect(porcentagem(10)).toBe("10%");
    expect(porcentagem(0)).toBe("0%");
    expect(porcentagem(7.25)).toBe("7,25%");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 15 })).toBe("R$ 15");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 9.9 })).toBe("R$ 9,90");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 999.9 })).toBe("R$ 999,90");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 1000 })).toBe("R$ 1.000");
    expect(destaqueDoCupom({ tipo: "fixed", valor: 1299.9 })).toBe(
      "R$ 1.299,90",
    );
    expect(destaqueDoCupom({ tipo: "fixed", valor: 12345.6 })).toBe(
      "R$ 12.345,60",
    );
  });

  // Instantes UTC FIXOS: o calendário é o da loja (Brasília, UTC-3), não o do
  // aparelho — o teste tem de passar com TZ=UTC e com TZ=America/Noronha.
  it("validade no calendário de Brasília, não no do aparelho", () => {
    // 28/09 10:00 em Brasília.
    const agora = new Date("2026-09-28T13:00:00.000Z");
    expect(validadeDoCupom(null, agora)).toBeNull();
    // 28/09 23:59:59.999 em Brasília = 29/09 02:59 UTC.
    expect(validadeDoCupom("2026-09-29T02:59:59.999Z", agora)).toBe(
      "Vence hoje",
    );
    expect(validadeDoCupom("2026-09-30T02:59:59.999Z", agora)).toBe(
      "Vence amanhã",
    );
    expect(validadeDoCupom("2026-10-06T02:59:59.999Z", agora)).toBe(
      "Válido até 05/10",
    );
    expect(validadeDoCupom("2027-01-03T02:59:59.999Z", agora)).toBe(
      "Válido até 02/01/2027",
    );
  });

  it("às 22h de Brasília (já 'amanhã' em UTC) o cupom do dia ainda 'vence hoje'", () => {
    // 25/11 22:00 em Brasília = 26/11 01:00 UTC; o cupom vale até 25/11 23:59.
    const agora = new Date("2026-11-26T01:00:00.000Z");
    expect(validadeDoCupom("2026-11-26T02:59:59.999Z", agora)).toBe(
      "Vence hoje",
    );
    expect(validadeDoCupom("2026-11-27T02:59:59.999Z", agora)).toBe(
      "Vence amanhã",
    );
  });

  it("a virada de ano usa o ano de Brasília", () => {
    // 31/12/2026 22:00 em Brasília = 01/01/2027 01:00 UTC (ainda 2026 na loja).
    const agora = new Date("2027-01-01T01:00:00.000Z");
    expect(validadeDoCupom("2027-01-10T02:59:59.999Z", agora)).toBe(
      "Válido até 09/01/2027",
    );
    // 31/12 23:59:59.999 em Brasília (ainda não passou: 01/01 02:59 UTC).
    expect(validadeDoCupom("2027-01-01T02:59:59.999Z", agora)).toBe(
      "Vence hoje",
    );
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

  it("empate de desconto: a ordem da lista decide, fica o primeiro", () => {
    const empatados = lerCuponsDoCheckout([
      linha({ codigo: "A", desconto: 10 }),
      linha({ codigo: "B", desconto: 10 }),
    ]);
    expect(melhorCupom(empatados)).toBe("A");
    expect(melhorCupom([...empatados].reverse())).toBe("B");
  });

  it("progresso até o mínimo, preso entre 0 e 100", () => {
    expect(progressoAteOMinimo({ minimo: 100, falta: 30 })).toBe(70);
    expect(progressoAteOMinimo({ minimo: 0, falta: 0 })).toBe(100);
    expect(progressoAteOMinimo({ minimo: 100, falta: 150 })).toBe(0);
  });
});
