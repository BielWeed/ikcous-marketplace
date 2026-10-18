// @vitest-environment jsdom
import type { KpiCardConfig } from "@/components/admin/AdminKpiCarousel";
import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { Clock, Package, ShoppingBag, Wallet } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cards: readonly KpiCardConfig[] = [
  {
    label: "Total Clientes",
    value: "16",
    subValue: "Base de Clientes",
    icon: Package,
    accent: "text-indigo-300",
  },
  {
    label: "Novos (30 dias)",
    value: "0",
    subValue: "Crescimento",
    icon: Clock,
    accent: "text-emerald-300",
  },
  {
    label: "Valor médio por venda",
    value: "R$ 25,81",
    subValue: "Média por pedido",
    icon: Wallet,
    accent: "text-orange-300",
  },
  {
    label: "Pedidos Totais",
    value: "14",
    subValue: "Pedidos consolidados",
    icon: ShoppingBag,
    accent: "text-pink-300",
  },
];
const legendas = ["Total", "Novos · 30d", "Média/pedido", "Pedidos"];
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
  vi.unstubAllGlobals();
});

async function montar(titulo = "Métricas de Clientes", dados = cards) {
  await act(async () =>
    root.render(
      <MetricasDoPainel
        titulo={titulo}
        legendasDoResumo={legendas}
        cards={dados}
      />,
    ),
  );
  return host.querySelector("section")!;
}

it.each(["Clientes", "Pedidos", "Produtos"])(
  "%s: resumo mostra os quatro números na ordem, com dois em destaque e rótulos acessíveis",
  async (tela) => {
    const secao = await montar(`Métricas de ${tela}`);
    expect(secao.getAttribute("aria-label")).toBe(`Métricas de ${tela}`);
    const grupos = [...secao.querySelectorAll('[role="group"]')];
    expect(grupos.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Total Clientes",
      "Novos (30 dias)",
      "Valor médio por venda",
      "Pedidos Totais",
    ]);
    expect(grupos.map((g) => g.querySelector("h3")?.textContent)).toEqual([
      "16",
      "0",
      "R$ 25,81",
      "14",
    ]);
    for (const grupo of grupos.slice(0, 2))
      expect(grupo.querySelector("h3")?.className).toContain("text-[22px]");
    for (const grupo of grupos.slice(2))
      expect(grupo.querySelector("h3")?.className).toContain("text-xs");
    expect(
      [...secao.querySelectorAll('span[aria-hidden="true"]')].map(
        (el) => el.textContent,
      ),
    ).toEqual(legendas);
    for (const grupo of grupos) {
      expect(grupo.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      expect(grupo.querySelector(".sr-only")?.textContent).toBe(
        grupo.getAttribute("aria-label"),
      );
    }
    expect(secao.querySelector('[role="status"]')).toBeNull();
  },
);

it("Expandir abre todos os cartões; Recolher volta ao resumo, sem navegação de carrossel", async () => {
  const secao = await montar();
  const expandir = secao.querySelector("button")!;
  expect(expandir.textContent).toContain("Expandir");
  expect(expandir.getAttribute("aria-expanded")).toBe("false");
  expect(expandir.className).toContain("min-h-11");
  expandir.focus();
  await act(async () => expandir.click());
  const recolher = secao.querySelector("button")!;
  expect(document.activeElement).toBe(recolher);
  expect(recolher.textContent).toContain("Recolher");
  expect(recolher.getAttribute("aria-expanded")).toBe("true");
  expect(recolher.className).toContain("min-h-11");
  expect(secao.querySelectorAll("button")).toHaveLength(1);
  expect(secao.textContent).not.toMatch(
    /Carrossel|Primeiro grupo|Próximo|Anterior/,
  );
  const grade = secao.querySelector(".grid")!;
  expect(grade.className).toContain("grid-cols-2");
  const cartoes = [...grade.querySelectorAll("article")];
  expect(cartoes.map((c) => c.getAttribute("aria-label"))).toEqual([
    "Total Clientes",
    "Novos (30 dias)",
    "Valor médio por venda",
    "Pedidos Totais",
  ]);
  expect(cartoes.map((c) => c.querySelector("h3")?.textContent)).toEqual([
    "16",
    "0",
    "R$ 25,81",
    "14",
  ]);
  for (const [i, cartao] of cartoes.entries()) {
    const card = cards.at(i);
    expect(cartao.textContent).toContain(card?.subValue);
    expect(cartao.querySelector("svg")?.getAttribute("class")).toContain(
      card?.accent,
    );
    expect(cartao.innerHTML).not.toMatch(/truncate|line-clamp/);
  }
  await act(async () => recolher.click());
  expect(document.activeElement).toBe(secao.querySelector("button"));
  expect(secao.querySelectorAll("article")).toHaveLength(0);
  expect(secao.querySelectorAll('[role="group"]')).toHaveLength(4);
  expect(secao.querySelector("button")?.getAttribute("aria-expanded")).toBe(
    "false",
  );
});

