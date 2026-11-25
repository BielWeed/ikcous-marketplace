// Caça de mutação "só testes" (catálogo e pedidos, 25/11/2026). Os mapeadores
// de banco para tela (`mapProductFromDB`, `mapVariantFromDB`, `mapOrderFromDB`)
// têm um padrão seguro para cada campo que o banco pode não mandar, e 17
// desses padrões podiam ser trocados sem nenhum dos oito arquivos de teste do
// mapeador perceber. O que está em jogo, em linguagem de loja:
//
//  - Preço, estoque, vendidos e estoque de variação que faltam viram ZERO, nunca
//    NaN (um NaN no preço ou no estoque quebra a soma do carrinho e some do
//    filtro "tem estoque"), e NUNCA 1 (estoque que falta não pode virar "1 em
//    estoque": venderia uma peça que talvez não exista).
//  - Produto sem data de cadastro vai para 1970 com `createdTime` 0: a ordem
//    da vitrine usa `createdTime ?? 0` e um NaN ali desfaz a ordenação.
//  - Produto sem `ativo` é ativo; variação sem `active` é ativa (a ausência
//    não esconde a venda); o preço "De" zero não é preço "De".
//  - Pedido: sem status vale "pending"; item sem preço vale 0; o id do item e
//    a foto de reserva (quando a lista de fotos vem vazia) sobrevivem; o
//    endereço de retirada gravado no pedido o marca como retirada na loja.
import { describe, expect, it } from "vitest";

import {
  mapOrderFromDB,
  mapProductFromDB,
  mapVariantFromDB,
} from "@/lib/mappers";

type LinhaDeVariacao = Parameters<typeof mapVariantFromDB>[0];
type LinhaDePedido = Parameters<typeof mapOrderFromDB>[0];

const variacaoDoBanco = (campos: Record<string, unknown>): LinhaDeVariacao =>
  campos as unknown as LinhaDeVariacao;

const pedidoDoBanco = (campos: Record<string, unknown>): LinhaDePedido =>
  ({
    id: "ped-1",
    created_at: "2026-08-01T10:00:00.000Z",
    updated_at: "2026-08-01T11:00:00.000Z",
    customer_data: {},
    customer_name: "Joana",
    ...campos,
  }) as unknown as LinhaDePedido;

