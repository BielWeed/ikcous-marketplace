// Caça por mutação nos utilitários puros: `cortarTexto` (títulos de banner e
// textos de vitrine). Os testes que já existem não pegavam duas trocas:
//   - tirar o `trimEnd()` (sobrava espaço antes do "…" quando o texto tem
//     espaço duplo no ponto do corte);
//   - trocar o corte por LETRA INTEIRA (Intl.Segmenter) pelo corte por ponto de
//     código (Array.from): um emoji com tom de pele, uma família de emojis ou
//     uma letra com acento "solto" eram partidos ao meio e a vitrine mostrava
//     o emoji sem o tom, ou a letra sem o acento, seguida de "…".
import { cortarTexto } from "@/lib/cortar-texto";
import { describe, expect, it } from "vitest";

describe("cortarTexto — letra composta nunca é partida", () => {
  it("emoji com tom de pele (4 unidades) que não cabe sai inteiro, nunca só a mão amarela", () => {
    const mao = "👍🏽"; // 👍 + modificador de tom = 4 unidades de texto
    expect(mao).toHaveLength(4);

    // 56 letras + o emoji ocupariam 60, e só 59 cabem (1 fica para o "…").
    const saida = cortarTexto(`${"a".repeat(56)}${mao}bbbb`, 60);

    expect(saida).toBe(`${"a".repeat(56)}…`);
    expect(saida).not.toContain("👍");
    expect(saida).not.toContain("🏽");
  });

  it("emoji com tom de pele que cabe é mantido inteiro", () => {
    const mao = "👍🏽";
    const saida = cortarTexto(
      `${"a".repeat(50)}${mao}bbbbbbbbbbbbbbbbbbbbbb`,
      60,
    );

    expect(saida).toContain(mao);
    expect(saida.endsWith("…")).toBe(true);
    expect(saida.length).toBeLessThanOrEqual(60);
  });

  it("emoji composto (família, 8 unidades) não vira só a primeira pessoa", () => {
    const familia = "👨‍👩‍👧"; // 3 pessoas ligadas por ZWJ
    expect(familia).toHaveLength(8);

    const saida = cortarTexto(`${"a".repeat(54)}${familia}bbbb`, 60);

    expect(saida).toBe(`${"a".repeat(54)}…`);
    expect(saida).not.toContain("👨");
  });

  it("letra com acento solto (e + sinal) não perde o acento no corte", () => {
    const eAgudo = "é"; // "é" decomposto = 2 unidades
    expect(eAgudo).toHaveLength(2);

    const saida = cortarTexto(`${"a".repeat(58)}${eAgudo}bb`, 60);

    // A letra inteira não cabe: sai sem ela, e não "e" sem o acento.
    expect(saida).toBe(`${"a".repeat(58)}…`);
  });
});

describe("cortarTexto — espaços no ponto do corte", () => {
  it("espaço duplo no ponto do corte não deixa espaço antes das reticências", () => {
    // O corte cai no meio da palavra seguinte e recua até o último espaço, que
    // é o segundo dos dois: o primeiro fica na ponta e quem o tira é o trimEnd.
    const nome = `${"a".repeat(57)}  ${"b".repeat(10)}`;

    const saida = cortarTexto(nome, 60);

    expect(saida).toBe(`${"a".repeat(57)}…`);
    expect(saida).not.toMatch(/\s…$/);
  });

  it("espaços no fim do trecho que cabe também são aparados", () => {
    const saida = cortarTexto(`${"a".repeat(20)}     ${"b".repeat(50)}`, 26);

    expect(saida).toBe(`${"a".repeat(20)}…`);
  });

  it("corte que cai exatamente numa fronteira de palavra mantém a última palavra inteira", () => {
    // 9 letras cabem ("aaaa bbbb") e o próximo caractere já é o espaço: não há
    // palavra partida, então não se recua para "aaaa…".
    expect(cortarTexto("aaaa bbbb cccc", 10)).toBe("aaaa bbbb…");
  });
});
