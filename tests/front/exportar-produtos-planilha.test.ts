import {
  lerCatalogoInteiro,
  linhasDosProdutos,
  produtosEmCsv,
} from "@/lib/exportar-produtos-planilha";
import { mapProductFromDB } from "@/lib/mappers";
import type { Product, ProductVariant } from "@/types";
import { describe, expect, it } from "vitest";

const produto = (dados: Partial<Product> = {}): Product => ({
  id: "p1",
  sku: "P-01",
  name: 'Vestido "Verão", azul 🌻',
  description: "Algodão; leve\nFeito à mão",
  price: 80,
  originalPrice: 100,
  costPrice: 30,
  images: ["https://example.org/foto.jpg"],
  category: "Vestidos",
  stock: 12,
  sold: 3,
  isActive: true,
  isBestseller: true,
  freeShipping: false,
  createdAt: "2026-11-14T12:00:00Z",
  updatedAt: "2026-11-15T12:00:00Z",
  ...dados,
});
const variante = (dados: Partial<ProductVariant> = {}): ProductVariant => ({
  id: "v1",
  productId: "p1",
  name: "Tamanho",
  value: "M",
  sku: "V-M",
  stockIncrement: 4,
  active: true,
  ...dados,
});

function registro(p: Product, custos = true, indice = 1) {
  const linhas = linhasDosProdutos([p], custos);
  return Object.fromEntries(
    linhas[0].map((titulo, i) => [titulo, linhas.at(indice)?.at(i)]),
  );
}

describe("catálogo inteiro, fora da lista e dos filtros da tela", () => {
  it("busca todas as páginas até conferir a contagem", async () => {
    const paginas: number[] = [];
    const produtos = await lerCatalogoInteiro(async (pagina) => {
      paginas.push(pagina);
      return { products: [produto({ id: String(pagina) })], total: 3 };
    });
    expect(paginas).toEqual([0, 1, 2]);
    expect(produtos.map((p) => p.id)).toEqual(["0", "1", "2"]);
  });
  it("aceita catálogo vazio confirmado", async () => {
    expect(
      await lerCatalogoInteiro(async () => ({ products: [], total: 0 })),
    ).toEqual([]);
  });
  it.each(["incompleta", "repetida", "contagem mudou", "total inválido"])(
    "recusa planilha %s, nunca baixa uma lista parcial como completa",
    async (caso) => {
      await expect(
        lerCatalogoInteiro(async (pagina) => ({
          products:
            caso === "incompleta" && pagina > 0
              ? []
              : [
                  produto({
                    id: caso === "repetida" ? "mesmo" : String(pagina),
                  }),
                ],
          total:
            caso === "total inválido"
              ? Number.NaN
              : caso === "contagem mudou" && pagina > 0
                ? 3
                : 2,
        })),
      ).rejects.toThrow();
    },
  );
  it("não engole erro numa página posterior", async () => {
    await expect(
      lerCatalogoInteiro(async (pagina) => {
        if (pagina > 0) throw new Error("sem rede");
        return { products: [produto()], total: 2 };
      }),
    ).rejects.toThrow("sem rede");
  });
});

