// Duas bordas do aviso "o cliente cancelou" do sino do painel:
//
//  1. Pedido de VISITANTE (sem conta) cancelado sem autor — é o que a rotina do
//     banco faz quando o prazo do Pix acaba: `created_by` nulo e `user_id`
//     nulo. Nulo é igual a nulo, então só a checagem "tem autor?" impede o
//     sino de dizer "cliente cancelou" para algo que nenhum cliente fez.
//  2. Pagamento recebido na entrega, produto que já tinha saído e a lojista JÁ
//     marcou "O produto voltou": o aviso continua (o dinheiro ainda é combinado
//     à mão), mas SEM o pedido de "combinar a devolução" repetido na frase.
import {
  type LinhaDeCancelamento,
  montarAvisos,
  selecionarCancelamentosDoCliente,
} from "@/utils/avisos-do-lojista";
import { describe, expect, it } from "vitest";

const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const NINGUEM = new Set<string>();

function linha(
  extra: Partial<LinhaDeCancelamento> = {},
  pedido: Record<string, unknown> = {},
): LinhaDeCancelamento {
  return {
    id: "h1",
    order_id: PEDIDO,
    old_status: "pending",
    created_by: CLIENTE,
    created_at: "2026-11-24T11:57:00.000Z",
    marketplace_orders: {
      id: PEDIDO,
      user_id: CLIENTE,
      customer_name: "Maria Silva",
      total: 149.9,
      payment_status: "pago",
      status: "cancelled",
      cancelled_after_shipping: false,
      ...pedido,
    },
    ...extra,
  };
}

describe("cancelamento sem autor não vira 'o cliente cancelou'", () => {
  it("pedido de visitante cancelado pelo sistema (autor nulo, dono nulo) não avisa", () => {
    const sistema = linha(
      { created_by: null },
      { user_id: null, payment_status: "pago" },
    );
    expect(selecionarCancelamentosDoCliente([sistema], NINGUEM)).toEqual([]);
  });

  it("o mesmo vale para o pedido sem pagamento online", () => {
    const sistema = linha(
      { created_by: null },
      { user_id: null, payment_status: null },
    );
    expect(selecionarCancelamentosDoCliente([sistema], NINGUEM)).toEqual([]);
  });

  it("autor vazio (texto em branco) também não é um cliente", () => {
    const sistema = linha({ created_by: "" }, { user_id: "" });
    expect(selecionarCancelamentosDoCliente([sistema], NINGUEM)).toEqual([]);
  });

  it("com autor e dono iguais o aviso entra (controle: a trava não bloqueia tudo)", () => {
    expect(selecionarCancelamentosDoCliente([linha()], NINGUEM)).toHaveLength(
      1,
    );
  });
});

describe("pago na entrega, produto que saiu e já voltou", () => {
  const voltou = () =>
    linha(
      { old_status: "shipping" },
      {
        payment_status: "recebido_na_entrega",
        cancelled_after_shipping: true,
        returned_to_seller_at: "2026-11-24T13:00:00.000Z",
      },
    );

  it("entra como devolução combinada, sem a marca de 'combinar ainda'", () => {
    const [aviso] = selecionarCancelamentosDoCliente([voltou()], NINGUEM);
    expect(aviso.situacao).toBe("devolucao_combinada");
    expect(aviso).not.toHaveProperty("devolucaoCombinada");
  });

  it("a frase diz 'devolução combinada' UMA vez só", () => {
    const cancelamentos = selecionarCancelamentosDoCliente([voltou()], NINGUEM);
    const [aviso] = montarAvisos({
      pedidos: [],
      perguntasPendentes: 0,
      avaliacoes: [],
      produtos: [],
      cancelamentosDoCliente: cancelamentos,
    });
    expect(aviso.detalhe.split("devolução combinada")).toHaveLength(2);
  });

  it("se o produto ainda NÃO voltou, aí sim a marca aparece e há orientação de transporte", () => {
    const naRua = linha(
      { old_status: "shipping" },
      {
        payment_status: "recebido_na_entrega",
        cancelled_after_shipping: true,
        returned_to_seller_at: null,
      },
    );
    const [aviso] = selecionarCancelamentosDoCliente([naRua], NINGUEM);
    expect(aviso.situacao).toBe("ja_saiu");
    expect(aviso.devolucaoCombinada).toBe(true);
  });
});

