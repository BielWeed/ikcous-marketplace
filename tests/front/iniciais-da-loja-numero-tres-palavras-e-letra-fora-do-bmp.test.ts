// A sigla do avatar da loja (`src/lib/iniciais-da-loja.ts`): o teste da reserva
// só trazia nomes de letras comuns. Bordas que ficaram sem prova:
//   · número conta como letra da sigla ("Loja 2" → "L2", "24h" → "24");
//   · a sigla tem NO MÁXIMO duas letras, mesmo com três palavras no nome;
//   · letra fora do alfabeto básico do Unicode (fonte matemática, ocupa dois
//     "pedaços" de texto) não é cortada ao meio, nem na loja de uma palavra só
//     nem na de várias palavras.
import { iniciaisDaLoja } from "@/lib/iniciais-da-loja";
import { describe, expect, it } from "vitest";

describe("iniciaisDaLoja — número, três palavras e letra fora do alfabeto básico", () => {
  it("número vale como letra: a segunda palavra pode ser um número", () => {
    expect(iniciaisDaLoja("Loja 2")).toBe("L2");
    expect(iniciaisDaLoja("Moda 24h")).toBe("M2");
  });

  it("nome de uma palavra só com número: as duas primeiras letras/dígitos", () => {
    expect(iniciaisDaLoja("24horas")).toBe("24");
    expect(iniciaisDaLoja("A1B2")).toBe("A1");
  });

  it("só dígitos no nome também vira sigla", () => {
    expect(iniciaisDaLoja("123")).toBe("12");
    expect(iniciaisDaLoja("7 8")).toBe("78");
  });

  it("três palavras ou mais: só as duas primeiras entram na sigla", () => {
    expect(iniciaisDaLoja("Savy Collection Brasil")).toBe("SC");
    expect(iniciaisDaLoja("a b c d e")).toBe("AB");
  });

  it("uma palavra só: duas letras, nunca três", () => {
    expect(iniciaisDaLoja("Savy")).toBe("SA");
    expect(iniciaisDaLoja("Sav")).toBe("SA");
  });

  it("letra de dois 'pedaços' de texto numa palavra só não é cortada ao meio", () => {
    // U+1D4D0 e U+1D4D1: letras de fonte matemática, fora do alfabeto básico.
    const sigla = iniciaisDaLoja("\u{1d4d0}\u{1d4d1}\u{1d4d2}");
    expect(Array.from(sigla)).toEqual(["\u{1d4d0}", "\u{1d4d1}"]);
    expect(sigla.length).toBe(4);
  });

  it("letra de dois 'pedaços' no começo de cada palavra não é cortada ao meio", () => {
    const sigla = iniciaisDaLoja("\u{1d4d0}lfa \u{1d4d1}eta");
    expect(Array.from(sigla)).toEqual(["\u{1d4d0}", "\u{1d4d1}"]);
    expect(() => encodeURIComponent(sigla)).not.toThrow();
  });

  it("pontuação e espaços sobrando não entram na sigla", () => {
    expect(iniciaisDaLoja("  --Savy!!   &   Collection  ")).toBe("SC");
    expect(iniciaisDaLoja("D'Ávila")).toBe("DÁ");
  });
});
