// O lojista fica sabendo quando o CLIENTE cancela (14/10/2026) — a parte da
// TELA (o sino do painel). O push sai da rotina de 10 minutos
// (supabase/functions/_shared/aviso-de-cancelamento-do-cliente.ts).
//
// A regra "o que e cancelamento do cliente" mora em DOIS lugares que nao se
// enxergam: aqui (a tela) e la (o push). A tabela de casos abaixo e a mesma do
// teste de la — mexeu numa, mexa nas duas. UMA diferenca, de proposito e
// declarada: o pedido SEM pagamento online (a pagar na entrega/retirada) que a
// cliente cancela antes do envio so' avisa na TELA; o push da rotina ainda nao
// o conhece (ver o segundo bloco `describe`).
import { describe, expect, it } from "vitest";

import {
  type CancelamentoDoCliente,
  type EntradaDeAvisos,
  JANELA_DE_CANCELAMENTO_HORAS,
  type LinhaDeCancelamento,
  montarAvisos,
  selecionarCancelamentosDoCliente,
} from "@/utils/avisos-do-lojista";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

const ADMIN = "a1111111-1111-4111-8111-111111111111";
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const OUTRO = "c2222222-2222-4222-8222-222222222222";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

function linha(
  extra: Partial<LinhaDeCancelamento> = {},
  pedido: Record<string, unknown> = {},
): LinhaDeCancelamento {
  return {
    id: "h1",
    order_id: PEDIDO,
    old_status: "pending",
    created_by: CLIENTE,
    created_at: "2026-10-14T11:57:00.000Z",
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

const SEM_ADMIN = new Set<string>();
const COM_ADMIN = new Set<string>([ADMIN]);

describe("selecionarCancelamentosDoCliente — so o que o CLIENTE cancelou e ja tinha pago", () => {
  it("cliente cancelou pedido pago e nao enviado: entra, com o pedido e a situacao certos", () => {
    const [c] = selecionarCancelamentosDoCliente([linha()], SEM_ADMIN);
    expect(c).toEqual<CancelamentoDoCliente>({
      id: "h1",
      order_id: PEDIDO,
      customer_name: "Maria Silva",
      total: 149.9,
      created_at: "2026-10-14T11:57:00.000Z",
      situacao: "reembolso_automatico",
    });
  });

  it("ja enviado (estava em shipping) entra com a situacao 'ja_saiu'", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [linha({ old_status: "shipping" }, { cancelled_after_shipping: true })],
      SEM_ADMIN,
    );
    expect(c.situacao).toBe("ja_saiu");
  });

  it("pago depois do cancelamento entra com situacao propria (sem prometer reembolso automatico)", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [linha({}, { payment_status: "pago_apos_expirar" })],
      SEM_ADMIN,
    );
    expect(c.situacao).toBe("pago_depois");
  });

  it("estornado (a rotina ja devolveu o dinheiro) tambem entra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({}, { payment_status: "estornado" })],
        SEM_ADMIN,
      ),
    ).toHaveLength(1);
  });

  it("ADMIN cancelando (pedido de cliente ou o proprio pedido) nao entra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ created_by: ADMIN })],
        COM_ADMIN,
      ),
    ).toEqual([]);
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ created_by: ADMIN }, { user_id: ADMIN })],
        COM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("quem cancelou nao e o dono do pedido: nao entra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ created_by: OUTRO })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("sem autor (expiracao do PIX, servidor): nao entra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ created_by: null })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("pedido com pagamento ONLINE nao concluido (aguardando, recusado, expirado): nao entra", () => {
    for (const payment_status of ["aguardando", "recusado", "expirado"]) {
      expect(
        selecionarCancelamentosDoCliente(
          [linha({}, { payment_status })],
          SEM_ADMIN,
        ),
      ).toEqual([]);
    }
  });

  it("venda ja recebida na mao (recebido_na_entrega): nao entra, e outro assunto", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({}, { payment_status: "recebido_na_entrega" })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("pedido que a loja reativou (nao esta mais cancelado): nao entra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({}, { status: "processing" })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("re-cancelamento (ja estava cancelado): nao entra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ old_status: "cancelled" })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("linha sem o pedido embutido (RLS, pedido apagado): nao entra e nao quebra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ marketplace_orders: null })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("o embutido vindo como lista de um item (outro formato do PostgREST) tambem vale", () => {
    const l = linha();
    const emLista = {
      ...l,
      marketplace_orders: [l.marketplace_orders],
    } as unknown as LinhaDeCancelamento;
    expect(selecionarCancelamentosDoCliente([emLista], SEM_ADMIN)).toHaveLength(
      1,
    );
  });

  it("a janela da tela e a mesma de 24 h do push", () => {
    expect(JANELA_DE_CANCELAMENTO_HORAS).toBe(24);
  });
});

