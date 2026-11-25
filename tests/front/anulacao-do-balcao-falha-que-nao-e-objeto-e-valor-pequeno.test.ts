// ANULAR VENDA DO BALCÃO — duas bordas que `anulacao-do-balcao-regras.test.ts`
// deixa passar:
//  1. a falha chega em formato que NÃO é o de erro do banco (`null`, texto solto,
//     número, objeto sem `code`/`message`, `message` que não é texto). Antes de
//     ler `code`/`message`, o código confere o formato; se esta conferência
//     sumisse, `null` derrubaria a tela com TypeError em vez de mandar o
//     lojista conferir a venda;
//  2. venda de valor pequeno (R$ 1,00 e centavos) ainda manda devolver o dinheiro.
import { describe, expect, it } from "vitest";

import {
  FRASE_SEM_CONEXAO_DA_ANULACAO,
  mensagemDaFalhaDaAnulacao,
  orientacaoDeDevolucao,
} from "@/lib/anulacao-do-balcao";

const FRASE_GENERICA = "Não consegui anular agora. Tente de novo.";

describe("mensagemDaFalhaDaAnulacao — falha que não tem a forma de erro do banco", () => {
  const SEM_FORMA: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["texto solto", "falhou"],
    ["número", 42],
    ["booleano", true],
    ["objeto vazio", {}],
    ["objeto só com message", { message: "boom" }],
    ["code que não é texto", { code: 42, message: "boom" }],
    ["code vazio (fetch que falhou)", { code: "", message: "Failed to fetch" }],
  ];

  for (const [nome, erro] of SEM_FORMA) {
    it(`${nome}: manda conferir a venda, sem derrubar a tela`, () => {
      expect(mensagemDaFalhaDaAnulacao(erro)).toBe(
        FRASE_SEM_CONEXAO_DA_ANULACAO,
      );
    });
  }

  it("`message` que não é texto, com código desconhecido, cai na frase genérica sem estourar", () => {
    expect(mensagemDaFalhaDaAnulacao({ code: "XX000", message: 42 })).toBe(
      FRASE_GENERICA,
    );
    expect(mensagemDaFalhaDaAnulacao({ code: "XX000", message: null })).toBe(
      FRASE_GENERICA,
    );
  });

  it("`message` em branco no 22023 não vira frase vazia: usa a frase própria da tela", () => {
    for (const message of ["", "   "]) {
      expect(mensagemDaFalhaDaAnulacao({ code: "22023", message })).toBe(
        "Esta venda não pode ser anulada aqui.",
      );
    }
  });
});

describe("orientacaoDeDevolucao — valor pequeno ainda é dinheiro a devolver", () => {
  it("R$ 1,00 exato manda devolver (não é 'venda sem valor')", () => {
    expect(orientacaoDeDevolucao("cash", 1)).toMatch(
      /^Devolva R\$\s1,00 em dinheiro ao cliente\.$/,
    );
  });

  it("centavos mandam devolver: R$ 0,50 e R$ 0,01", () => {
    expect(orientacaoDeDevolucao("pix", 0.5)).toMatch(
      /^Devolva R\$\s0,50 ao cliente por PIX\.$/,
    );
    expect(orientacaoDeDevolucao("card", 0.01)).toMatch(
      /^Faça o estorno de R\$\s0,01 na maquininha\.$/,
    );
  });

  it("valor negativo é tratado como venda sem valor", () => {
    expect(orientacaoDeDevolucao("cash", -5)).toBe(
      "A venda não tinha valor: não há dinheiro a devolver.",
    );
  });
});
