import {
  mapOrderFromDB,
  mapProductFromDB,
  mapVariantFromDB,
} from "@/lib/mappers";
import type { Address } from "@/types";
import type { Database } from "@/types/database.types";
import { describe, expect, it, vi } from "vitest";

/**
 * src/lib/mappers.ts — a fronteira onde a linha do Postgres vira objeto do app.
 *
 * POR QUE COMEÇAR POR AQUI (INFRA-150, #70): é função pura, roda sem DOM e sem
 * rede, e é o ponto onde um erro não aparece como exceção — aparece como preço
 * errado na tela. O `catch` do mapProductFromDB engole qualquer falha e devolve
 * um produto "Erro ao carregar" com preço 0: sem teste, nada disso faz barulho.
 *
 * UMA CORREÇÃO DE FATO SOBRE A ISSUE #70: ela diz que o eixo do teste é "nome
 * de coluna em português x inglês, view x tabela". Não é — pelo menos não hoje.
 * A `vw_produtos_public` (migration 20260713000000) faz `SELECT id, nome,
 * descricao, preco_venda, ...` direto de `public.produtos`, sem renomear nada:
 * view e tabela chegam no mapper com as MESMAS colunas em português. As colunas
 * em inglês (`name`, `price`, `cost_price`, `stock`) não são produzidas por
 * nenhuma fonte do schema atual — `git grep` só as encontra dentro do próprio
 * mapper. O teste "colunas em inglês" abaixo existe para registrar isso, não
 * para fingir que é o caminho normal.
 *
 * A diferença REAL entre view e tabela é outra, e essa sim está coberta: a view
 * pública não expõe `custo` (é o ponto do PR #137), então o mesmo produto chega
 * com `costPrice` preenchido pelo caminho do admin e indefinido pelo caminho do
 * cliente.
 */

type OrderRow = Database["public"]["Tables"]["marketplace_orders"]["Row"];
type OrderItemRow =
  Database["public"]["Tables"]["marketplace_order_items"]["Row"];
type VariantRow = Database["public"]["Tables"]["product_variants"]["Row"];

/**
 * As 27 colunas que a `vw_produtos_public` devolve, na ordem da migration
 * 20260713000000_fix_public_products_view.sql. Copiar a lista de lá em vez de
 * inventar um objeto plausível é o que dá valor ao teste: se a view mudar, a
 * divergência aparece aqui.
 */
const LINHA_VIEW_PUBLICA = {
  id: "prod-1",
  nome: "Caneca Térmica 500 ml",
  descricao: "Mantém quente por 6 h",
  preco_venda: 79.9,
  preco_original: 99.9,
  estoque: 12,
  imagem_url: null,
  imagem_urls: ["https://cdn.exemplo/caneca.webp"],
  categoria: "Casa",
  ativo: true,
  data_cadastro: "2026-07-01T12:00:00.000Z",
  tags: ["novo"],
  meta_title: null,
  meta_description: null,
  is_bestseller: false,
  frete_gratis: true,
  sold: 4,
  calculated_points: 79,
  codigo: "CAN-500",
  ultima_atualizacao: "2026-07-20T12:00:00.000Z",
  rating: 4.5,
  review_count: 3,
  peso_kg: 0.4,
  largura_cm: 12,
  altura_cm: 20,
  comprimento_cm: 12,
};

/** O mesmo produto pelo caminho do admin: ganha `custo` e `deleted_at`. */
const LINHA_ADMIN = {
  ...LINHA_VIEW_PUBLICA,
  custo: 31.5,
  deleted_at: null,
};

function variante(extra: Partial<VariantRow> = {}): VariantRow {
  return {
    active: true,
    created_at: "2026-07-01T12:00:00.000Z",
    id: "var-1",
    name: "Cor",
    price_override: null,
    product_id: "prod-1",
    sku: null,
    stock_increment: 0,
    value: "Preta",
    ...extra,
  } as VariantRow;
}

