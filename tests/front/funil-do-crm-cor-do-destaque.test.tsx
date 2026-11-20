// @vitest-environment jsdom
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

function visaoComPedidos(
  pedidosCriados: number,
  pedidosPagos: number,
): VisaoDoCrm {
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

describe("FunilEPedidosDoCrm — contagens sem cor de conversão", () => {
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

  it.each([0, 5, 8])("usa tom neutro com %i pagos", async (pagos) => {
    const { FunilEPedidosDoCrm } = await import(
      "@/components/admin/crm/FunilEPedidosDoCrm"
    );
    await act(async () => {
      raiz.render(
        <FunilEPedidosDoCrm
          visao={visaoComPedidos(10, pagos)}
          carregando={false}
          onNavigate={() => {}}
        />,
      );
    });

    const destaques = hospedeiro.querySelectorAll(
      '[aria-label="Funil do app"] [role="group"] h3',
    );
    expect(destaques).toHaveLength(2);
    for (const destaque of destaques) {
      expect(destaque.className).not.toMatch(/text-(rose|amber|emerald)-300/);
    }
  });
});
