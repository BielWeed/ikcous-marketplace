// Gestão Fiscal, tarefa 6: os valores da lei, num módulo só para todas as lojas.
//
// O que este teste protege (é dinheiro mostrado a lojista):
//   1. SÓ 2026 tem número; qualquer outro ano devolve "não conferido" e NENHUM valor
//      de conta (nem o de 2026 "emprestado").
//   2. TODO valor numérico tem fonte (artigo + URL) e data de conferência: valor novo
//      sem fonte reprova aqui, e fonte sem valor também.
//   3. Os números batem com o que foi conferido em fonte oficial em 24/11/2026
//      (docs/fiscal/2026-11-24-parametros-conferidos.md). Os valores abaixo são os
//      daquele documento, escritos de novo à mão: se alguém mexer num, este teste cai.
//   4. A tabela do Anexo I é conferida por uma propriedade independente (a alíquota
//      efetiva é contínua na fronteira das faixas 1 a 5), que pega erro de digitação.
import { describe, expect, it } from "vitest";

import {
  DATA_DA_CONFERENCIA,
  type FaixaDoAnexoI,
  LIMITES_DA_FAIXA_DO_MEI,
  type ParametrosConferidos,
  ULTIMO_ANO_CONFERIDO,
  VENCIMENTO_DO_DAS_DIA,
  fonteDoValor,
  parametrosDoAno,
  vencimentoDoDas,
} from "@/lib/fiscal/parametros-da-lei";

function conferidos(ano: number): ParametrosConferidos {
  const p = parametrosDoAno(ano);
  if (!p.conferido) throw new Error(`o ano ${ano} devia estar conferido`);
  return p;
}

/** Todos os caminhos (`mei.dasPorAtividade.comercio`, `simples.anexoI.0.aliquota`...) que são número. */
function caminhosNumericos(valor: unknown, caminho = ""): string[] {
  if (typeof valor === "number") return [caminho];
  if (typeof valor !== "object" || valor === null) return [];
  return Object.entries(valor).flatMap(([chave, filho]) =>
    caminhosNumericos(filho, caminho === "" ? chave : `${caminho}.${chave}`),
  );
}

/** Cada faixa do Anexo I com a seguinte (a última não tem seguinte). */
function vizinhas(
  faixas: readonly FaixaDoAnexoI[],
): { abaixo: FaixaDoAnexoI; acima: FaixaDoAnexoI }[] {
  return faixas.flatMap((abaixo, k) => {
    const acima = faixas.at(k + 1);
    return acima ? [{ abaixo, acima }] : [];
  });
}

/** Os números que a LEI dá: tudo em `mei` e `simples` (o resto é ano e vigência, não conta). */
function numerosDaLei(p: ParametrosConferidos): string[] {
  return [
    ...caminhosNumericos(p.mei, "mei"),
    ...caminhosNumericos(p.simples, "simples"),
  ];
}

