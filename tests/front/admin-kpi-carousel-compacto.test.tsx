import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { BarChart3, Package, Users, Wallet } from "lucide-react";
// @vitest-environment jsdom
//
// Pedido do Gabriel (02/09 à tarde): a faixa de métricas do painel (o
// carrossel "Visão Financeira" / "Métricas de …") ocupava um espaço enorme
// — cards verticais de 128px de altura mínima para mostrar UM número.
//
// A CURA (comportamento novo, provado aqui):
//   1. Card COMPACTO horizontal (~64px de altura): rótulo em cima, valor
//      grande na linha de baixo.
//   2. O CARROSSEL FICA (decisão do dono: "mantém em carrossel, é mais
//      compacto") — mas mais denso: 2 cards por exibição no celular (o
//      antigo mostrava UM card largo por vez), 3 no tablet, 4 no desktop,
//      5 no telão.
//   3. O botão "Expandir" segue alternando para a grade (modo antigo
//      mantido), e o carregamento mostra skeletons na faixa.
//
// Sem @testing-library/react (não instalado neste projeto) — mesmo padrão
// dos outros testes de componente deste projeto. Embla precisa dos stubs de
// ResizeObserver/matchMedia no jsdom (mesmo motivo dos testes das telas).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let hospedeiro: HTMLDivElement;
let raiz: Root;

const cardsFake: readonly KpiCardConfig[] = [
  { id: "receita", label: "Receita Hoje", value: "R$ 0,00", icon: Wallet },
  { id: "pedidos", label: "Pedidos Hoje", value: 3, icon: BarChart3 },
  { id: "clientes", label: "Clientes Ativos", value: 12, icon: Users },
  { id: "catalogo", label: "Produtos no Catálogo", value: 19, icon: Package },
  { id: "estoque", label: "Itens em Estoque", value: 87, icon: Package },
];

async function montar(elemento: React.ReactElement) {
  await act(async () => {
    raiz.render(elemento);
  });
}

describe("AdminKpiCarousel — carrossel compacto de métricas", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("todos os KPIs existem no carrossel, com rótulo e valor no card compacto", async () => {
    const { AdminKpiCarousel } = await import(
      "@/components/admin/AdminKpiCarousel"
    );
    await montar(
      <AdminKpiCarousel cards={cardsFake} title="Visão Financeira" />,
    );

    for (const card of cardsFake) {
      expect(hospedeiro.textContent).toContain(String(card.value));
      expect(hospedeiro.textContent).toContain(card.label);
    }
    // E o título da seção continua na barra de controle.
    expect(hospedeiro.textContent).toContain("Visão Financeira");
  });

  it("2 cards por exibição no celular — a densidade que o dono pediu", async () => {
    const { AdminKpiCarousel } = await import(
      "@/components/admin/AdminKpiCarousel"
    );
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    // Cada slide ocupa metade da largura da faixa no breakpoint base
    // (o desenho antigo ocupava a largura INTEIRA com um card só).
    const slides = hospedeiro.querySelectorAll('[class*="flex-[0_0_50%]"]');
    expect(slides.length).toBe(cardsFake.length);
  });

  it("botão 'Expandir' alterna para a grade e volta ao carrossel", async () => {
    const { AdminKpiCarousel } = await import(
      "@/components/admin/AdminKpiCarousel"
    );
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    const expandir = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Expandir"),
    );
    expect(expandir).toBeTruthy();

    await act(async () => {
      expandir!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Em modo grade o botão vira "Carrossel" (volta).
    const voltar = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Carrossel"),
    );
    expect(voltar).toBeTruthy();

    await act(async () => {
      voltar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Expandir"),
      ),
    ).toBeTruthy();
  });

  it("card de altura FIXA — a faixa fica idêntica nas telas (padronização)", async () => {
    const { AdminKpiCarousel } = await import(
      "@/components/admin/AdminKpiCarousel"
    );
    await montar(<AdminKpiCarousel cards={cardsFake} title="Métricas" />);

    // Card simples (sem content/footer) tem altura TRAVADA (h-16) e
    // overflow escondido: nenhuma tela fica mais alta que a outra.
    const card = hospedeiro.querySelector('[class*="h-16"]');
    expect(card).toBeTruthy();
    expect(card!.className).toContain("overflow-hidden");
  });

  it("valor e subtítulo ocupam LINHAS PRÓPRIAS — o dado completo cabe sem brigar por espaço", async () => {
    const { AdminKpiCarousel } = await import(
      "@/components/admin/AdminKpiCarousel"
    );
    await montar(
      <AdminKpiCarousel
        cards={[
          {
            id: "capital",
            label: "Capital Alocado",
            value: "R$ 1.312.456,78",
            subValue: "Capital Líquido",
            icon: Wallet,
          },
        ]}
        title="Métricas de Produtos"
      />,
    );

    // O valor completo está no DOM (nada é cortado por JS)…
    const valor = hospedeiro.querySelector("h3");
    expect(valor?.textContent).toBe("R$ 1.312.456,78");

    // …e o subtítulo é LINHA PRÓPRIA (irmão imediato do valor), não um
    // apêndice que espreme o número — era o "R$ 1.31... / CAPITAL LIQ...".
    const sub = valor!.nextElementSibling;
    expect(sub?.tagName).toBe("P");
    expect(sub?.textContent).toBe("Capital Líquido");
  });

  it("carregando: skeletons na faixa, sem card nenhum", async () => {
    const { AdminKpiCarousel } = await import(
      "@/components/admin/AdminKpiCarousel"
    );
    await montar(<AdminKpiCarousel cards={cardsFake} loading={true} />);

    // Nenhum valor real na tela enquanto carrega — só o esqueleto.
    expect(hospedeiro.textContent).not.toContain("R$ 0,00");
    expect(hospedeiro.querySelector(".animate-pulse")).toBeTruthy();
  });
});
