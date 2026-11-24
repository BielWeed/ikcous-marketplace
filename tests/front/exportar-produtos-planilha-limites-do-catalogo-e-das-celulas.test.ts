// Protege os limites que a planilha de produtos ainda não tinha vigiados:
// (1) a leitura do catálogo inteiro recusa produto sem id, página que traz
// mais do que o total e total que não é número inteiro (sem sair pedindo
// páginas ao servidor); (2) as células: Sim/Não de destaque e frete grátis,
// etiquetas, lista de fotos (relativa fica, placeholder sai), lucro e margem
// sem sujeira de ponto flutuante no XLSX, linha-base escondida quando o
// estoque é zero, datas cruas no XLSX e em horário de Brasília no CSV, e o
// apóstrofo de proteção também para texto que só ABRE com TAB, CR ou LF.
import {
  lerCatalogoInteiro,
  linhasDosProdutos,
} from "@/lib/exportar-produtos-planilha";
import type { Product, ProductVariant } from "@/types";
import { describe, expect, it, vi } from "vitest";

const produto = (dados: Partial<Product> = {}): Product => ({
  id: "p1",
  sku: "P-01",
  name: "Vestido inventado",
  description: "Descrição inventada",
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
  createdAt: "2026-09-08T12:07:00Z",
  updatedAt: "2026-09-09T12:07:00Z",
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

function registros(
  produtos: Product[],
  formato: "xlsx" | "csv" = "csv",
  custos = true,
) {
  const linhas = linhasDosProdutos(produtos, custos, formato);
  return linhas
    .slice(1)
    .map((linha) =>
      Object.fromEntries(linha.map((valor, i) => [linhas[0].at(i), valor])),
    );
}

describe("leitura do catálogo inteiro: limites", () => {
  it("produto sem id é recusado, mesmo sendo o único da página", async () => {
    const lerPagina = vi.fn().mockResolvedValue({
      products: [produto({ id: "" })],
      total: 1,
    });
    await expect(lerCatalogoInteiro(lerPagina)).rejects.toThrow(
      "O catálogo mudou durante a leitura",
    );
  });

  it("página com mais produtos do que o total para na hora, sem pedir outra página", async () => {
    const lerPagina = vi
      .fn()
      .mockResolvedValueOnce({
        products: [produto({ id: "a" }), produto({ id: "b" })],
        total: 1,
      })
      // Se a leitura insistir e pedir a página seguinte, o erro denuncia (e o
      // teste não fica preso num laço sem fim).
      .mockRejectedValue(new Error("pediu outra página ao servidor"));
    await expect(lerCatalogoInteiro(lerPagina)).rejects.toThrow(
      "Não foi possível conferir o catálogo.",
    );
    expect(lerPagina).toHaveBeenCalledTimes(1);
  });

  it("total que não é inteiro é recusado já na primeira página", async () => {
    const lerPagina = vi
      .fn()
      .mockResolvedValueOnce({ products: [produto()], total: 1.5 })
      .mockResolvedValue({ products: [], total: 1.5 });
    await expect(lerCatalogoInteiro(lerPagina)).rejects.toThrow(
      "O catálogo mudou durante a leitura",
    );
    expect(lerPagina).toHaveBeenCalledTimes(1);
  });
});

describe("células da planilha de produtos: limites", () => {
  it("Destaque e Frete grátis dizem Sim quando é verdade e Não quando não é", () => {
    const [verdade, mentira] = registros([
      produto({ id: "a", isBestseller: true, freeShipping: true }),
      produto({ id: "b", isBestseller: false, freeShipping: false }),
    ]);
    expect(verdade.Destaque).toBe("Sim");
    expect(verdade["Frete grátis"]).toBe("Sim");
    expect(mentira.Destaque).toBe("Não");
    expect(mentira["Frete grátis"]).toBe("Não");
    const [soDestaque] = registros([
      produto({ isBestseller: true, freeShipping: false }),
    ]);
    expect(soDestaque.Destaque).toBe("Sim");
    expect(soDestaque["Frete grátis"]).toBe("Não");
  });

  it("etiquetas saem separadas por vírgula e espaço; sem etiqueta, a célula fica vazia", () => {
    const [com, sem] = registros([
      produto({ id: "a", tags: ["verão", "promoção", "novo"] }),
      produto({ id: "b", tags: undefined }),
    ]);
    expect(com.Etiquetas).toBe("verão, promoção, novo");
    expect(sem.Etiquetas).toBe("");
  });

  it("fotos: uma por linha, endereço relativo fica e só o placeholder sai", () => {
    const [r] = registros([
      produto({
        images: [
          "/fotos/a.jpg",
          "https://placehold.co/600x600.png",
          "https://cdn.exemplo.org/b.jpg",
        ],
      }),
    ]);
    expect(r.Fotos).toBe("/fotos/a.jpg\nhttps://cdn.exemplo.org/b.jpg");
  });

  it("lucro e margem no XLSX saem em centavos exatos, sem sujeira de ponto flutuante", () => {
    // 0,3 - 0,1 dá 0.19999999999999998 em ponto flutuante; 2/3 dá 66.666...
    const [r] = registros(
      [produto({ price: 0.3, costPrice: 0.1, originalPrice: null })],
      "xlsx",
    );
    expect(r["Lucro por unidade (R$)"]).toBe(0.2);
    const [r2] = registros(
      [produto({ price: 3, costPrice: 1, originalPrice: null })],
      "xlsx",
    );
    expect(r2["Lucro por unidade (R$)"]).toBe(2);
    expect(r2["Margem (%)"]).toBe(66.67);
  });

  it("estoque zero com todas as variantes desligadas não inventa linha da base", () => {
    const linhas = registros([
      produto({
        stock: 0,
        variants: [
          variante({ id: "v1", value: "P", active: false }),
          variante({ id: "v2", value: "M", active: false }),
        ],
      }),
    ]);
    expect(linhas.map((l) => l["ID da variante"])).toEqual(["v1", "v2"]);
  });

  it("controle: estoque positivo com todas as variantes desligadas mostra a base e as variantes", () => {
    const linhas = registros([
      produto({
        stock: 5,
        variants: [variante({ id: "v1", active: false })],
      }),
    ]);
    expect(linhas.map((l) => l["ID da variante"])).toEqual(["", "v1"]);
  });

  it("datas: o XLSX recebe o instante cru e o CSV recebe o horário de Brasília", () => {
    const p = produto({
      createdAt: "2026-09-08T12:07:00Z",
      updatedAt: "2026-11-02T02:50:00Z",
    });
    const [x] = registros([p], "xlsx");
    expect(x["Criado em"]).toBe("2026-09-08T12:07:00Z");
    expect(x["Atualizado em"]).toBe("2026-11-02T02:50:00Z");
    const [c] = registros([p], "csv");
    expect(c["Criado em"]).toBe("08/09/2026 09:07");
    expect(c["Atualizado em"]).toBe("01/11/2026 23:50");
  });

  it.each([
    ["\tMaria", "'\tMaria"],
    ["\rMaria", "'\rMaria"],
    ["\nMaria", "'\nMaria"],
    ["Maria\tSouza", "Maria\tSouza"],
    ["Maria =1", "Maria =1"],
  ])(
    "CSV: nome %j sai como %j (só o começo do texto é perigoso)",
    (nome, esperado) => {
      const [r] = registros([produto({ name: nome })], "csv");
      expect(r.Nome).toBe(esperado);
    },
  );
});
