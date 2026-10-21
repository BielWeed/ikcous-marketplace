// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { BarraDeBusca } from "@/components/admin/BarraDeBusca";
import { MetricasDoPainel } from "@/components/admin/MetricasDoPainel";
import { Package } from "lucide-react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cards = Array.from({ length: 6 }, (_, i) => ({
  label: `Métrica ${i}`,
  value: `R$ ${i},00`,
  icon: Package,
}));
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

it("reserva 148 px, nota 28, principais 76 e rodapé 40 sem terceira linha", async () => {
  const entender = vi.fn();
  await act(async () =>
    root.render(
      <MetricasDoPainel
        titulo="Produtos"
        cards={cards}
        legendasDoResumo={[]}
        nota="Conferindo custos…"
        onEntender={entender}
        loading
      />,
    ),
  );
  const secao = host.querySelector("section")!;
  expect(secao.className).toContain("h-[148px]");
  expect(secao.querySelector(".metricas-painel-nota")?.className).toContain(
    "h-7",
  );
  expect(secao.querySelector(".metricas-painel-nota")?.className).toContain(
    "truncate",
  );
  expect(
    secao.querySelector(".metricas-painel-principais")?.className,
  ).toContain("h-[76px]");
  const rodape = secao.querySelector(".metricas-painel-secundarias")!;
  expect(rodape.className).toContain("h-10");
  expect(rodape.querySelectorAll('[role="group"]')).toHaveLength(2);
  expect(secao.querySelector('[role="status"]')?.className).toContain(
    "sr-only",
  );
  const info = rodape.querySelector<HTMLButtonElement>(
    '[aria-label="Entender valores"]',
  )!;
  expect(info.className).toContain("size-11");
  await act(async () => info.click());
  expect(entender).toHaveBeenCalledOnce();
  const expandir = secao.querySelector<HTMLButtonElement>("[aria-expanded]")!;
  expect(expandir.className).toContain("min-h-11");
  await act(async () => expandir.click());
  expect(secao.className).toContain("h-[404px]");
  expect(secao.querySelectorAll("article")).toHaveLength(6);
  expect(
    secao.querySelector('button[aria-label="Entender valores"]'),
  ).not.toBeNull();
});

it("busca reserva 117 px e chips 44 px mesmo sem categorias", async () => {
  await act(async () =>
    root.render(
      <BarraDeBusca
        id="teste"
        rotulo="Buscar"
        placeholder="Buscar"
        value=""
        onChange={() => {}}
        modo="compact"
        onMudarModo={() => {}}
        grupo="Categorias"
        opcoes={[]}
      />,
    ),
  );
  expect(host.querySelector("[data-barra-de-busca]")?.className).toContain(
    "h-[117px]",
  );
  expect(host.querySelector('[role="group"]')?.className).toContain("h-11");
  expect(host.querySelector("input")?.className).toContain("h-12");
});

// jsdom não mede y. Estas guardas travam a estrutura; Chromium deve medir os pixels.
const fontes = new Map([
  ["Products", readFileSync("src/views/admin/AdminProductsView.tsx", "utf8")],
  ["Orders", readFileSync("src/views/admin/AdminOrdersView.tsx", "utf8")],
  ["Customers", readFileSync("src/views/admin/AdminCustomersView.tsx", "utf8")],
]);
it.each(["Products", "Orders", "Customers"])(
  "%s: cabeçalho fixo e lista separados da carga",
  (nome) => {
    const fonte = fontes.get(nome)!;
    expect(fonte).toContain("admin-topo-cabecalho");
    expect(fonte).toContain("h-[76px]");
    expect(fonte).toContain("admin-topo-conteudo");
    expect(fonte).toContain("admin-topo-resumo");
    expect(fonte).toContain("admin-topo-lista");
    expect(fonte.indexOf("admin-topo-cabecalho")).toBeLessThan(
      fonte.indexOf("admin-topo-resumo"),
    );
    expect(fonte.indexOf("admin-topo-resumo")).toBeLessThan(
      fonte.indexOf("<BarraDeBusca"),
    );
    expect(fonte.indexOf("<BarraDeBusca")).toBeLessThan(
      fonte.indexOf("admin-topo-lista"),
    );
    if (nome !== "Products") {
      expect(fonte).toMatch(
        nome === "Orders"
          ? /<p role="status" className="sr-only">\s*Carregando pedidos\.\.\./
          : /<p role="status" className="sr-only">\s*Carregando novos dados\.\.\./,
      );
    }
  },
);
