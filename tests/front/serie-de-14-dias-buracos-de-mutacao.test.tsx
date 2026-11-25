// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), "Últimos 14 dias" do Início. Defeitos de UMA
// linha que os testes vizinhos deixavam passar:
//  - "Próximo dia" andar para trás (só dá para ver depois de recuar um dia);
//  - o cartão ficar "ocupado" (leitor de tela) só porque recarrega em segundo
//    plano, com a série já na tela;
//  - os dois rótulos de ponta (primeiro e último dia) e o "· Hoje" do último,
//    que só vale quando o último dia da série é mesmo hoje;
//  - o "· Hoje" na linha da tabela (fechada e aberta) e no nome acessível do
//    botão de escolher o dia;
//  - o visto (check) só na linha escolhida e o fundo mais claro dela;
//  - a dica ao passar o dedo/mouse numa coluna ("dia: valor");
//  - os textos de espera e o botão de tentar de novo quando a leitura falha.
// Valores e dias inventados; nenhuma chamada de rede.
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import { formatarData, formatarMoeda } from "@/lib/crm";
import type { PontoDaSerieDiaria } from "@/types/painel";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Meio-dia em Brasília de 31/12/2026: "hoje" é 2026-12-31.
const INSTANTE = new Date("2026-12-31T15:00:00Z");

const DIAS = Array.from({ length: 14 }, (_, i) =>
  new Date(Date.UTC(2026, 11, 18 + i, 12)).toISOString().slice(0, 10),
);
const SERIE: PontoDaSerieDiaria[] = DIAS.map((dia, i) => ({
  dia,
  receita: (i + 1) * 10,
}));
// A mesma série, parada em 30/12 (o último dia NÃO é hoje).
const SERIE_ATE_ONTEM: PontoDaSerieDiaria[] = Array.from(
  { length: 14 },
  (_, i) => ({
    dia: new Date(Date.UTC(2026, 11, 17 + i, 12)).toISOString().slice(0, 10),
    receita: (i + 1) * 10,
  }),
);
const SEM_VENDA: PontoDaSerieDiaria[] = DIAS.map((dia) => ({
  dia,
  receita: 0,
}));

let container: HTMLDivElement;
let root: Root;

function montar(ui: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return container;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(INSTANTE);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const botao = (tela: HTMLElement, rotulo: string) =>
  tela.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`);
const diaEscolhido = (tela: HTMLElement) =>
  tela.querySelector("p[aria-live] span")?.textContent ?? "";
const abrirTabela = (tela: HTMLElement) =>
  act(() =>
    tela.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click(),
  );
const linhas = (tela: HTMLElement) =>
  Array.from(tela.querySelectorAll<HTMLElement>("tbody tr"));

describe("SerieDe14Dias: setas", () => {
  it("recuar dois dias e avançar um: o dia escolhido sobe de 29 para 30", () => {
    const tela = montar(<SerieDe14Dias serie={SERIE} carregando={false} />);
    act(() => botao(tela, "Dia anterior")?.click());
    act(() => botao(tela, "Dia anterior")?.click());
    expect(diaEscolhido(tela)).toContain(formatarData("2026-12-29"));
    act(() => botao(tela, "Próximo dia")?.click());
    expect(diaEscolhido(tela)).toContain(formatarData("2026-12-30"));
  });
});

describe("SerieDe14Dias: 'ocupado' só sem dado", () => {
  it("com a série na tela, recarregar em segundo plano não deixa o cartão ocupado", () => {
    const tela = montar(<SerieDe14Dias serie={SERIE} carregando />);
    expect(tela.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it("sem venda nenhuma e carregando: ocupado, com o texto de espera", () => {
    const tela = montar(<SerieDe14Dias serie={SEM_VENDA} carregando />);
    expect(tela.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(tela.textContent).toContain("Carregando as vendas…");
  });
});

describe("SerieDe14Dias: rótulos das pontas", () => {
  const pontas = (tela: HTMLElement) =>
    Array.from(
      tela.querySelectorAll<HTMLElement>(
        "div.flex.justify-between.gap-3 > span",
      ),
    ).map((s) => s.textContent);

  it("primeiro dia à esquerda, último à direita com '· Hoje' quando é hoje", () => {
    const tela = montar(<SerieDe14Dias serie={SERIE} carregando={false} />);
    expect(pontas(tela)).toEqual(["18 dez", "31 dez · Hoje"]);
  });

  it("série que termina ontem: a ponta direita é 30 dez, sem 'Hoje'", () => {
    const tela = montar(
      <SerieDe14Dias serie={SERIE_ATE_ONTEM} carregando={false} />,
    );
    expect(pontas(tela)).toEqual(["17 dez", "30 dez"]);
  });
});

describe("SerieDe14Dias: tabela", () => {
  it("fechada, a linha de hoje diz '· Hoje' e as outras não", () => {
    const tela = montar(<SerieDe14Dias serie={SERIE} carregando={false} />);
    const todas = linhas(tela);
    expect(todas).toHaveLength(14);
    const primeiraCelula = (i: number) =>
      todas.at(i)?.querySelector("td")?.textContent ?? "";
    expect(primeiraCelula(13)).toContain("· Hoje");
    expect(primeiraCelula(12)).not.toContain("Hoje");
    expect(primeiraCelula(0)).not.toContain("Hoje");
  });

  it("aberta, o botão de cada dia leva o dia no nome e '· Hoje' só no de hoje", () => {
    const tela = montar(<SerieDe14Dias serie={SERIE} carregando={false} />);
    abrirTabela(tela);
    expect(
      botao(tela, `Selecionar ${formatarData("2026-12-31")} · Hoje`),
    ).not.toBeNull();
    expect(
      botao(tela, `Selecionar ${formatarData("2026-12-30")}`),
    ).not.toBeNull();
  });

  it("aberta, só a linha escolhida leva o visto e o fundo mais claro", () => {
    const tela = montar(<SerieDe14Dias serie={SERIE} carregando={false} />);
    abrirTabela(tela);
    const todas = linhas(tela);
    // Escolhida por padrão: a última (hoje).
    expect(todas[13].querySelector("svg.lucide-check")).not.toBeNull();
    expect(todas[13].className).toContain("bg-white/[0.06]");
    expect(todas[12].querySelector("svg.lucide-check")).toBeNull();
    expect(todas[12].className).toContain("bg-white/[0.03]");
    expect(tela.querySelectorAll("tbody svg.lucide-check")).toHaveLength(1);
  });
});

describe("SerieDe14Dias: dica de cada coluna", () => {
  it("passar o dedo/mouse numa coluna mostra 'dia: valor'", () => {
    const tela = montar(<SerieDe14Dias serie={SERIE} carregando={false} />);
    const coluna = tela.querySelector<HTMLElement>('[data-dia="2026-12-31"]');
    expect(coluna?.getAttribute("title")).toBe(
      `${formatarData("2026-12-31")}: ${formatarMoeda(140)}`,
    );
  });
});

describe("SerieDe14Dias: leitura que falhou", () => {
  it("o botão de tentar de novo chama a função da tela", () => {
    const tentar = vi.fn();
    const tela = montar(
      <SerieDe14Dias
        serie={SEM_VENDA}
        carregando={false}
        falhou
        onTentarDeNovo={tentar}
      />,
    );
    const tentarBotao = Array.from(tela.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Tentar de novo"),
    );
    expect(tentarBotao).toBeDefined();
    act(() => tentarBotao?.click());
    expect(tentar).toHaveBeenCalledTimes(1);
  });
});
