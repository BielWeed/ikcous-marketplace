// @vitest-environment jsdom
//
// Achado da revisão do redesenho visual do CRM: "Cartão de crédito" (via o
// `default` do switch de estiloDaForma) usava a MESMA cor sky-400 do canal
// "App" (`estiloDoCanal`), e "Online" (forma de pagamento, Mercado Pago)
// usava a MESMA cor violet-400 do canal "Loja física". Sky/violet são a
// identidade FIXA dos canais (ver comentário de estiloDoCanal); uma forma
// de pagamento com a mesma cor de um canal confunde as duas legendas na
// mesma tela (Canais mostra os dois cartões lado a lado).
//
// N2 da re-revisão: `fin__forma_do_pedido` (migration
// 20261177000000_o_financeiro_da_loja_nasce.sql:308-318, lida por
// `crm_visao` em 20261178000000_o_crm_e_o_inicio_leem_a_loja.sql:54)
// devolve SÓ `pix`, `credito`, `debito`, `dinheiro`, `cartao` ou `outro` —
// nunca `cash`/`card`/`online` (esses são o `payment_method` bruto de
// ENTRADA da função, não o que ela devolve). Este arquivo passa a usar os
// valores REAIS e prova que os 6 têm rótulo certo e cor distinta, sem
// colidir com as cores dos canais.
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

  // Rótulo EXATO (não substring): "Cartão" não pode achar o <li> de "Cartão
  // de crédito"/"Cartão de débito" por engano — os três aparecem juntos na
  // mesma lista, e os três começam com "Cartão".
  function corDaBarra(rotuloExato: string): string[] {
    const rotulo = Array.from(
      hospedeiro.querySelectorAll("li span.font-bold"),
    ).find((el) => texto(el).trim() === rotuloExato);
    const li = rotulo?.closest("li");
    const barra = li?.querySelector(".h-full.rounded-full");
    return Array.from(barra?.classList ?? []);
  }

  it("dinheiro, cartão, crédito, débito, pix e outro: rótulo certo e cor distinta, sem sky-400/violet-400", async () => {
    const { CanaisDoCrm } = await import("@/components/admin/crm/CanaisDoCrm");

    const visao: VisaoDoCrm = {
      kpis: { ...KPIS_VAZIOS, receita: 1200, pedidos: 13, ticketMedio: 92.3 },
      canais: [
        { canal: "online", receita: 1200, pedidos: 13, ticketMedio: 92.3 },
      ],
      // Ordem PROPOSITAL por receita decrescente (é como CartaoDeFormas
      // ordena) — "cartao" (genérico) vem logo depois de "credito", os
      // dois começando por "Cartão": o helper acima precisa dos dois sem
      // se confundir.
      formas: [
        { forma: "credito", receita: 400, pedidos: 4 },
        { forma: "cartao", receita: 300, pedidos: 3 },
        { forma: "debito", receita: 200, pedidos: 2 },
        { forma: "pix", receita: 150, pedidos: 2 },
        { forma: "dinheiro", receita: 100, pedidos: 1 },
        { forma: "outro", receita: 50, pedidos: 1 },
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
    const cartao = corDaBarra("Cartão");
    const debito = corDaBarra("Cartão de débito");
    const pix = corDaBarra("PIX");
    const dinheiro = corDaBarra("Dinheiro");
    const outro = corDaBarra("Outra forma");

    // Os 6 rótulos existem de verdade (helper não devolveu [] por não achar
    // o <li>).
    for (const [nome, classes] of [
      ["credito", credito],
      ["cartao", cartao],
      ["debito", debito],
      ["pix", pix],
      ["dinheiro", dinheiro],
      ["outro", outro],
    ] as const) {
      expect(
        classes.length,
        `forma "${nome}" sem barra encontrada`,
      ).toBeGreaterThan(0);
    }

    expect(credito).not.toContain("bg-sky-400");
    expect(credito).not.toContain("bg-violet-400");
    expect(cartao).not.toContain("bg-sky-400");
    expect(cartao).not.toContain("bg-violet-400");

    // Paleta distinta entre as 6 formas (nenhuma repete a cor da outra) —
    // "cartao" (genérico) precisa da SUA própria cor, distinta de crédito
    // e débito (são 3 "tipos de cartão" diferentes na mesma tela).
    const cores = [credito, cartao, debito, pix, dinheiro, outro].map(
      (classes) => classes.find((c) => c.startsWith("bg-")) ?? "",
    );
    expect(new Set(cores).size).toBe(cores.length);

    // As que já eram corretas continuam com a mesma cor de antes.
    expect(debito).toContain("bg-cyan-400");
    expect(pix).toContain("bg-emerald-400");
    expect(dinheiro).toContain("bg-amber-400");
  });

  it('a frase de leitura cita "Dinheiro" quando ele é a forma líder', async () => {
    const { CanaisDoCrm } = await import("@/components/admin/crm/CanaisDoCrm");

    const visao: VisaoDoCrm = {
      kpis: { ...KPIS_VAZIOS, receita: 5000, pedidos: 40, ticketMedio: 125 },
      canais: [
        { canal: "presencial", receita: 5000, pedidos: 40, ticketMedio: 125 },
      ],
      formas: [
        { forma: "dinheiro", receita: 3500, pedidos: 20 },
        { forma: "pix", receita: 1500, pedidos: 20 },
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

    expect(texto(hospedeiro)).toContain(
      "Dinheiro é 70% da receita do período.",
    );
  });
});