describe("parametrosDoAno: 2026, o único ano conferido", () => {
  it("devolve conferido, o ano e a vigência 01/01 a 31/12 de 2026", () => {
    const p = conferidos(2026);
    expect(p.conferido).toBe(true);
    expect(p.ano).toBe(2026);
    expect(p.vigencia).toEqual({ inicio: "2026-01-01", fim: "2026-12-31" });
    expect(ULTIMO_ANO_CONFERIDO).toBe(2026);
    expect(DATA_DA_CONFERENCIA).toBe("2026-11-24");
  });

  it("MEI: teto anual, teto por mês de atividade e DAS por atividade (L1, L2, L4)", () => {
    const { mei } = conferidos(2026);
    expect(mei.tetoAnual).toBe(81_000);
    expect(mei.tetoPorMesDeAtividade).toBe(6_750);
    expect(mei.dasPorAtividade).toEqual({
      comercio: 82.05,
      servico: 86.05,
      comercioEServico: 87.05,
    });
  });

  it("MEI: o teto por mês vezes 12 é o teto anual (consistência da própria lei)", () => {
    // R$ 6.750 x 12 = R$ 81.000: abertura em janeiro não pode dar teto diferente do cheio.
    const { mei } = conferidos(2026);
    expect(mei.tetoPorMesDeAtividade * 12).toBe(mei.tetoAnual);
  });

  it("MEI: limites de faixa do medidor são 100% e 120% (L3)", () => {
    const { mei } = conferidos(2026);
    expect(LIMITES_DA_FAIXA_DO_MEI).toEqual({
      dentroAtePercentual: 100,
      excessoToleradoAtePercentual: 120,
    });
    expect(mei.faixas).toEqual(LIMITES_DA_FAIXA_DO_MEI);
  });

  it("Simples: o Anexo I (comércio) em vigor em 2026 (L6)", () => {
    const { simples } = conferidos(2026);
    expect(simples.anexoI).toEqual([
      { ate: 180_000, aliquota: 4, deduzir: 0 },
      { ate: 360_000, aliquota: 7.3, deduzir: 5_940 },
      { ate: 720_000, aliquota: 9.5, deduzir: 13_860 },
      { ate: 1_800_000, aliquota: 10.7, deduzir: 22_500 },
      { ate: 3_600_000, aliquota: 14.3, deduzir: 87_300 },
      { ate: 4_800_000, aliquota: 19, deduzir: 378_000 },
    ]);
  });

  it("Simples: teto, sublimite, mínimo da RBT12, meses da RBT12 e dia do vencimento (L5, L7, L10)", () => {
    const { simples } = conferidos(2026);
    expect(simples.tetoSimples).toBe(4_800_000);
    expect(simples.sublimite).toBe(3_600_000);
    expect(simples.rbt12QuandoZero).toBe(1);
    expect(simples.mesesDaRbt12).toBe(12);
    expect(simples.vencimentoDia).toBe(20);
    expect(VENCIMENTO_DO_DAS_DIA).toBe(20);
  });

  it("Anexo I: a alíquota efetiva é contínua na fronteira das faixas 1 a 5 (confere a digitação)", () => {
    // (RBT12 x aliquota - PD) / RBT12, calculado na fronteira superior da faixa k e
    // na inferior da k+1 (que é a mesma RBT12), tem de dar o mesmo número. Em centavos
    // inteiros para não depender de arredondamento de ponto flutuante.
    const pares = vizinhas(conferidos(2026).simples.anexoI);
    // 5 faixas contínuas = 4 fronteiras (a 6ª faixa tem salto próprio, de propósito).
    expect(pares).toHaveLength(5);
    for (const { abaixo, acima } of pares.slice(0, 4)) {
      const fronteira = abaixo.ate * 100; // centavos
      const dasDaFaixa = (f: FaixaDoAnexoI) =>
        Math.round(fronteira * f.aliquota) - f.deduzir * 10_000;
      expect(dasDaFaixa(abaixo)).toBe(dasDaFaixa(acima));
    }
  });

  it("Anexo I: faixas crescentes e coladas ao teto do Simples", () => {
    const { anexoI, tetoSimples } = conferidos(2026).simples;
    for (const { abaixo, acima } of vizinhas(anexoI)) {
      expect(acima.ate).toBeGreaterThan(abaixo.ate);
      expect(acima.aliquota).toBeGreaterThan(abaixo.aliquota);
      expect(acima.deduzir).toBeGreaterThan(abaixo.deduzir);
    }
    expect(anexoI.at(-1)?.ate).toBe(tetoSimples);
  });

  it("os parâmetros não podem ser alterados por quem os recebe", () => {
    const p = conferidos(2026);
    expect(() => {
      (p.mei as { tetoAnual: number }).tetoAnual = 1;
    }).toThrow();
    expect(() => {
      // Contorna o `readonly` do tipo de propósito: é o JavaScript solto que se quer provar.
      const faixas = p.simples.anexoI as unknown as FaixaDoAnexoI[];
      faixas.push({ ate: 0, aliquota: 0, deduzir: 0 });
    }).toThrow();
    expect(() => {
      const faixas = p.simples.anexoI as unknown as FaixaDoAnexoI[];
      (faixas.at(0) as { aliquota: number }).aliquota = 99;
    }).toThrow();
    expect(conferidos(2026).mei.tetoAnual).toBe(81_000);
  });
});

describe("parametrosDoAno: o ano que não foi conferido nunca devolve número de conta", () => {
  it.each([2025, 2027, 2028, 2029, 2035, 1999, 0, -2026])(
    "ano %i: não conferido, aponta o último ano conferido e mais nada",
    (ano) => {
      const p = parametrosDoAno(ano);
      expect(p).toEqual({ conferido: false, ultimoAnoConferido: 2026 });
      // Nem uma chave a mais: nada de `mei`, `simples` ou "valor velho de 2026".
      expect(Object.keys(p).sort()).toEqual([
        "conferido",
        "ultimoAnoConferido",
      ]);
    },
  );

  it.each([
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["fração", 2026.5],
  ])("ano inválido (%s) também não é conferido", (_nome, ano) => {
    expect(parametrosDoAno(ano)).toEqual({
      conferido: false,
      ultimoAnoConferido: 2026,
    });
  });

  it("2027 não herda nenhum valor de 2026 (o teto do MEI de 2027 está na lei, mas é condicional)", () => {
    expect(JSON.stringify(parametrosDoAno(2027))).not.toMatch(
      /81000|6750|82\.05/,
    );
  });
});

