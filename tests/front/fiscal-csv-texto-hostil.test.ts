// Gestão Fiscal, caça por mutação: texto digitado por cliente ou lojista no CSV do contador.
//
// A descrição de uma devolução vem do extrato (pode ter texto que o cliente digitou). O
// que este arquivo protege, em português simples:
//   - texto que começa com `=`, `+`, `-`, `@`, tabulação ou quebra de linha (mesmo depois
//     de espaços, inclusive espaço "duro") NUNCA vira fórmula na planilha do contador:
//     a célula começa com apóstrofo, e o resto do texto chega intacto;
//   - aspas, ponto e vírgula e quebra de linha dentro do texto não criam coluna nem
//     linha nova: relido por um leitor de CSV INDEPENDENTE, toda linha tem 6 células;
//   - acento e emoji chegam inteiros;
//   - descrição ausente (null, de um dado antigo) não vira a palavra "null".
//
// O leitor de CSV abaixo é escrito aqui, à parte do código do app, de propósito: se o
// arquivo estivesse mal formado, o leitor veria um número de células diferente de 6.
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import { describe, expect, it } from "vitest";

import {
  type EntradaDoCsvDoContador,
  montarCsvDoContador,
} from "@/lib/fiscal/csv-do-contador";

type LinhaMinima = EntradaDoCsvDoContador["extrato"][number];

const estorno = (descricao: string): LinhaMinima => ({
  origem: "estorno",
  tipo: "saida",
  status: "realizado",
  valor: 30,
  data: "2026-10-06",
  descricao,
});

const entrada = (extrato: LinhaMinima[]): EntradaDoCsvDoContador => ({
  modo: "mensal",
  referencia: "2026-10",
  extrato,
  guias: [],
  agora: new Date("2026-11-24T20:49:00Z"),
});

/** Leitor de CSV (separador `;`, aspas `"`, `""` para aspa literal, CRLF entre linhas). */
function lerCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let entreAspas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto.charAt(i);
    if (entreAspas) {
      if (c === '"' && texto.charAt(i + 1) === '"') {
        celula += '"';
        i += 1;
      } else if (c === '"') {
        entreAspas = false;
      } else {
        celula += c;
      }
    } else if (c === '"' && celula === "") {
      entreAspas = true;
    } else if (c === ";") {
      linha.push(celula);
      celula = "";
    } else if (c === "\r" && texto.charAt(i + 1) === "\n") {
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
      i += 1;
    } else {
      celula += c;
    }
  }
  if (celula !== "" || linha.length > 0) {
    linha.push(celula);
    linhas.push(linha);
  }
  return linhas;
}

/** A célula "Descrição" da única devolução do arquivo, relida pelo leitor independente. */
function descricaoLida(descricao: string | null): string {
  const csv = montarCsvDoContador(
    entrada([estorno(descricao as unknown as string)]),
  );
  if (!csv) throw new Error("o CSV saiu vazio");
  expect(csv.texto.startsWith("﻿")).toBe(true);
  const linhas = lerCsv(csv.texto.slice(1));
  // Cabeçalho + 1 devolução, cada uma com exatamente 6 células.
  expect(linhas).toHaveLength(2);
  for (const l of linhas) expect(l).toHaveLength(6);
  const celulas = linhas[1];
  if (!celulas) throw new Error("faltou a linha da devolução");
  expect(celulas.slice(0, 5)).toEqual([
    "Devolução ou estorno",
    "06/10/2026",
    "",
    "",
    "30,00",
  ]);
  return celulas[5] ?? "";
}

describe("CSV do contador: texto que parece fórmula nunca vira fórmula", () => {
  const perigosos = [
    "=1+1",
    "=cmd|' /C calc'!A0",
    "+55 11 90000-0000",
    "-1",
    "@SOMA(A1:A9)",
    "\t=1+1",
    "\r=1+1",
    "\n=1+1",
    "  =1+1",
    " =1+1", // espaço "duro"
    " \t -2+3",
    "   @x",
  ];

  for (const digitado of perigosos) {
    it(`${JSON.stringify(digitado)} chega como texto (apóstrofo na frente) e o resto intacto`, () => {
      expect(descricaoLida(digitado)).toBe(`'${digitado}`);
    });
  }
});

describe("CSV do contador: texto comum chega do jeito que foi digitado", () => {
  const comuns = [
    "Estorno do pedido #123",
    "Devolução - pedido 77", // hífen no meio não é fórmula
    "troca = tamanho M", // igual no meio não é fórmula
    "João José — café com leite ☕",
    "Cliente adorou 😀🎉 e devolveu mesmo assim",
    "Ação: crédito de R$ 10,00 (50%)",
  ];

  for (const digitado of comuns) {
    it(`${JSON.stringify(digitado)} sai sem apóstrofo`, () => {
      expect(descricaoLida(digitado)).toBe(digitado);
    });
  }
});

describe("CSV do contador: aspas, ponto e vírgula e quebra de linha dentro do texto", () => {
  const estranhos = [
    'Cliente disse "não gostei"',
    "troca; cliente pediu; sem culpa",
    "linha 1\nlinha 2",
    "linha 1\r\nlinha 2",
    'aspas no fim"',
    '"aspas no começo',
    '""',
    ";",
  ];

  for (const digitado of estranhos) {
    it(`${JSON.stringify(digitado)} fica numa célula só, e o arquivo continua com 6 colunas`, () => {
      expect(descricaoLida(digitado)).toBe(digitado);
    });
  }

  it("fórmula escondida entre aspas ainda ganha o apóstrofo, e as aspas chegam como texto", () => {
    expect(descricaoLida('=HYPERLINK("http://x";"y")')).toBe(
      `'=HYPERLINK("http://x";"y")`,
    );
  });
});

describe("CSV do contador: descrição ausente", () => {
  it("null (dado antigo) vira célula vazia, nunca a palavra null nem erro", () => {
    expect(descricaoLida(null)).toBe("");
  });

  it("texto vazio vira célula vazia", () => {
    expect(descricaoLida("")).toBe("");
  });
});

describe("CSV do contador: o leitor independente enxerga todas as linhas de um arquivo misto", () => {
  it("várias devoluções com texto estranho: sempre 6 células, sempre uma linha por devolução", () => {
    const csv = montarCsvDoContador(
      entrada([estorno('=1+1;"x"\n'), estorno("normal"), estorno("+1\r\n+2")]),
    );
    if (!csv) throw new Error("o CSV saiu vazio");
    const linhas = lerCsv(csv.texto.slice(1));
    expect(linhas).toHaveLength(4);
    for (const l of linhas) expect(l).toHaveLength(6);
    expect(linhas.slice(1).map((l) => l[5])).toEqual([
      `'=1+1;"x"\n`,
      "normal",
      "'+1\r\n+2",
    ]);
  });
});
