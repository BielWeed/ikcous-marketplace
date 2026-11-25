// A frase de alcance da tela de Push ("Receberão: N aparelhos") quando a
// contagem AINDA NÃO foi medida (ou a medição falhou). Zero é uma afirmação
// forte ("ninguém vai receber"): sem medir, a tela mostra traço, nunca "0" e,
// pior, nunca o texto cru "null aparelhos". O teste que já existia cobria os
// números e o rótulo do botão de segmento, mas nenhum chamava a frase de
// alcance com "ainda não medido" — a verificação do `null` podia ser trocada
// por uma que nunca dispara e a lojista leria "null aparelhos" antes de enviar
// uma campanha.
import {
  rotuloDaContagem,
  textoDeAlcanceEmAparelhos,
} from "@/utils/contadores-de-push";
import { describe, expect, it } from "vitest";

describe("alcance em aparelhos quando a contagem não foi medida", () => {
  it("sem medição o alcance é um traço, não zero nem 'null'", () => {
    const frase = textoDeAlcanceEmAparelhos(null);

    expect(frase).toBe("— aparelhos");
    expect(frase).not.toMatch(/null|undefined|NaN/);
    expect(frase).not.toMatch(/^0 /);
  });

  it("zero MEDIDO é dito como zero (medir e achar ninguém é outra coisa)", () => {
    expect(textoDeAlcanceEmAparelhos(0)).toBe("0 aparelhos");
    expect(rotuloDaContagem(0)).toBe("0");
  });

  it("um aparelho fica no singular e dois no plural", () => {
    expect(textoDeAlcanceEmAparelhos(1)).toBe("1 aparelho");
    expect(textoDeAlcanceEmAparelhos(2)).toBe("2 aparelhos");
  });

  it("o rótulo do botão sem medição também é traço", () => {
    expect(rotuloDaContagem(null)).toBe("—");
  });
});
