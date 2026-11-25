// `src/utils/avisos-do-lojista.ts`: o que os testes vizinhos deixavam passar
// (caça por mutação).
//
//  - endereço de retirada só com espaços NÃO é retirada na loja: o pedido que
//    já saiu continua "ja_saiu" (avise o transporte), não "retirada_pronta";
//  - pago na entrega e cancelado ANTES de sair não leva a marca "combinar a
//    devolução" (o produto nunca saiu): a frase do dinheiro sai uma vez só;
//    com o produto na rua, a marca vem e a orientação a acompanha;
//  - ordem de urgência: pedido de privacidade (prazo legal correndo) vem antes
//    do recebimento por marcar;
//  - o aviso de privacidade diz onde abrir e o prazo da loja.
import { PRAZO_DE_RESPOSTA_EM_DIAS } from "@/config/textos-de-privacidade";
import {
  type EntradaDeAvisos,
  type LinhaDeCancelamento,
  montarAvisos,
  selecionarCancelamentosDoCliente,
} from "@/utils/avisos-do-lojista";
import { describe, expect, it } from "vitest";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

const CLIENTE = "c9999999-9999-4999-8999-999999999999";
const PEDIDO = "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d";

function linha(
  extra: Partial<LinhaDeCancelamento> = {},
  pedido: Record<string, unknown> = {},
): LinhaDeCancelamento {
  return {
    id: "h9",
    order_id: PEDIDO,
    old_status: "pending",
    created_by: CLIENTE,
    created_at: "2026-11-20T10:00:00.000Z",
    marketplace_orders: {
      id: PEDIDO,
      user_id: CLIENTE,
      customer_name: "Joana Teste",
      total: 80,
      payment_status: "pago",
      status: "cancelled",
      cancelled_after_shipping: false,
      ...pedido,
    },
    ...extra,
  };
}

const SEM_ADMIN = new Set<string>();

describe("endereço de retirada em branco não é retirada", () => {
  it("produto que saiu com retirada preenchida: 'retirada_pronta' (controle)", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [
        linha(
          { old_status: "shipping" },
          { pickup_address: "Rua das Flores, 10" },
        ),
      ],
      SEM_ADMIN,
    );
    expect(c?.situacao).toBe("retirada_pronta");
  });

  it.each(["", "   ", "\t \n"])(
    "produto que saiu com retirada %j: 'ja_saiu'",
    (pickup_address) => {
      const [c] = selecionarCancelamentosDoCliente(
        [linha({ old_status: "shipping" }, { pickup_address })],
        SEM_ADMIN,
      );
      expect(c?.situacao).toBe("ja_saiu");
    },
  );

  it("retirada nula ou ausente também é entrega", () => {
    for (const pedido of [{ pickup_address: null }, {}]) {
      const [c] = selecionarCancelamentosDoCliente(
        [linha({ old_status: "shipping" }, pedido)],
        SEM_ADMIN,
      );
      expect(c?.situacao).toBe("ja_saiu");
    }
  });
});

describe("pago na entrega: a marca 'combinar a devolução' só vale se o produto saiu", () => {
  it("cancelado antes de sair: devolução combinada SEM a marca", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [linha({}, { payment_status: "recebido_na_entrega" })],
      SEM_ADMIN,
    );
    expect(c?.situacao).toBe("devolucao_combinada");
    expect(c).not.toHaveProperty("devolucaoCombinada");
  });

  it("e a frase do aviso diz 'devolução combinada' uma vez só", () => {
    const cancelamentos = selecionarCancelamentosDoCliente(
      [linha({}, { payment_status: "recebido_na_entrega" })],
      SEM_ADMIN,
    );
    const [aviso] = montarAvisos({
      ...VAZIO,
      cancelamentosDoCliente: cancelamentos,
    });
    const partes = aviso?.detalhe.split("devolução combinada") ?? [];
    expect(partes).toHaveLength(2);
  });

  it("produto na rua, pago na entrega e sem voltar: a marca vem (controle)", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [
        linha(
          { old_status: "shipping" },
          { payment_status: "recebido_na_entrega" },
        ),
      ],
      SEM_ADMIN,
    );
    expect(c?.situacao).toBe("ja_saiu");
    expect(c?.devolucaoCombinada).toBe(true);
  });
});

describe("ordem de urgência e texto do pedido de privacidade", () => {
  it("privacidade vem antes do recebimento por marcar", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidosDePrivacidadeAbertos: 1,
      recebimentosPorMarcar: [
        {
          id: "5b4c3d2e-1f0a-4b9c-8d7e-6f5a4b3c2d1e",
          customer_name: "Ana",
          total: 10,
          updated_at: "2026-11-20T10:00:00.000Z",
        },
      ],
    });
    expect(avisos.map((a) => a.tipo)).toEqual(["privacidade", "recebimento"]);
  });

  it("o detalhe diz onde abrir e o prazo da loja", () => {
    const [aviso] = montarAvisos({ ...VAZIO, pedidosDePrivacidadeAbertos: 2 });
    expect(aviso?.detalhe).toContain("Ajustes > Minha loja");
    expect(aviso?.detalhe).toContain(
      `Prazo: ${PRAZO_DE_RESPOSTA_EM_DIAS} dias`,
    );
  });
});
