// A frase que o formulário mostra quando o preço passa do teto tem de dizer o
// MESMO valor que a conta usa para barrar. Os testes de fronteira já provavam
// a conta (9.999.999,99 passa, um centavo a mais não), mas nenhum lia a frase:
// ela podia prometer "máximo de R$ 10.000.000,00" enquanto o campo barrava em
// 9.999.999,99, e a lojista ficaria sem entender por que o salvar recusa.
import { describe, expect, it } from "vitest";

import {
  acimaDoTetoDePreco,
  mensagemDePrecoAcimaDoTeto,
} from "@/utils/teto-de-preco";

describe("mensagem de preço acima do teto", () => {
  it("começa pelo sujeito da tela e diz o que fazer", () => {
    expect(mensagemDePrecoAcimaDoTeto("O preço de venda")).toBe(
      "O preço de venda passa do máximo de R$ 9.999.999,99. Use um valor menor.",
    );
    expect(mensagemDePrecoAcimaDoTeto("O preço desta variação")).toContain(
      "O preço desta variação passa do máximo",
    );
  });

  it("o valor escrito na frase é exatamente o limite que a conta usa", () => {
    const frase = mensagemDePrecoAcimaDoTeto("O custo");
    const casado = /R\$ ([\d.]+,\d{2})/.exec(frase);
    expect(casado).not.toBeNull();
    const limiteDito = Number(
      (casado?.[1] ?? "").replace(/\./g, "").replace(",", "."),
    );

    // O que a frase chama de "máximo" ainda passa; um centavo a mais, não.
    expect(acimaDoTetoDePreco(limiteDito)).toBe(false);
    expect(acimaDoTetoDePreco(limiteDito + 0.01)).toBe(true);
  });
});
