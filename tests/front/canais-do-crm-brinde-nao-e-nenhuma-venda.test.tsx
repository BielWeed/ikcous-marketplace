// @vitest-environment jsdom
//
// Aba Canais do CRM: um pedido que fecha em R$ 0,00 (brinde com cupom de 100%)
// é venda para o banco (`crm__vendas` não filtra total > 0). Antes, o bloco do
// canal olhava só a receita e escrevia "Nenhuma venda pelo app neste período"
// ao lado de "Pedidos 1" no cartão de cima. Zerado é "nenhum PEDIDO".
import { CanaisDoCrm } from "@/components/admin/crm/CanaisDoCrm";
import { fraseLeituraDosCanais } from "@/lib/crm";
import type { CanalDoCrm, KpisDoCrm, VisaoDoCrm } from "@/types/crm";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const KPIS: KpisDoCrm = {
  receita: 0,
  receitaAnterior: null,
  pedidos: 1,
  pedidosAnterior: null,
  ticketMedio: 0,
  ticketMedioAnterior: null,
  clientesCompradores: null,
  clientesNovos: null,
  taxaRecompra: null,
  receitaRecorrentePct: null,
  ltvMedio: null,
  receitaEmRisco: null,
  taxaDevolucao: null,
};

function visaoCom(canais: CanalDoCrm[]): VisaoDoCrm {
  return {
    kpis: KPIS,
    canais,
    formas: [],
    funil: {
      visitas: null,
      produtosVistos: null,
      carrinhos: null,
      pedidosCriados: null,
      pedidosPagos: null,
    },
    pipeline: [],
    segmentos: [],
  };
}

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\s/g, " ");

describe("Canais do CRM: brinde de R$ 0,00 é venda, não 'Nenhuma venda'", () => {
  let raiz: Root;
  let tela: HTMLDivElement;

  beforeEach(() => {
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    tela.remove();
  });

  async function montar(visao: VisaoDoCrm) {
    await act(async () => {
      raiz.render(
        <CanaisDoCrm visao={visao} carregando={false} onNavigate={() => {}} />,
      );
    });
  }

  it("canal com 1 pedido e receita 0: mostra Pedidos 1 e Valor médio R$ 0,00 (o texto não separa rótulo e valor)", async () => {
    await montar(
      visaoCom([
        { canal: "online", receita: 0, pedidos: 1, ticketMedio: 0 },
        { canal: "presencial", receita: 0, pedidos: 0, ticketMedio: 0 },
      ]),
    );
    const app = tela.querySelector('li[aria-label="Detalhes App (online)"]');
    expect(app).not.toBeNull();
    expect(texto(app)).not.toContain("Nenhuma venda");
    expect(texto(app)).toContain("Pedidos1 (100%)");
    expect(texto(app)).toContain("Valor médioR$ 0,00");
    // O canal que de fato não teve pedido segue dizendo isso.
    const loja = tela.querySelector('li[aria-label="Detalhes Loja física"]');
    expect(texto(loja)).toContain("Nenhuma venda pela loja física");
  });

  it("com pedidos mas receita 0, o cartão vazio 'Nenhuma venda paga' não aparece", async () => {
    await montar(
      visaoCom([
        { canal: "online", receita: 0, pedidos: 1, ticketMedio: 0 },
        { canal: "presencial", receita: 0, pedidos: 0, ticketMedio: 0 },
      ]),
    );
    // (o cartão de formas tem frase própria com o mesmo começo; o vazio é o
    // que traz o botão do balcão)
    expect(texto(tela)).not.toContain("Vender no balcão");
  });

  it("sem nenhum pedido: o cartão vazio continua aparecendo", async () => {
    await montar(
      visaoCom([
        { canal: "online", receita: 0, pedidos: 0, ticketMedio: 0 },
        { canal: "presencial", receita: 0, pedidos: 0, ticketMedio: 0 },
      ]),
    );
    expect(texto(tela)).toContain("Vender no balcão");
  });
});

describe("fraseLeituraDosCanais: pedidos sem receita", () => {
  const brinde = { canal: "online", receita: 0, pedidos: 1, ticketMedio: 0 };
  const vazio = { canal: "presencial", receita: 0, pedidos: 0, ticketMedio: 0 };

  it("há pedido e a receita somou zero: diz que foram brindes, não 'Nenhuma venda'", () => {
    expect(fraseLeituraDosCanais(brinde, vazio)).toBe(
      "As vendas do período somaram R$ 0,00 (brindes).",
    );
  });

  it("nenhum pedido nos dois canais: 'Nenhuma venda no período.'", () => {
    expect(fraseLeituraDosCanais(vazio, vazio)).toBe(
      "Nenhuma venda no período.",
    );
  });
});
