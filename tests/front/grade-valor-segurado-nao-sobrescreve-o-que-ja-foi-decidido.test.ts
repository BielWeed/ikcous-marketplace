// `preencherComSegurado` (`src/utils/grade-valor-segurado.ts`): o valor
// SEGURADO de "Aplicar para todas" só preenche o que a lojista ainda não
// decidiu. O que ela já decidiu numa coluna não pode ser sobrescrito só porque
// a OUTRA coluna da mesma linha está em aberto:
//
//  - linha com preço digitado e estoque vazio: o estoque é preenchido e o preço
//    digitado fica (inclusive R$ 0,00 de brinde);
//  - linha com estoque que ela digitou e preço vazio: o preço é preenchido e o
//    estoque digitado fica;
//  - nada a preencher: nenhuma linha nova, a lista devolvida é a MESMA (a tela
//    não refaz o que já está certo) e `preencheu` é falso.
import {
  type LinhaComValores,
  preencherComSegurado,
} from "@/utils/grade-valor-segurado";
import { describe, expect, it } from "vitest";

describe("preencherComSegurado — uma coluna decidida, a outra em aberto", () => {
  it("preço digitado na linha fica; só o estoque vazio é preenchido", () => {
    const linhas: LinhaComValores[] = [{ estoque: "", preco: "30" }];
    const { linhas: depois, preencheu } = preencherComSegurado(
      linhas,
      "10",
      "49.90",
    );
    expect(preencheu).toBe(true);
    expect(depois).toEqual([{ estoque: "10", preco: "30" }]);
  });

  it("preço 0,00 de brinde digitado na linha não é sobrescrito", () => {
    const linhas: LinhaComValores[] = [{ estoque: "", preco: "0.00" }];
    const { linhas: depois } = preencherComSegurado(linhas, "10", "49.90");
    expect(depois).toEqual([{ estoque: "10", preco: "0.00" }]);
  });

  it("estoque que a lojista digitou fica; só o preço vazio é preenchido", () => {
    const linhas: LinhaComValores[] = [
      { estoque: "7", preco: "", estoqueEditado: true },
    ];
    const { linhas: depois, preencheu } = preencherComSegurado(
      linhas,
      "10",
      "49.90",
    );
    expect(preencheu).toBe(true);
    expect(depois).toEqual([
      { estoque: "7", preco: "49.90", estoqueEditado: true },
    ]);
  });
});

describe("preencherComSegurado — nada a preencher", () => {
  it("estoque já igual ao segurado e nunca mexido: não preenche, devolve a mesma lista", () => {
    const linhas: LinhaComValores[] = [
      { estoque: "5", preco: "", estoqueEditado: false },
    ];
    const resultado = preencherComSegurado(linhas, "5", "");
    expect(resultado.preencheu).toBe(false);
    expect(resultado.linhas).toBe(linhas);
  });

  it("segurado vazio nos dois campos devolve a mesma lista", () => {
    const linhas: LinhaComValores[] = [{ estoque: "", preco: "" }];
    const resultado = preencherComSegurado(linhas, "", "");
    expect(resultado.preencheu).toBe(false);
    expect(resultado.linhas).toBe(linhas);
  });
});
