// @vitest-environment jsdom
//
// "Visitas" no funil do CRM: a 1ª etapa (unidade "entradas") só existe quando
// há contagem; chips por canal; a prévia de link/robô fica FORA da conta; antes
// do contador o funil avisa em vez de mostrar um "0" enganoso; leitura
// indisponível = funil IGUAL ao de hoje.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AjudaDoCrm } from "@/components/admin/crm/AjudaDoCrm";
import { FunilEPedidosDoCrm } from "@/components/admin/crm/FunilEPedidosDoCrm";
import { lerVisitasDoCrm } from "@/lib/crm";
import type { IntervaloDeDatas, VisaoDoCrm } from "@/types/crm";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PERIODO: IntervaloDeDatas = { inicio: "2026-10-01", fim: "2026-11-03" };

const VISAO: VisaoDoCrm = {
  kpis: {
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
  },
  canais: [],
  formas: [],
  funil: {
    visitas: null,
    produtosVistos: null,
    carrinhos: 12,
    pedidosCriados: 6,
    pedidosPagos: 4,
  },
  pipeline: [],
  segmentos: [],
};

const lida = (extra: Record<string, unknown> = {}) =>
  lerVisitasDoCrm({
    contando_desde: "2026-09-01",
    visitas: 42,
    canais: [
      { canal: "direto", visitas: 20 },
      { canal: "instagram", visitas: 12 },
      { canal: "whatsapp", visitas: 6 },
      { canal: "outros_sites", visitas: 4 },
    ],
    previas: 9,
    ...extra,
  });

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

function montar(props: Record<string, unknown> = {}) {
  act(() =>
    raiz.render(
      <FunilEPedidosDoCrm
        visao={VISAO}
        carregando={false}
        onNavigate={() => {}}
        {...props}
      />,
    ),
  );
}

const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
const etapas = () =>
  Array.from(
    hospedeiro.querySelectorAll(
      '[aria-labelledby="crm-funil-titulo"] [role="group"]',
    ),
  ).map((g) => g.getAttribute("aria-label"));

describe("FunilEPedidosDoCrm — visitas", () => {
  it("com contagem: 'Visitas' é a 1ª etapa, antes de Carrinhos, em 'entradas'", () => {
    montar({ visitas: lida(), intervalo: PERIODO });
    expect(etapas().slice(0, 2)).toEqual(["Visitas", "Carrinhos"]);
    const visitas = hospedeiro.querySelector('[aria-label="Visitas"]');
    expect(visitas?.textContent).toContain("42");
    expect(visitas?.textContent).toContain("entradas");
  });

  it("chips por canal, e a prévia fica FORA do total", () => {
    montar({ visitas: lida(), intervalo: PERIODO });
    const chips = hospedeiro.querySelector('[aria-label="Visitas por canal"]');
    expect(chips?.textContent).toContain("Direto 20");
    expect(chips?.textContent).toContain("Instagram 12");
    expect(chips?.textContent).toContain("WhatsApp 6");
    expect(chips?.textContent).toContain("Outros sites 4");
    expect(texto()).toContain(
      "Fora da conta: 9 pré-visualizações de link e robôs",
    );
    // 42 pessoas, não 42 + 9.
    expect(
      hospedeiro.querySelector('[aria-label="Visitas"]')?.textContent,
    ).not.toContain("51");
  });

  it("período completo não traz aviso de início", () => {
    montar({ visitas: lida(), intervalo: PERIODO });
    expect(texto()).not.toMatch(/Contando desde|A contar/);
  });

  it("período que começa antes do contador: 'Contando desde 02/11'", () => {
    montar({
      visitas: lida({ contando_desde: "2026-11-02" }),
      intervalo: PERIODO,
    });
    expect(texto()).toContain("Contando desde 02/11");
    expect(etapas()[0]).toBe("Visitas");
  });

  it("período anterior ao contador: avisa, sem etapa e sem '0' enganoso", () => {
    montar({
      visitas: lida({ contando_desde: "2026-11-02", visitas: null }),
      intervalo: { inicio: "2026-10-01", fim: "2026-10-31" },
    });
    expect(texto()).toContain("A contar a partir de 02/11/2026");
    expect(etapas()).not.toContain("Visitas");
    expect(texto()).not.toContain("entradas");
  });

  it("contador sem nenhuma entrada: 'a partir de agora'", () => {
    montar({
      visitas: lida({ contando_desde: null, visitas: null, canais: [] }),
      intervalo: PERIODO,
    });
    expect(texto()).toContain("A contar a partir de agora");
  });

  it("indisponível (sem leitura): o funil é IGUAL ao de hoje", () => {
    montar();
    const semProp = hospedeiro.innerHTML;
    montar({ visitas: null, intervalo: PERIODO });
    expect(hospedeiro.innerHTML).toBe(semProp);
    expect(etapas()).not.toContain("Visitas");
    expect(texto()).not.toMatch(/entradas|Contando|A contar|Fora da conta/);
  });

  it("dia no teto: avisa que a contagem não é confiável e o número vira 'pelo menos'", () => {
    montar({
      visitas: lida({
        no_teto: [
          { dia: "2026-10-20", canal: "direto" },
          { dia: "2026-10-20", canal: "instagram" },
          { dia: "2026-10-21", canal: "direto" },
        ],
      }),
      intervalo: PERIODO,
    });
    expect(texto()).toContain(
      "Contagem não confiável em 2 dias: alguém inflou o contador.",
    );
    const etapa = hospedeiro.querySelector('[aria-label="Visitas"]');
    expect(etapa?.textContent).toContain("42");
    expect(etapa?.textContent).toContain("pelo menos");
  });

  it("um dia só: singular; sem no_teto: nenhum aviso nem 'pelo menos'", () => {
    montar({
      visitas: lida({ no_teto: [{ dia: "2026-10-20", canal: "direto" }] }),
      intervalo: PERIODO,
    });
    expect(texto()).toContain("Contagem não confiável em 1 dia:");
    montar({ visitas: lida(), intervalo: PERIODO });
    expect(texto()).not.toContain("não confiável");
    expect(texto()).not.toContain("pelo menos");
  });

  it("a ajuda do funil deixa de dizer que visitas não são medidas", () => {
    montar({ visitas: lida(), intervalo: PERIODO });
    act(() => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          '[aria-label="Entender Funil do app"]',
        )
        ?.click();
    });
    const ajuda = (
      document.querySelector('[role="dialog"]')?.textContent ?? ""
    ).replace(/\s+/g, " ");
    expect(ajuda).toContain("Produtos vistos ainda não são medidos.");
    expect(ajuda).not.toContain("Visitas e produtos vistos");
  });
});

describe("AjudaDoCrm — visitas", () => {
  it("explica o que conta como visita e o porquê do 'direto'", () => {
    act(() => raiz.render(<AjudaDoCrm isOpen onClose={() => {}} />));
    const ajuda = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(ajuda).not.toContain(
      "visitas e produtos vistos ainda não são medidos",
    );
    expect(ajuda).toContain("o mesmo celular abrindo duas vezes conta duas");
    expect(ajuda).toContain("porque o WhatsApp não diz de onde a pessoa veio");
    expect(ajuda).toContain("do seu próprio painel não contam");
    expect(ajuda).toContain("barra de endereço do Chrome pode não contar");
  });
});
