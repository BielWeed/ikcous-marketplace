// @vitest-environment jsdom
//
// Pedido do Gabriel (Início, 27/09/2026): o cartão "Últimos 14 dias" "não
// tem clareza: tem que dar para entender cada barra de cada dia". Com poucas
// vendas o gráfico antigo virava um bloco cinza quase invisível (13 riscos
// de 1px) e só o 1º/último dia tinham rótulo. Este teste prova que agora:
// as 14 colunas SEMPRE aparecem (mesmo que a série venha menor, caso real
// medido no harness visual), cada uma com rótulo de dia, "Hoje" marcado, e
// dia sem venda com trilho vazio — nunca confundido com uma barra de venda.
// Mesmo casco de atalhos-do-inicio-so-dois-botoes-grandes.test.tsx:
// createRoot + act, sem mocks (componente puro).
import { SerieDe14Dias } from "@/components/admin/inicio/SerieDe14Dias";
import { diaEmSaoPaulo } from "@/lib/crm";
import type { PontoDaSerieDiaria } from "@/types/painel";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// O componente marca "hoje" comparando com `diaEmSaoPaulo(new Date())" — o
// mesmo cálculo usado aqui, para o teste não depender da data real do
// relógio do sistema que roda a suíte.
const HOJE = diaEmSaoPaulo(new Date());

function colunas(tela: HTMLElement) {
  return Array.from(
    tela.querySelectorAll<HTMLElement>('[data-testid="serie-14d-coluna"]'),
  );
}

describe("SerieDe14Dias — 14 colunas legíveis", () => {
  it("com 1 único ponto na série, ainda assim renderiza as 14 colunas", () => {
    const serie: PontoDaSerieDiaria[] = [{ dia: HOJE, receita: 350 }];
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);

    expect(colunas(tela)).toHaveLength(14);
    // A tabela escondida (leitor de tela) também sai com os 14 dias.
    expect(tela.querySelectorAll("table tbody tr")).toHaveLength(14);
  });

  it("cada coluna traz um rótulo de dia, e a de hoje sai marcada como 'Hoje'", () => {
    const serie: PontoDaSerieDiaria[] = [{ dia: HOJE, receita: 350 }];
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);

    const rotulos = tela.querySelectorAll('[data-testid="serie-14d-rotulo"]');
    expect(rotulos).toHaveLength(14);
    const valores = tela.querySelectorAll(
      '[data-testid="serie-14d-rotulo-dia"]',
    );
    // O primeiro dia da janela (14 dias antes de hoje) mostra o número do
    // dia, dois dígitos — igual ao que está em `data-dia` da 1ª coluna.
    const primeiraColuna = colunas(tela)[0];
    const diaDaPrimeiraColuna = primeiraColuna
      .getAttribute("data-dia")!
      .slice(8, 10);
    expect(
      Array.from(valores).some(
        (r) => (r.textContent ?? "").trim() === diaDaPrimeiraColuna,
      ),
    ).toBe(true);

    const colunaDeHoje = tela.querySelector(
      '[data-testid="serie-14d-coluna"][data-hoje="true"]',
    );
    expect(colunaDeHoje).not.toBeNull();
    expect(colunaDeHoje?.getAttribute("data-dia")).toBe(HOJE);
    expect(colunaDeHoje?.textContent).toContain("Hoje");
    // Só uma coluna é "hoje".
    expect(tela.querySelectorAll('[data-hoje="true"]')).toHaveLength(1);
  });

  it("dia sem venda fica com trilho vazio — nunca uma barra", () => {
    const serie: PontoDaSerieDiaria[] = [{ dia: HOJE, receita: 350 }];
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);

    const semVenda = colunas(tela).filter(
      (c) => c.getAttribute("data-dia") !== HOJE,
    );
    expect(semVenda).toHaveLength(13);
    for (const coluna of semVenda) {
      expect(coluna.getAttribute("data-com-venda")).toBe("false");
      expect(
        coluna.querySelector('[data-testid="serie-14d-barra"]'),
      ).toBeNull();
    }

    const comVenda = colunas(tela).find(
      (c) => c.getAttribute("data-dia") === HOJE,
    );
    expect(comVenda?.getAttribute("data-com-venda")).toBe("true");
    expect(
      comVenda?.querySelector('[data-testid="serie-14d-barra"]'),
    ).not.toBeNull();
  });

  it("série já completa (14 pontos, com um dia sem venda no meio) mantém as 14 colunas e o trilho do dia zerado", () => {
    const serie: PontoDaSerieDiaria[] = Array.from({ length: 14 }, (_, i) => {
      const dia = new Date(Date.UTC(2026, 8, 13 + i))
        .toISOString()
        .slice(0, 10);
      return { dia, receita: dia === "2026-09-20" ? 0 : 10 + i };
    });
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);

    expect(colunas(tela)).toHaveLength(14);
    const colunaZerada = colunas(tela).find(
      (c) => c.getAttribute("data-dia") === "2026-09-20",
    );
    expect(colunaZerada?.getAttribute("data-com-venda")).toBe("false");
    expect(
      colunaZerada?.querySelector('[data-testid="serie-14d-barra"]'),
    ).toBeNull();
  });
});

