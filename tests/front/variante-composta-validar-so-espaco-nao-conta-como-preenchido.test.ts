// `validarAtributos` (última trava do modal de variante composta): campo com só
// espaço NÃO é preenchido. Sem aparar o espaço, "   " passaria como nome ou
// valor válido, o modal efetivaria a variante e `juntarAtributos` (que apara)
// gravaria uma linha de `product_variants` com nome ou valor VAZIO — a linha
// pela metade que esta trava existe para impedir.
import { validarAtributos } from "@/utils/variante-composta";
import { describe, expect, it } from "vitest";

const NADA_PREENCHIDO =
  "Preencha o atributo (ex: Cor) e o valor (ex: Espacial Grey).";
const NOME_OBRIGATORIO = "O nome do atributo (ex: Cor, Tamanho) é obrigatório.";
const VALOR_OBRIGATORIO =
  "O valor do atributo (ex: Espacial Grey) é obrigatório.";

describe("validarAtributos — só espaço não é preenchido", () => {
  it("nome só com espaço e valor preenchido: o nome é obrigatório", () => {
    expect(validarAtributos([{ name: "   ", value: "Branca" }])).toBe(
      NOME_OBRIGATORIO,
    );
  });

  it("valor só com espaço e nome preenchido: o valor é obrigatório", () => {
    expect(validarAtributos([{ name: "Cor", value: "   " }])).toBe(
      VALOR_OBRIGATORIO,
    );
  });

  it("par com nome e valor só de espaço é sobra: nada preenchido", () => {
    expect(validarAtributos([{ name: "  ", value: "  " }])).toBe(
      NADA_PREENCHIDO,
    );
  });

  it("nome só de espaço com valor vazio é sobra, não 'nome obrigatório'", () => {
    expect(validarAtributos([{ name: "  ", value: "" }])).toBe(NADA_PREENCHIDO);
  });

  it("valor só de espaço com nome vazio é sobra, não 'nome obrigatório'", () => {
    expect(validarAtributos([{ name: "", value: "  " }])).toBe(NADA_PREENCHIDO);
  });

  it("sobra de espaço ao lado de um par completo não atrapalha", () => {
    expect(
      validarAtributos([
        { name: "Cor", value: "Branca" },
        { name: "  ", value: "  " },
      ]),
    ).toBeNull();
  });
});
