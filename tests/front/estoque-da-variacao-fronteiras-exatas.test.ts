// As FRONTEIRAS exatas do estoque de uma variação: 0, o máximo, e um a mais.
//
// O formulário do produto só grava variação cujo estoque é "um número inteiro
// de 0 a 10.000" (`estoqueDaVariacaoValido`). Cada borda é uma venda: se o 0
// virasse inválido a lojista não conseguiria salvar uma cor que acabou; se o
// máximo exato virasse inválido, a variação com o estoque cheio não salvaria;
// se o máximo + 1 passasse, o banco recusaria na hora de gravar.
//
// Mutações medidas (nenhum teste vizinho caía):
//   - `estoque >= 0`                   -> `estoque > 0`
//   - `estoque <= ESTOQUE_MAXIMO...`   -> `estoque < ESTOQUE_MAXIMO...`
//   - `Number(limpo) > ESTOQUE_MAXIMO` -> `>=` (em `erroDoEstoqueDaVariacao`)
// O 0 também passa pelo rascunho: `esvaziarEstoqueInvalidoDoRascunho` troca o
// que é inválido por NaN, então um 0 mal classificado viraria "campo vazio" e
// o saldo zerado de propósito se perderia ao restaurar o rascunho.
import { esvaziarEstoqueInvalidoDoRascunho } from "@/lib/rascunho-do-produto";
import type { ProductVariant } from "@/types";
import {
  MENSAGEM_ESTOQUE_MAXIMO_DA_VARIACAO,
  erroDoEstoqueDaVariacao,
  estoqueDaVariacaoValido,
} from "@/utils/estoque-da-variacao";
import { ESTOQUE_MAXIMO_DA_VARIACAO } from "@/utils/truth_gate";
import { describe, expect, it } from "vitest";

const MAX = ESTOQUE_MAXIMO_DA_VARIACAO;

const variacao = (stockIncrement: number): ProductVariant => ({
  id: "v1",
  productId: "p1",
  name: "Cor",
  value: "Azul",
  stockIncrement,
  active: true,
});

describe("estoqueDaVariacaoValido: as bordas", () => {
  it.each([
    [0, "zero (a cor acabou, e é um número como outro qualquer)"],
    [1, "uma unidade"],
    [MAX, "o máximo exato"],
  ])("%s é válido: %s", (estoque) => {
    expect(estoqueDaVariacaoValido(estoque)).toBe(true);
  });

  it.each([
    [MAX + 1, "um acima do máximo"],
    [-1, "negativo"],
    [1.5, "fracionário"],
    [Number.NaN, "campo vazio (NaN)"],
    [Number.POSITIVE_INFINITY, "infinito"],
    ["5", "texto, não número"],
    [null, "nulo"],
    [undefined, "ausente"],
  ])("%s é inválido: %s", (estoque) => {
    expect(estoqueDaVariacaoValido(estoque)).toBe(false);
  });
});

describe("erroDoEstoqueDaVariacao: as bordas do texto digitado", () => {
  it.each(["0", "1", String(MAX), ` ${MAX} `])("%j não tem erro", (texto) => {
    expect(erroDoEstoqueDaVariacao(texto, true)).toBeNull();
    expect(erroDoEstoqueDaVariacao(texto, false)).toBeNull();
  });

  it("um acima do máximo recusa com a frase do máximo", () => {
    expect(erroDoEstoqueDaVariacao(String(MAX + 1))).toBe(
      MENSAGEM_ESTOQUE_MAXIMO_DA_VARIACAO,
    );
  });

  it.each(["-1", "-0"])("%j recusa como negativo", (texto) => {
    expect(erroDoEstoqueDaVariacao(texto)).toBe(
      "O estoque da variação não pode ser negativo. Digite 0 ou mais.",
    );
  });

  it.each(["1,5", "1.5", "dez"])("%j recusa por não ser inteiro", (texto) => {
    expect(erroDoEstoqueDaVariacao(texto)).toBe(
      "Digite o estoque da variação só com números inteiros (sem vírgula nem ponto).",
    );
  });
});

describe("rascunho: o zero e o máximo sobrevivem, o inválido vira campo vazio", () => {
  it.each([0, 1, MAX])("estoque %s volta do rascunho como está", (estoque) => {
    const v = variacao(estoque);
    expect(esvaziarEstoqueInvalidoDoRascunho(v)).toBe(v);
  });

  it.each([MAX + 1, -1])(
    "estoque %s (inválido) vira NaN, sem inventar outro número",
    (estoque) => {
      expect(
        Number.isNaN(
          esvaziarEstoqueInvalidoDoRascunho(variacao(estoque)).stockIncrement,
        ),
      ).toBe(true);
    },
  );
});