// Achado do Gabriel (recortes de d53ceb52): o rótulo do valor acima da barra
// de maior receita ESTOURAVA a borda do cartão quando o pico caía numa das
// últimas colunas (o caso mais comum: hoje) — centralizado numa coluna de
// ~24px, um texto como "R$ 1.494,10" transborda para fora do cartão porque
// não sobra coluna à direita para "absorver" a metade direita do texto.
// A âncora agora muda pelo ÍNDICE do pico: início (<=3) cresce para a
// direita (left-0, sem right-0 — sobra coluna à direita); fim (>=10) cresce
// para a esquerda (right-0, sem left-0); meio fica centralizado de verdade
// com `left-1/2 -translate-x-1/2` (revisão independente de 3be94dcb: com
// `inset-x-0 text-center` a caixa ficava presa à largura da coluna e um
// texto mais largo saía alinhado ao início dela, +14px fora do centro).
function serieComPico(indicePico: number): PontoDaSerieDiaria[] {
  return Array.from({ length: 14 }, (_, i) => {
    const dia = new Date(Date.UTC(2026, 8, 13 + i)).toISOString().slice(0, 10);
    return { dia, receita: i === indicePico ? 999 : 10 };
  });
}

function rotuloDoPico(tela: HTMLElement) {
  const rotulo = tela.querySelector('[data-testid="serie-14d-pico"]');
  expect(rotulo).not.toBeNull();
  return rotulo as HTMLElement;
}

describe("SerieDe14Dias — o rótulo do pico nunca estoura o cartão", () => {
  it("pico nas primeiras colunas ancora à esquerda (cresce para dentro do cartão)", () => {
    const tela = montar(
      <SerieDe14Dias serie={serieComPico(1)} carregando={false} />,
    );
    const rotulo = rotuloDoPico(tela);
    expect(rotulo.classList.contains("left-0")).toBe(true);
    expect(rotulo.classList.contains("right-0")).toBe(false);
    expect(rotulo.classList.contains("inset-x-0")).toBe(false);
  });

  it("pico numa coluna do meio fica centralizado de verdade (left-1/2 -translate-x-1/2)", () => {
    const tela = montar(
      <SerieDe14Dias serie={serieComPico(7)} carregando={false} />,
    );
    const rotulo = rotuloDoPico(tela);
    // `inset-x-0 text-center` prendia a caixa à largura da coluna (~24px) e
    // o texto, mais largo que isso, saía alinhado ao início — não
    // centralizado. `left-1/2 -translate-x-1/2` centraliza pelo tamanho
    // real do texto, não pelo da coluna.
    expect(rotulo.classList.contains("left-1/2")).toBe(true);
    expect(rotulo.classList.contains("-translate-x-1/2")).toBe(true);
    expect(rotulo.classList.contains("inset-x-0")).toBe(false);
    expect(rotulo.classList.contains("left-0")).toBe(false);
    expect(rotulo.classList.contains("right-0")).toBe(false);
  });

  it("pico nas últimas colunas (ex.: hoje) ancora à direita (cresce para dentro do cartão)", () => {
    const tela = montar(
      <SerieDe14Dias serie={serieComPico(13)} carregando={false} />,
    );
    const rotulo = rotuloDoPico(tela);
    expect(rotulo.classList.contains("right-0")).toBe(true);
    expect(rotulo.classList.contains("left-0")).toBe(false);
    expect(rotulo.classList.contains("inset-x-0")).toBe(false);
  });
});

