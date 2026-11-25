// `src/utils/motivo-do-bloqueio-do-produto.ts`: o que os testes vizinhos
// deixavam passar (caça por mutação).
//
//  - `camposQueFaltam` devolve, com o nome do campo, o ID do campo da tela: é
//    o toque na barra "Falta 1 campo" que leva a lojista até ele. Um id trocado
//    leva o foco para lugar nenhum e nenhum teste da frase reclamava;
//  - o verbo ("salvar" ao editar, "publicar" ao criar) vale em TODAS as frases
//    com verbo, não só na de "falta preencher": os testes de antes só
//    combinavam `editando = true` com campo faltando.
import {
  camposQueFaltam,
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

describe("camposQueFaltam — nome e id de cada campo, na ordem da tela", () => {
  it("formulário vazio: os cinco, cada um com o id do campo da tela", () => {
    expect(
      camposQueFaltam({
        name: "",
        description: "",
        price: "",
        stock: "",
        category: "",
      }),
    ).toEqual([
      { nome: "nome", id: "product-name" },
      { nome: "descrição", id: "product-description" },
      { nome: "categoria", id: "product-category" },
      { nome: "preço de venda", id: "product-sale-price" },
      { nome: "estoque", id: "product-stock" },
    ]);
  });

  it("formulário completo: lista vazia", () => {
    expect(camposQueFaltam(completo)).toEqual([]);
  });

  it("o primeiro que falta é o que o toque da barra procura", () => {
    expect(camposQueFaltam({ ...completo, price: "", stock: "" })[0]).toEqual({
      nome: "preço de venda",
      id: "product-sale-price",
    });
  });
});

describe("motivoDoBloqueioDoProduto — o verbo acompanha editar/criar em todas as frases", () => {
  it("editando, com campo em vermelho: 'salvar'", () => {
    expect(motivoDoBloqueioDoProduto(completo, true, true)).toBe(
      "Para salvar, corrija os campos que estão com aviso em vermelho.",
    );
  });

  it("criando, com campo em vermelho: 'publicar'", () => {
    expect(motivoDoBloqueioDoProduto(completo, true, false)).toBe(
      "Para publicar, corrija os campos que estão com aviso em vermelho.",
    );
  });

  it("editando, sem causa conhecida: 'salvar'", () => {
    expect(motivoDoBloqueioDoProduto(completo, false, true)).toBe(
      "Para salvar, confira os campos do formulário.",
    );
  });

  it("criando, sem causa conhecida: 'publicar'", () => {
    expect(motivoDoBloqueioDoProduto(completo, false, false)).toBe(
      "Para publicar, confira os campos do formulário.",
    );
  });
});
