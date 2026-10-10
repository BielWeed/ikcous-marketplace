// @vitest-environment jsdom
//
// N4 da re-revisão (27/09/2026): CLASSES_DO_DESTAQUE_DE_PAGAMENTO
// (FunilEPedidosDoCrm.tsx) escolhe a cor do destaque "Conversão em venda"
// pelo TOM que tomDaTaxaDePagamento devolve (0-29% baixa/rosa, 30-69%
// mediana/âmbar, >=70% boa/verde) — a função pura já tem teste em
// crm-visual-canais-funil.test.ts, mas nada provava que o COMPONENTE de
// fato usa o resultado dela: um mutante "sempre emerald" no componente
// (a regressão original que o achado 8 corrigiu — 0% pintado de verde)
// passaria na suíte inteira sem este arquivo, porque a função pura
// continuaria certa isolada. Este teste renderiza o componente de
// verdade com 3 conversões (0%, 50%, 80%) e lê as classes do DOM.
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

function visaoComConversao(
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

describe("FunilEPedidosDoCrm — a cor do destaque 'Conversão em venda' reage ao valor, nunca é sempre verde", () => {
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

  /** A caixa do destaque é o `div.rounded-xl.border` mais próximo do
   * rótulo "Conversão em venda" — o `<p>` do rótulo mora dentro de um
   * `<div>` sem classe, que por sua vez mora dentro da caixa estilizada. */
  function classesDaCaixa(): string[] {
    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (el) => el.textContent?.trim() === "Conversão em venda",
    );
    const caixa = rotulo?.closest("div.rounded-xl.border");
    return Array.from(caixa?.classList ?? []);
  }

  it("0% (o caso real que motivou o achado): rosa, nunca verde", async () => {
    const { FunilEPedidosDoCrm } = await import(
      "@/components/admin/crm/FunilEPedidosDoCrm"
    );

    await act(async () => {
      raiz.render(
        <FunilEPedidosDoCrm
          visao={visaoComConversao(10, 0)}
          carregando={false}
          onNavigate={() => {}}
        />,
      );
    });

    const classes = classesDaCaixa();
    expect(classes).toContain("border-rose-500/20");
    expect(classes).not.toContain("border-emerald-500/20");
    expect(classes).not.toContain("border-amber-500/20");
  });

  it("~50%: âmbar (mediana), nem verde nem rosa", async () => {
    const { FunilEPedidosDoCrm } = await import(
      "@/components/admin/crm/FunilEPedidosDoCrm"
    );

    await act(async () => {
      raiz.render(
        <FunilEPedidosDoCrm
          visao={visaoComConversao(10, 5)}
          carregando={false}
          onNavigate={() => {}}
        />,
      );
    });

    const classes = classesDaCaixa();
    expect(classes).toContain("border-amber-500/20");
    expect(classes).not.toContain("border-emerald-500/20");
    expect(classes).not.toContain("border-rose-500/20");
  });

  it(">= 70%: verde (boa) — a única faixa que pode usar emerald", async () => {
    const { FunilEPedidosDoCrm } = await import(
      "@/components/admin/crm/FunilEPedidosDoCrm"
    );

    await act(async () => {
      raiz.render(
        <FunilEPedidosDoCrm
          visao={visaoComConversao(10, 8)}
          carregando={false}
          onNavigate={() => {}}
        />,
      );
    });

    const classes = classesDaCaixa();
    expect(classes).toContain("border-emerald-500/20");
    expect(classes).not.toContain("border-amber-500/20");
    expect(classes).not.toContain("border-rose-500/20");
  });
});
