// @vitest-environment jsdom
import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";
import { linhasDosProdutos } from "@/lib/exportar-produtos-planilha";
import { gerarXlsx } from "@/lib/planilha-xlsx";
import type { Product } from "@/types";
import { describe, expect, it, vi } from "vitest";

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

  it("ordena worksheet e estilos conforme OOXML, com fills e contagens coerentes", () => {
    const partes = abrir(gerarXlsx(linhasDosProdutos([produto], true)));
    const filhos = (elemento: Element) =>
      [...elemento.children].map((filho) => filho.localName);
    expect(
      filhos(partes.get("xl/worksheets/sheet1.xml")!.documentElement),
    ).toEqual([
      "dimension",
      "sheetViews",
      "sheetFormatPr",
      "cols",
      "sheetData",
      "autoFilter",
    ]);
    const estilos = partes.get("xl/styles.xml")!.documentElement;
    expect(filhos(estilos)).toEqual([
      "fonts",
      "fills",
      "borders",
      "cellStyleXfs",
      "cellXfs",
      "cellStyles",
    ]);
    for (const bloco of estilos.children) {
      expect(bloco.hasAttribute("count"), bloco.localName).toBe(true);
      expect(Number(bloco.getAttribute("count")), bloco.localName).toBe(
        bloco.children.length,
      );
    }
    expect(
      [...estilos.querySelectorAll("fills > fill > patternFill")].map((fill) =>
        fill.getAttribute("patternType"),
      ),
    ).toEqual(["none", "gray125", "solid"]);
  });

  it.each([
    {
      custos: true,
      produtos: [produto],
      ref: "A1:AE2",
      absoluto: "'Produtos'!$A$1:$AE$2",
    },
    {
      custos: false,
      produtos: [produto, { ...produto, id: "p2" }],
      ref: "A1:AB3",
      absoluto: "'Produtos'!$A$1:$AB$3",
    },
    {
      custos: false,
      produtos: [],
      ref: "A1:AB1",
      absoluto: "'Produtos'!$A$1:$AB$1",
    },
  ])(
    "registra a vista e o filtro oculto do workbook na área $ref",
    ({ custos, produtos, ref, absoluto }) => {
      const partes = abrir(gerarXlsx(linhasDosProdutos(produtos, custos)));
      const workbook = partes.get("xl/workbook.xml")!;
      expect(
        [...workbook.documentElement.children].map((filho) => filho.localName),
      ).toEqual(["bookViews", "sheets", "definedNames"]);
      expect(
        workbook.querySelectorAll("bookViews > workbookView"),
      ).toHaveLength(1);
      expect(workbook.querySelector("sheet")?.getAttribute("name")).toBe(
        "Produtos",
      );
      expect(
        workbook.querySelectorAll("definedNames > definedName"),
      ).toHaveLength(1);
      const filtro = workbook.querySelector("definedName")!;
      expect(filtro.getAttribute("name")).toBe("_xlnm._FilterDatabase");
      expect(filtro.getAttribute("localSheetId")).toBe("0");
      expect(filtro.getAttribute("hidden")).toBe("1");
      expect(filtro.textContent).toBe(absoluto);
      const relativo = filtro.textContent!.split("!")[1].replace(/\$/g, "");
      const autoFilter = partes
        .get("xl/worksheets/sheet1.xml")!
        .querySelector("autoFilter")!;
      expect(autoFilter.getAttribute("ref")).toBe(ref);
      expect(relativo).toBe(autoFilter.getAttribute("ref"));
    },
  );

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
        linhasDosProdutos(
          [{ ...produto, name: "=1+1", weightKg: 0.5 }],
          true,
          "xlsx",
        ),
      ),
    );
    const doc = partes.get("xl/worksheets/sheet1.xml")!;
    expect(doc.querySelector('c[r="A2"] t')?.textContent).toBe("000123");
    expect(doc.querySelector('c[r="B2"] t')?.textContent).toBe("=1+1");
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
    expect(formatos).toEqual(["0", "0", "4", "1", "10", "0", "22"]);
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

/** Célula pelo título do cabeçalho, para os testes não dependerem de letra fixa. */
function celulaDa(doc: Document, titulo: string, linha: number) {
  const cabecalho = [...doc.querySelectorAll('row[r="1"] c')].find(
    (c) => c.querySelector("t")?.textContent === titulo,
  );
  const letras = cabecalho!.getAttribute("r")!.replace(/\d+/g, "");
  return doc.querySelector(`c[r="${letras}${linha}"]`);
}

