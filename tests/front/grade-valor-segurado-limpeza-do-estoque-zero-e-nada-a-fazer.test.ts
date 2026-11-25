// Bordas do "valor segurado" da grade que nenhum teste anterior cobria:
//  - o estoque segurado é limpo de TODO caractere não numérico (não só do
//    primeiro): "1.000.000" vira "1000000", nunca "1000000" pela metade;
//  - estoque segurado "0" é um valor de verdade (zero unidades) e preenche as
//    linhas em aberto; já estoque segurado VAZIO nunca apaga o estoque que a
//    lojista deixou numa linha;
//  - estoque de linha só com espaços, já mexido, é campo apagado (em aberto);
//  - quando nada foi preenchido, o resultado é a MESMA lista, sem o aviso.
import { describe, expect, it } from "vitest";

import { preencherComSegurado } from "@/utils/grade-valor-segurado";

describe("preencherComSegurado — limpeza e bordas", () => {
  it("limpa todos os não-dígitos do estoque segurado, não só o primeiro", () => {
    const { linhas, preencheu } = preencherComSegurado(
      [{ estoque: "", preco: "10" }],
      "1.000.000",
      "",
    );

    expect(preencheu).toBe(true);
    expect(linhas[0]?.estoque).toBe("1000000");
  });

  it("estoque segurado 0 é um valor real e preenche a linha em aberto", () => {
    const { linhas, preencheu } = preencherComSegurado(
      [{ estoque: "", preco: "10", estoqueEditado: false }],
      "0",
      "",
    );

    expect(preencheu).toBe(true);
    expect(linhas[0]?.estoque).toBe("0");
  });

  it("estoque segurado vazio NÃO apaga o estoque da linha quando só o preço foi segurado", () => {
    const { linhas, preencheu } = preencherComSegurado(
      [{ estoque: "5", preco: "", estoqueEditado: false }],
      "",
      "49,90",
    );

    expect(preencheu).toBe(true);
    expect(linhas[0]?.estoque).toBe("5");
    expect(linhas[0]?.preco).toBe("49.90");
  });

  it("estoque da linha só com espaços, já mexido, conta como apagado e recebe o segurado", () => {
    const { linhas } = preencherComSegurado(
      [{ estoque: "  ", preco: "10", estoqueEditado: true }],
      "5",
      "",
    );

    expect(linhas[0]?.estoque).toBe("5");
  });

  it("preço segurado vazio e estoque já decidido em todas as linhas: nada muda, mesma lista e sem aviso", () => {
    const entrada = [
      { estoque: "3", preco: "7", estoqueEditado: true },
      { estoque: "4", preco: "", estoqueEditado: true },
    ];

    const resultado = preencherComSegurado(entrada, "5", "");

    expect(resultado.preencheu).toBe(false);
    expect(resultado.linhas).toBe(entrada);
  });
});