const PEDIDO_BASE: OrderRow = {
  address_id: null,
  cancelled_after_shipping: false,
  confirmation_email_sent_at: null,
  coupon_code: null,
  coupon_id: null,
  coupon_usage_returned: false,
  created_at: "2026-08-01T10:00:00.000Z",
  customer_data: {},
  customer_name: "Joana",
  customer_phone: null,
  discount: null,
  expires_at: null,
  gateway_payment_id: null,
  id: "ped-1",
  idempotency_key: null,
  notes: null,
  observation: null,
  paid_at: null,
  pagamento_recebido_em: null,
  pagamento_recebido_por: null,
  payment_method: null,
  payment_status: null,
  returned_to_seller_at: null,
  shipping: null,
  shipping_cost: null,
  shipping_label_id: null,
  shipping_label_url: null,
  status: "pending",
  stock_returned_at: null,
  subtotal: 100,
  total: 120,
  total_amount: null,
  tracking_code: null,
  updated_at: "2026-08-01T11:00:00.000Z",
  user_id: null,
};

function pedido(
  extra: Partial<OrderRow> & { items?: OrderItemRow[]; address?: Address } = {},
) {
  return { ...PEDIDO_BASE, ...extra };
}

function item(extra: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    created_at: "2026-08-01T10:00:00.000Z",
    id: "it-1",
    image_url: null,
    order_id: "ped-1",
    price: 79.9,
    product_id: "prod-1",
    product_name: "Caneca Térmica 500 ml",
    quantity: 1,
    variant_id: null,
    ...extra,
  };
}

/** O caminho de erro do mapper grita no console; sem isto a saída vira ruído. */
function semRuido<T>(fn: () => T): T {
  const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return fn();
  } finally {
    espiao.mockRestore();
  }
}

