// @vitest-environment jsdom
//
// Achados de contraste abaixo de AA (spec exige AA) na revisão do redesenho
// visual do CRM (`docs/superpowers/specs/2026-09-27-crm-visual-profissional-design.md`):
//
// - CanaisDoCrm: a frase "Nenhuma venda ... neste período" (canal zerado)
//   media ~2,2:1 — text-zinc-500 DENTRO de um `opacity-60` aplicado ao
//   cartão inteiro. A opacidade não pode recair sobre frase nenhuma; o
//   texto informativo vira text-zinc-400 a 100% de opacidade.
// - ClientesDoCrm: a receita do segmento zerado (10 px) media ~2,1:1 —
//   text-zinc-500 vira text-zinc-400. Os títulos de faixa ("Melhores" /
//   "Atenção" / "Perdendo") e os rótulos de coluna também saem de zinc-500
//   para zinc-400.
// - O botão "Limpar" do filtro de segmento tinha min-h-9 (36 px), abaixo do
//   alvo de toque de 44 px — vira min-h-11.
//
// N3 da re-revisão (27/09/2026): o fix acima do segmento zerado trocou só a
// COR da receita, mas o `opacity-60` continuava no BOTÃO inteiro (~3,2:1,
// ainda abaixo de AA) — agora a opacidade fica só no ponto de cor (gráfico),
// igual ao que já tinha sido feito em CanaisDoCrm. Também troca para
// text-zinc-400: "(67%)" ao lado de Pedidos e "· ticket R$…" em
// CanaisDoCrm.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CanalDoCrm,
  ClienteDoCrm,
  FormaDePagamentoDoCrm,
  KpisDoCrm,
  ResumoDoSegmento,
  VisaoDoCrm,
} from "@/types/crm";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de teste" } }),
}));

const h = vi.hoisted(() => ({
  listaVazia: { total: 0, clientes: [] as ClienteDoCrm[] },
}));
vi.mock("@/hooks/useCrm", () => ({
  useCrmClientes: () => ({
    lista: h.listaVazia,
    carregando: false,
    erro: null,
    atualizar: vi.fn(),
  }),
}));

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

