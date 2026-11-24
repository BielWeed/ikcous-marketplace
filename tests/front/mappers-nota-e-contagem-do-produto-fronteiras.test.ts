import { mapProductFromDB } from "@/lib/mappers";
import { describe, expect, it } from "vitest";

/**
 * A nota e a contagem de avaliações que o catálogo entrega a cada card e à
 * página do produto (`rating` e `review_count` da view). Caça por mutação
 * (24/11/2026): só dois pontos da regra tinham teste (4,5 com 3 avaliações e
 * nulo sem avaliações), e cada operador desta expressão sobrevivia à troca:
 *
 *   rating: row.rating != null && (row.rating || review_count > 0)
 *             ? Number(row.rating) : 5
 *
 * A regra de negócio, em palavras: produto SEM avaliação nenhuma mostra 5
 * estrelas (o padrão da vitrine); mas nota 0 de quem JÁ tem avaliações é nota
 * REAL e não pode virar 5; nota ausente (nula) nunca vira 0 só porque existem
 * avaliações; e nota que chega como texto (numeric do Postgres) vira número.
 */
const BASE = {
  id: "prod-1",
  nome: "Caneca Térmica 500 ml",
  descricao: "Mantém quente por 6 h",
  preco_venda: 79.9,
  preco_original: null,
  estoque: 12,
  imagem_url: null,
  imagem_urls: ["https://cdn.exemplo/caneca.webp"],
  categoria: "Casa",
  ativo: true,
  data_cadastro: "2026-07-01T12:00:00.000Z",
  tags: [],
  is_bestseller: false,
  frete_gratis: false,
  sold: 0,
  codigo: "CAN-500",
  ultima_atualizacao: "2026-07-20T12:00:00.000Z",
};

const notaDe = (rating: unknown, reviewCount: unknown) =>
  mapProductFromDB({
    ...BASE,
    rating,
    review_count: reviewCount,
  } as never).rating;

describe("mapProductFromDB — nota do produto", () => {
  it.each([
    ["nota 0 e nenhuma avaliação: padrão de 5 estrelas", 0, 0, 5],
    ["nota nula e nenhuma avaliação: 5", null, 0, 5],
    ["nota nula e contagem nula: 5", null, null, 5],
    ["nota ausente e contagem ausente: 5", undefined, undefined, 5],
    ["nota 0 COM avaliações: é nota real, fica 0", 0, 3, 0],
    ["nota nula COM avaliações: sem nota não vira 0, fica 5", null, 3, 5],
    ["nota ausente COM avaliações: 5", undefined, 3, 5],
    ["nota 4,5 com contagem 0 (linha incoerente): vale a nota", 4.5, 0, 4.5],
    ["nota 4,5 com contagem nula: vale a nota", 4.5, null, 4.5],
    ["nota 4,5 com 3 avaliações: vale a nota", 4.5, 3, 4.5],
    ["nota 1 com 1 avaliação: o menor valor real", 1, 1, 1],
    ["nota como texto (numeric do Postgres) vira número", "4.7", 2, 4.7],
  ])("%s", (_nome, rating, contagem, esperado) => {
    expect(notaDe(rating, contagem)).toBe(esperado);
  });
});

describe("mapProductFromDB — contagem de avaliações", () => {
  it.each([
    ["número", 3, 3],
    ["texto (bigint do Postgres)", "12", 12],
    ["zero", 0, 0],
    ["nulo", null, 0],
    ["ausente", undefined, 0],
  ])("%s", (_nome, entrada, esperado) => {
    expect(
      mapProductFromDB({
        ...BASE,
        rating: 4,
        review_count: entrada,
      } as never).reviewCount,
    ).toBe(esperado);
  });
});
