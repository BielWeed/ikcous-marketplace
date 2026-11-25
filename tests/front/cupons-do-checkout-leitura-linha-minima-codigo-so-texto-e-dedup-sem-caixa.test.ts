// Achado por mutação, 25/11/2026, em `lerCuponsDoCheckout` (a leitura defensiva
// da resposta da RPC `cupons_do_checkout`). Cinco mudanças de uma linha passavam
// verdes porque os testes sempre mandavam a linha COMPLETA e o código em
// maiúsculas no primeiro cupom:
//   · valor padrão de mínimo, falta ou desconto trocado de 0 para 1 (uma linha só
//     com código, tipo e valor passaria a prometer "falta R$ 1" ou "R$ 1 OFF");
//   · código que não é texto (número) aceito em vez de descartado;
//   · `vistos.add(codigo)` sem maiúscula: "verao10" seguido de "VERAO10" mostrava
//     o MESMO cupom duas vezes no checkout;
//   · `valido_ate` numérico (ou de outro tipo) aceito como prazo: o cartão
//     chamaria `new Date(1893456000000)` e mostraria uma validade inventada.
// Só dados fictícios.
import { lerCuponsDoCheckout } from "@/lib/cupons-do-checkout";
import { describe, expect, it } from "vitest";

describe("lerCuponsDoCheckout — linha mínima e tipos errados", () => {
  it("só código, tipo e valor: tudo o mais é zero, falso ou sem prazo", () => {
    expect(
      lerCuponsDoCheckout([{ codigo: "MIN", tipo: "fixed", valor: 5 }]),
    ).toEqual([
      {
        codigo: "MIN",
        tipo: "fixed",
        valor: 5,
        minimo: 0,
        validoAte: null,
        exclusivo: false,
        aplica: false,
        falta: 0,
        desconto: 0,
      },
    ]);
  });

  it("mínimo, falta e desconto de tipo errado (texto solto, objeto) também valem zero", () => {
    const [cupom] = lerCuponsDoCheckout([
      {
        codigo: "TIPOS",
        tipo: "percentage",
        valor: 10,
        minimo: "abc",
        falta: {},
        desconto: null,
      },
    ]);
    expect(cupom.minimo).toBe(0);
    expect(cupom.falta).toBe(0);
    expect(cupom.desconto).toBe(0);
  });

  it("código que não é texto é descartado, não convertido", () => {
    expect(
      lerCuponsDoCheckout([
        { codigo: 123, tipo: "fixed", valor: 5 },
        { codigo: null, tipo: "fixed", valor: 5 },
        { codigo: ["A"], tipo: "fixed", valor: 5 },
      ]),
    ).toEqual([]);
  });

  it("prazo que não é texto de data vira 'sem prazo'", () => {
    const [numerico, objeto] = lerCuponsDoCheckout([
      { codigo: "NUM", tipo: "fixed", valor: 5, valido_ate: 1893456000000 },
      { codigo: "OBJ", tipo: "fixed", valor: 5, valido_ate: {} },
    ]);
    expect(numerico.validoAte).toBeNull();
    expect(objeto.validoAte).toBeNull();
  });
});

describe("lerCuponsDoCheckout — o mesmo código em outra caixa é o mesmo cupom", () => {
  it("minúscula primeiro e maiúscula depois: fica só o primeiro", () => {
    const cupons = lerCuponsDoCheckout([
      { codigo: "verao10", tipo: "percentage", valor: 10 },
      { codigo: "VERAO10", tipo: "fixed", valor: 5 },
      { codigo: "Verao10", tipo: "fixed", valor: 7 },
    ]);
    expect(cupons.map((c) => c.codigo)).toEqual(["verao10"]);
    expect(cupons[0].tipo).toBe("percentage");
  });

  it("maiúscula primeiro e minúscula depois: também fica só o primeiro", () => {
    const cupons = lerCuponsDoCheckout([
      { codigo: "VERAO10", tipo: "percentage", valor: 10 },
      { codigo: "verao10", tipo: "fixed", valor: 5 },
    ]);
    expect(cupons.map((c) => c.codigo)).toEqual(["VERAO10"]);
  });
});
