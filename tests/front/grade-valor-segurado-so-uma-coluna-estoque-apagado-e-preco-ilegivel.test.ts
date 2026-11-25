// `preencherComSegurado` (`src/utils/grade-valor-segurado.ts`): o valor que a
// lojista digitou em "Aplicar para todas" e NÃO aplicou fica segurado e é
// preenchido nas linhas ao efetivar a grade. Os testes que já existiam sempre
// seguravam estoque E preço ao mesmo tempo; três casos ficavam soltos:
//
//  1. Só UMA das duas colunas segurada (a lojista digitou o estoque e não
//     mexeu no preço, ou o contrário): a que foi digitada precisa chegar às
//     linhas. Se a função desistisse quando uma das duas está vazia, o produto
//     ficaria com estoque 0 mesmo com "10" digitado em "Aplicar para todas".
//  2. Linha cujo estoque ela APAGOU (campo vazio) depois de ter mexido nele:
//     vazio é "não decidi", então recebe o segurado, mesmo marcada como editada.
//  3. Preço da linha que não é número ("x", só espaços): conta como "Auto" e
//     recebe o preço segurado; um "x" nunca vira preço que a loja cobra.
import {
  type LinhaComValores,
  preencherComSegurado,
} from "@/utils/grade-valor-segurado";
import { describe, expect, it } from "vitest";

describe("preencherComSegurado — só uma coluna segurada", () => {
  it("só o estoque segurado: preenche o estoque e deixa o preço como está", () => {
    const linhas: LinhaComValores[] = [
      { estoque: "", preco: "" },
      { estoque: "", preco: "30" },
    ];

    const { linhas: depois, preencheu } = preencherComSegurado(
      linhas,
      "10",
      "",
    );

    expect(preencheu).toBe(true);
    expect(depois).toEqual([
      { estoque: "10", preco: "" },
      { estoque: "10", preco: "30" },
    ]);
  });

  it("só o preço segurado: preenche o preço vazio e deixa o estoque como está", () => {
    const linhas: LinhaComValores[] = [
      { estoque: "3", preco: "", estoqueEditado: true },
      { estoque: "0", preco: "12.50", estoqueEditado: true },
    ];

    const { linhas: depois, preencheu } = preencherComSegurado(
      linhas,
      "",
      "49,90",
    );

    expect(preencheu).toBe(true);
    expect(depois).toEqual([
      { estoque: "3", preco: "49.90", estoqueEditado: true },
      { estoque: "0", preco: "12.50", estoqueEditado: true },
    ]);
  });

  it("segurado vazio nos dois: nada muda e a lista devolvida é a mesma", () => {
    const linhas: LinhaComValores[] = [{ estoque: "", preco: "" }];

    const resultado = preencherComSegurado(linhas, "", "");

    expect(resultado.preencheu).toBe(false);
    expect(resultado.linhas).toBe(linhas);
  });
});

describe("preencherComSegurado — estoque apagado e preço ilegível", () => {
  it("estoque apagado depois de editado volta a ser 'não decidido' e recebe o segurado", () => {
    const linhas: LinhaComValores[] = [
      { estoque: "", preco: "30", estoqueEditado: true },
    ];

    const { linhas: depois } = preencherComSegurado(linhas, "10", "");

    expect(depois).toEqual([
      { estoque: "10", preco: "30", estoqueEditado: true },
    ]);
  });

  it("estoque 0 digitado de propósito (editado) continua 0", () => {
    const linhas: LinhaComValores[] = [
      { estoque: "0", preco: "30", estoqueEditado: true },
    ];

    const resultado = preencherComSegurado(linhas, "10", "");

    expect(resultado.preencheu).toBe(false);
    expect(resultado.linhas).toEqual([
      { estoque: "0", preco: "30", estoqueEditado: true },
    ]);
  });

  it.each(["x", "   ", "abc"])(
    "preço da linha '%s' (não é número) conta como Auto e recebe o preço segurado",
    (ilegivel) => {
      const linhas: LinhaComValores[] = [
        { estoque: "5", preco: ilegivel, estoqueEditado: true },
      ];

      const { linhas: depois } = preencherComSegurado(linhas, "", "49.90");

      expect(depois[0].preco).toBe("49.90");
    },
  );
});
