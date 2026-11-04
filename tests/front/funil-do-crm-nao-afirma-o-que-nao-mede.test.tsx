// @vitest-environment jsdom
//
// Funil e pedidos do CRM: duas frases afirmavam o que o dado não prova.
// 1) "Pedidos criados" conta pela data do PEDIDO e "pedidos pagos" pela data
//    do PAGAMENTO (crm_visao). Quando entram vendas de pedidos de outro dia, o
//    cartão mostrava "3 de 2" e a nota dizia "Todo pedido criado virou venda
//    paga" mesmo com pedido de hoje sem pagar.
// 2) A fila "Pedidos em aberto agora" nunca traz pedido aguardando pagamento
//    (o banco filtra), mas o texto vazio dizia "nenhum pedido esperando
//    separação, pagamento ou envio".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { KpisDoCrm, VisaoDoCrm } from "@/types/crm";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KPIS_VAZIOS: KpisDoCrm = {
  receita: null,
  receitaAnterior: null,
  pedidos: null,
  pedidosAnterior: null,
  ticketMedio: null,
  ticketMedioAnterior: null,
  clientesCompradores: null,
  clientesNovos: null,
  taxaRecompra: null,
  receitaRecorrentePct: null,
  ltvMedio: null,
  receitaEmRisco: null,
  taxaDevolucao: null,
};

function visao(pedidosCriados: number, pedidosPagos: number): VisaoDoCrm {
  return {
    kpis: KPIS_VAZIOS,
    canais: [],
    formas: [],
    funil: {
      visitas: null,
      produtosVistos: null,
      carrinhos: null,
      pedidosCriados,
      pedidosPagos,
    },
    pipeline: [],
    segmentos: [],
  };
}

describe("FunilEPedidosDoCrm — só afirma o que o dado prova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(v: VisaoDoCrm) {
    const { FunilEPedidosDoCrm } = await import(
      "@/components/admin/crm/FunilEPedidosDoCrm"
    );
    await act(async () => {
      raiz.render(
        <FunilEPedidosDoCrm
          visao={v}
          carregando={false}
          onNavigate={() => {}}
        />,
      );
    });
    return (hospedeiro.textContent ?? "").replace(/\u00a0/g, " ");
  }

  it("mais vendas pagas do que pedidos criados: sem '3 de 2' e sem 'todo pedido virou venda paga'", async () => {
    const texto = await montar(visao(2, 3));
    expect(texto).not.toContain("3 de 2");
    expect(texto).not.toContain("Todo pedido criado virou venda paga");
  });

  it("pagas = criadas (podem ser de dias diferentes): não promete que todo pedido foi pago", async () => {
    const texto = await montar(visao(2, 2));
    expect(texto).not.toContain("Todo pedido criado virou venda paga");
  });

  it("controle: menos vendas do que pedidos mantém '1 de 2' e o aviso de pedido sem venda", async () => {
    const texto = await montar(visao(2, 1));
    expect(texto).toContain("1 de 2");
    expect(texto).toContain("1 pedido não virou venda paga");
  });

  it("fila vazia: não diz que não há pedido esperando pagamento", async () => {
    const texto = await montar(visao(0, 0));
    expect(texto).toContain("Nenhum pedido em aberto");
    expect(texto).not.toContain("separação, pagamento ou envio");
    expect(texto).toContain("Pedidos que aguardam pagamento ficam de fora");
  });
});