describe("CanaisDoCrm — frase do canal zerado usa text-zinc-400 a 100% de opacidade", () => {
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

  it("canal presencial (loja física) zerado: sentença legível, sem opacity-60 no cartão", async () => {
    const { CanaisDoCrm } = await import("@/components/admin/crm/CanaisDoCrm");

    const canais: CanalDoCrm[] = [
      { canal: "online", receita: 500, pedidos: 5, ticketMedio: 100 },
    ];
    const formas: FormaDePagamentoDoCrm[] = [
      { forma: "pix", receita: 500, pedidos: 5 },
    ];
    const visao: VisaoDoCrm = {
      kpis: { ...KPIS_VAZIOS, receita: 500, pedidos: 5, ticketMedio: 100 },
      canais,
      formas,
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

    const frase = Array.from(hospedeiro.querySelectorAll("p")).find((el) =>
      texto(el).includes("Nenhuma venda pela loja física"),
    );
    expect(frase).not.toBeUndefined();
    expect(frase?.classList.contains("text-zinc-400")).toBe(true);
    expect(frase?.classList.contains("text-zinc-500")).toBe(false);

    // A opacidade não pode mais recair sobre o cartão inteiro (que embrulha
    // a frase) — só um elemento gráfico (ícone), nunca o texto.
    let no: Element | null = frase!;
    while (no && no !== hospedeiro) {
      expect(no.classList.contains("opacity-60")).toBe(false);
      no = no.parentElement;
    }
  });

  it('N3: "(N%)" ao lado de Pedidos e "· ticket R$…" usam text-zinc-400', async () => {
    const { CanaisDoCrm } = await import("@/components/admin/crm/CanaisDoCrm");

    const canais: CanalDoCrm[] = [
      { canal: "online", receita: 800, pedidos: 8, ticketMedio: 100 },
      { canal: "presencial", receita: 200, pedidos: 2, ticketMedio: 100 },
    ];
    const formas: FormaDePagamentoDoCrm[] = [
      { forma: "pix", receita: 1000, pedidos: 10 },
    ];
    const visao: VisaoDoCrm = {
      kpis: { ...KPIS_VAZIOS, receita: 1000, pedidos: 10, ticketMedio: 100 },
      canais,
      formas,
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

    const fatiaPedidos = Array.from(hospedeiro.querySelectorAll("span")).find(
      (el) => /^\(\d+%\)$/.test(texto(el).trim()),
    );
    expect(fatiaPedidos).not.toBeUndefined();
    expect(fatiaPedidos?.classList.contains("text-zinc-400")).toBe(true);
    expect(fatiaPedidos?.classList.contains("text-zinc-500")).toBe(false);

    const ticket = Array.from(hospedeiro.querySelectorAll("span")).find((el) =>
      texto(el).trim().startsWith("· ticket"),
    );
    expect(ticket).not.toBeUndefined();
    expect(ticket?.classList.contains("text-zinc-400")).toBe(true);
    expect(ticket?.classList.contains("text-zinc-500")).toBe(false);
  });
});

describe("ClientesDoCrm — receita do segmento zerado e títulos de faixa usam text-zinc-400", () => {
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

  it("segmento com 0 clientes: a receita compacta (10px) não é mais text-zinc-500", async () => {
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );

    // Nenhum segmento na lista: TODOS os 10 blocos ficam zerados — mais
    // fácil de achar um bloco "Campeões" (0 clientes) sem precisar navegar
    // por faixa.
    const segmentos: ResumoDoSegmento[] = [];

    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={segmentos}
          carregandoSegmentos={false}
          segmento={null}
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });

    const blocoCampeoes = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((b) => texto(b).includes("Campeões"));
    expect(blocoCampeoes).not.toBeUndefined();
    const receita = Array.from(blocoCampeoes!.querySelectorAll("span")).find(
      (el) => texto(el).startsWith("R$"),
    );
    expect(receita).not.toBeUndefined();
    expect(receita?.classList.contains("text-zinc-400")).toBe(true);
    expect(receita?.classList.contains("text-zinc-500")).toBe(false);

    // N3: opacity-60 não pode mais recair sobre o BOTÃO inteiro (dimmerizava
    // a receita mesmo já em zinc-400, ~3,2:1) — só sobre o ponto de cor
    // (gráfico), dentro do botão.
    expect(blocoCampeoes!.classList.contains("opacity-60")).toBe(false);
    const pontoDeCor = blocoCampeoes!.querySelector("span.rounded-full");
    expect(pontoDeCor).not.toBeNull();
    expect(pontoDeCor?.classList.contains("opacity-60")).toBe(true);

    const tituloFaixa = Array.from(hospedeiro.querySelectorAll("h3")).find(
      (el) => texto(el) === "Melhores",
    );
    expect(tituloFaixa).not.toBeUndefined();
    expect(tituloFaixa?.classList.contains("text-zinc-400")).toBe(true);
    expect(tituloFaixa?.classList.contains("text-zinc-500")).toBe(false);
  });

  it('botão "Limpar" do filtro ativo tem alvo de toque >= 44px (min-h-11)', async () => {
    const { ClientesDoCrm } = await import(
      "@/components/admin/crm/ClientesDoCrm"
    );

    const segmentos: ResumoDoSegmento[] = [
      { segmento: "em_risco", clientes: 2, receita: 200 },
    ];

    await act(async () => {
      raiz.render(
        <ClientesDoCrm
          segmentos={segmentos}
          carregandoSegmentos={false}
          segmento="em_risco"
          aoMudarSegmento={() => {}}
          active
          onNavigate={() => {}}
          sinalDeAtualizacao={0}
        />,
      );
    });

    const limpar = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      texto(b).includes("Limpar"),
    );
    expect(limpar).not.toBeUndefined();
    expect(limpar?.classList.contains("min-h-11")).toBe(true);
    expect(limpar?.classList.contains("min-h-9")).toBe(false);
  });
});
