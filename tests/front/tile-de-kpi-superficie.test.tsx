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

  it("padrão (sem prop): mantém SUPERFICIE_DO_CRM — o que VisaoGeralDoCrm usa", async () => {
    const { TileDeKpi } = await import("@/components/admin/crm/TileDeKpi");

    await act(async () => {
      raiz.render(
        <TileDeKpi rotulo="Receita" valor="R$ 100,00" icone={TrendingUp} />,
      );
    });

    const cartao = hospedeiro.firstElementChild as HTMLElement;
    expect(cartao.classList.contains("bg-zinc-900/60")).toBe(true);
    expect(cartao.classList.contains("admin-glass")).toBe(false);
    expect(cartao.classList.contains("rounded-2xl")).toBe(true);
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
    expect(cartao.classList.contains("bg-zinc-900/60")).toBe(false);
    // N1: admin-glass (src/index.css) não tem rounded-* nenhum — sem o
    // rounded-2xl fixo no corpo do TileDeKpi, este cartão perde o canto.
    expect(cartao.classList.contains("rounded-2xl")).toBe(true);
  });
});

describe("NumerosDoMes (Início) — os 4 tiles pedem a superfície admin-glass", () => {
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

  it("os 4 tiles usam admin-glass, igual aos outros cartões do Início", async () => {
    const { NumerosDoMes } = await import(
      "@/components/admin/inicio/NumerosDoMes"
    );

    await act(async () => {
      raiz.render(
        <NumerosDoMes painel={null} carregando={false} onNavigate={() => {}} />,
      );
    });

    const secao = hospedeiro.querySelector("section")!;
    const tiles = Array.from(secao.querySelectorAll(".grid > div"));
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.classList.contains("admin-glass")).toBe(true);
      expect(tile.classList.contains("bg-zinc-900/60")).toBe(false);
      expect(tile.classList.contains("rounded-2xl")).toBe(true);
    }
  });
});