// Revisão independente de 3be94dcb: `text-zinc-500` em 10px mede ~4,12:1
// sobre o fundo do cartão (#09090b) — abaixo de AA (4,5:1); o mês em
// `text-[8px] text-zinc-600` media ~2:1. No molde de
// tests/front/crm-contraste-aa.test.tsx: o teste prende a CLASSE certa, não
// recalcula contraste (o número já foi medido pela revisão).
describe("SerieDe14Dias — contraste AA dos rótulos", () => {
  it("rótulo do dia (não-hoje) usa text-zinc-400, não text-zinc-500", () => {
    const serie: PontoDaSerieDiaria[] = [{ dia: HOJE, receita: 350 }];
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);
    const diasNaoHoje = Array.from(
      tela.querySelectorAll<HTMLElement>(
        '[data-testid="serie-14d-rotulo-dia"]',
      ),
    ).filter((el) => (el.textContent ?? "").trim() !== "Hoje");
    expect(diasNaoHoje.length).toBe(13);
    for (const el of diasNaoHoje) {
      expect(el.classList.contains("text-zinc-400")).toBe(true);
      expect(el.classList.contains("text-zinc-500")).toBe(false);
    }
  });

  it("rótulo do mês usa text-zinc-400 (não text-zinc-600) e pelo menos 9px (não text-[8px])", () => {
    const serie: PontoDaSerieDiaria[] = [{ dia: HOJE, receita: 350 }];
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);
    const meses = tela.querySelectorAll<HTMLElement>(
      '[data-testid="serie-14d-rotulo-mes"]',
    );
    expect(meses).toHaveLength(14);
    for (const el of Array.from(meses)) {
      expect(el.classList.contains("text-zinc-400")).toBe(true);
      expect(el.classList.contains("text-zinc-600")).toBe(false);
      expect(el.classList.contains("text-[8px]")).toBe(false);
      const classeDeTamanho = Array.from(el.classList).find((c) =>
        /^text-\[\d+px\]$/.test(c),
      );
      expect(classeDeTamanho).toBeDefined();
      const px = Number(classeDeTamanho!.match(/\d+/)![0]);
      expect(px).toBeGreaterThanOrEqual(9);
    }
  });
});

// Achado da revisão independente: com `hidden sm:inline` alternando dia
// sim/dia não no celular, a fileira de meses só existia nas colunas com
// `mostrarMes` — as outras não tinham essa linha, e o número do dia descia
// uma linha em relação às colunas que tinham mês, desalinhando a fileira.
// Agora a linha do mês é reservada em TODAS as colunas (só o texto some,
// via `invisible`, que preserva o espaço) e os 14 rótulos de dia aparecem
// sempre — sem alternância.
describe("SerieDe14Dias — os 14 rótulos aparecem sempre, e a linha do mês fica alinhada", () => {
  it("os 14 rótulos de dia aparecem sempre, sem a classe 'hidden' (nada de dia sim/dia não)", () => {
    const serie: PontoDaSerieDiaria[] = [{ dia: HOJE, receita: 350 }];
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);
    const dias = tela.querySelectorAll<HTMLElement>(
      '[data-testid="serie-14d-rotulo-dia"]',
    );
    expect(dias).toHaveLength(14);
    for (const el of Array.from(dias)) {
      expect(el.classList.contains("hidden")).toBe(false);
    }
  });

  it("a linha do mês existe em toda coluna (mesmo invisível) — só a 1ª/virada mostra o texto", () => {
    // Série inteira em setembro: só a 1ª coluna tem "virada" (índice 0).
    const serie: PontoDaSerieDiaria[] = Array.from({ length: 14 }, (_, i) => {
      const dia = new Date(Date.UTC(2026, 8, 13 + i))
        .toISOString()
        .slice(0, 10);
      return { dia, receita: 10 };
    });
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);
    const meses = tela.querySelectorAll<HTMLElement>(
      '[data-testid="serie-14d-rotulo-mes"]',
    );
    // Presente nas 14 colunas — inclusive nas que não mostram o texto: é
    // isso que reserva a altura da linha e mantém o "14" de cada coluna na
    // mesma altura do "15", "16" etc.
    expect(meses).toHaveLength(14);
    expect(meses[0].classList.contains("invisible")).toBe(false);
    for (const el of Array.from(meses).slice(1)) {
      expect(el.classList.contains("invisible")).toBe(true);
    }
  });
});

