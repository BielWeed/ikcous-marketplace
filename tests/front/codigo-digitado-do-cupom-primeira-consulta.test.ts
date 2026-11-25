// O CÓDIGO DO CUPOM COMO A CLIENTE DIGITOU — a PRIMEIRA consulta do checkout.
// `codigoDigitadoDoCupom` não tinha teste próprio: só o componente o chama, e
// nenhuma suíte do componente conferia o texto que sai. A versão normalizada
// (sem acento) segue de reserva; esta é a que vai primeiro ao servidor.
import { describe, expect, it } from "vitest";

import {
  codigoDigitadoDoCupom,
  normalizarCodigoDoCupom,
} from "@/lib/codigo-do-cupom";

describe("codigoDigitadoDoCupom", () => {
  it("tira os espaços das pontas", () => {
    expect(codigoDigitadoDoCupom("  PROMO10  ")).toBe("PROMO10");
  });

  it("passa para maiúsculas", () => {
    expect(codigoDigitadoDoCupom("promo10")).toBe("PROMO10");
  });

  it("NÃO tira o acento: um cupom antigo gravado com acento ainda tem de casar", () => {
    expect(codigoDigitadoDoCupom("verão10")).toBe("VERÃO10");
  });

  it("não mexe nos espaços do MEIO (isso é trabalho da versão normalizada)", () => {
    expect(codigoDigitadoDoCupom("verao 10")).toBe("VERAO 10");
    expect(normalizarCodigoDoCupom("verao 10")).toBe("VERAO10");
  });

  it("junta a letra com o acento colados separados (NFD) na forma composta (NFC)", () => {
    const colado = "verão10".normalize("NFD");
    expect(colado).not.toBe("verão10"); // premissa do teste: a entrada é mesmo decomposta
    const resultado = codigoDigitadoDoCupom(colado);
    expect(resultado).toBe("VERÃO10".normalize("NFC"));
    expect(resultado.length).toBe("VERÃO10".length);
  });
});
