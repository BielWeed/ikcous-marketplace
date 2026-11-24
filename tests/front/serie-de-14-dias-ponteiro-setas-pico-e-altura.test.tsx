// @vitest-environment jsdom
//
// "Últimos 14 dias" do Início — o que o toque, as setas e a altura das barras
// prometem, e que nenhum teste segurava (achado por mutação em 24/11/2026):
//  - o toque numa posição escolhe a coluna em que o dedo está (não a mais
//    próxima da borda seguinte), e fora das bordas fica na primeira/última;
//  - caixa sem largura (ainda sem medida) não escolhe nada;
//  - "Dia anterior" desliga no primeiro dia e "Próximo dia" no último;
//  - com dois dias empatados no maior valor, o "Pico" nomeia o primeiro;
//  - a barra do maior dia ocupa 100% e a menor barra com venda nunca some
//    (piso de 6%).
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import type { PontoDaSerieDiaria } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 14 dias terminando em 24/11/2026: o 3º (13/11) e o 10º (20/11) empatam no
// maior valor (R$ 500); 15/11 vendeu só R$ 1.
const SERIE: PontoDaSerieDiaria[] = Array.from({ length: 14 }, (_, i) => {
  const dia = new Date(Date.UTC(2026, 10, 11 + i)).toISOString().slice(0, 10);
  const receita =
    dia === "2026-11-13" || dia === "2026-11-20"
      ? 500
      : dia === "2026-11-15"
        ? 1
        : 0;
  return { dia, receita };
});

let tela: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
  act(() => raiz.render(<SerieDe14Dias serie={SERIE} carregando={false} />));
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  vi.useRealTimers();
});

const barras = () =>
  tela.querySelector<HTMLElement>(
    '[data-testid="serie-14d-barras"]',
  ) as HTMLElement;
const colunaSelecionada = () =>
  tela
    .querySelector('[data-testid="serie-14d-coluna"][data-selecionado="true"]')
    ?.getAttribute("data-dia");
const botao = (rotulo: string) =>
  tela.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`);

/** Caixa de 140 px de largura: cada uma das 14 colunas ocupa 10 px. */
function medirCaixa(largura: number) {
  barras().getBoundingClientRect = () =>
    ({ left: 0, width: largura, top: 0, height: 96 }) as DOMRect;
}
function tocarEm(clientX: number) {
  act(() => {
    barras().dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX }),
    );
  });
}

describe("SerieDe14Dias: toque no gráfico", () => {
  it("o toque escolhe a coluna sob o dedo (35 px de 140 é a 4ª coluna, não a 5ª)", () => {
    medirCaixa(140);
    tocarEm(35);
    expect(colunaSelecionada()).toBe("2026-11-14");
  });

  it("toque além das bordas fica na primeira ou na última coluna", () => {
    medirCaixa(140);
    tocarEm(-30);
    expect(colunaSelecionada()).toBe("2026-11-11");
    tocarEm(999);
    expect(colunaSelecionada()).toBe("2026-11-24");
  });

  it("caixa ainda sem largura não escolhe nada (continua no último dia)", () => {
    // jsdom devolve largura 0: sem a guarda, -50/0 viraria a primeira coluna.
    tocarEm(-50);
    expect(colunaSelecionada()).toBe("2026-11-24");
  });
});

describe("SerieDe14Dias: setas e pico", () => {
  it("abre no último dia: 'Próximo dia' desligado e 'Dia anterior' ligado", () => {
    expect(botao("Próximo dia")?.disabled).toBe(true);
    expect(botao("Dia anterior")?.disabled).toBe(false);
  });

  it("no primeiro dia o 'Dia anterior' desliga e o 'Próximo dia' liga", () => {
    medirCaixa(140);
    tocarEm(0);
    expect(colunaSelecionada()).toBe("2026-11-11");
    expect(botao("Dia anterior")?.disabled).toBe(true);
    expect(botao("Próximo dia")?.disabled).toBe(false);
  });

  it("dois dias empatados no maior valor: o pico nomeia o primeiro (13/11), não o segundo", () => {
    const pico = tela.querySelector('[data-testid="serie-14d-pico"]');
    const rotulo = pico?.parentElement?.querySelector("dt")?.textContent ?? "";
    expect(rotulo).toContain("13");
    expect(rotulo).not.toContain("20");
    expect(pico?.textContent).toMatch(/R\$\s?500,00/);
  });
});

describe("SerieDe14Dias: altura das barras", () => {
  const alturaDa = (dia: string) =>
    tela
      .querySelector(`[data-dia="${dia}"] [data-testid="serie-14d-barra"]`)
      ?.getAttribute("style") ?? "";

  it("o maior dia ocupa 100% da altura", () => {
    expect(alturaDa("2026-11-13")).toContain("height: 100%");
  });

  it("um dia com R$ 1 contra R$ 500 ainda tem barra visível (piso de 6%)", () => {
    expect(alturaDa("2026-11-15")).toContain("height: 6%");
  });
});