describe("mapProductFromDB", () => {
  it("mapeia a linha da view pública sem inventar custo", () => {
    const produto = mapProductFromDB(LINHA_VIEW_PUBLICA);

    expect(produto.id).toBe("prod-1");
    expect(produto.name).toBe("Caneca Térmica 500 ml");
    expect(produto.price).toBe(79.9);
    expect(produto.originalPrice).toBe(99.9);
    expect(produto.stock).toBe(12);
    expect(produto.sku).toBe("CAN-500");
    expect(produto.freeShipping).toBe(true);
    expect(produto.images).toEqual(["https://cdn.exemplo/caneca.webp"]);
    expect(produto.createdAt).toBe("2026-07-01T12:00:00.000Z");
    expect(produto.updatedAt).toBe("2026-07-20T12:00:00.000Z");
    expect(produto.weightKg).toBe(0.4);

    // O ponto do PR #137: a view pública não traz `custo`. Se algum dia o
    // mapper passar a devolver 0 aqui, o painel de margem do admin vai ler
    // "100% de margem" em todo produto vindo do caminho do cliente.
    expect(produto.costPrice).toBeUndefined();
  });

  it("mapeia a linha do admin trazendo o custo", () => {
    expect(mapProductFromDB(LINHA_ADMIN).costPrice).toBe(31.5);
  });

  it("custo nulo no banco continua indefinido, não vira zero", () => {
    const produto = mapProductFromDB({ ...LINHA_ADMIN, custo: null });
    expect(produto.costPrice).toBeUndefined();
  });

  it("custo zero é preservado como zero", () => {
    // `?? ` e não `||`: custo 0 é um valor legítimo (brinde, amostra) e não
    // pode virar "sem custo informado".
    expect(mapProductFromDB({ ...LINHA_ADMIN, custo: 0 }).costPrice).toBe(0);
  });

  it("produto sem imagem nenhuma cai no placeholder", () => {
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      imagem_urls: null,
      imagem_url: null,
    });
    expect(produto.images).toEqual([
      "https://placehold.co/600x400?text=Sem+Imagem",
    ]);
  });

  it("produto só com imagem_url (legado) vira lista de um item", () => {
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      imagem_urls: null,
      imagem_url: "https://cdn.exemplo/legado.jpg",
    });
    expect(produto.images).toEqual(["https://cdn.exemplo/legado.jpg"]);
  });

  it("descarta entradas vazias de imagem_urls e não deixa a lista vazia", () => {
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      imagem_urls: ["", "   ", null],
      imagem_url: null,
    });
    expect(produto.images).toEqual([
      "https://placehold.co/600x400?text=Sem+Imagem",
    ]);
  });

  it("estoque sai das variantes ATIVAS quando existe alguma ativa", () => {
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      estoque: 12,
      product_variants: [
        variante({ id: "var-1", stock_increment: 3, active: true }),
        variante({ id: "var-2", stock_increment: 5, active: true }),
        variante({ id: "var-3", stock_increment: 99, active: false }),
      ],
    });
    // 3 + 5. O `estoque: 12` da linha é IGNORADO, e a variante inativa não
    // entra na conta.
    expect(produto.stock).toBe(8);
    expect(produto.variants).toHaveLength(3);
  });

  it("sem nenhuma variante ativa, o estoque volta a ser o da linha", () => {
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      estoque: 12,
      product_variants: [variante({ stock_increment: 99, active: false })],
    });
    expect(produto.stock).toBe(12);
  });

  it("linha nula devolve o produto de erro em vez de estourar", () => {
    const produto = semRuido(() => mapProductFromDB(null));
    expect(produto.name).toBe("Erro ao carregar");
    expect(produto.price).toBe(0);
    expect(produto.isActive).toBe(false);
    expect(produto.images).toEqual([
      "https://placehold.co/600x400?text=Erro+de+Dados",
    ]);
  });

  it("produto sem avaliação nenhuma é apresentado como 5 estrelas", () => {
    // Comportamento ATUAL, registrado de propósito: `row.rating ? ... : 5`
    // trata ausência E nota zero como 5 estrelas. Quem for mexer em avaliação
    // (ADMIN-090, #101) precisa decidir se isso é o desejado — o teste está
    // aqui para a mudança ser consciente, não acidental.
    expect(
      mapProductFromDB({ ...LINHA_VIEW_PUBLICA, rating: null, review_count: 0 })
        .rating,
    ).toBe(5);
  });

  it("aceita colunas em inglês, que hoje nenhuma fonte produz", () => {
    // Fallback defensivo do mapper. Nenhuma view, tabela ou RPC deste schema
    // devolve estes nomes — se um dia alguém quiser apagar o fallback, este
    // teste é o registro de que ele nunca foi exercitado em produção.
    const produto = mapProductFromDB({
      id: "prod-en",
      name: "Mug",
      price: 10,
      stock: 2,
      is_active: false,
      free_shipping: true,
      cost_price: 4,
      images: ["https://cdn.exemplo/mug.webp"],
    });
    expect(produto.name).toBe("Mug");
    expect(produto.price).toBe(10);
    expect(produto.stock).toBe(2);
    expect(produto.isActive).toBe(false);
    expect(produto.freeShipping).toBe(true);
    expect(produto.costPrice).toBe(4);
  });
});