describe("mapProductFromDB — campo que o banco não mandou vira padrão seguro", () => {
  it("linha só com o id: preço 0, estoque 0, vendidos 0, ativo, sem NaN", () => {
    const p = mapProductFromDB({ id: "p1" });

    expect(p.price).toBe(0);
    expect(p.stock).toBe(0);
    expect(p.sold).toBe(0);
    expect(p.isActive).toBe(true);
    expect(Number.isNaN(p.price)).toBe(false);
    expect(Number.isNaN(p.stock)).toBe(false);
  });

  it("sem data de cadastro: 1970 e createdTime 0 (a ordem da vitrine continua definida)", () => {
    const p = mapProductFromDB({ id: "p1" });

    expect(p.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(p.createdTime).toBe(0);
    expect(p.updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("preço da tabela vazio cai no preço da visão (price)", () => {
    expect(
      mapProductFromDB({ id: "p1", preco_venda: null, price: 12.5 }).price,
    ).toBe(12.5);
  });

  it("preço 'De' zero ou ausente não é preço 'De'; preço 'De' real passa", () => {
    expect(mapProductFromDB({ id: "p", preco_original: 0 }).originalPrice).toBe(
      undefined,
    );
    expect(
      mapProductFromDB({ id: "p", preco_original: null }).originalPrice,
    ).toBe(undefined);
    expect(
      mapProductFromDB({ id: "p", preco_original: 59.9 }).originalPrice,
    ).toBe(59.9);
  });

  it("código do produto: a tabela (codigo) vence a visão (sku), e a visão sozinha vale", () => {
    expect(mapProductFromDB({ id: "p", sku: "CAM-01" }).sku).toBe("CAM-01");
    expect(mapProductFromDB({ id: "p", codigo: "X", sku: "Y" }).sku).toBe("X");
  });

  it("variação ativa SEM estoque informado soma zero (não NaN), a desligada não entra", () => {
    const p = mapProductFromDB({
      id: "p",
      estoque: 50,
      product_variants: [
        { id: "v1", active: true },
        { id: "v2", active: true, stock_increment: 3 },
        { id: "v3", active: false, stock_increment: 9 },
      ],
    });

    expect(p.stock).toBe(3);
  });
});

describe("mapVariantFromDB — campo ausente", () => {
  it("variação só com o id: estoque 0, ativa, nome 'Padrão', valor vazio, sem preço próprio", () => {
    const v = mapVariantFromDB(variacaoDoBanco({ id: "v1", product_id: "p1" }));

    expect(v.stockIncrement).toBe(0);
    expect(v.active).toBe(true);
    expect(v.name).toBe("Padrão");
    expect(v.value).toBe("");
    expect(v.priceOverride).toBeUndefined();
  });

  it("preço próprio ZERO é preço (brinde), só null/ausente é 'sem preço próprio'", () => {
    expect(
      mapVariantFromDB(variacaoDoBanco({ id: "v", price_override: 0 }))
        .priceOverride,
    ).toBe(0);
    expect(
      mapVariantFromDB(variacaoDoBanco({ id: "v", price_override: null }))
        .priceOverride,
    ).toBeUndefined();
  });

  it("variação desligada de verdade continua desligada", () => {
    expect(
      mapVariantFromDB(variacaoDoBanco({ id: "v", active: false })).active,
    ).toBe(false);
  });
});

describe("mapOrderFromDB — campo ausente e retirada na loja", () => {
  it("pedido sem status vale 'pending'", () => {
    expect(mapOrderFromDB(pedidoDoBanco({})).status).toBe("pending");
  });

  it("item sem preço vale 0, com id mantém o id, e sem id não inventa a chave", () => {
    const pedido = mapOrderFromDB(
      pedidoDoBanco({
        items: [
          {
            id: "item-1",
            product_id: "p1",
            product_name: "Camiseta",
            quantity: 2,
          },
          { product_id: "p2", product_name: "Calça", quantity: 1 },
        ],
      }),
    );

    expect(pedido.items[0].price).toBe(0);
    expect(pedido.items[0].id).toBe("item-1");
    expect("id" in pedido.items[1]).toBe(false);
  });

  it("lista de fotos do produto VAZIA: a foto de reserva (imagem_url) é usada", () => {
    const pedido = mapOrderFromDB(
      pedidoDoBanco({
        items: [
          {
            product_id: "p1",
            product_name: "Camiseta",
            quantity: 1,
            price: 10,
            product: {
              imagem_urls: [],
              imagem_url: "https://exemplo.test/capa.jpg",
            },
          },
        ],
      }),
    );

    expect(pedido.items[0].image).toBe("https://exemplo.test/capa.jpg");
  });

  it("lista de fotos preenchida: vale a primeira dela", () => {
    const pedido = mapOrderFromDB(
      pedidoDoBanco({
        items: [
          {
            product_id: "p1",
            product_name: "Camiseta",
            quantity: 1,
            price: 10,
            product: {
              imagem_urls: [
                "https://exemplo.test/a.jpg",
                "https://exemplo.test/b.jpg",
              ],
              imagem_url: "https://exemplo.test/capa.jpg",
            },
          },
        ],
      }),
    );

    expect(pedido.items[0].image).toBe("https://exemplo.test/a.jpg");
  });

  it("endereço de retirada gravado no pedido: é retirada na loja, com o endereço aparado", () => {
    const pedido = mapOrderFromDB(
      pedidoDoBanco({ customer_data: { pickup_address: "  Rua A, 10  " } }),
    );

    expect(pedido.retiradaNaLoja).toBe(true);
    expect(pedido.enderecoDeRetirada).toBe("Rua A, 10");
  });

  it("sem endereço de retirada (ou só espaços): não é retirada", () => {
    const sem = mapOrderFromDB(pedidoDoBanco({}));
    const soEspacos = mapOrderFromDB(
      pedidoDoBanco({ customer_data: { pickup_address: "   " } }),
    );

    expect(sem.retiradaNaLoja).toBe(false);
    expect(sem.enderecoDeRetirada).toBeNull();
    expect(soEspacos.retiradaNaLoja).toBe(false);
    expect(soEspacos.enderecoDeRetirada).toBeNull();
  });
});
