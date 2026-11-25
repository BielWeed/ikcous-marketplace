import { pontuadorDaBusca } from "@/lib/busca-de-produtos";
import { describe, expect, it } from "vitest";

type ProdutoDaBusca = Parameters<ReturnType<typeof pontuadorDaBusca>>[0];

const nota = (busca: string, produto: ProdutoDaBusca) =>
  pontuadorDaBusca(busca)(produto);

// Os testes de relevância que já existem comparam "A vem antes de B". Faltava
// a conta que sustenta a promessa do código: o SKU exato tem de passar até o
// MELHOR produto que não tem o código. A margem é de 1 ponto, então um número
// trocado por um a menos já faria o produto certo empatar com outro.
describe("relevância da busca: o código exato passa a soma máxima sem código", () => {
  const buscas = [
    { busca: "bolsa", palavras: 1 },
    { busca: "bolsa preta", palavras: 2 },
    { busca: "bolsa preta grande", palavras: 3 },
  ];

  it.each(buscas)(
    "$palavras palavra(s): o melhor produto sem código exato soma 150 + 35 por palavra",
    ({ busca, palavras }) => {
      const melhorSemCodigo = {
        name: busca,
        category: busca,
        description: busca,
        // código que CONTÉM a busca, mas não é igual: vale só o parcial.
        sku: `${busca} x`,
      };
      // nome igual (100) + categoria igual (40) + descrição (5) + código
      // parcial (5) + nome (20) e categoria (15) por palavra.
      expect(nota(busca, melhorSemCodigo)).toBe(150 + 35 * palavras);
    },
  );

  it.each(buscas)(
    "$palavras palavra(s): produto que só tem o SKU exato fica ACIMA do melhor sem código",
    ({ busca }) => {
      const melhorSemCodigo = {
        name: busca,
        category: busca,
        description: busca,
        sku: `${busca} x`,
      };
      const soPeloCodigo = { name: "Peça", category: "Outros", sku: busca };
      expect(nota(busca, soPeloCodigo)).toBeGreaterThan(
        nota(busca, melhorSemCodigo),
      );
    },
  );

  it.each(buscas)(
    "$palavras palavra(s): o mesmo vale quando o código exato está numa variação ativa",
    ({ busca }) => {
      const melhorSemCodigo = {
        name: busca,
        category: busca,
        description: busca,
        sku: `${busca} x`,
      };
      const soPelaVariacao = {
        name: "Peça",
        category: "Outros",
        variants: [{ value: "P", active: true, sku: busca }],
      };
      expect(nota(busca, soPelaVariacao)).toBeGreaterThan(
        nota(busca, melhorSemCodigo),
      );
    },
  );
});

describe("relevância da busca: o peso de cada palavra", () => {
  it("palavra achada no NOME vale mais que a mesma palavra achada só na categoria", () => {
    // Busca com as palavras fora de ordem: nenhuma das duas frases bate
    // inteira, então só o peso por palavra decide.
    const noNome = { name: "Vestido Azul", category: "Outros" };
    const naCategoria = { name: "Peça", category: "Vestido Azul" };
    expect(nota("azul vestido", noNome)).toBe(40);
    expect(nota("azul vestido", naCategoria)).toBe(30);
    expect(nota("azul vestido", noNome)).toBeGreaterThan(
      nota("azul vestido", naCategoria),
    );
  });

  it("produto sem nenhuma palavra da busca fica em zero", () => {
    expect(
      nota("azul vestido", { name: "Bolsa", category: "Acessórios" }),
    ).toBe(0);
  });
});
