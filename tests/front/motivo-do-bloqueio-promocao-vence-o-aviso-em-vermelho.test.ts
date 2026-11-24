// Quando o botão Publicar/Salvar está desligado por DUAS causas ao mesmo tempo
// (promoção ligada sem o preço de antes + algum campo com aviso em vermelho),
// a frase tem de falar da PROMOÇÃO: é a causa que a lojista resolve de um
// jeito só ("escreva o De ou desligue"). A frase genérica "corrija os avisos"
// mandaria ela procurar um aviso que pode nem estar na tela. Nenhum teste
// anterior combinava as duas causas, então trocar a ordem passava despercebido.
import {
  fraseCurtaDoBloqueio,
  motivoDoBloqueioDoProduto,
} from "@/utils/motivo-do-bloqueio-do-produto";
import { describe, expect, it } from "vitest";

const completo = {
  name: "Camiseta",
  description: "Algodão",
  price: "50",
  stock: "3",
  category: "Geral",
};

describe("promoção sem preço de antes + campo com aviso: vence a promoção", () => {
  it("frase completa", () => {
    expect(motivoDoBloqueioDoProduto(completo, true, false, true)).toBe(
      'Escreva o preço de antes ("De") ou desligue a promoção.',
    );
    expect(motivoDoBloqueioDoProduto(completo, true, true, true)).toBe(
      'Escreva o preço de antes ("De") ou desligue a promoção.',
    );
  });

  it("frase curta da barra", () => {
    expect(fraseCurtaDoBloqueio(completo, true, true)).toBe(
      "Falta o preço de antes",
    );
  });

  it("sem a promoção na conta, o aviso em vermelho volta a valer", () => {
    expect(motivoDoBloqueioDoProduto(completo, true, false, false)).toBe(
      "Para publicar, corrija os campos que estão com aviso em vermelho.",
    );
    expect(fraseCurtaDoBloqueio(completo, true, false)).toBe(
      "Corrija os avisos",
    );
  });
});

describe("cada campo obrigatório sozinho é nomeado", () => {
  it.each([
    ["name", "nome"],
    ["description", "descrição"],
    ["category", "categoria"],
    ["price", "preço de venda"],
    ["stock", "estoque"],
  ] as const)("só %s faltando diz '%s'", (campo, nome) => {
    expect(
      motivoDoBloqueioDoProduto({ ...completo, [campo]: "" }, false, false),
    ).toBe(`Para publicar, falta preencher: ${nome}.`);
    expect(fraseCurtaDoBloqueio({ ...completo, [campo]: "" }, false)).toBe(
      "Falta 1 campo",
    );
  });

  it("estoque '0' é um estoque preenchido (texto não vazio), não um campo faltando", () => {
    expect(
      motivoDoBloqueioDoProduto({ ...completo, stock: "0" }, false, false),
    ).toBe("Para publicar, confira os campos do formulário.");
  });
});
