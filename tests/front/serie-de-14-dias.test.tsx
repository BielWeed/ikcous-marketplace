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
import { afterEach, describe, expect, it } from "vitest";

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
