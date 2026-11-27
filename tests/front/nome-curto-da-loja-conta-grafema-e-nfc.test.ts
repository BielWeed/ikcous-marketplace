// O rótulo do ícone instalado conta o que a pessoa VÊ como um caractere.
// Emoji composto (pessoa + ZWJ + objeto, como "👩‍🍳") são 3 pontos de código e
// um desenho só; contado por ponto de código, "Brigaderia👩‍🍳" (11 na tela)
// passava de 12 e o corte partia o emoji no meio. E o mesmo nome digitado com
// acento separado (NFD, como alguns teclados e colagens mandam) contava mais
// que o mesmo nome em NFC e perdia uma palavra.
import {
  LIMITE_DO_NOME_CURTO,
  nomeCurtoDaLoja,
} from "@/config/nomeCurtoDaLoja";
import { describe, expect, it } from "vitest";

// Mulher + ZWJ + panela: um grafema, três pontos de código.
const COZINHEIRA = "\u{1F469}‍\u{1F373}";

describe("nomeCurtoDaLoja — conta grafema e ignora a forma do acento", () => {
  it("'Brigaderia👩‍🍳' tem 11 grafemas e fica inteiro no limite de 12", () => {
    const nome = `Brigaderia${COZINHEIRA}`;
    expect(Array.from(nome)).toHaveLength(13);
    expect(nomeCurtoDaLoja(nome)).toBe(nome);
  });

  it("corte da primeira palavra nunca parte emoji composto", () => {
    // 12 letras + o emoji = 13 grafemas: o corte cai ANTES do emoji inteiro.
    expect(nomeCurtoDaLoja(`Brigaderiaxx${COZINHEIRA}`)).toBe("Brigaderiaxx");
    // Só emojis compostos: 12 deles, cada um inteiro.
    const cortado = nomeCurtoDaLoja(COZINHEIRA.repeat(13));
    expect(cortado).toBe(COZINHEIRA.repeat(LIMITE_DO_NOME_CURTO));
  });

  it("'Ateliê Café' em NFD conta como em NFC (11) e sai inteiro, em NFC", () => {
    const nfc = "Ateliê Café".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(Array.from(nfd)).toHaveLength(13);
    expect(nomeCurtoDaLoja(nfd)).toBe(nfc);
    expect(nomeCurtoDaLoja(nfc)).toBe(nfc);
  });
});
