// A frase que o formulário de produto mostra enquanto o botão Publicar/Salvar
// está desligado. A regra de quando o botão desliga mora em `isValid` de
// AdminProductFormView; a tela é testada em
// admin-product-form-variacao-sku-e-publicar-diz-o-que-falta.test.tsx. Aqui,
// só a frase.
import {
  motivoDoBloqueioDoProduto,
  motivoDoEnvioDeFotos,
} from "@/utils/motivo-do-bloqueio-do-produto";
import { describe, expect, it } from "vitest";

const completo = {
  name: "Camiseta",
  description: "Algodão",
  price: "50",
  stock: "3",
  category: "Geral",
};

describe("motivoDoBloqueioDoProduto", () => {
  it("lista só o que falta, na ordem da tela", () => {
    expect(
      motivoDoBloqueioDoProduto(
        { ...completo, description: "", category: "" },
        false,
        false,
      ),
    ).toBe("Para publicar, falta preencher: descrição, categoria.");
  });

  it("formulário vazio lista os cinco campos obrigatórios", () => {
    expect(
      motivoDoBloqueioDoProduto(
        { name: "", description: "", price: "", stock: "", category: "" },
        false,
        false,
      ),
    ).toBe(
      "Para publicar, falta preencher: nome, descrição, categoria, preço de venda, estoque.",
    );
  });

  it("produto já salvo fala em salvar, não em publicar", () => {
    expect(
      motivoDoBloqueioDoProduto({ ...completo, name: "" }, false, true),
    ).toBe("Para salvar, falta preencher: nome.");
  });

  it("nada faltando mas há campo com erro: manda olhar os avisos em vermelho", () => {
    expect(motivoDoBloqueioDoProduto(completo, true, false)).toBe(
      "Para publicar, corrija os campos que estão com aviso em vermelho.",
    );
  });

  it("falta campo E há erro: o que falta vem primeiro (é o que se resolve digitando)", () => {
    expect(
      motivoDoBloqueioDoProduto({ ...completo, name: "" }, true, false),
    ).toMatch(/falta preencher: nome/);
  });

  it("nem falta nem erro conhecido: ainda assim devolve uma frase (nunca vazio)", () => {
    expect(motivoDoBloqueioDoProduto(completo, false, false)).toBe(
      "Para publicar, confira os campos do formulário.",
    );
  });
});

describe("motivoDoEnvioDeFotos", () => {
  it("diz a foto da vez dentro do lote", () => {
    expect(motivoDoEnvioDeFotos({ atual: 2, total: 3 }, false)).toBe(
      "Enviando fotos… (2 de 3). O botão libera quando terminar.",
    );
  });

  it("sem progresso conhecido ainda diz que está enviando", () => {
    expect(motivoDoEnvioDeFotos(null, false)).toMatch(/^Enviando fotos/);
  });

  it("envio do recorte tem frase própria", () => {
    expect(motivoDoEnvioDeFotos({ atual: 1, total: 1 }, true)).toMatch(
      /foto ajustada/,
    );
  });
});
