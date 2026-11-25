// @vitest-environment jsdom
// Bordas do gerador de XLSX que o teste principal (planilha-xlsx.test.ts) não
// vigiava. Cada uma é uma borda onde um número trocado por um vizinho
// produziria uma planilha que o Excel recusa ou lê errado:
// - quais caracteres entram no texto (fronteiras de U+001F/U+0020, U+D7FF,
//   U+DFFF solto, U+E000, U+FFFD, U+10000) e o escape de TODAS as ocorrências;
// - a letra da coluna (Z, AA, AZ, BA, a última do Excel: XFD);
// - os limites (colunas, linhas, tamanho do texto), cabeçalho vazio e linha
//   com tamanho diferente do cabeçalho;
// - estilo por tipo de coluna, largura, altura do cabeçalho, data de criação
//   do arquivo dentro do ZIP e instante sem fuso, que fica como texto.
import { Buffer } from "node:buffer";
import { gerarXlsx } from "@/lib/planilha-xlsx";
import { describe, expect, it } from "vitest";

/** O XML da aba, extraído do ZIP "store" (sem compressão) como texto. */
function xmlDaAba(bytes: Uint8Array): string {
  const texto = new TextDecoder().decode(bytes);
  const achado = /<worksheet[\s\S]*<\/worksheet>/.exec(texto);
  expect(achado).not.toBeNull();
  return achado![0];
}

function folha(linhas: (string | number)[][]): Document {
  const doc = new DOMParser().parseFromString(
    xmlDaAba(gerarXlsx(linhas)),
    "application/xml",
  );
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc;
}

function celula(doc: Document, referencia: string): Element {
  const achada = doc.querySelector(`c[r="${referencia}"]`);
  expect(achada, referencia).not.toBeNull();
  return achada!;
}

/** Letra da coluna calculada de outro jeito que o código de produção (vale até ZZ). */
function letra(indice: number): string {
  const resto = String.fromCharCode(65 + (indice % 26));
  return indice < 26
    ? resto
    : String.fromCharCode(64 + Math.floor(indice / 26)) + resto;
}

describe("XLSX: quais caracteres entram no texto", () => {
  it.each([
    [
      "US (U+001F) é controle e sai, o espaço (U+0020) fica",
      "x\u001Fy z",
      "xy z",
    ],
    ["U+D7FF é o último antes dos substitutos e fica", "a퟿b", "a퟿b"],
    ["substituto solto (U+DFFF) não é texto e sai", "a\uDFFFb", "ab"],
    ["U+E000 é o primeiro depois dos substitutos e fica", "ab", "ab"],
    ["U+FFFD (caractere de substituição) é válido e fica", "a�b", "a�b"],
    [
      "U+10000 é o primeiro fora do plano básico e fica",
      "a\u{10000}b",
      "a\u{10000}b",
    ],
  ])("%s", (_, entrada, esperado) => {
    const doc = folha([["Nome"], [entrada]]);
    expect(celula(doc, "A2").textContent).toBe(esperado);
  });

  it("escapa TODAS as ocorrências de &, < e >, e nunca deixa ']]>' solto", () => {
    const entrada = "a&b&c <d<e> f>g ]]> h";
    const bytes = gerarXlsx([["Nome"], [entrada]]);
    const xml = xmlDaAba(bytes);
    // Se um & ou < ficasse sem escape, o XML nem abriria.
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(celula(doc, "A2").textContent).toBe(entrada);
    // O XML 1.0 proíbe a sequência ']]>' em texto.
    expect(xml).not.toContain("]]>");
    expect(xml).toContain("]]&gt;");
  });

  it("quebra de linha do Windows (CRLF) e CR solto chegam ao Excel como foram digitados", () => {
    // O leitor de XML transforma CR em LF; só o CR escrito como "&#13;" sobrevive.
    // Descrição escrita no Windows traz CRLF.
    const entrada = "linha1\r\nlinha2\rlinha3\nlinha4";
    const doc = folha([["Descrição"], [entrada]]);
    expect(celula(doc, "A2").textContent).toBe(entrada);
  });

  it("'_x' com 3 ou 5 dígitos hexadecimais não é sequência do Excel e fica como veio", () => {
    const entrada = "_x123_ e _x00411_";
    const doc = folha([["Nome"], [entrada]]);
    expect(celula(doc, "A2").textContent).toBe(entrada);
  });
});

describe("XLSX: letra da coluna", () => {
  it("53 colunas: A..Z, AA..AZ, BA, com a referência de cada célula e a área", () => {
    const titulos = Array.from({ length: 53 }, (_, i) => `Coluna ${i + 1}`);
    const dados = titulos.map((_, i) => `valor ${i + 1}`);
    const doc = folha([titulos, dados]);
    const referencias = Array.from(doc.querySelectorAll('row[r="2"] c')).map(
      (c) => c.getAttribute("r"),
    );
    expect(referencias).toEqual(titulos.map((_, i) => `${letra(i)}2`));
    expect(referencias[25]).toBe("Z2");
    expect(referencias[26]).toBe("AA2");
    expect(referencias[51]).toBe("AZ2");
    expect(referencias[52]).toBe("BA2");
    expect(doc.querySelector("dimension")?.getAttribute("ref")).toBe("A1:BA2");
  });
});

