// @vitest-environment jsdom
//
// MetricasDoPainel no modo "relatório" (resumo fixo das telas de relatórios) —
// bordas que as provas vizinhas não pisam:
//  - só os DOIS primeiros cartões ganham destaque (mesmo se vierem mais);
//  - sem `compactValue` o número aparece uma vez só, sem o par de versões
//    "curta no celular / completa no desktop";
//  - o tom da faixa de nota ("atencao" âmbar, "erro" rosa) só pinta quando
//    pedido, e cada um com a sua cor;
//  - número que não tem largura medida (caixa com largura 0, tela escondida)
//    não é encolhido: medir 0 não é medir "cabe".
import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { Package } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cartoes: readonly KpiCardConfig[] = [
  {
    label: "Vendas do mês",
    value: "R$ 1.234,00",
    subValue: "Total",
    icon: Package,
    accent: "text-emerald-300",
  },
  {
    label: "Pedidos do mês",
    value: "42",
    subValue: "Quantidade",
    icon: Package,
    accent: "text-sky-300",
  },
  {
    label: "Ticket médio",
    value: "R$ 29,38",
    subValue: "Média",
    icon: Package,
    accent: "text-orange-300",
  },
];
const legendas = ["Vendas", "Pedidos", "Ticket"];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function montar(
  dados: readonly KpiCardConfig[],
  relatorio: Partial<
    NonNullable<Parameters<typeof MetricasDoPainel>[0]["relatorio"]>
  > = {},
) {
  await act(async () =>
    root.render(
      <MetricasDoPainel
        titulo="Resumo dos relatórios"
        legendasDoResumo={legendas}
        cards={dados}
        relatorio={{ rodape: "rodapé do resumo", ...relatorio }}
      />,
    ),
  );
  return host.querySelector("section") as HTMLElement;
}

describe("MetricasDoPainel — resumo dos relatórios", () => {
  it("com três cartões, só os dois primeiros ganham destaque", async () => {
    const secao = await montar(cartoes);
    const grupos = [...secao.querySelectorAll(".metricas-painel-destaque")].map(
      (g) => g.getAttribute("aria-label"),
    );
    expect(grupos).toEqual(["Vendas do mês", "Pedidos do mês"]);
    expect(secao.textContent).not.toContain("Ticket médio");
    expect(secao.textContent).not.toContain("R$ 29,38");
  });

  it("legenda vem da lista na ordem, e o número completo aparece uma vez sem 'compactValue'", async () => {
    const secao = await montar(cartoes);
    const destaques = [...secao.querySelectorAll(".metricas-painel-destaque")];
    expect(destaques.map((d) => d.querySelector("p")?.textContent)).toEqual([
      "Vendas",
      "Pedidos",
    ]);
    for (const [i, destaque] of destaques.entries()) {
      const numero = destaque.querySelector("h3");
      expect(numero?.textContent).toBe(cartoes.at(i)?.value);
      // sem versão compacta: nenhuma das duas variantes responsivas
      expect(numero?.querySelector(".sm\\:hidden")).toBeNull();
      expect(numero?.querySelector(".hidden")).toBeNull();
    }
  });

  it("com 'compactValue' diferente: curta no celular e completa a partir do 'sm'", async () => {
    const secao = await montar([
      { ...cartoes[0], compactValue: "R$ 1,2 mil" } as KpiCardConfig,
      cartoes[1] as KpiCardConfig,
    ]);
    const primeiro = secao.querySelector(".metricas-painel-destaque h3");
    expect(primeiro?.querySelector(".sm\\:hidden")?.textContent).toBe(
      "R$ 1,2 mil",
    );
    expect(primeiro?.querySelector(".sm\\:inline")?.textContent).toBe(
      "R$ 1.234,00",
    );
  });

  it("'compactValue' igual ao valor não duplica o número", async () => {
    const secao = await montar([
      { ...cartoes[0], compactValue: "R$ 1.234,00" } as KpiCardConfig,
      cartoes[1] as KpiCardConfig,
    ]);
    const primeiro = secao.querySelector(".metricas-painel-destaque h3");
    expect(primeiro?.querySelector(".sm\\:hidden")).toBeNull();
    expect(primeiro?.textContent).toBe("R$ 1.234,00");
  });

  it("o tom da faixa de nota: sem tom não pinta; 'atencao' é âmbar; 'erro' é rosa", async () => {
    const nota = () =>
      host.querySelector(".metricas-relatorio-nota")?.className ?? "";
    await montar(cartoes);
    expect(nota()).not.toContain("bg-amber-500/10");
    expect(nota()).not.toContain("bg-rose-500/10");
    await montar(cartoes, { tom: "atencao" });
    expect(nota()).toContain("bg-amber-500/10");
    expect(nota()).not.toContain("bg-rose-500/10");
    await montar(cartoes, { tom: "erro" });
    expect(nota()).toContain("bg-rose-500/10");
    expect(nota()).not.toContain("bg-amber-500/10");
  });

  it("caixa com largura 0 (tela escondida) não encolhe o número, mesmo medindo estouro", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return { width: this.tagName === "H3" ? 50 : 200 } as DOMRect;
      },
    );
    const secao = await montar(cartoes);
    const numero = secao.querySelector<HTMLElement>(
      ".metricas-painel-numero",
    ) as HTMLElement;
    expect(numero.style.fontSize).toBe("");
  });

  it("controle: com largura medida e número maior que a caixa, o número encolhe", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return { width: this.tagName === "H3" ? 50 : 200 } as DOMRect;
      },
    );
    const secao = await montar(cartoes);
    const numero = secao.querySelector<HTMLElement>(
      ".metricas-painel-numero",
    ) as HTMLElement;
    expect(numero.style.fontSize).toBe("24.75%");
  });
});