describe("mapVariantFromDB", () => {
  it("preenche os defaults de nome e estoque", () => {
    const v = mapVariantFromDB(
      variante({ name: "", stock_increment: 0, price_override: null }),
    );
    expect(v.name).toBe("Padrão");
    expect(v.stockIncrement).toBe(0);
    expect(v.priceOverride).toBeUndefined();
    expect(v.active).toBe(true);
  });

  it("mantém o preço sobrescrito quando existe", () => {
    expect(
      mapVariantFromDB(variante({ price_override: 89.9 })).priceOverride,
    ).toBe(89.9);
  });

  it("override ZERO é um preço, não ausência (laudo 31/08, E2 — achado BLOQUEANTE da revisão do PR #370)", () => {
    // O `? :` de antes tratava 0 como ausência: o zero do banco virava
    // undefined ANTES de chegar a `precoVendido`, e a variação-brinde voltava
    // a ser exibida pelo preço cheio depois de qualquer recarga de página —
    // com a RPC recusando o pedido no último clique ("os valores mudaram").
    expect(
      mapVariantFromDB(variante({ price_override: 0 })).priceOverride,
    ).toBe(0);
    // null/undefined continuam sendo ausência de verdade (usa o preço do produto).
    expect(
      mapVariantFromDB(variante({ price_override: null })).priceOverride,
    ).toBeUndefined();
  });
});

describe("mapOrderFromDB", () => {
  it("o snapshot do customer_data vence ao endereço do join (laudo #4, onda 2)", () => {
    // Era "prefere o endereço do join" — e era o defeito: o JOIN traz o
    // endereço ATUAL do perfil; deixá-lo vencer fazia editar/apagar endereço
    // no perfil reescrever/apagar o "Endereço de Entrega" de pedido antigo.
    // O snapshot gravado na compra é a verdade do comprovante (laudo
    // cliente-pós-compra 02/09, #4 — onda 2). Prova completa em
    // mappers-endereco-snapshot-vence.test.ts.
    const endereco: Address = {
      id: "end-1",
      user_id: "u-1",
      name: "Casa",
      recipient_name: "Joana",
      cep: "38500-000",
      street: "Rua das Flores",
      number: "10",
      complement: "fundos",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
      reference: "ao lado da praça",
      is_default: true,
    };
    const o = mapOrderFromDB(
      pedido({
        address: endereco,
        customer_data: {
          addressData: { street: "Rua Antiga", city: "Outra Cidade" },
        },
      }),
    );
    expect(o.customer.address).toBe("Rua Antiga");
    expect(o.customer.city).toBe("Outra Cidade");
  });

  it("sem join, usa o snapshot addressData do customer_data", () => {
    const o = mapOrderFromDB(
      pedido({
        customer_data: {
          addressData: {
            street: "Rua Antiga",
            number: "77",
            city: "Patrocínio",
            state: "MG",
            cep: "38740-000",
          },
        },
      }),
    );
    expect(o.customer.address).toBe("Rua Antiga");
    expect(o.customer.number).toBe("77");
    expect(o.customer.city).toBe("Patrocínio");
  });

  it("sem snapshot, usa os campos na raiz do customer_data", () => {
    const o = mapOrderFromDB(
      pedido({
        customer_data: {
          address_text: "Av. Brasil",
          number: "5",
          city: "Araxá",
          whatsapp: "34999990000",
          cpf: "000.000.000-00",
        },
      }),
    );
    expect(o.customer.address).toBe("Av. Brasil");
    expect(o.customer.number).toBe("5");
    expect(o.customer.city).toBe("Araxá");
    expect(o.customer.whatsapp).toBe("34999990000");
    // O spread de customer_data preserva o que o mapper não conhece.
    expect((o.customer as { cpf?: string }).cpf).toBe("000.000.000-00");
  });

  it("cai para o telefone quando o snapshot só tem `phone`", () => {
    const o = mapOrderFromDB(
      pedido({ customer_data: { phone: "34988887777" } }),
    );
    expect(o.customer.whatsapp).toBe("34988887777");
  });

  it("item sem imagem própria herda a primeira imagem do produto", () => {
    const o = mapOrderFromDB(
      pedido({
        items: [
          {
            ...item(),
            product: { imagem_urls: ["https://cdn.exemplo/a.webp"] },
          } as OrderItemRow,
        ],
      }),
    );
    expect(o.items[0].image).toBe("https://cdn.exemplo/a.webp");
    expect(o.items[0].productId).toBe("prod-1");
    expect(o.items[0].quantity).toBe(1);
  });

  it("sem produto no join, a imagem do item vale", () => {
    const o = mapOrderFromDB(
      pedido({ items: [item({ image_url: "https://cdn.exemplo/b.webp" })] }),
    );
    expect(o.items[0].image).toBe("https://cdn.exemplo/b.webp");
  });

  it("pedido sem itens vira lista vazia, não undefined", () => {
    expect(mapOrderFromDB(pedido()).items).toEqual([]);
  });

  it("aplica os defaults de pagamento e status", () => {
    const o = mapOrderFromDB(pedido());
    expect(o.paymentMethod).toBe("cash");
    expect(o.status).toBe("pending");
    expect(o.shipping).toBe(0);
    expect(o.discount).toBe(0);
    expect(o.customer.name).toBe("Joana");
  });

  it("usa total_amount quando total chega nulo", () => {
    // O tipo gerado diz `total: number`, mas o mapper defende contra nulo — há
    // linhas antigas em produção com o valor só em `total_amount`. O cast
    // existe para poder testar o caminho que o mapper de fato tem.
    const o = mapOrderFromDB(
      pedido({ total: null as unknown as number, total_amount: 250 }),
    );
    expect(o.total).toBe(250);
  });

  it("copia payment_status quando o webhook já confirmou o pagamento", () => {
    // Task 9 (Fase 3): o mapper é fiel, não traduz — quem transforma `null`
    // em "sem cobrança online" é o PaymentStatusBadge, não este mapper.
    const o = mapOrderFromDB(pedido({ payment_status: "pago_apos_expirar" }));
    expect(o.paymentStatus).toBe("pago_apos_expirar");
  });

  it("payment_status nulo (os 64 pedidos históricos) continua nulo", () => {
    const o = mapOrderFromDB(pedido({ payment_status: null }));
    expect(o.paymentStatus).toBeNull();
  });
});