// Achado da revisão independente: o destaque da coluna marcada (toque/hover)
// dependia só do trilho mudar de tom — invisível quando a barra cobre 100%
// da altura da coluna (~1,22:1 medido). Agora marcar uma coluna esmaece
// (opacity-40) o trilho+barra das OUTRAS colunas, um contraste visual que
// não depende da altura da barra marcada.
describe("SerieDe14Dias — marcar uma coluna esmaece as outras (destaque visível)", () => {
  it("pointermove numa coluna esmaece o trilho/barra das demais, não da marcada", () => {
    const rectOriginal = Element.prototype.getBoundingClientRect;
    // jsdom não calcula layout: sem isto, `caixa.width <= 0` faz o handler
    // sair sem marcar nada. 350px / 14 colunas ≈ 25px cada — clientX=10
    // cai na coluna 0.
    Element.prototype.getBoundingClientRect = () =>
      ({
        width: 350,
        height: 96,
        top: 0,
        left: 0,
        right: 350,
        bottom: 96,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;

    try {
      const serie: PontoDaSerieDiaria[] = [{ dia: HOJE, receita: 350 }];
      const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);
      const barras = tela.querySelector(
        '[data-testid="serie-14d-barras"]',
      ) as HTMLElement;

      act(() => {
        barras.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX: 10 }),
        );
      });

      const graficos = tela.querySelectorAll<HTMLElement>(
        '[data-testid="serie-14d-grafico"]',
      );
      expect(graficos).toHaveLength(14);
      expect(graficos[0].classList.contains("opacity-40")).toBe(false);
      expect(graficos[1].classList.contains("opacity-40")).toBe(true);
      expect(graficos[13].classList.contains("opacity-40")).toBe(true);
    } finally {
      Element.prototype.getBoundingClientRect = rectOriginal;
    }
  });
});

describe("SerieDe14Dias — relógio fixo: 'Hoje' e a virada de mês", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("com o relógio em 2026-10-02T02:30:00Z (hoje = 01/10 em São Paulo), 'Hoje' cai no dia 01 e o mês 'out' aparece na coluna da virada", () => {
    // 02:30 UTC = 23:30 do dia anterior em São Paulo (UTC-3): hoje é
    // 2026-10-01 para o componente, mesmo com o relógio já em 02/10 UTC.
    vi.useFakeTimers({
      now: new Date("2026-10-02T02:30:00Z").getTime(),
      toFake: ["Date"],
    });
    // 2026-09-18 .. 2026-10-01 (14 dias): setembro tem 30 dias, então o dia
    // "31" desse mês rola automaticamente para 1º de outubro — a virada
    // cai exatamente na última coluna, que também é "hoje".
    const serie: PontoDaSerieDiaria[] = Array.from({ length: 14 }, (_, i) => {
      const dia = new Date(Date.UTC(2026, 8, 18 + i))
        .toISOString()
        .slice(0, 10);
      return { dia, receita: i };
    });
    const tela = montar(<SerieDe14Dias serie={serie} carregando={false} />);

    const colunaDeHoje = colunas(tela).find(
      (c) => c.getAttribute("data-hoje") === "true",
    );
    expect(colunaDeHoje?.getAttribute("data-dia")).toBe("2026-10-01");
    expect(
      colunaDeHoje
        ?.querySelector('[data-testid="serie-14d-rotulo-dia"]')
        ?.textContent?.trim(),
    ).toBe("Hoje");

    const mesDaVirada = colunaDeHoje?.querySelector(
      '[data-testid="serie-14d-rotulo-mes"]',
    );
    expect(mesDaVirada?.textContent?.trim()).toBe("out");
    expect(mesDaVirada?.classList.contains("invisible")).toBe(false);
  });
});