describe("XLSX: limites da planilha", () => {
  it("16384 colunas (a última é XFD) cabem; 16385 não", () => {
    const titulos = Array.from({ length: 16384 }, (_, i) => `C${i}`);
    const doc = folha([titulos]);
    expect(doc.querySelector("dimension")?.getAttribute("ref")).toBe("A1:XFD1");
    expect(() => gerarXlsx([[...titulos, "a mais"]])).toThrow(
      "Dimensões fora do limite da planilha.",
    );
  });

  it("1.048.577 linhas não cabem (o limite do Excel é 1.048.576)", () => {
    const umaLinha = ["x"];
    const linhas = Array.from({ length: 1_048_577 }, () => umaLinha);
    expect(() => gerarXlsx(linhas)).toThrow(
      "Dimensões fora do limite da planilha.",
    );
  });

  it("exatamente 1.048.576 linhas (cabeçalho incluso) ainda cabem", () => {
    const vazia = [""];
    const linhas: (string | number)[][] = [["Nome"]];
    for (let i = 1; i < 1_048_576; i++) linhas.push(vazia);
    const bytes = gerarXlsx(linhas);
    expect(xmlDaAba(bytes)).toContain('<dimension ref="A1:A1048576"/>');
  }, 60_000);

  it("sem nenhuma linha, ou com cabeçalho sem coluna, recusa com a mensagem de limite", () => {
    expect(() => gerarXlsx([])).toThrow(
      "Dimensões fora do limite da planilha.",
    );
    expect(() => gerarXlsx([[]])).toThrow(
      "Dimensões fora do limite da planilha.",
    );
  });

  it("texto de exatamente 32767 caracteres cabe; 32768 não", () => {
    const doc = folha([["Nome"], ["a".repeat(32767)]]);
    expect(celula(doc, "A2").textContent).toHaveLength(32767);
    expect(() => gerarXlsx([["Nome"], ["a".repeat(32768)]])).toThrow(
      "Texto maior que o limite do XLSX.",
    );
  });

  it("linha com menos ou mais células que o cabeçalho é recusada", () => {
    expect(() => gerarXlsx([["A", "B"], ["só uma"]])).toThrow(
      "Linha incompleta.",
    );
    expect(() =>
      gerarXlsx([
        ["A", "B"],
        ["1", "2", "3"],
      ]),
    ).toThrow("Linha incompleta.");
  });
});

describe("XLSX: estilo, largura e altura por tipo de coluna", () => {
  it("Vendidos, Estoque mínimo e Estoque são inteiros (estilo 3); 'Item' e 'Sistema' não são data", () => {
    const doc = folha([
      ["Vendidos", "Estoque mínimo", "Estoque", "Item", "Sistema"],
      [3, 5, 7, 9, "x"],
    ]);
    expect(celula(doc, "A2").getAttribute("s")).toBe("3");
    expect(celula(doc, "B2").getAttribute("s")).toBe("3");
    expect(celula(doc, "C2").getAttribute("s")).toBe("3");
    // Só o título que TERMINA em " em" (com o espaço) é data.
    expect(celula(doc, "D2").getAttribute("s")).toBe("0");
    expect(celula(doc, "E2").getAttribute("s")).toBe("0");
  });

  it("largura de cada tipo de coluna", () => {
    const titulos = [
      "Nome",
      "Descrição",
      "Foto da variante",
      "ID do produto",
      "Criado em",
      "Outro",
    ];
    const doc = folha([titulos, titulos.map(() => "x")]);
    const larguras = Array.from(doc.querySelectorAll("cols col")).map((c) =>
      Number(c.getAttribute("width")),
    );
    expect(larguras).toEqual([36, 60, 50, 38, 26, 22]);
  });

  it("só o cabeçalho tem altura fixa de 30", () => {
    const doc = folha([["Nome"], ["x"]]);
    expect(doc.querySelector('row[r="1"]')?.getAttribute("ht")).toBe("30");
    expect(doc.querySelector('row[r="1"]')?.getAttribute("customHeight")).toBe(
      "1",
    );
    expect(doc.querySelector('row[r="2"]')?.hasAttribute("ht")).toBe(false);
  });
});

describe("XLSX: data de criação dos arquivos dentro do ZIP", () => {
  it("todos os cabeçalhos (local e central) levam 01/01/1980, uma data DOS válida, e não zero", () => {
    const zip = Buffer.from(gerarXlsx([["Nome"], ["x"]]));
    const DATA_DOS_1980 = 33;
    let locais = 0;
    for (let i = 0; i + 4 <= zip.length; i++) {
      if (zip.readUInt32LE(i) === 0x04034b50) {
        expect(zip.readUInt16LE(i + 12)).toBe(DATA_DOS_1980);
        locais++;
      }
      if (zip.readUInt32LE(i) === 0x02014b50) {
        expect(zip.readUInt16LE(i + 14)).toBe(DATA_DOS_1980);
        locais++;
      }
    }
    // 6 arquivos x (cabeçalho local + central).
    expect(locais).toBeGreaterThanOrEqual(12);
  });
});

describe("XLSX: instante sem fuso", () => {
  it.each(["2026-11-15T10:00:00", "2026-11-15T10:00:00.123"])(
    "'%s' (sem Z nem deslocamento) fica como texto, nunca vira horário inventado",
    (instante) => {
      const doc = folha([["Criado em"], [instante]]);
      const c = celula(doc, "A2");
      expect(c.getAttribute("t")).toBe("inlineStr");
      expect(c.textContent).toBe(instante);
      expect(c.getAttribute("s")).toBe("5");
    },
  );
});
