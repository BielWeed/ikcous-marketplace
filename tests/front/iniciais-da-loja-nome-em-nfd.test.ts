// Nome da loja com o acento SEPARADO da letra (NFD, comum em texto colado):
// "É" vira "E" + acento combinante, e o acento (marca, não letra) partia a
// palavra em duas — "Élan Joias" saía "EL" em vez de "ÉJ". O nome vira NFC
// antes de achar as palavras, então a sigla é a mesma nas duas formas.
import { iniciaisDaLoja } from "@/lib/iniciais-da-loja";
import { describe, expect, it } from "vitest";

describe("iniciaisDaLoja — nome em NFD", () => {
  it("'Élan Joias' em NFD vira 'ÉJ', igual ao NFC", () => {
    const nfc = "Élan Joias".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(iniciaisDaLoja(nfd)).toBe("ÉJ".normalize("NFC"));
    expect(iniciaisDaLoja(nfc)).toBe("ÉJ".normalize("NFC"));
  });

  it("nome de uma palavra só em NFD leva as duas primeiras letras inteiras", () => {
    expect(iniciaisDaLoja("Ótica".normalize("NFD"))).toBe(
      "ÓT".normalize("NFC"),
    );
  });
});