describe("fonte e data de conferência em todo valor", () => {
  it("todo número da lei tem fonte com artigo, URL oficial e data de 24/11/2026", () => {
    const p = conferidos(2026);
    const caminhos = numerosDaLei(p);
    // Sanidade: o percorredor realmente achou os números (não passa "vazio").
    expect(caminhos.length).toBeGreaterThanOrEqual(25);
    expect(caminhos).toContain("mei.tetoAnual");
    expect(caminhos).toContain("simples.anexoI.5.deduzir");

    for (const caminho of caminhos) {
      const fonte = fonteDoValor(p, caminho);
      expect(fonte, `sem fonte: ${caminho}`).not.toBeNull();
      expect(
        fonte?.artigo.trim().length,
        `artigo vazio: ${caminho}`,
      ).toBeGreaterThan(5);
      expect(fonte?.url, `URL sem https: ${caminho}`).toMatch(/^https:\/\//);
      expect(fonte?.conferidoEm, `sem data: ${caminho}`).toBe("2026-11-24");
    }
  });

  it("as URLs são de fonte oficial (planalto.gov.br ou receita.fazenda.gov.br)", () => {
    const p = conferidos(2026);
    for (const [caminho, fonte] of Object.entries(p.fontes)) {
      expect(fonte.url, caminho).toMatch(
        /^https:\/\/(www\.planalto\.gov\.br|www8\.receita\.fazenda\.gov\.br|normasinternet2\.receita\.fazenda\.gov\.br)\//,
      );
    }
  });

  it("não sobra fonte órfã: toda fonte descreve algum valor que existe", () => {
    const p = conferidos(2026);
    const caminhos = numerosDaLei(p);
    for (const chave of Object.keys(p.fontes)) {
      const cobreAlgum = caminhos.some(
        (c) => c === chave || c.startsWith(`${chave}.`),
      );
      expect(cobreAlgum, `fonte órfã: ${chave}`).toBe(true);
    }
  });

  it("fonteDoValor usa a fonte mais específica e devolve null para o que não tem", () => {
    const p = conferidos(2026);
    expect(fonteDoValor(p, "mei.tetoAnual")?.artigo).toMatch(/18-A/);
    expect(fonteDoValor(p, "simples.anexoI.2.aliquota")?.artigo).toMatch(
      /Anexo I/,
    );
    expect(fonteDoValor(p, "mei.valorInventado")).toBeNull();
    expect(fonteDoValor(p, "")).toBeNull();
    // Nomes que existem em todo objeto não são fonte: nada de "constructor" herdado.
    expect(fonteDoValor(p, "constructor")).toBeNull();
    expect(fonteDoValor(p, "__proto__")).toBeNull();
    expect(fonteDoValor(p, "toString")).toBeNull();
  });
});

describe("vencimentoDoDas: dia 20 do mês seguinte, sábado e domingo vão para a segunda", () => {
  // Sugestão editável: a lei (R-140 art. 40 §3º) fala em "dia sem expediente bancário",
  // e feriado bancário NÃO é calculado aqui.
  it("dia 20 em dia útil fica no dia 20", () => {
    expect(vencimentoDoDas("2026-10")).toBe("2026-11-20"); // sexta
    expect(vencimentoDoDas("2026-09")).toBe("2026-10-20"); // terça
  });

  it("dia 20 num sábado vai para a segunda, dia 22", () => {
    expect(vencimentoDoDas("2026-05")).toBe("2026-06-22");
  });

  it("dia 20 num domingo vai para a segunda, dia 21", () => {
    expect(vencimentoDoDas("2026-08")).toBe("2026-09-21");
    expect(vencimentoDoDas("2026-11")).toBe("2026-12-21");
  });

  it("dezembro passa para janeiro do ano seguinte", () => {
    expect(vencimentoDoDas("2026-12")).toBe("2027-01-20"); // quarta
  });

  it("competência que não é yyyy-mm de verdade não vira data", () => {
    for (const ruim of [
      "",
      "2026",
      "2026-13",
      "2026-00",
      "2026-1",
      "26-05",
      "2026-05-01",
      "abc",
    ]) {
      expect(vencimentoDoDas(ruim), ruim).toBeNull();
    }
  });
});
