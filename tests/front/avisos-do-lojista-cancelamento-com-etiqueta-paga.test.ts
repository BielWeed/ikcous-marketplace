// 27/11/2026 (caça): a cliente pode cancelar pedido em `processing` que JÁ TEM
// etiqueta paga no Melhor Envio (`shipping_label_id`). O banco devolve o
// estoque e abre o reembolso, mas cancelar o pedido NÃO cancela a etiqueta: o
// saldo segue gasto e o pacote pode até já estar no correio. O aviso do sino
// dizia só "pago, o reembolso é automático".
//
// A mesma frase sai no push da rotina de 10 minutos
// (supabase/functions/_shared/aviso-de-cancelamento-do-cliente.ts, com teste
// próprio em Deno): mudou aqui, mude lá.
import { describe, expect, it } from "vitest";

import {
  type EntradaDeAvisos,
  type LinhaDeCancelamento,
  montarAvisos,
  selecionarCancelamentosDoCliente,
} from "@/utils/avisos-do-lojista";

const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
// O valor sai com espaço NÃO separável (formatCurrency), como no resto do sino.
const VALOR = "R$ 149,90";
const FRASE_DA_ETIQUETA =
  "Esse pedido já tinha etiqueta de envio: se ainda não postou, cancele a etiqueta no Melhor Envio para recuperar o valor; se já postou, fale com a cliente.";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

function linha(
  extra: Partial<LinhaDeCancelamento> = {},
  pedido: Record<string, unknown> = {},
): LinhaDeCancelamento {
  return {
    id: "h1",
    order_id: PEDIDO,
    old_status: "processing",
    created_by: CLIENTE,
    created_at: "2026-11-27T11:57:00.000Z",
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

function detalheDoAviso(l: LinhaDeCancelamento) {
  const cancelamentosDoCliente = selecionarCancelamentosDoCliente(
    [l],
    new Set<string>(),
  );
  const avisos = montarAvisos({ ...VAZIO, cancelamentosDoCliente });
  const aviso = avisos.find((a) => a.tipo === "cancelamento");
  if (!aviso) throw new Error("aviso de cancelamento ausente");
  return aviso.detalhe;
}

describe("aviso de cancelamento do cliente — etiqueta já paga", () => {
  it("pago, em processing, com etiqueta: o aviso manda cuidar da etiqueta no Melhor Envio", () => {
    const [c] = selecionarCancelamentosDoCliente(
      [linha({}, { shipping_label_id: "label-123" })],
      new Set<string>(),
    );
    expect(c.situacao).toBe("reembolso_automatico");
    expect(c.etiquetaPaga).toBe(true);
    expect(detalheDoAviso(linha({}, { shipping_label_id: "label-123" }))).toBe(
      `${VALOR} — pago, o reembolso é automático. ${FRASE_DA_ETIQUETA}`,
    );
  });

  it("sem pagamento online, com etiqueta: o aviso também fala da etiqueta", () => {
    expect(
      detalheDoAviso(
        linha({}, { payment_status: null, shipping_label_id: "label-123" }),
      ),
    ).toBe(`Não precisa separar nem enviar. ${FRASE_DA_ETIQUETA}`);
  });

  it("produto que JÁ SAIU: a etiqueta já foi usada, o aviso não fala dela", () => {
    for (const [extra, pedido] of [
      [{ old_status: "shipping" }, { cancelled_after_shipping: true }],
      [{ old_status: "processing" }, { cancelled_after_shipping: true }],
    ] as const) {
      const l = linha(extra, { ...pedido, shipping_label_id: "label-123" });
      const [c] = selecionarCancelamentosDoCliente([l], new Set<string>());
      expect(c.etiquetaPaga).toBeUndefined();
      expect(detalheDoAviso(l)).not.toContain("etiqueta");
    }
  });

  it("sem etiqueta (nula, ausente, vazia ou só espaços): o texto de sempre, sem o campo novo", () => {
    for (const shipping_label_id of [null, undefined, "", "   "]) {
      const l = linha({}, { shipping_label_id });
      const [c] = selecionarCancelamentosDoCliente([l], new Set<string>());
      expect(Object.hasOwn(c, "etiquetaPaga")).toBe(false);
      expect(detalheDoAviso(l)).toBe(
        `${VALOR} — pago, o reembolso é automático`,
      );
    }
  });
});
