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

it.each(["1 produto sem custo · lucro parcial", "Conferindo custos…"])(
  "expandir mantém a nota visível: %s",
  async (nota) => {
    await act(async () =>
      root.render(
        <MetricasDoPainel
          titulo="Produtos"
          cards={cards}
          legendasDoResumo={["Custo", "Lucro bruto (parcial)"]}
          nota={nota}
        />,
      ),
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[aria-expanded]")!.click(),
    );
    const faixa = host.querySelector(".metricas-painel-nota")!;
    expect(faixa).not.toBeNull();
    expect(faixa.textContent).toBe(nota);
    expect(faixa.className).not.toMatch(/sr-only|truncate/);
    expect(faixa.className).toContain("h-7");
    const css = readFileSync(
      "src/components/admin/metricas-do-painel.css",
      "utf8",
    );
    expect(css).toContain("padding: 11px 12px;");
    // 28 de nota + 44 de cabeçalho + 3 × 96 + 2 × 10 de vãos + 22 de respiro + 2 de borda.
    const cabecalho = Number(
      css.match(/\.metricas-painel-cabecalho\s*\{\s*height: (\d+)px/)?.[1],
    );
    const linha = Number(css.match(/grid-auto-rows: (\d+)px/)?.[1]);
    expect(host.querySelector(".metricas-painel-grade")!.className).toContain(
      "gap-2.5",
    );
    expect(28 + cabecalho + 3 * linha + 2 * 10 + 22 + 2).toBe(404);
    expect(host.querySelectorAll("article")[1].textContent).toContain(
      "Métrica 1 (parcial)",
    );
    expect(host.querySelector("section")!.className).toContain("h-[404px]");
  },
);

it("mantém os tokens dos três temas ao integrar a geometria fixa", () => {
  for (const arquivo of [
    "src/components/admin/BarraDeBusca.tsx",
    "src/components/admin/MetricasDoPainel.tsx",
    "src/views/admin/AdminProductsView.tsx",
  ]) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminho vem da lista fechada acima.
    const fonte = readFileSync(arquivo, "utf8");
    expect(fonte).not.toMatch(/admin-(?:card|accent)\b/);
    expect(fonte).toContain(
      arquivo.includes("Metricas") ? "bg-admin-surface" : "bg-admin-raised",
    );
  }
  const css = readFileSync(
    "src/components/admin/metricas-do-painel.css",
    "utf8",
  );
  expect(css).toContain("hsl(var(--admin-raised))");
  expect(css).toContain("hsl(var(--admin-surface))");
  expect(css).toContain("var(--lit-t-b5b1bd, #b5b1bd)");
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
