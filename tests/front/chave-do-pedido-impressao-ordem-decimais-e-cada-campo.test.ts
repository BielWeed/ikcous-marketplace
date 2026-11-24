// CHAVE DA COMPRA (idempotência do lado do cliente) — a IMPRESSÃO da compra.
//
// A chave só se repete na retentativa se a impressão for a MESMA, e só gira
// quando a compra mudou de verdade. Os dois erros custam dinheiro:
//  - impressão que muda sem a compra mudar (ordem dos itens, ruído de ponto
//    flutuante no total) gira a chave e a retentativa cria um SEGUNDO pedido
//    (estoque e cupom em dobro, cobrança em dobro);
//  - impressão que NÃO muda quando a compra mudou (outro cupom, outro CEP,
//    outra variação) devolve o pedido ANTIGO para uma compra diferente.
//
// Buraco achado por mutação em `src/lib/chave-do-pedido.ts`: tirar o `.sort()`
// dos itens não derrubava teste algum. Os testes vizinhos só mexem no meio de
// pagamento (`chave-do-pedido-inclui-meio-de-pagamento`) e no armazenamento.
import { describe, expect, it } from "vitest";

import {
  type CompraParaImpressao,
  criarGerenciadorDeChave,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";

const base: CompraParaImpressao = {
  items: [
    { product_id: "prod-a", variant_id: "var-1", quantity: 2 },
    { product_id: "prod-b", variant_id: null, quantity: 1 },
  ],
  totalAmount: 150,
  shippingCost: 20,
  destinationCep: "01001000",
  shippingOptionId: "opt-1",
  couponCode: "BEMVINDO",
  addressId: "end-1",
  cepDoEndereco: "01001000",
  paymentMethod: "online",
};

function com(mudanca: Partial<CompraParaImpressao>): CompraParaImpressao {
  return { ...base, ...mudanca };
}

describe("impressaoDaCompra — o que NÃO é mudar de compra", () => {
  it("a ordem em que os itens foram postos no carrinho não muda a impressão", () => {
    const invertida = com({ items: [...base.items].reverse() });
    expect(impressaoDaCompra(invertida)).toBe(impressaoDaCompra(base));
  });

  it("três itens em qualquer permutação dão a mesma impressão", () => {
    const itens = [
      { product_id: "a", variant_id: "1", quantity: 1 },
      { product_id: "b", variant_id: "2", quantity: 3 },
      { product_id: "c", variant_id: null, quantity: 2 },
    ];
    const [a, b, c] = itens;
    if (!a || !b || !c) throw new Error("itens de teste");
    const permutacoes = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    const impressoes = new Set(
      permutacoes.map((items) => impressaoDaCompra(com({ items }))),
    );
    expect(impressoes.size).toBe(1);
  });

  it("variação ausente (null/undefined) é a mesma coisa que vazia", () => {
    const semVariacao = com({
      items: [{ product_id: "p", quantity: 1 }],
    });
    const comNulo = com({
      items: [{ product_id: "p", variant_id: null, quantity: 1 }],
    });
    expect(impressaoDaCompra(semVariacao)).toBe(impressaoDaCompra(comNulo));
  });

  it("campos opcionais ausentes, nulos ou vazios dão a mesma impressão", () => {
    const vazios = com({
      destinationCep: null,
      shippingOptionId: null,
      couponCode: null,
      addressId: null,
      cepDoEndereco: null,
      paymentMethod: null,
    });
    const ausentes: CompraParaImpressao = {
      items: base.items,
      totalAmount: base.totalAmount,
      shippingCost: base.shippingCost,
    };
    expect(impressaoDaCompra(vazios)).toBe(impressaoDaCompra(ausentes));
  });

  it("ruído de ponto flutuante no total e no frete não gira a chave (decimais fixados em 2)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 — o mesmo R$ 0,30 do carrinho.
    const limpo = com({ totalAmount: 0.3, shippingCost: 7.1 });
    const sujo = com({ totalAmount: 0.1 + 0.2, shippingCost: 7.1000000000001 });
    expect(impressaoDaCompra(sujo)).toBe(impressaoDaCompra(limpo));
    // E inteiro é o mesmo que com centavos zerados.
    expect(impressaoDaCompra(com({ totalAmount: 150 }))).toBe(
      impressaoDaCompra(com({ totalAmount: 150.0 })),
    );
  });
});