describe("retirada na loja, pago na entrega, produto que não saiu da loja", () => {
  it("manda tocar em 'O produto voltou' e combinar a devolução, sem prometer liberar o dinheiro", () => {
    const naLoja = linha(
      { old_status: "shipping" },
      {
        payment_status: "recebido_na_entrega",
        cancelled_after_shipping: true,
        pickup_address: "Rua das Flores, 10",
      },
    );
    const cancelamentos = selecionarCancelamentosDoCliente([naLoja], NINGUEM);
    expect(cancelamentos[0].situacao).toBe("retirada_pronta");
    expect(cancelamentos[0].devolucaoCombinada).toBe(true);

    const [aviso] = montarAvisos({
      pedidos: [],
      perguntasPendentes: 0,
      avaliacoes: [],
      produtos: [],
      cancelamentosDoCliente: cancelamentos,
    });
    expect(aviso.detalhe).toContain(
      'toque em "O produto voltou" para repor o estoque; devolução combinada com a cliente',
    );
    // O texto de "retirada paga online" não vale aqui: não há reembolso do app.
    expect(aviso.detalhe).not.toContain("liberar a devolução do dinheiro");
  });
});

const ENTRADA_VAZIA = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

describe("textos do sino quando o dado vem em branco ou no limite", () => {
  it("pedido sem nome (texto vazio) diz 'cliente', não deixa um buraco no título", () => {
    const [aviso] = montarAvisos({
      ...ENTRADA_VAZIA,
      pedidos: [
        {
          id: "p1",
          customer_name: "",
          total: 10,
          created_at: "2026-11-24T10:00:00.000Z",
        },
      ],
    });
    expect(aviso.titulo).toBe("Pedido de cliente esperando você");
  });

  it("pedido com nome nulo também diz 'cliente'", () => {
    const [aviso] = montarAvisos({
      ...ENTRADA_VAZIA,
      pedidos: [
        {
          id: "p1",
          customer_name: null,
          total: null,
          created_at: "2026-11-24T10:00:00.000Z",
        },
      ],
    });
    expect(aviso.titulo).toBe("Pedido de cliente esperando você");
  });

  it.each([
    [1, "1 pergunta esperando resposta"],
    [2, "2 perguntas esperando resposta"],
  ])("%i pergunta(s) pendente(s): '%s'", (quantas, titulo) => {
    const [aviso] = montarAvisos({
      ...ENTRADA_VAZIA,
      perguntasPendentes: quantas,
    });
    expect(aviso.titulo).toBe(titulo);
  });

  it.each([
    [1, "1 devolução esperando sua resposta"],
    [2, "2 devoluções esperando sua resposta"],
  ])("%i devolução(ões) solicitada(s): '%s'", (quantas, titulo) => {
    const [aviso] = montarAvisos({
      ...ENTRADA_VAZIA,
      devolucoesSolicitadas: quantas,
    });
    expect(aviso.titulo).toBe(titulo);
  });

  it("avaliação cujo produto veio sem nome (texto vazio) mostra 'Produto'", () => {
    const [aviso] = montarAvisos({
      ...ENTRADA_VAZIA,
      avaliacoes: [
        {
          id: "r1",
          product_id: "prod-1",
          nomeDoProduto: "",
          rating: 4,
          created_at: "2026-11-24T10:00:00.000Z",
        },
      ],
    });
    expect(aviso.detalhe).toBe("Produto");
    expect(aviso.titulo).toBe("Avaliação de 4 estrelas sem resposta");
  });
});
