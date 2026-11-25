// Gestão Fiscal, tarefa 11: a comparação "estimativa do app x guia lançada".
//
// Só vale nos meses que têm AS DUAS coisas. O que se mostra é o quanto a estimativa
// ficou acima ou abaixo da guia, em média, nos últimos 3 desses meses. Mês sem uma das
// duas coisas, ou com guia zero (que não dá para dividir), fica fora da conta. Sem nenhum
// mês válido não há frase: melhor calar do que inventar um percentual.
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  type ComparacaoDaEstimativa,
  MESES_DA_COMPARACAO,
  type MesParaComparar,
  compararEstimativaComGuia,
} from "@/lib/fiscal/comparacao";

const mes = (
  yyyyMm: string,
  estimativa: number | null,
  guia: number | null,
): MesParaComparar => ({ mes: yyyyMm, estimativa, guia });

/** Resultado com frase, ou erro do teste: assim o `null` não se repete em todo caso. */
function comparar(meses: readonly MesParaComparar[]): ComparacaoDaEstimativa {
  const resultado = compararEstimativaComGuia(meses);
  if (resultado === null) throw new Error("devia haver comparação");
  return resultado;
}

describe("compararEstimativaComGuia: o percentual", () => {
  it("estimativa maior que a guia: 18% acima", () => {
    const r = comparar([mes("2026-03", 118, 100)]);
    expect(r.sentido).toBe("acima");
    expect(r.percentual).toBe(18);
    expect(r.meses).toBe(1);
  });

  it("estimativa menor que a guia: 18% abaixo, com sinal negativo", () => {
    const r = comparar([mes("2026-03", 82, 100)]);
    expect(r.sentido).toBe("abaixo");
    expect(r.percentual).toBe(-18);
  });

  it("estimativa igual à guia: 'igual', zero (e nunca -0)", () => {
    const r = comparar([mes("2026-03", 100, 100)]);
    expect(r.sentido).toBe("igual");
    expect(Object.is(r.percentual, 0)).toBe(true);
  });

  it("diferença que arredonda para 0% também é 'igual'", () => {
    // 1000 contra 1001 = -0,0999%: não vale dizer "abaixo".
    const r = comparar([mes("2026-03", 1000, 1001)]);
    expect(r.sentido).toBe("igual");
    expect(Object.is(r.percentual, 0)).toBe(true);
  });

  it("é a média dos percentuais de cada mês, não a razão das somas", () => {
    // Mês A: +100%. Mês B: -90%. Média = +5%.
    // (A razão das somas daria 300 contra 1100 = -73%, que é outra coisa.)
    const r = comparar([mes("2026-01", 200, 100), mes("2026-02", 100, 1000)]);
    expect(r.percentual).toBe(5);
    expect(r.sentido).toBe("acima");
    expect(r.meses).toBe(2);
  });

  it("estimativa zero com guia lançada vale: -100%", () => {
    // Estimativa 0 é um resultado de verdade (mês sem receita), não "ausente".
    const r = comparar([mes("2026-03", 0, 100)]);
    expect(r.percentual).toBe(-100);
    expect(r.sentido).toBe("abaixo");
  });

  it("meio por cento arredonda para longe do zero, igual dos dois lados", () => {
    // 410 contra 400 = +2,5%; 390 contra 400 = -2,5%. Sem erro de ponto flutuante.
    expect(comparar([mes("2026-03", 410, 400)]).percentual).toBe(3);
    expect(comparar([mes("2026-03", 390, 400)]).percentual).toBe(-3);
  });

  it("não perde o meio por cento quando o ponto flutuante erra por um fio", () => {
    // Exatamente +57,5% e -57,5%, mas a divisão em ponto flutuante dá 57,49999999999999.
    // Sem tirar esse ruído antes de arredondar, o resultado cairia em 57 em vez de 58.
    expect(comparar([mes("2026-03", 189, 120)]).percentual).toBe(58);
    expect(comparar([mes("2026-03", 51, 120)]).percentual).toBe(-58);
  });
});

describe("compararEstimativaComGuia: quais meses entram", () => {
  it("só os meses com AS DUAS coisas; os outros não entram na conta nem na contagem", () => {
    const r = comparar([
      mes("2026-01", 110, 100), // tem as duas: +10%
      mes("2026-02", null, 300), // sem estimativa
      mes("2026-03", 500, null), // sem guia lançada
      mes("2026-04", null, null),
    ]);
    expect(r.meses).toBe(1);
    expect(r.percentual).toBe(10);
  });

  it("a janela são os 3 últimos meses COM as duas, não os 3 últimos do calendário", () => {
    const r = comparar([
      mes("2026-01", 110, 100), // +10
      mes("2026-02", 120, 100), // +20
      mes("2026-03", 130, 100), // +30
      mes("2026-04", 999, null), // mais recente, mas sem guia: fora
      mes("2026-05", null, 100), // mais recente, mas sem estimativa: fora
    ]);
    expect(r.meses).toBe(3);
    expect(r.percentual).toBe(20);
  });

  it("com mais de 3 meses válidos, só os 3 mais recentes contam (o mais velho cai)", () => {
    const r = comparar([
      mes("2026-01", 1000, 100), // +900%: se entrasse, estragava a média
      mes("2026-02", 110, 100), // +10
      mes("2026-03", 120, 100), // +20
      mes("2026-04", 130, 100), // +30
    ]);
    expect(MESES_DA_COMPARACAO).toBe(3);
    expect(r.meses).toBe(3);
    expect(r.percentual).toBe(20);
  });

  it("a ordem da lista não importa: o mais recente é o de maior mês", () => {
    const r = comparar([
      mes("2026-04", 130, 100),
      mes("2026-01", 1000, 100),
      mes("2026-03", 120, 100),
      mes("2026-02", 110, 100),
    ]);
    expect(r.meses).toBe(3);
    expect(r.percentual).toBe(20);
  });

  it("passa a virada do ano: dezembro vem antes de janeiro do ano seguinte", () => {
    const r = comparar([
      mes("2027-01", 130, 100), // +30, o mais novo
      mes("2026-12", 120, 100), // +20
      mes("2026-11", 110, 100), // +10
      mes("2026-10", 1000, 100), // o mais velho: cai
    ]);
    expect(r.meses).toBe(3);
    expect(r.percentual).toBe(20);
  });

  it("a lista de entrada não é alterada", () => {
    const entrada = [mes("2026-02", 110, 100), mes("2026-01", 120, 100)];
    const copia = entrada.map((m) => ({ ...m }));
    comparar(entrada);
    expect(entrada).toEqual(copia);
  });
});