describe("impressaoDaCompra — cada campo que muda a compra muda a impressão", () => {
  const original = impressaoDaCompra(base);
  const mudancas: Array<[string, Partial<CompraParaImpressao>]> = [
    ["total", { totalAmount: 150.01 }],
    ["frete", { shippingCost: 20.01 }],
    ["CEP de destino", { destinationCep: "20040020" }],
    ["opção de frete", { shippingOptionId: "opt-2" }],
    ["cupom", { couponCode: "OUTRO" }],
    ["sem cupom", { couponCode: null }],
    ["endereço salvo", { addressId: "end-2" }],
    ["CEP digitado", { cepDoEndereco: "20040020" }],
    ["meio de pagamento", { paymentMethod: "cash" }],
    [
      "quantidade de um item",
      {
        items: [
          { product_id: "prod-a", variant_id: "var-1", quantity: 3 },
          { product_id: "prod-b", variant_id: null, quantity: 1 },
        ],
      },
    ],
    [
      "variação de um item",
      {
        items: [
          { product_id: "prod-a", variant_id: "var-2", quantity: 2 },
          { product_id: "prod-b", variant_id: null, quantity: 1 },
        ],
      },
    ],
    [
      "produto de um item",
      {
        items: [
          { product_id: "prod-z", variant_id: "var-1", quantity: 2 },
          { product_id: "prod-b", variant_id: null, quantity: 1 },
        ],
      },
    ],
    [
      "um item a mais",
      {
        items: [
          ...base.items,
          { product_id: "prod-c", variant_id: null, quantity: 1 },
        ],
      },
    ],
  ];

  for (const [nome, mudanca] of mudancas) {
    it(`mudou o(a) ${nome} -> impressão DIFERENTE`, () => {
      expect(impressaoDaCompra(com(mudanca))).not.toBe(original);
    });
  }

  it("a troca de um valor para o campo vizinho não colide (cupom 'X' no lugar do endereço 'X')", () => {
    const cupomX = com({ couponCode: "X", addressId: null });
    const enderecoX = com({ couponCode: null, addressId: "X" });
    expect(impressaoDaCompra(cupomX)).not.toBe(impressaoDaCompra(enderecoX));
  });
});

describe("a chave acompanha a impressão", () => {
  function armazenamentoEmMemoria() {
    const dados = new Map<string, string>();
    return {
      getItem: (k: string) => dados.get(k) ?? null,
      setItem: (k: string, v: string) => void dados.set(k, v),
      removeItem: (k: string) => void dados.delete(k),
    };
  }

  it("itens em outra ordem repetem a MESMA chave (a retentativa não cria segundo pedido)", () => {
    let n = 0;
    const gerenciador = criarGerenciadorDeChave(
      armazenamentoEmMemoria(),
      () => `chave-${++n}`,
    );
    const primeira = gerenciador.chavePara(impressaoDaCompra(base));
    const invertida = com({ items: [...base.items].reverse() });
    expect(gerenciador.chavePara(impressaoDaCompra(invertida))).toBe(primeira);
    expect(n).toBe(1);
  });

  it("outro cupom gira a chave (a compra mudou)", () => {
    let n = 0;
    const gerenciador = criarGerenciadorDeChave(
      armazenamentoEmMemoria(),
      () => `chave-${++n}`,
    );
    const primeira = gerenciador.chavePara(impressaoDaCompra(base));
    const outra = gerenciador.chavePara(
      impressaoDaCompra(com({ couponCode: "OUTRO" })),
    );
    expect(outra).not.toBe(primeira);
  });
});
