// `fraseCurtaDoBloqueio` (barra de baixo do formulário de produto) chamada SEM o
// terceiro argumento, que é opcional: o padrão tem de ser "sem promoção
// quebrada". Se o padrão virasse "promoção sem preço original", um formulário
// completo, só com um campo em vermelho, diria "Falta o preço de antes" — uma
// frase que manda a lojista procurar um campo que ela nem ligou.
import { fraseCurtaDoBloqueio } from "@/utils/motivo-do-bloqueio-do-produto";
import { describe, expect, it } from "vitest";

const completos = {
  name: "Camiseta",
  description: "Algodão",
  price: "49,90",
  stock: "3",
  category: "Roupas",
};

describe("fraseCurtaDoBloqueio — terceiro argumento omitido", () => {
  it("campo com aviso em vermelho e sem o argumento da promoção: 'Corrija os avisos'", () => {
    expect(fraseCurtaDoBloqueio(completos, true)).toBe("Corrija os avisos");
  });

  it("nada em vermelho e sem o argumento da promoção: 'Confira os campos'", () => {
    expect(fraseCurtaDoBloqueio(completos, false)).toBe("Confira os campos");
  });

  it("controle: com o argumento ligado a promoção vence o aviso em vermelho", () => {
    expect(fraseCurtaDoBloqueio(completos, true, true)).toBe(
      "Falta o preço de antes",
    );
  });
});
