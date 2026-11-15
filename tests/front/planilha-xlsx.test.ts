// @vitest-environment jsdom
import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";
import { linhasDosProdutos } from "@/lib/exportar-produtos-planilha";
import { gerarXlsx } from "@/lib/planilha-xlsx";
import type { Product } from "@/types";
import { describe, expect, it } from "vitest";

const nomes = [
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/worksheets/sheet1.xml",
];

/** Lê ZIP store sem reutilizar o escritor; CRC vem da implementação nativa do Node. */
function abrir(bytes: Uint8Array) {
  const zip = Buffer.from(bytes);
  const arquivos = new Map<string, string>();
  const locais: {
    nome: string;
    inicio: number;
    crc: number;
    tamanho: number;
  }[] = [];
  let posicao = 0;
  expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 3, 4]));
  while (zip.readUInt32LE(posicao) === 0x04034b50) {
    const inicio = posicao;
    expect(zip.readUInt16LE(inicio + 8)).toBe(0);
    const crc = zip.readUInt32LE(inicio + 14);
    const tamanho = zip.readUInt32LE(inicio + 18);
    expect(zip.readUInt32LE(inicio + 22)).toBe(tamanho);
    const comprimentoNome = zip.readUInt16LE(inicio + 26);
    const nome = zip.toString(
      "utf8",
      inicio + 30,
      inicio + 30 + comprimentoNome,
    );
    posicao += 30 + comprimentoNome + zip.readUInt16LE(inicio + 28);
    const dados = zip.subarray(posicao, posicao + tamanho);
    expect(crc32(dados), nome).toBe(crc);
    arquivos.set(nome, dados.toString("utf8"));
    locais.push({ nome, inicio, crc, tamanho });
    posicao += tamanho;
  }
  expect([...arquivos.keys()]).toEqual(nomes);
  const diretorio = posicao;
  for (const local of locais) {
    expect(zip.readUInt32LE(posicao)).toBe(0x02014b50);
    expect(zip.readUInt32LE(posicao + 16)).toBe(local.crc);
    expect(zip.readUInt32LE(posicao + 20)).toBe(local.tamanho);
    expect(zip.readUInt32LE(posicao + 24)).toBe(local.tamanho);
    expect(zip.readUInt32LE(posicao + 42)).toBe(local.inicio);
    const tamanhoNome = zip.readUInt16LE(posicao + 28);
    expect(zip.toString("utf8", posicao + 46, posicao + 46 + tamanhoNome)).toBe(
      local.nome,
    );
    posicao +=
      46 +
      tamanhoNome +
      zip.readUInt16LE(posicao + 30) +
      zip.readUInt16LE(posicao + 32);
  }
  expect(zip.readUInt32LE(posicao)).toBe(0x06054b50);
  expect(zip.readUInt16LE(posicao + 8)).toBe(6);
  expect(zip.readUInt16LE(posicao + 10)).toBe(6);
  expect(zip.readUInt32LE(posicao + 12)).toBe(posicao - diretorio);
  expect(zip.readUInt32LE(posicao + 16)).toBe(diretorio);
  expect(posicao + 22).toBe(zip.length);
  return new Map(
    [...arquivos].map(([nome, xml]) => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      expect(doc.querySelector("parsererror"), nome).toBeNull();
      return [nome, doc];
    }),
  );
}

function folha(linhas: (string | number)[][]) {
  return abrir(gerarXlsx(linhas)).get("xl/worksheets/sheet1.xml")!;
}

const produto: Product = {
  id: "p1",
  sku: "000123",
  name: "Verão 🌻 &<>\"'",
  description: "Feito à mão\nAlgodão",
  category: "Roupas",
  price: 80,
  originalPrice: 100,
  costPrice: 30,
  stock: 12,
  sold: 3,
  images: [],
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: "2026-11-15",
};

