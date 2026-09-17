// Achado "chave-do-pedido-25" (frente dinheiro-front, 15/09/2026): a
// impressão digital da compra não incluía o meio de pagamento. Cliente paga
// com PIX online, a rede cai depois do commit, ele troca para "Pix na
// Entrega" e clica de nome — MESMO carrinho, MESMA impressão, MESMA chave.
// A RPC devolve o pedido gravado pelo OUTRO meio e a tela mente (confetti
// de pedido na entrega para um pedido que na verdade ficou aguardando
// pagamento online, ou vice-versa). A cura é a mesma desta biblioteca desde
// sempre: impressão diferente -> chave diferente -> o servidor não confunde
// os dois pedidos.
//
// Este teste cobre só a metade do cliente (impressaoDaCompra +
// criarGerenciadorDeChave). Quem PASSA paymentMethod para a impressão é o
// CheckoutView — fora do escopo desta tarefa (trava do plano).

import {
  criarGerenciadorDeChave,
  impressaoDaCompra,
} from "@/lib/chave-do-pedido";
import { describe, expect, it } from "vitest";

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
  shippingOptionId: "melhor-envio-1",
  couponCode: null,
  addressId: null,
  cepDoEndereco: "38500000",
  paymentMethod: "online",
};

describe("impressaoDaCompra — o meio de pagamento é parte da identidade da compra", () => {
  it("mudou o meio de pagamento -> impressão DIFERENTE (mesmo carrinho)", () => {
    const online = impressaoDaCompra(compraBase);
    const naEntrega = impressaoDaCompra({
      ...compraBase,
      paymentMethod: "cash",
    });

    expect(naEntrega).not.toBe(online);
  });

  it("sem meio de pagamento nenhum, a impressão também difere da com meio (não colapsa em vazio)", () => {
    const semMeio = impressaoDaCompra({
      ...compraBase,
      paymentMethod: undefined,
    });
    const comMeio = impressaoDaCompra(compraBase);

    expect(semMeio).not.toBe(comMeio);
  });

  it("mesmo meio de pagamento repetido -> impressão IGUAL (retentativa legítima)", () => {
    expect(impressaoDaCompra(compraBase)).toBe(impressaoDaCompra(compraBase));
  });
});

describe("criarGerenciadorDeChave — trocar de meio de pagamento gira chave nova", () => {
  it("retentativa com OUTRO meio de pagamento não herda a chave do pedido do primeiro meio", () => {
    const armazem = storageFake();
    const gerente = criarGerenciadorDeChave(armazem, chavesSequenciais());

    // Cliente clica "Finalizar" pagando online; a rede cai depois do commit
    // do pedido (a chave já foi salva no sessionStorage).
    const chaveDoPedidoOnline = gerente.chavePara(
      impressaoDaCompra(compraBase),
    );

    // Ele troca para "Pix na Entrega" e clica de novo, MESMO carrinho.
    const chaveDoPedidoNaEntrega = gerente.chavePara(
      impressaoDaCompra({ ...compraBase, paymentMethod: "cash" }),
    );

    // Sem a correção, as duas chaves seriam iguais e a RPC devolveria o
    // pedido online para quem agora está pagando na entrega (ou o
    // contrário) — o bug relatado em chave-do-pedido-25.
    expect(chaveDoPedidoNaEntrega).not.toBe(chaveDoPedidoOnline);
  });
});