describe("CSV para Excel em português", () => {
  it.each([
    ["2026-11-17T02:30:00Z", "16/11/2026 23:30"],
    ["2026-11-17T12:00:00Z", "17/11/2026 09:00"],
    ["", ""],
    ["ontem", ""],
  ])("mostra criação e atualização %j em Brasília", (data, esperado) => {
    const csv = produtosEmCsv(
      [produto({ createdAt: data, updatedAt: data, description: "" })],
      false,
    );
    expect(csv.split("\r\n").at(1)?.split(";").slice(-2)).toEqual([
      `"${esperado}"`,
      `"${esperado}"`,
    ]);
  });
  it("deixa atualização ausente vazia", () => {
    const csv = produtosEmCsv([produto({ updatedAt: undefined })], false);
    expect(csv.endsWith(';""')).toBe(true);
  });

  it("inclui BOM, ponto e vírgula, decimal com vírgula e aspas escapadas", () => {
    const csv = produtosEmCsv([produto()], true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Preço (R$)";"Preço original (R$)"');
    expect(csv).toContain("80,00;100,00;30,00;50,00;62,50;12;");
    expect(csv).toContain('"Vestido ""Verão"", azul 🌻"');
    expect(csv).toContain('"Algodão; leve\nFeito à mão"');
    expect(csv).toContain("\r\n");
  });
  it("protege fórmula também no arquivo final e não exporta custo sem permissão", () => {
    const csv = produtosEmCsv(
      [produto({ name: "=1+1", costPrice: 123456 })],
      false,
    );
    expect(csv).toContain('"\'=1+1"');
    expect(csv).not.toContain("Custo (R$)");
    expect(csv).not.toContain("123456");
  });
});

describe("proteção contra fórmula depende do formato", () => {
  it.each(["=1+1", "+55 11 99999", "-Camisa", "@SUM(A1)", " =x", "\t=x"])(
    "texto %j: CSV leva apóstrofo, XLSX leva o dado cru",
    (texto) => {
      const p = produto({
        name: texto,
        description: texto,
        variants: [variante({ sku: texto })],
      });
      const lido = (formato?: "csv" | "xlsx") => {
        const linhas = linhasDosProdutos([p], true, formato);
        return Object.fromEntries(
          linhas[0].map((t, i) => [t, linhas[1].at(i)]),
        );
      };
      for (const formato of [undefined, "csv"] as const) {
        expect(lido(formato).Nome, String(formato)).toBe(`'${texto}`);
        expect(lido(formato).Descrição, String(formato)).toBe(`'${texto}`);
        expect(lido(formato)["SKU da variante"], String(formato)).toBe(
          `'${texto}`,
        );
      }
      expect(lido("xlsx").Nome).toBe(texto);
      expect(lido("xlsx").Descrição).toBe(texto);
      expect(lido("xlsx")["SKU da variante"]).toBe(texto);
      // o arquivo CSV de reserva continua protegido.
      expect(produtosEmCsv([p], true)).toContain(`"'${texto}"`);
    },
  );
});

describe("planilha de produtos", () => {
  it("produto sem foto vindo do mapeador não exporta o placeholder como foto real", () => {
    const p = mapProductFromDB({
      id: "sem-foto",
      nome: "Sem foto",
      preco_venda: 10,
      imagem_urls: [],
    });
    expect(p.images).toEqual(["https://placehold.co/600x400?text=Sem+Imagem"]);
    expect(registro(p).Fotos).toBe("");
    expect(
      registro({ ...p, images: [...p.images, "https://example.org/foto.jpg"] })
        .Fotos,
    ).toBe("https://example.org/foto.jpg");
  });
  it("organiza cabeçalho em português e preserva texto, promoção e números", () => {
    const r = registro(produto());
    expect(Object.keys(r).slice(0, 6)).toEqual([
      "Código/SKU",
      "Nome",
      "Categoria",
      "Status",
      "Preço (R$)",
      "Preço original (R$)",
    ]);
    expect(r).toMatchObject({
      "Código/SKU": "P-01",
      Nome: 'Vestido "Verão", azul 🌻',
      Categoria: "Vestidos",
      Status: "Em Operação",
      "Preço (R$)": 80,
      "Preço original (R$)": 100,
      "Custo (R$)": 30,
      "Lucro por unidade (R$)": 50,
      "Margem (%)": 62.5,
      Estoque: 12,
      Descrição: "Algodão; leve\nFeito à mão",
      Fotos: "https://example.org/foto.jpg",
    });
  });

  it("não exporta o contador desatualizado de vendidos", () => {
    const linhas = linhasDosProdutos([produto({ sold: 987654 })], true);
    expect(linhas[0]).not.toContain("Vendidos");
    expect(linhas[1]).not.toContain(987654);
  });

  it("mostra o estoque-base quando só existem variantes desligadas", () => {
    const p = produto({
      variants: [variante({ active: false })],
    });
    const linhas = linhasDosProdutos([p], true);
    const [estoque, ativa] = ["Estoque", "Variante ativa"].map((coluna) =>
      linhas[0].indexOf(coluna),
    );
    expect(
      linhas.slice(1).map((linha) => [linha.at(estoque), linha.at(ativa)]),
    ).toEqual(
      expect.arrayContaining([
        [12, ""],
        [4, "Não"],
      ]),
    );
    expect(linhas).toHaveLength(3);
  });

  it("faz uma linha por variante, inclusive inativa, sem somar estoques nem perder preço zero", () => {
    const p = produto({
      variants: [
        variante({ priceOverride: 0 }),
        variante({ id: "v2", value: "G", active: false, stockIncrement: 9 }),
      ],
    });
    expect(linhasDosProdutos([p], true)).toHaveLength(3);
    expect(registro(p)).toMatchObject({
      "Código/SKU": "P-01",
      "SKU da variante": "V-M",
      "Preço (R$)": 0,
      Estoque: 4,
      Variante: "Tamanho: M",
      "Variante ativa": "Sim",
      "Margem (%)": "",
    });
    expect(registro(p, true, 2)).toMatchObject({
      Estoque: 9,
      "Preço (R$)": 80,
      "Variante ativa": "Não",
    });
  });

  it("preserva preço próprio não zero da variante e calcula lucro e margem sobre ele", () => {
    const base = produto({ price: 80, costPrice: 30 });
    expect(
      registro({ ...base, variants: [variante({ priceOverride: 120 })] }),
    ).toMatchObject({
      "Preço (R$)": 120,
      "Custo (R$)": 30,
      "Lucro por unidade (R$)": 90,
      "Margem (%)": 75,
    });
    expect(registro(base)).toMatchObject({
      "Preço (R$)": 80,
      "Lucro por unidade (R$)": 50,
      "Margem (%)": 62.5,
    });
  });

  it("não inclui qualquer coluna financeira quando não há permissão", () => {
    const linhas = linhasDosProdutos([produto({ costPrice: 123456 })], false);
    expect(linhas[0]).not.toContain("Custo (R$)");
    expect(linhas[0]).not.toContain("Lucro por unidade (R$)");
    expect(linhas[0]).not.toContain("Margem (%)");
    expect(linhas.flat()).not.toContain(123456);
  });

  it("custo ausente fica vazio; custo zero é conhecido e margem negativa é preservada", () => {
    expect(registro(produto({ costPrice: null }))).toMatchObject({
      "Custo (R$)": "",
      "Lucro por unidade (R$)": "",
      "Margem (%)": "",
    });
    expect(registro(produto({ costPrice: undefined }))["Custo (R$)"]).toBe("");
    expect(registro(produto({ costPrice: 0 }))).toMatchObject({
      "Custo (R$)": 0,
      "Lucro por unidade (R$)": 80,
      "Margem (%)": 100,
    });
    expect(registro(produto({ price: 10, costPrice: 20 }))).toMatchObject({
      "Lucro por unidade (R$)": -10,
      "Margem (%)": -100,
    });
  });

  it("sem foto/categoria/preço original não inventa dado; status é o do painel", () => {
    expect(
      registro(
        produto({
          category: "",
          images: [],
          originalPrice: null,
          isActive: false,
        }),
      ),
    ).toMatchObject({
      Categoria: "",
      Fotos: "",
      "Preço original (R$)": "",
      Status: "Oculto da loja",
    });
    expect(registro(produto({ stock: 0 }))).toMatchObject({
      Status: "Esgotado",
    });
    expect(linhasDosProdutos([], false)).toHaveLength(1);
  });

  it.each([
    "=1+1",
    "+1+1",
    "-1+1",
    "@SUM(A1)",
    "\t=1",
    "\r=1",
    "\n=1",
    "  =1+1",
  ])(
    "neutraliza %j em TODAS as células textuais, mas não números negativos",
    (texto) => {
      const p = produto({
        name: texto,
        sku: texto,
        category: texto,
        description: texto,
        images: [texto],
        tags: [texto],
        costPrice: 100,
        variants: [
          variante({
            name: texto,
            value: texto,
            sku: texto,
            codigoBarras: texto,
            imageUrl: texto,
          }),
        ],
      });
      const linhas = linhasDosProdutos([p], true);
      const celulas = linhas[1];
      expect(
        celulas.filter((c) => typeof c === "string" && /^[=+\-@\t\r]/.test(c)),
      ).toEqual([]);
      expect(registro(p).Nome).toBe(`'${texto}`);
      expect(registro(p)["Lucro por unidade (R$)"]).toBe(-20);
    },
  );

  it("exporta peso, dimensões e datas existentes sem inventar marca ou rascunho", () => {
    const r = registro(
      produto({ weightKg: 0.5, widthCm: 10, heightCm: 20, lengthCm: 30 }),
    );
    expect(r).toMatchObject({
      "Peso (kg)": 0.5,
      "Largura (cm)": 10,
      "Altura (cm)": 20,
      "Comprimento (cm)": 30,
      "Criado em": "14/11/2026 09:00",
      "Atualizado em": "15/11/2026 09:00",
    });
    expect(r).not.toHaveProperty("Marca");
  });
});
