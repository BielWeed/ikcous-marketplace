import { describe, expect, it } from "vitest";

import {
  type EntradaDeAvisos,
  LIMIAR_PADRAO_DE_ESTOQUE,
  montarAvisos,
  precisaDeReposicao,
} from "@/utils/avisos-do-lojista";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

describe("precisaDeReposicao — a guarda e' de LIMIAR, nao binaria", () => {
  it("usa o estoque_minimo do proprio produto quando ele existe", () => {
    expect(precisaDeReposicao(2, 2)).toBe(true);
    expect(precisaDeReposicao(1, 2)).toBe(true);
    expect(precisaDeReposicao(3, 2)).toBe(false);
  });

  it("cai no padrao do projeto (5) quando estoque_minimo e' nulo", () => {
    expect(LIMIAR_PADRAO_DE_ESTOQUE).toBe(5);
    expect(precisaDeReposicao(5, null)).toBe(true);
    expect(precisaDeReposicao(6, null)).toBe(false);
  });

  it("estoque zerado tambem precisa de reposicao", () => {
    expect(precisaDeReposicao(0, null)).toBe(true);
  });

  it("um estoque_minimo de zero nao vira o padrao 5", () => {
    // `?? 5` e' obrigatorio aqui; `|| 5` transformaria 0 em 5 e acusaria
    // reposicao em produto que o lojista marcou como "nunca avisar".
    expect(precisaDeReposicao(3, 0)).toBe(false);
    expect(precisaDeReposicao(0, 0)).toBe(true);
  });
});

describe("montarAvisos", () => {
  it("sem nada pendente devolve lista vazia", () => {
    expect(montarAvisos(VAZIO)).toEqual([]);
  });

  it("um pedido pendente vira aviso que abre AQUELE pedido", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidos: [
        {
          id: "ped-1",
          customer_name: "Maria Silva",
          total: 22.9,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("pedido");
    expect(avisos[0].destino).toEqual({ view: "admin-orders", id: "ped-1" });
    expect(avisos[0].contaNoCracha).toBe(true);
    expect(avisos[0].titulo).toContain("Maria Silva");
  });

  it("perguntas pendentes viram UM aviso com a contagem", () => {
    const avisos = montarAvisos({ ...VAZIO, perguntasPendentes: 3 });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("pergunta");
    expect(avisos[0].destino).toEqual({ view: "admin-qa" });
    expect(avisos[0].titulo).toContain("3");
  });

  it("zero perguntas pendentes NAO vira aviso", () => {
    expect(montarAvisos({ ...VAZIO, perguntasPendentes: 0 })).toEqual([]);
  });

  it("avaliacao sem resposta vira aviso; com resposta nao entra na lista", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      avaliacoes: [
        {
          id: "av-1",
          product_id: "prod-1",
          nomeDoProduto: "Bobbie Goods",
          rating: 5,
          created_at: "2026-08-24T09:00:00.000Z",
        },
      ],
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("avaliacao");
    expect(avisos[0].destino).toEqual({ view: "admin-reviews" });
  });

  it("produto acabando vira aviso que abre AQUELE produto, e NAO conta no cracha", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        {
          id: "prod-9",
          name: "Caneta 3D",
          stock: 2,
          estoqueMinimo: null,
          created_at: "2026-08-20T09:00:00.000Z",
        },
      ],
    });

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("estoque");
    expect(avisos[0].destino).toEqual({
      view: "admin-product-form",
      id: "prod-9",
    });
    expect(avisos[0].contaNoCracha).toBe(false);
  });

  it("produto com estoque suficiente nao vira aviso", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      produtos: [
        {
          id: "prod-9",
          name: "Caneta 3D",
          stock: 40,
          estoqueMinimo: null,
          created_at: "2026-08-20T09:00:00.000Z",
        },
      ],
    });

    expect(avisos).toEqual([]);
  });

  it("ordena por urgencia: pedido, pergunta, avaliacao, estoque", () => {
    const avisos = montarAvisos({
      produtos: [
        {
          id: "p",
          name: "X",
          stock: 1,
          estoqueMinimo: null,
          created_at: "2026-08-24T12:00:00.000Z",
        },
      ],
      avaliacoes: [
        {
          id: "a",
          product_id: "p",
          nomeDoProduto: "X",
          rating: 4,
          created_at: "2026-08-24T12:00:00.000Z",
        },
      ],
      perguntasPendentes: 1,
      pedidos: [
        {
          id: "o",
          customer_name: "N",
          total: 1,
          created_at: "2026-08-24T12:00:00.000Z",
        },
      ],
    });

    expect(avisos.map((a) => a.tipo)).toEqual([
      "pedido",
      "pergunta",
      "avaliacao",
      "estoque",
    ]);
  });

  it("dentro do mesmo tipo, o mais recente vem primeiro", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidos: [
        {
          id: "velho",
          customer_name: "A",
          total: 1,
          created_at: "2026-08-20T10:00:00.000Z",
        },
        {
          id: "novo",
          customer_name: "B",
          total: 1,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
    });

    expect(avisos.map((a) => a.destino.id)).toEqual(["novo", "velho"]);
  });

  it("o id do aviso e' unico por tipo+origem — dois tipos com o mesmo id de origem nao colidem", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidos: [
        {
          id: "mesmo",
          customer_name: "A",
          total: 1,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
      produtos: [
        {
          id: "mesmo",
          name: "X",
          stock: 0,
          estoqueMinimo: null,
          created_at: "2026-08-24T10:00:00.000Z",
        },
      ],
    });

    const ids = avisos.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