describe("compararEstimativaComGuia: sem frase", () => {
  it("lista vazia: null", () => {
    expect(compararEstimativaComGuia([])).toBeNull();
  });

  it("nenhum mês com as duas coisas: null", () => {
    expect(
      compararEstimativaComGuia([
        mes("2026-01", 100, null),
        mes("2026-02", null, 100),
      ]),
    ).toBeNull();
  });

  it("guia zero não divide por zero: o mês fica fora da conta", () => {
    const r = comparar([mes("2026-01", 110, 100), mes("2026-02", 400, 0)]);
    expect(r.meses).toBe(1);
    expect(r.percentual).toBe(10);
    expect(Number.isFinite(r.percentual)).toBe(true);
  });

  it("só havia mês de guia zero: null (e não Infinity nem NaN)", () => {
    expect(compararEstimativaComGuia([mes("2026-01", 400, 0)])).toBeNull();
  });

  it("guia que arredonda para zero centavos também não entra", () => {
    expect(compararEstimativaComGuia([mes("2026-01", 400, 0.004)])).toBeNull();
  });

  it("guia negativa ou estimativa negativa não entram", () => {
    expect(
      compararEstimativaComGuia([
        mes("2026-01", 100, -50),
        mes("2026-02", -10, 100),
      ]),
    ).toBeNull();
  });

  it("NaN e infinito não entram (nem derrubam o resto)", () => {
    const r = comparar([
      mes("2026-01", Number.NaN, 100),
      mes("2026-02", 100, Number.POSITIVE_INFINITY),
      mes("2026-03", Number.POSITIVE_INFINITY, 100),
      mes("2026-04", 120, 100),
    ]);
    expect(r.meses).toBe(1);
    expect(r.percentual).toBe(20);
  });

  it("mês que não é aaaa-mm não entra", () => {
    expect(
      compararEstimativaComGuia([
        mes("2026-13", 110, 100),
        mes("2026-1", 110, 100),
        mes("", 110, 100),
        mes("2026-01-01", 110, 100),
      ]),
    ).toBeNull();
  });

  it("mês repetido na lista é ambíguo: sai da conta em vez de escolher um valor", () => {
    const r = comparar([
      mes("2026-01", 110, 100),
      mes("2026-02", 500, 100), // repetido com valores diferentes
      mes("2026-02", 100, 100),
    ]);
    expect(r.meses).toBe(1);
    expect(r.percentual).toBe(10);
  });
});

describe("compararEstimativaComGuia: a frase", () => {
  it("acima, no plural", () => {
    const r = comparar([
      mes("2026-01", 118, 100),
      mes("2026-02", 118, 100),
      mes("2026-03", 118, 100),
    ]);
    expect(r.frase).toBe(
      "Nas 3 últimas guias lançadas, a estimativa do app ficou 18% acima da guia.",
    );
  });

  it("abaixo, sem sinal de menos na frase", () => {
    const r = comparar([mes("2026-01", 82, 100), mes("2026-02", 82, 100)]);
    expect(r.frase).toBe(
      "Nas 2 últimas guias lançadas, a estimativa do app ficou 18% abaixo da guia.",
    );
  });

  it("um mês só fica no singular", () => {
    const r = comparar([mes("2026-01", 118, 100)]);
    expect(r.frase).toBe(
      "Na última guia lançada, a estimativa do app ficou 18% acima da guia.",
    );
  });

  it("igual: não diz '0% acima'", () => {
    const r = comparar([mes("2026-01", 100, 100), mes("2026-02", 100, 100)]);
    expect(r.frase).toBe(
      "Nas 2 últimas guias lançadas, a estimativa do app ficou praticamente igual à guia.",
    );
  });
});

// O texto do próprio módulo, lido pelo Vite (`?raw`), sem API de Node.
const FONTE_DO_MODULO = import.meta.glob<string>(
  "/src/lib/fiscal/comparacao.ts",
  { query: "?raw", import: "default", eager: true },
);

describe("a comparação só lê: não grava nada", () => {
  it("o módulo não importa nada que grave lançamento nem fale com o banco", () => {
    const [fonte] = Object.values(FONTE_DO_MODULO);
    // Sanidade: achou mesmo o arquivo (senão o teste passaria "vazio").
    expect(fonte).toContain("compararEstimativaComGuia");
    expect(fonte).not.toMatch(
      /salvarLancamento|baixarLancamento|fin_lancamento_salvar|supabase/i,
    );
  });
});