it("sem medições, mantém os quatro travessões e o aviso ao expandir; zero medido remove o aviso", async () => {
  const desconhecidos = cards.map((card) => ({ ...card, value: "—" }));
  const secao = await montar("Métricas de Clientes", desconhecidos);
  expect(secao.querySelector('[role="status"]')?.textContent).toContain(
    "Aguardando métricas",
  );
  expect([...secao.querySelectorAll("h3")].map((el) => el.textContent)).toEqual(
    ["—", "—", "—", "—"],
  );
  await act(async () => secao.querySelector("button")!.click());
  expect(secao.querySelector('[role="status"]')?.textContent).toContain(
    "Aguardando métricas",
  );
  expect([...secao.querySelectorAll("h3")].map((el) => el.textContent)).toEqual(
    ["—", "—", "—", "—"],
  );
  await montar("Métricas de Clientes", [
    { ...cards[0], value: 0 },
    ...desconhecidos.slice(1),
  ]);
  expect(secao.querySelector('[role="status"]')).toBeNull();
  expect([...secao.querySelectorAll("h3")].map((el) => el.textContent)).toEqual(
    ["0", "—", "—", "—"],
  );
});

it("números e rótulos longos podem quebrar linha, sem truncar o resumo", async () => {
  const secao = await montar("Métricas de Produtos", [
    { ...cards[0], value: "R$ 123.456.789,90" },
    ...cards.slice(1),
  ]);
  expect(secao.querySelector("h3")?.textContent).toBe("R$ 123.456.789,90");
  for (const valor of secao.querySelectorAll("h3")) {
    expect(valor.className).toContain("break-words");
    expect(valor.className).toContain("tabular-nums");
  }
  expect(secao.innerHTML).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
});

it("durante o carregamento de Produtos, reserva os valores sem afirmar números antes da resposta", async () => {
  await act(async () =>
    root.render(
      <MetricasDoPainel
        titulo="Métricas de Produtos"
        legendasDoResumo={legendas}
        cards={cards}
        loading
      />,
    ),
  );
  const secao = host.querySelector("section")!;
  expect(secao.getAttribute("aria-busy")).toBe("true");
  expect(secao.querySelector('[role="status"]')?.textContent).toContain(
    "Aguardando métricas",
  );
  expect([...secao.querySelectorAll("h3")].map((el) => el.textContent)).toEqual(
    ["", "", "", ""],
  );
  expect(secao.querySelectorAll(".animate-pulse")).toHaveLength(4);
  await act(async () => secao.querySelector("button")!.click());
  expect(secao.querySelectorAll("article .animate-pulse")).toHaveLength(4);
  await montar("Métricas de Produtos");
  expect(secao.getAttribute("aria-busy")).toBe("false");
  expect(secao.querySelector('[role="status"]')).toBeNull();
  expect([...secao.querySelectorAll("h3")].map((el) => el.textContent)).toEqual(
    ["16", "0", "R$ 25,81", "14"],
  );
});
