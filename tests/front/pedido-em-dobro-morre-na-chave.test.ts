// Laudo caça-bugs 31/08 (A1): a criação do pedido não tinha idempotência.
// A rede cair DEPOIS do commit do pedido e o segundo clique legítimo criava
// o pedido DE NOVO — estoque e cupom debitados em dobro. A trava síncrona
// do checkout só cobre o duplo toque no mesmo tique; a cura da retentativa
// é a CHAVE DA COMPRA: o checkout gera um uuid por compra, o servidor
// devolve o pedido original quando a chave já existe.
//
// A chave pertence à COMPRA (impressão digital), não ao clique: mesma
// impressão = mesma chave (a retentativa volta para o pedido que já
// nasceu); impressão nova = chave nova (compra diferente NÃO herda pedido
// alheio). No sucesso a chave se esquece — comprar de novo, mesmo que o
// carrinho volte idêntico, tem de nascer pedido novo.
//
// Esta suíte prova a regra no gerenciador puro; o CheckoutView o consome
// com 2 linhas visíveis no diff e o servidor (migration 20261038000000)
// é a metade que decide de verdade.

import {
  criarGerenciadorDeChave,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";
import { describe, expect, it } from "vitest";

// Map, não Record: indexação por chave variável em objeto é sink de
// injeção para o eslint (3 warnings que estourariam o teto do CI).
function storageFake(pares: Array<[string, string]> = []) {
  const conteudo = new Map(pares);
  return {
    getItem: (k: string) => conteudo.get(k) ?? null,
    setItem: (k: string, v: string) => {
      conteudo.set(k, v);
    },
    removeItem: (k: string) => {
      conteudo.delete(k);
    },
  };
}

function chavesSequenciais(prefixo = "chave-") {
  let n = 0;
  return () => `${prefixo}${++n}`;
}

const compraBase = {
  items: [{ product_id: "p1", variant_id: null, quantity: 2 }],
  totalAmount: 50,
  shippingCost: 10,
  destinationCep: "38500000",
  // EMENDA FRETE V2 (03/09): era "flat-fee-1" — a taxa fixa morreu na edge E
  // na RPC do pedido (migration 20261081000000 emendada: flat-fee-% é
  // exception). A fixture agora usa um id de transportadora, que é uma opção
  // válida de verdade. O que este teste prova não muda: a impressão da compra
  // muda quando a opção de frete muda.
  shippingOptionId: "melhor-envio-1",
  couponCode: null,
  addressId: null,
  cepDoEndereco: "38500000",
};

describe("impressaoDaCompra — a identidade da compra", () => {
  it("compras idênticas têm a mesma impressão", () => {
    expect(impressaoDaCompra(compraBase)).toBe(impressaoDaCompra(compraBase));
  });

  it("a ORDEM dos itens não muda a impressão (carrinho é conjunto)", () => {
    const a = impressaoDaCompra({
      ...compraBase,
      items: [
        { product_id: "p1", variant_id: null, quantity: 2 },
        { product_id: "p2", variant_id: "v2", quantity: 1 },
      ],
    });
    const b = impressaoDaCompra({
      ...compraBase,
      items: [
        { product_id: "p2", variant_id: "v2", quantity: 1 },
        { product_id: "p1", variant_id: null, quantity: 2 },
      ],
    });
    expect(a).toBe(b);
  });

  it.each([
    [
      "item",
      (c: typeof compraBase) => ({
        ...c,
        items: [{ product_id: "OUTRO", variant_id: null, quantity: 2 }],
      }),
    ],
    [
      "quantidade",
      (c: typeof compraBase) => ({
        ...c,
        items: [{ product_id: "p1", variant_id: null, quantity: 3 }],
      }),
    ],
    ["total", (c: typeof compraBase) => ({ ...c, totalAmount: 999 })],
    ["frete", (c: typeof compraBase) => ({ ...c, shippingCost: 0 })],
    [
      "cep de destino",
      (c: typeof compraBase) => ({ ...c, destinationCep: "01001000" }),
    ],
    [
      "opção de frete",
      (c: typeof compraBase) => ({ ...c, shippingOptionId: "local-delivery" }),
    ],
    ["cupom", (c: typeof compraBase) => ({ ...c, couponCode: "PRIMEIRA" })],
    ["endereço", (c: typeof compraBase) => ({ ...c, addressId: "addr-9" })],
    [
      "cep do endereço",
      (c: typeof compraBase) => ({ ...c, cepDoEndereco: "20000000" }),
    ],
  ])("mudou %s -> impressão DIFERENTE", (_nome, muda) => {
    expect(impressaoDaCompra(muda(compraBase))).not.toBe(
      impressaoDaCompra(compraBase),
    );
  });
});

describe("criarGerenciadorDeChave — a chave sobrevive à retentativa e morre no sucesso", () => {
  it("a MESMA compra pedida duas vezes devolve a MESMA chave", () => {
    const armazem = storageFake();
    const gerente = criarGerenciadorDeChave(armazem, chavesSequenciais());
    const impressao = impressaoDaCompra(compraBase);

    const primeira = gerente.chavePara(impressao);
    const segunda = gerente.chavePara(impressao);

    expect(primeira).toBe("chave-1");
    expect(segunda).toBe(primeira);
  });

  it("compra DIFERENTE na mesma sessão ganha chave NOVA", () => {
    const armazem = storageFake();
    const gerente = criarGerenciadorDeChave(armazem, chavesSequenciais());

    const daCompra1 = gerente.chavePara(impressaoDaCompra(compraBase));
    const daCompra2 = gerente.chavePara(
      impressaoDaCompra({ ...compraBase, totalAmount: 75 }),
    );

    expect(daCompra2).not.toBe(daCompra1);
  });

  it("depois do SUCESSO (esquecer), a mesma impressão ganha chave nova", () => {
    const armazem = storageFake();
    const gerente = criarGerenciadorDeChave(armazem, chavesSequenciais());
    const impressao = impressaoDaCompra(compraBase);

    const daPrimeira = gerente.chavePara(impressao);
    gerente.esquecer();
    const daSegundaCompra = gerente.chavePara(impressao);

    expect(daSegundaCompra).not.toBe(daPrimeira);
  });

  it("a chave sobrevive a RECARREGAR a página (storage persistente)", () => {
    const armazem = storageFake();
    const impressao = impressaoDaCompra(compraBase);

    const antes = criarGerenciadorDeChave(
      armazem,
      chavesSequenciais(),
    ).chavePara(impressao);

    // A página recarregou: gerente novo, o MESMO storage.
    const depois = criarGerenciadorDeChave(
      armazem,
      chavesSequenciais(),
    ).chavePara(impressao);

    expect(depois).toBe(antes);
  });

  it("storage corrompido não derruba a compra: nasce chave nova", () => {
    const armazem = storageFake([
      ["ikcous-chave-do-pedido", "{isso nao e json"],
    ]);
    const gerente = criarGerenciadorDeChave(armazem, chavesSequenciais());

    expect(gerente.chavePara(impressaoDaCompra(compraBase))).toBe("chave-1");
  });

  it("chave gerada é uuid de verdade quando não se passa gerador", () => {
    const gerente = criarGerenciadorDeChave(storageFake());
    const formatoUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(gerente.chavePara(impressaoDaCompra(compraBase))).toMatch(
      formatoUuid,
    );
  });
});