describe("XLSX mínimo, sem biblioteca e sem compressão", () => {
  it("gera seis partes XML válidas com CRCs e diretório central coerentes", () => {
    const partes = abrir(
      gerarXlsx([
        ["Nome", "Preço (R$)"],
        ["Árvore 🌻", 12.5],
      ]),
    );
    expect(
      partes
        .get("xl/workbook.xml")!
        .querySelector("sheet")
        ?.getAttribute("name"),
    ).toBe("Produtos");
    expect(
      partes.get("[Content_Types].xml")!.querySelectorAll("Override"),
    ).toHaveLength(3);
    expect(
      partes
        .get("_rels/.rels")!
        .querySelector("Relationship")
        ?.getAttribute("Target"),
    ).toBe("xl/workbook.xml");
    expect(
      [
        ...partes
          .get("xl/_rels/workbook.xml.rels")!
          .querySelectorAll("Relationship"),
      ].map((r) => r.getAttribute("Target")),
    ).toEqual(["worksheets/sheet1.xml", "styles.xml"]);
  });

  it("congela cabeçalho, filtra a área completa e dá largura e estilo às colunas", () => {
    const partes = abrir(gerarXlsx(linhasDosProdutos([produto], true)));
    const doc = partes.get("xl/worksheets/sheet1.xml")!;
    expect(doc.querySelector("pane")?.getAttribute("state")).toBe("frozen");
    expect(doc.querySelector("pane")?.getAttribute("ySplit")).toBe("1");
    expect(doc.querySelector("pane")?.getAttribute("topLeftCell")).toBe("A2");
    expect(doc.querySelector("autoFilter")?.getAttribute("ref")).toBe("A1:AE2");
    expect(doc.querySelector('c[r="AE1"] t')?.textContent).toBe(
      "Atualizado em",
    );
    expect(doc.querySelector('c[r="A1"]')?.getAttribute("s")).toBe("1");
    expect(doc.querySelector('col[min="2"]')?.getAttribute("width")).toBe("36");
    expect(
      Number(doc.querySelector('col[min="1"]')?.getAttribute("width")),
    ).toBeGreaterThan(10);
    const estilos = partes.get("xl/styles.xml")!;
    expect(
      estilos.querySelectorAll("fonts font")[1].querySelector("b"),
    ).not.toBeNull();
    expect(estilos.querySelector("font name")?.getAttribute("val")).toBe(
      "Arial",
    );
  });

  it("preserva acentos, emoji, espaços e símbolos; remove só controles XML inválidos", () => {
    const doc = folha([
      ["Nome"],
      ["  ação 🌻 &<>\"'\t\n\r\u0000\u0001\u000b￾\ud800 fim"],
    ]);
    expect(doc.querySelector('c[r="A2"] t')?.textContent).toBe(
      "  ação 🌻 &<>\"'\t\n\r fim",
    );
    expect(doc.querySelector('c[r="A2"] t')?.getAttribute("xml:space")).toBe(
      "preserve",
    );
    expect(doc.querySelector('c[r="A2"]')?.getAttribute("t")).toBe("inlineStr");
  });

  it("mantém número, moeda em duas casas, fração percentual e texto sem fórmula", () => {
    const partes = abrir(
      gerarXlsx(
        linhasDosProdutos([{ ...produto, name: "=1+1", weightKg: 0.5 }], true),
      ),
    );
    const doc = partes.get("xl/worksheets/sheet1.xml")!;
    expect(doc.querySelector('c[r="A2"] t')?.textContent).toBe("000123");
    expect(doc.querySelector('c[r="B2"] t')?.textContent).toBe("'=1+1");
    expect(doc.querySelector("f")).toBeNull();
    for (const [ref, valor, estilo] of [
      ["E2", "80", "2"],
      ["H2", "50", "2"],
      ["I2", "0.625", "4"],
      ["J2", "12", "3"],
      ["P2", "0.5", "0"],
    ]) {
      const celula = doc.querySelector(`c[r="${ref}"]`)!;
      expect(celula.querySelector("v")?.textContent).toBe(valor);
      expect(celula.getAttribute("t")).not.toBe("inlineStr");
      expect(celula.getAttribute("s")).toBe(estilo);
    }
    const formatos = [
      ...partes.get("xl/styles.xml")!.querySelectorAll("cellXfs xf"),
    ].map((x) => x.getAttribute("numFmtId"));
    expect(formatos).toEqual(["0", "0", "4", "1", "10"]);
  });

  it("usa uma linha por variante, inclusive inativa, e nunca inclui custo sem acesso", () => {
    const p: Product = {
      ...produto,
      costPrice: 123456,
      variants: [
        {
          id: "v1",
          productId: "p1",
          name: "Tamanho",
          value: "M",
          stockIncrement: 4,
          active: true,
          priceOverride: 0,
        },
        {
          id: "v2",
          productId: "p1",
          name: "Tamanho",
          value: "G",
          stockIncrement: 9,
          active: false,
        },
      ],
    };
    const bytes = gerarXlsx(linhasDosProdutos([p], false));
    const doc = abrir(bytes).get("xl/worksheets/sheet1.xml")!;
    expect(doc.querySelectorAll("row")).toHaveLength(3);
    expect(doc.querySelector("autoFilter")?.getAttribute("ref")).toBe("A1:AB3");
    expect(doc.querySelector('c[r="E2"] v')?.textContent).toBe("0");
    expect(doc.querySelector('c[r="G2"] v')?.textContent).toBe("4");
    expect(doc.querySelector('c[r="G3"] v')?.textContent).toBe("9");
    expect(doc.querySelector('c[r="J3"] t')?.textContent).toBe("Não");
    expect(doc.documentElement.textContent).not.toContain("Custo (R$)");
    expect(doc.documentElement.textContent).not.toContain("123456");
  });

  it("SKU e EAN longos são textos inline, sem perder zeros ou precisão", () => {
    const doc = folha(
      linhasDosProdutos(
        [
          {
            ...produto,
            sku: "00123",
            codigoBarras: "78912345678901234567890",
            variants: [
              {
                id: "v1",
                productId: "p1",
                name: "Tamanho",
                value: "M",
                sku: "000456",
                codigoBarras: "0007891234567890123456",
                stockIncrement: 4,
                active: true,
              },
            ],
          },
        ],
        true,
      ),
    );
    for (const [ref, valor] of [
      ["A2", "00123"],
      ["L2", "000456"],
      ["N2", "78912345678901234567890"],
      ["O2", "0007891234567890123456"],
    ]) {
      const celula = doc.querySelector(`c[r="${ref}"]`)!;
      expect(celula.getAttribute("t")).toBe("inlineStr");
      expect(celula.querySelector("t")?.textContent).toBe(valor);
      expect(celula.querySelector("v")).toBeNull();
    }
  });

  it("catálogo vazio ainda tem cabeçalho congelado e filtro", () => {
    const doc = folha(linhasDosProdutos([], false));
    expect(doc.querySelectorAll("row")).toHaveLength(1);
    expect(doc.querySelector("autoFilter")?.getAttribute("ref")).toBe("A1:AB1");
  });

  it("recusa dados que não cabem no XLSX em vez de produzir arquivo corrompido", () => {
    expect(() => gerarXlsx([["Nome"], ["a".repeat(32768)]])).toThrow();
    expect(() => gerarXlsx([["Preço (R$)"], [Number.NaN]])).toThrow();
  });
});