// A loja nao e avisada so do que e' dinheiro: pedido a pagar na entrega ou na
// retirada (sem pagamento online) que a cliente cancela antes do envio faria a
// loja separar e enviar mercadoria cancelada. So a TELA conhece este ramo.
describe("selecionarCancelamentosDoCliente — pedido sem pagamento online, ainda nao enviado", () => {
  const SEM_PAGAMENTO = [null, ""];

  it("a cliente cancelou pedido sem pagamento online (nulo ou vazio) e nao enviado: entra, com a situacao propria", () => {
    for (const payment_status of SEM_PAGAMENTO) {
      const [c] = selecionarCancelamentosDoCliente(
        [linha({}, { payment_status })],
        SEM_ADMIN,
      );
      expect(c).toEqual<CancelamentoDoCliente>({
        id: "h1",
        order_id: PEDIDO,
        customer_name: "Maria Silva",
        total: 149.9,
        created_at: "2026-10-14T11:57:00.000Z",
        situacao: "sem_pagamento_online",
      });
    }
  });

  it("cancelamento feito pela PROPRIA LOJA (admin) nao avisa a loja dela mesma", () => {
    // Admin cancelando pedido de cliente: cai no "autor nao e o dono".
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ created_by: ADMIN }, { payment_status: null })],
        COM_ADMIN,
      ),
    ).toEqual([]);
    // Admin cancelando o PROPRIO pedido (autor = dono): so o papel o barra.
    expect(
      selecionarCancelamentosDoCliente(
        [
          linha(
            { created_by: ADMIN },
            { user_id: ADMIN, payment_status: null },
          ),
        ],
        COM_ADMIN,
      ),
    ).toEqual([]);
    // Autor que nao e o dono nem admin (ex.: conta alheia): tambem nao.
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ created_by: OUTRO }, { payment_status: null })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("cancelamento sem autor (rotina do servidor) nao avisa", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ created_by: null }, { payment_status: null })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("produto que ja tinha saido (shipping) nao entra por este ramo", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ old_status: "shipping" }, { payment_status: null })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
    expect(
      selecionarCancelamentosDoCliente(
        [linha({}, { payment_status: null, cancelled_after_shipping: true })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("pedido que a loja reativou, ou re-cancelamento, nao entra", () => {
    expect(
      selecionarCancelamentosDoCliente(
        [linha({}, { payment_status: null, status: "processing" })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
    expect(
      selecionarCancelamentosDoCliente(
        [linha({ old_status: "cancelled" }, { payment_status: null })],
        SEM_ADMIN,
      ),
    ).toEqual([]);
  });

  it("pedido PAGO nao duplica: continua uma situacao so, a de dinheiro (sem 'sem_pagamento_online')", () => {
    const pago = selecionarCancelamentosDoCliente([linha()], SEM_ADMIN);
    expect(pago).toHaveLength(1);
    expect(pago[0].situacao).toBe("reembolso_automatico");
  });
});

describe("montarAvisos — cancelamento do cliente", () => {
  const cancelamento = (
    extra: Partial<CancelamentoDoCliente> = {},
  ): CancelamentoDoCliente => ({
    id: "h1",
    order_id: PEDIDO,
    customer_name: "Maria Silva",
    total: 149.9,
    created_at: "2026-10-14T11:57:00.000Z",
    situacao: "reembolso_automatico",
    ...extra,
  });

  it("vira UM aviso que abre AQUELE pedido, com numero, nome, valor e a frase do dinheiro", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      cancelamentosDoCliente: [cancelamento()],
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      id: "cancelamento:h1",
      tipo: "cancelamento",
      titulo: "Maria Silva cancelou o pedido #4F5A6B",
      detalhe: "R$ 149,90 — pago, o reembolso é automático",
      quando: "2026-10-14T11:57:00.000Z",
      destino: { view: "admin-orders", id: PEDIDO },
    });
  });

  it("as tres frases: reembolso automatico, produto ja saiu e pago depois do cancelamento", () => {
    const frase = (situacao: CancelamentoDoCliente["situacao"]) =>
      montarAvisos({
        ...VAZIO,
        cancelamentosDoCliente: [cancelamento({ situacao })],
      })[0].detalhe;
    expect(frase("reembolso_automatico")).toContain("o reembolso é automático");
    expect(frase("ja_saiu")).toContain("o produto já saiu: avise o transporte");
    expect(frase("pago_depois")).toContain("pago depois do cancelamento");
    expect(frase("ja_saiu")).not.toContain("automático");
    expect(frase("pago_depois")).not.toContain("automático");
  });

  it("sem pagamento online: 'Pedido #N cancelado pela cliente' + 'Nao precisa separar nem enviar', sem falar de dinheiro", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      cancelamentosDoCliente: [
        cancelamento({ situacao: "sem_pagamento_online" }),
      ],
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      id: "cancelamento:h1",
      tipo: "cancelamento",
      titulo: "Pedido #4F5A6B cancelado pela cliente",
      detalhe: "Não precisa separar nem enviar.",
      destino: { view: "admin-orders", id: PEDIDO },
      contaNoCracha: false,
    });
    expect(`${avisos[0].titulo}. ${avisos[0].detalhe}`).toBe(
      "Pedido #4F5A6B cancelado pela cliente. Não precisa separar nem enviar.",
    );
    expect(avisos[0].detalhe).not.toContain("reembolso");
  });

  it("nao conta no cracha (como o estoque): a bolinha so acende pelo que o lojista resolve e some", () => {
    expect(
      montarAvisos({ ...VAZIO, cancelamentosDoCliente: [cancelamento()] })[0]
        .contaNoCracha,
    ).toBe(false);
  });

  it("sem nome do cliente: 'Cliente cancelou o pedido #N'", () => {
    const [aviso] = montarAvisos({
      ...VAZIO,
      cancelamentosDoCliente: [cancelamento({ customer_name: "  " })],
    });
    expect(aviso.titulo).toBe("Cliente cancelou o pedido #4F5A6B");
  });

  it("fica logo depois dos pedidos e antes das devolucoes; ausente = nada muda", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      devolucoesSolicitadas: 1,
      cancelamentosDoCliente: [cancelamento()],
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
      "cancelamento",
      "devolucao",
    ]);
    expect(montarAvisos(VAZIO)).toEqual([]);
  });

  it("dois cancelamentos: o mais recente primeiro, com ids distintos por evento", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      cancelamentosDoCliente: [
        cancelamento({ id: "velho", created_at: "2026-10-14T08:00:00.000Z" }),
        cancelamento({ id: "novo", created_at: "2026-10-14T11:00:00.000Z" }),
      ],
    });
    expect(avisos.map((a) => a.id)).toEqual([
      "cancelamento:novo",
      "cancelamento:velho",
    ]);
  });
});