// --- CATALOGO-100 (#44): a foto grampeada no codigo ------------------------
//
// `extractProductImages` tinha, ANTES de olhar as imagens cadastradas:
//
//     if (name?.includes("Aliança Luxo")) {
//       return ["https://m.media-amazon.com/images/I/51-mYyA-zXL...jpg"];
//     }
//
// Qualquer produto cujo nome contivesse "Aliança Luxo" tinha a foto trocada por
// uma imagem hospedada na Amazon — ignorando a que a lojista subiu. Numa
// demonstração ao vivo isso aparece na hora; num molde que vai ser clonado por
// loja, o grampo viaja junto.
describe("mapProductFromDB — sem grampo de produto no codigo (#44)", () => {
  it("produto chamado 'Aliança Luxo' usa a imagem que foi cadastrada", () => {
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      nome: "Aliança Luxo",
      name: "Aliança Luxo",
      imagem_urls: ["https://loja.exemplo/foto-da-lojista.jpg"],
    });

    expect(produto.images).toEqual([
      "https://loja.exemplo/foto-da-lojista.jpg",
    ]);
  });

  it("nenhuma imagem da Amazon sai deste mapeador", () => {
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      nome: "Aliança Luxo",
      name: "Aliança Luxo",
      imagem_urls: ["https://loja.exemplo/foto-da-lojista.jpg"],
    });

    expect(produto.images.join(" ")).not.toContain("media-amazon.com");
  });

  it("'Aliança Luxo' sem imagem cadastrada cai no placeholder, como qualquer produto", () => {
    // A ancora: sem isto, um mapeador que devolvesse lista vazia faria os dois
    // testes acima passarem pelo motivo errado.
    const produto = mapProductFromDB({
      ...LINHA_VIEW_PUBLICA,
      nome: "Aliança Luxo",
      name: "Aliança Luxo",
      imagem_urls: null,
      imagem_url: null,
    });

    expect(produto.images).toEqual([
      "https://placehold.co/600x400?text=Sem+Imagem",
    ]);
  });
});
