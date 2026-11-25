// A prévia do link (WhatsApp/Google) é montada por `resumoParaPrevia`
// (`src/lib/resumo-para-previa.ts`). O teste do módulo cobre o caminho feliz;
// aqui ficam as bordas que sobreviveram à caça por mutação:
//   · o teto padrão é de 200 pontos de código;
//   · linha só de traços/sublinhados é separador a partir de TRÊS, e só quando
//     é a linha INTEIRA ("Veja --- isso" é texto da lojista, não separador);
//   · título é "#" a "######" seguido de espaço; "#promo" no começo da linha é
//     hashtag e fica; linha indentada continua sendo título/lista/separador;
//   · o corte só recua até o espaço se isso não jogar fora metade ou mais do
//     que cabia; pontuação e restos de emoji composto não ficam pendurados
//     antes das reticências.
import { TAMANHO_DA_PREVIA, resumoParaPrevia } from "@/lib/resumo-para-previa";
import { describe, expect, it } from "vitest";

describe("teto padrão", () => {
  it("o teto padrão é de 200 pontos de código", () => {
    expect(TAMANHO_DA_PREVIA).toBe(200);
    const duzentos = "a".repeat(200);
    expect(resumoParaPrevia(duzentos)).toBe(duzentos);
    const cortado = resumoParaPrevia(`${duzentos}b`);
    expect(Array.from(cortado)).toHaveLength(200);
    expect(cortado).toBe(`${"a".repeat(199)}…`);
  });

  it("teto 1 devolve só as reticências quando há mais texto, e a letra quando cabe", () => {
    expect(resumoParaPrevia("abc", 1)).toBe("…");
    expect(resumoParaPrevia("a", 1)).toBe("a");
  });

  it("teto 2 guarda uma letra e as reticências", () => {
    expect(resumoParaPrevia("abc", 2)).toBe("a…");
  });
});

describe("separadores: só a linha inteira de 3 ou mais", () => {
  it.each(["---", "----------", "___", "______", "***", "*****"])(
    "a linha %s some",
    (linha) => {
      expect(
        resumoParaPrevia(`Antes
${linha}
Depois`),
      ).toBe("Antes Depois");
    },
  );

  it.each(["--", "__"])("a linha de dois '%s' é texto e fica", (dois) => {
    expect(resumoParaPrevia(`Antes\n${dois}\nDepois`)).toBe(
      `Antes ${dois} Depois`,
    );
  });

  it("traços no meio de uma frase não apagam a linha", () => {
    expect(resumoParaPrevia("Veja --- isso\nfim")).toBe("Veja --- isso fim");
    expect(resumoParaPrevia("a___b")).toBe("a___b");
    expect(resumoParaPrevia("tchau ___")).toBe("tchau ___");
  });

  it("separador com recuo também some", () => {
    expect(resumoParaPrevia("Antes\n   ---\nDepois")).toBe("Antes Depois");
  });
});

describe("títulos e listas", () => {
  it("de 1 a 6 cerquilhas com espaço são título e saem", () => {
    for (const marcas of ["#", "##", "###", "####", "#####", "######"]) {
      expect(resumoParaPrevia(`${marcas} Título`), marcas).toBe("Título");
    }
  });

  it("7 cerquilhas não são título", () => {
    expect(resumoParaPrevia("####### Título")).toBe("####### Título");
  });

  it("cerquilha colada na palavra, no começo da linha, é hashtag e fica", () => {
    expect(resumoParaPrevia("#promo hoje")).toBe("#promo hoje");
    expect(resumoParaPrevia("##promo")).toBe("##promo");
  });

  it("título com recuo continua sendo título", () => {
    expect(resumoParaPrevia("   ## Detalhes")).toBe("Detalhes");
  });

  it("marcador de lista só sai com espaço depois", () => {
    expect(resumoParaPrevia("- Capa dura")).toBe("Capa dura");
    expect(resumoParaPrevia("* Capa dura")).toBe("Capa dura");
    expect(resumoParaPrevia("-Capa dura")).toBe("-Capa dura");
    expect(resumoParaPrevia("-5% hoje")).toBe("-5% hoje");
  });

  it("item de lista com recuo continua sendo item", () => {
    expect(resumoParaPrevia("   - Capa dura")).toBe("Capa dura");
  });
});

describe("onde o corte cai", () => {
  it("espaço exatamente no meio do que cabia NÃO vira ponto de corte (corta seco)", () => {
    // max 9 -> cabem 8 pontos: "aaaa bbb"; o espaço está no índice 4 = metade.
    expect(resumoParaPrevia("aaaa bbbbbbbbbb", 9)).toBe("aaaa bbb…");
  });

  it("espaço antes da metade também não vira ponto de corte", () => {
    // cabem 8 pontos: "aaa bbbb"; espaço no índice 3, menos da metade.
    expect(resumoParaPrevia("aaa bbbbbbbbbb", 9)).toBe("aaa bbbb…");
  });

  it("espaço depois da metade vira ponto de corte", () => {
    // cabem 8 pontos: "aaaaa bb"; espaço no índice 5, mais da metade.
    expect(resumoParaPrevia("aaaaa bbbbbbbbbb", 9)).toBe("aaaaa…");
  });
});

describe("o que não pode ficar pendurado antes das reticências", () => {
  it.each([
    ["vírgula", ","],
    ["ponto e vírgula", ";"],
    ["dois-pontos", ":"],
    ["hífen", "-"],
    ["meia-risca", "–"],
    ["travessão", "—"],
    ["parêntese aberto", "("],
  ])("%s no fim do corte sai", (_nome, sinal) => {
    // Sem espaços: o corte é seco. Cabem 6 pontos: "abcde" + sinal.
    expect(resumoParaPrevia(`abcde${sinal}fghijk`, 7)).toBe("abcde…");
  });

  it("vários sinais seguidos saem todos", () => {
    expect(resumoParaPrevia("abc,;:-—(fghijklm", 9)).toBe("abc…");
  });

  it("espaço no fim do corte sai", () => {
    // cabem 2 pontos: "a " (espaço na posição 1, que não passa da metade).
    expect(resumoParaPrevia("a bcd", 3)).toBe("a…");
  });

  it("o sinal só sai do FIM: no meio do texto continua", () => {
    expect(resumoParaPrevia("a,b,c,d,e,f,g,h,i,j,k,l", 9)).toBe("a,b,c,d…");
  });

  it("seletor de variação de emoji solto no fim do corte sai", () => {
    // ❤️ = U+2764 + U+FE0F. Cabem 4 pontos: a b ❤ FE0F.
    expect(resumoParaPrevia("ab❤️cdefgh", 5)).toBe("ab❤…");
  });

  it("o conector de emoji composto só sai do FIM, o do meio do texto fica", () => {
    const familia = "👨‍👩‍👧";
    const resumo = resumoParaPrevia(`${familia} ${"b".repeat(300)}`, 50);
    expect(resumo.startsWith(`${familia} b`)).toBe(true);
    expect(Array.from(resumo)).toHaveLength(50);
  });
});

describe("linhas com espaços nas pontas", () => {
  it("espaços antes do texto não impedem tirar o negrito nem juntar as linhas", () => {
    expect(resumoParaPrevia("   **Novo**   \n   **Leve**")).toBe("Novo Leve");
  });
});
