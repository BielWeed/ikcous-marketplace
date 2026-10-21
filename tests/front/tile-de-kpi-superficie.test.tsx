// @vitest-environment jsdom
//
// Achado da revisão do redesenho visual do CRM: `TileDeKpi` (peça
// compartilhada em `src/components/admin/crm/`) trocou a superfície de
// `border-white/[0.04] bg-zinc-950 ...` para `SUPERFICIE_DO_CRM`
// (`border-white/[0.08] bg-zinc-900/60`) — correto para os 8 KPIs de
// `VisaoGeralDoCrm`, mas o MESMO componente também é usado pelos 4 tiles
// de "Este mês" no Início (`NumerosDoMes`), onde os outros cartões da tela
// (Hoje, Para fazer, Assinatura) continuam em `admin-glass`. Print do
// Início em 375/1280 (harness) confirmou que os tiles ficaram
// perceptivelmente mais claros/"caixudos" que o resto da tela. Nova prop
// `superficie` deixa o Início pedir a superfície antiga (`admin-glass`)
// sem mexer no padrão do CRM.
//
// Regressão da re-revisão (N1): `superficie="admin-glass"` SUBSTITUI
// `SUPERFICIE_DO_CRM` inteiro, e `.admin-glass` (src/index.css) não tem
// `rounded-*` nenhum — os 4 tiles do Início perderam o canto arredondado.
// `rounded-2xl` agora é fixo no corpo do TileDeKpi (não faz parte de
// `superficie`), então os dois modos ficam com canto — os testes abaixo
// provam isso nos dois.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TrendingUp } from "lucide-react";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TileDeKpi — prop `superficie` decide o cartão (CRM x Início)", () => {
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

  it("padrão (sem prop): desenho novo do cartão de métrica (borda 10%, zinc-900/70 + gradiente)", async () => {
    const { TileDeKpi } = await import("@/components/admin/crm/TileDeKpi");

    await act(async () => {
      raiz.render(
        <TileDeKpi
          rotulo="Receita"
          valor="R$ 100,00"
          icone={TrendingUp}
          rodape="vs. mês anterior"
        />,
      );
    });

    const cartao = hospedeiro.firstElementChild as HTMLElement;
    // Mesmo desenho do KpiCard de AdminKpiCarousel (redesenho de 10/10/2026).
    expect(cartao.classList.contains("border-admin-border")).toBe(true);
    expect(cartao.classList.contains("bg-admin-surface")).toBe(true);
    expect(cartao.classList.contains("bg-gradient-to-b")).toBe(true);
    expect(cartao.classList.contains("from-white/[0.06]")).toBe(true);
    // O desenho antigo (SUPERFICIE_DO_CRM) saiu do tile.
    expect(cartao.classList.contains("bg-zinc-900/60")).toBe(false);
    expect(cartao.classList.contains("admin-glass")).toBe(false);
    expect(cartao.classList.contains("rounded-2xl")).toBe(true);

    // Rótulo em frase normal (não caixa-alta miúda), contraste AA.
    const rotulo = Array.from(cartao.querySelectorAll("p")).find(
      (p) => p.textContent === "Receita",
    )!;
    expect(rotulo.classList.contains("text-xs")).toBe(true);
    expect(rotulo.classList.contains("font-semibold")).toBe(true);
    expect(rotulo.classList.contains("text-zinc-300")).toBe(true);
    expect(rotulo.classList.contains("uppercase")).toBe(false);

    // Valor grande e branco.
    const valor = Array.from(cartao.querySelectorAll("p")).find(
      (p) => p.textContent === "R$ 100,00",
    )!;
    expect(valor.classList.contains("text-white")).toBe(true);
    expect(valor.classList.contains("font-black")).toBe(true);
    // Dinheiro não pode cortar a 360px: 18px no celular, 24px de sm em diante.
    expect(valor.classList.contains("text-lg")).toBe(true);
    expect(valor.classList.contains("sm:text-2xl")).toBe(true);
    expect(valor.classList.contains("text-[22px]")).toBe(false);

    // Subtítulo 12px, zinc-400 (mínimo de contraste).
    const rodape = Array.from(cartao.querySelectorAll("div")).find(
      (d) => d.textContent === "vs. mês anterior",
    )!;
    expect(rodape.classList.contains("text-xs")).toBe(true);
    expect(rodape.classList.contains("text-zinc-400")).toBe(true);
    expect(rodape.className).not.toMatch(/text-\[11px\]/);

    // Ícone em selo.
    const selo = cartao.querySelector("svg")!.parentElement as HTMLElement;
    expect(selo.classList.contains("size-8")).toBe(true);
    expect(selo.classList.contains("rounded-xl")).toBe(true);
    expect(selo.classList.contains("border-admin-border")).toBe(true);
    expect(selo.classList.contains("bg-white/[0.06]")).toBe(true);
  });

  it('superficie="admin-glass": o cartão troca para a linguagem do Início', async () => {
    const { TileDeKpi } = await import("@/components/admin/crm/TileDeKpi");

    await act(async () => {
      raiz.render(
        <TileDeKpi
          rotulo="Receita do mês"
          valor="R$ 100,00"
          icone={TrendingUp}
          superficie="admin-glass"
        />,
      );
    });

    const cartao = hospedeiro.firstElementChild as HTMLElement;
    expect(cartao.classList.contains("admin-glass")).toBe(true);
    expect(cartao.classList.contains("bg-admin-surface")).toBe(false);
    expect(cartao.classList.contains("bg-zinc-900/60")).toBe(false);
    // N1: admin-glass (src/index.css) não tem rounded-* nenhum — sem o
    // rounded-2xl fixo no corpo do TileDeKpi, este cartão perde o canto.
    expect(cartao.classList.contains("rounded-2xl")).toBe(true);
  });
});

describe("NumerosDoMes (Início) — resumo e contas usam a mesma superfície", () => {
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

  it("o resumo e as contas usam os mesmos cartões neutros do Início", async () => {
    const { NumerosDoMes } = await import(
      "@/components/admin/inicio/NumerosDoMes"
    );

    await act(async () => {
      raiz.render(
        <NumerosDoMes painel={null} carregando={false} onNavigate={() => {}} />,
      );
    });

    const secao = hospedeiro.querySelector("section")!;
    const tiles = Array.from(secao.children).filter((el) =>
      el.classList.contains("rounded-[22px]"),
    );
    expect(tiles).toHaveLength(2);
    expect(secao.querySelectorAll("button")).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile.classList.contains("bg-admin-surface")).toBe(true);
      expect(tile.classList.contains("bg-zinc-900/60")).toBe(false);
      expect(tile.classList.contains("rounded-[22px]")).toBe(true);
    }
  });
});
