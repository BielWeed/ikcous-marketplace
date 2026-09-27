// @vitest-environment jsdom
//
// Achado da revisão do redesenho visual do CRM: "Cartão de crédito" (via o
// `default` do switch de estiloDaForma) usava a MESMA cor sky-400 do canal
// "App" (`estiloDoCanal`), e "Online" (forma de pagamento, Mercado Pago)
// usava a MESMA cor violet-400 do canal "Loja física". Sky/violet são a
// identidade FIXA dos canais (ver comentário de estiloDoCanal); uma forma
// de pagamento com a mesma cor de um canal confunde as duas legendas na
// mesma tela (Canais mostra os dois cartões lado a lado). Este arquivo
// prova que as formas ganharam uma paleta própria, sem colidir.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { KpisDoCrm, VisaoDoCrm } from "@/types/crm";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function texto(el: Element | null) {
  return (el?.textContent ?? "").replace(/\u00a0/g, " ");
}

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

describe("CanaisDoCrm — paleta das formas de pagamento não colide com a identidade dos canais", () => {
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

  function corDaBarra(rotulo: string): string[] {
    const li = Array.from(hospedeiro.querySelectorAll("li")).find((el) =>
      texto(el).includes(rotulo),
    );
    const barra = li?.querySelector(".h-full.rounded-full");
    return Array.from(barra?.classList ?? []);
  }

  it("crédito e online (Mercado Pago) não usam sky-400/violet-400 (cores dos canais App/Loja física)", async () => {
    const { CanaisDoCrm } = await import("@/components/admin/crm/CanaisDoCrm");

    const visao: VisaoDoCrm = {
      kpis: { ...KPIS_VAZIOS, receita: 1000, pedidos: 10, ticketMedio: 100 },
      canais: [
        { canal: "online", receita: 1000, pedidos: 10, ticketMedio: 100 },
      ],
      formas: [
        { forma: "credito", receita: 400, pedidos: 4 },
        { forma: "online", receita: 300, pedidos: 3 },
        { forma: "debito", receita: 200, pedidos: 2 },
        { forma: "pix", receita: 100, pedidos: 1 },
      ],
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

    await act(async () => {
      raiz.render(
        <CanaisDoCrm visao={visao} carregando={false} onNavigate={() => {}} />,
      );
    });

    const credito = corDaBarra("Cartão de crédito");
    const online = corDaBarra("Online (Mercado Pago)");
    const debito = corDaBarra("Cartão de débito");
    const pix = corDaBarra("PIX");

    expect(credito).not.toContain("bg-sky-400");
    expect(credito).not.toContain("bg-violet-400");
    expect(online).not.toContain("bg-violet-400");
    expect(online).not.toContain("bg-sky-400");

    // Paleta distinta entre as formas (nenhuma repete a cor da outra).
    const cores = [credito, online, debito, pix].map(
      (classes) => classes.find((c) => c.startsWith("bg-")) ?? "",
    );
    expect(new Set(cores).size).toBe(cores.length);
    // As duas que já eram corretas continuam com a mesma cor de antes.
    expect(debito).toContain("bg-cyan-400");
    expect(pix).toContain("bg-emerald-400");
  });
});