function estilosDe(partes: Map<string, Document>) {
  return [...partes.get("xl/styles.xml")!.querySelectorAll("cellXfs xf")];
}

describe("o XLSX entrega o dado como ele é", () => {
  it.each(["=1+1", "+55 11 99999", "-Camisa", "@SUM(A1)", " =x", "\t=x"])(
    "texto %j sai cru, sem apóstrofo, e continua texto inline (nunca fórmula)",
    (texto) => {
      const doc = folha(
        linhasDosProdutos(
          [{ ...produto, name: texto, description: texto }],
          true,
          "xlsx",
        ),
      );
      for (const titulo of ["Nome", "Descrição"]) {
        const celula = celulaDa(doc, titulo, 2)!;
        expect(celula.getAttribute("t"), titulo).toBe("inlineStr");
        expect(celula.querySelector("t")?.textContent, titulo).toBe(texto);
      }
      expect(doc.querySelector("f")).toBeNull();
    },
  );

  it("célula vazia não existe no XML, nem nas colunas numéricas, e a ordem segue crescente", () => {
    const doc = folha(
      linhasDosProdutos(
        [
          {
            ...produto,
            originalPrice: null,
            costPrice: null,
            category: "",
            updatedAt: undefined,
          },
        ],
        true,
        "xlsx",
      ),
    );
    for (const titulo of [
      "Preço original (R$)",
      "Custo (R$)",
      "Lucro por unidade (R$)",
      "Margem (%)",
      "Peso (kg)",
      "Largura (cm)",
      "Altura (cm)",
      "Comprimento (cm)",
      "Estoque mínimo",
      "Categoria",
      "Atualizado em",
    ])
      expect(celulaDa(doc, titulo, 2), titulo).toBeNull();
    expect(
      [...doc.querySelectorAll("c")].filter(
        (c) => c.querySelector("t")?.textContent === "",
      ),
    ).toHaveLength(0);
    const colunas = [...doc.querySelectorAll('row[r="2"] c')].map((c) => {
      let n = 0;
      for (const letra of c.getAttribute("r")!.replace(/\d+/g, ""))
        n = n * 26 + letra.charCodeAt(0) - 64;
      return n;
    });
    expect(colunas).toEqual([...colunas].sort((a, b) => a - b));
    expect(new Set(colunas).size).toBe(colunas.length);
    expect(doc.querySelector("dimension")?.getAttribute("ref")).toBe("A1:AE2");
    // o que existe continua lá: preço e id.
    expect(
      celulaDa(doc, "Preço (R$)", 2)?.querySelector("v")?.textContent,
    ).toBe("80");
    expect(celulaDa(doc, "ID do produto", 2)).not.toBeNull();
  });

  it("zero é dado, não vazio: preço, custo, estoque e peso zerados continuam na planilha", () => {
    const doc = folha(
      linhasDosProdutos(
        [{ ...produto, price: 0, costPrice: 0, stock: 0, weightKg: 0 }],
        true,
        "xlsx",
      ),
    );
    for (const titulo of ["Preço (R$)", "Custo (R$)", "Estoque", "Peso (kg)"])
      expect(celulaDa(doc, titulo, 2)?.querySelector("v")?.textContent).toBe(
        "0",
      );
  });

  it("Descrição e fotos não quebram linha (linha gigante); Nome e cabeçalho continuam quebrando", () => {
    const partes = abrir(
      gerarXlsx(
        linhasDosProdutos(
          [
            {
              ...produto,
              description: "x".repeat(5000),
              images: [
                "https://exemplo.test/a.jpg",
                "https://exemplo.test/b.jpg",
              ],
              variants: [
                {
                  id: "v1",
                  productId: "p1",
                  name: "Tamanho",
                  value: "M",
                  stockIncrement: 1,
                  active: true,
                  imageUrl: "https://exemplo.test/v.jpg",
                },
              ],
            },
          ],
          true,
          "xlsx",
        ),
      ),
    );
    const doc = partes.get("xl/worksheets/sheet1.xml")!;
    const xfs = estilosDe(partes);
    const quebra = (titulo: string, linha: number) => {
      const estilo = Number(celulaDa(doc, titulo, linha)!.getAttribute("s"));
      return xfs
        .at(estilo)
        ?.querySelector("alignment")
        ?.getAttribute("wrapText");
    };
    expect(quebra("Descrição", 2)).not.toBe("1");
    expect(quebra("Fotos", 2)).not.toBe("1");
    expect(quebra("Foto da variante", 2)).not.toBe("1");
    expect(quebra("Nome", 2)).toBe("1");
    expect(quebra("Nome", 1)).toBe("1");
    // o texto em si não é cortado nem alterado.
    expect(celulaDa(doc, "Descrição", 2)?.querySelector("t")?.textContent).toBe(
      "x".repeat(5000),
    );
    expect(celulaDa(doc, "Fotos", 2)?.querySelector("t")?.textContent).toBe(
      "https://exemplo.test/a.jpg\nhttps://exemplo.test/b.jpg",
    );
  });

  it("Criado em e Atualizado em viram data do Excel no horário de Brasília", () => {
    const partes = abrir(
      gerarXlsx(
        linhasDosProdutos(
          [
            {
              ...produto,
              createdAt: "2026-01-02T03:04:05.000Z",
              updatedAt: "2018-12-01T12:00:00+00:00",
            },
          ],
          true,
          "xlsx",
        ),
      ),
    );
    const doc = partes.get("xl/worksheets/sheet1.xml")!;
    const xfs = estilosDe(partes);
    // 2026-01-02 00:04:05 em Brasília (UTC-3).
    const criado = celulaDa(doc, "Criado em", 2)!;
    expect(criado.getAttribute("t")).toBeNull();
    expect(Number(criado.querySelector("v")?.textContent)).toBeCloseTo(
      46024 + 245 / 86400,
      8,
    );
    expect(xfs[Number(criado.getAttribute("s"))].getAttribute("numFmtId")).toBe(
      "22",
    );
    // 2018-12-01 10:00 em Brasília (UTC-2: o horário de verão ainda existia).
    const atualizado = celulaDa(doc, "Atualizado em", 2)!;
    expect(Number(atualizado.querySelector("v")?.textContent)).toBeCloseTo(
      43435 + 10 / 24,
      8,
    );
  });

  it("aceita o timestamp com microssegundos que o Postgres devolve", () => {
    const doc = folha(
      linhasDosProdutos(
        [{ ...produto, createdAt: "2026-01-02T03:04:05.123456+00:00" }],
        true,
        "xlsx",
      ),
    );
    expect(
      Number(celulaDa(doc, "Criado em", 2)?.querySelector("v")?.textContent),
    ).toBeCloseTo(46024 + 245 / 86400, 8);
  });

  it("com muitas linhas de data cria no máximo um formatador (por célula travava a tela)", () => {
    // O espiao repassa ao construtor de verdade (o vitest exige `function` para poder usar `new`).
    const Real = Intl.DateTimeFormat;
    const construcoes = vi
      .spyOn(Intl, "DateTimeFormat")
      // biome-ignore lint/complexity/useArrowFunction: o vitest só aceita `new` em mock feito com function
      .mockImplementation(function (
        ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
      ) {
        return new Real(...args);
      } as unknown as typeof Intl.DateTimeFormat);
    try {
      const produtos = Array.from({ length: 50 }, (_, i) => ({
        ...produto,
        id: `p${i}`,
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "2018-12-01T12:00:00+00:00",
      }));
      const doc = folha(linhasDosProdutos(produtos, true, "xlsx"));
      // as datas foram convertidas de verdade (nao caiu no texto): o teste mede o caminho do formatador.
      expect(celulaDa(doc, "Criado em", 51)?.getAttribute("t")).toBeNull();
      expect(construcoes.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      construcoes.mockRestore();
    }
  });

  it("data sem fuso ou ilegível fica como texto, sem inventar horário", () => {
    const doc = folha(
      linhasDosProdutos(
        [{ ...produto, createdAt: "2026-11-15", updatedAt: "ontem" }],
        true,
        "xlsx",
      ),
    );
    for (const [titulo, texto] of [
      ["Criado em", "2026-11-15"],
      ["Atualizado em", "ontem"],
    ]) {
      const celula = celulaDa(doc, titulo, 2)!;
      expect(celula.getAttribute("t")).toBe("inlineStr");
      expect(celula.querySelector("t")?.textContent).toBe(texto);
      // estilo do fallback: texto sem quebra de linha (indice 5), nao o de data (6)
      expect(celula.getAttribute("s")).toBe("5");
    }
  });
});
