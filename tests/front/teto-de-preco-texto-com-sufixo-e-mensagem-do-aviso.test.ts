// O teto de preço do formulário de produto (`src/utils/teto-de-preco.ts`):
//   · o texto do campo é lido como o navegador lê um número digitado, até onde
//     ele for número: "12000000,50" ou "12000000abc" (vírgula brasileira ou
//     lixo colado depois) continua passando do teto — com `Number(texto)` o
//     valor viraria NaN e escaparia do aviso;
//   · a frase do aviso fala do mesmo teto e pede um valor menor.
import {
  acimaDoTetoDePreco,
  mensagemDePrecoAcimaDoTeto,
} from "@/utils/teto-de-preco";
import { describe, expect, it } from "vitest";

describe("acimaDoTetoDePreco — texto com sufixo", () => {
  it.each(["12000000,50", "12000000abc", "12000000 reais", "10000000.00"])(
    "'%s' está acima do teto",
    (texto) => {
      expect(acimaDoTetoDePreco(texto)).toBe(true);
    },
  );

  it.each(["9999999,99", "9999999abc", "R$ 99", "1e3", "0"])(
    "'%s' não está acima do teto",
    (texto) => {
      expect(acimaDoTetoDePreco(texto)).toBe(false);
    },
  );
});

describe("mensagemDePrecoAcimaDoTeto", () => {
  it("diz o sujeito, o teto exato e o que fazer", () => {
    expect(mensagemDePrecoAcimaDoTeto("O preço de venda")).toBe(
      "O preço de venda passa do máximo de R$ 9.999.999,99. Use um valor menor.",
    );
    expect(mensagemDePrecoAcimaDoTeto("O preço desta variação")).toBe(
      "O preço desta variação passa do máximo de R$ 9.999.999,99. Use um valor menor.",
    );
  });
});
