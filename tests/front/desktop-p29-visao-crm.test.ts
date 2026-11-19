// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import { StrategicIntelligenceBlocks } from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const caminho = "src/components/admin/crm/VisaoGeralDoCrm.tsx";
const fonte = readFileSync(caminho, "utf8");
// Literais congelados de 251753360; não depende do histórico disponível no CI.
const CLASSES_DO_CELULAR_NA_BASE = [
  "-my-2 inline-flex min-h-11 items-center gap-1 text-left font-bold text-amber-300",
  "size-3 shrink-0",
  "space-y-4",
  "flex items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 text-xs text-amber-300",
  "min-h-11 shrink-0 px-2 font-bold",
  "h-[188px] justify-center",
  "min-h-11 rounded-xl bg-foreground px-4 text-xs font-bold text-background",
  "flex flex-wrap items-center justify-between gap-x-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 text-xs text-amber-300",
  "py-2",
  "inline-flex min-h-11 shrink-0 items-center gap-1 text-left font-bold",
  "size-3 shrink-0",
  "space-y-4 pt-2",
  "flex items-center gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-rose-300",
  "size-5 shrink-0",
  "text-xs",
  "ml-auto min-h-11 px-3 text-xs font-bold",
];

function analisar(texto: string) {
  return ts.createSourceFile(
    caminho,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function atributo(
  no: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  nome: string,
) {
  const item = no.attributes.properties.find(
    (p) => ts.isJsxAttribute(p) && p.name.getText() === nome,
  );
  return item &&
    ts.isJsxAttribute(item) &&
    item.initializer &&
    ts.isStringLiteral(item.initializer)
    ? item.initializer.text
    : "";
}

function historico(texto: string) {
  let resultado: ts.JsxElement | undefined;
  function visitar(no: ts.Node) {
    if (
      ts.isJsxElement(no) &&
      atributo(no.openingElement, "aria-label") === "Histórico completo da loja"
    )
      resultado = no;
    ts.forEachChild(no, visitar);
  }
  visitar(analisar(texto));
  if (!resultado) throw new Error("Histórico não encontrado");
  return resultado;
}

function filhosDaGrade(texto: string) {
  const filhos: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  function coletar(no: ts.Node) {
    if (ts.isJsxElement(no)) filhos.push(no.openingElement);
    else if (ts.isJsxSelfClosingElement(no)) filhos.push(no);
    else ts.forEachChild(no, coletar);
  }
  for (const filho of historico(texto).children) coletar(filho);
  return filhos;
}

function conferirCelular(texto: string) {
  const literais: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText() === "className") {
      function literal(filho: ts.Node) {
        if (ts.isStringLiteral(filho))
          literais.push(classesDoCelular(filho.text));
        ts.forEachChild(filho, literal);
      }
      if (no.initializer) literal(no.initializer);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(analisar(texto));
  expect(literais).toEqual(CLASSES_DO_CELULAR_NA_BASE);
}

function conferirGrade(texto: string) {
  const tokens = atributo(historico(texto).openingElement, "className").split(
    /\s+/,
  );
  for (const token of [
    "xl:grid",
    "xl:grid-cols-2",
    "xl:gap-6",
    "xl:space-y-0",
    "xl:items-start",
    "xl:[&>*]:min-w-0",
  ]) {
    expect(tokens).toContain(token);
  }
  expect(tokens).not.toContain("lg:grid-cols-2");
  expect(texto).not.toMatch(
    /(?:lg|xl|2xl):(?:overflow-hidden|order-|grid-flow-dense)/,
  );
  return tokens;
}

const estados = [
  "carregando",
  "erro",
  "vazio",
  "ambos",
  "só categorias",
  "só produtos",
  "categorias vazias",
  "produtos vazios",
] as const;
type Estado = (typeof estados)[number];

function conferirEstado(texto: string, estado: Estado, alerta: boolean) {
  const tokens = conferirGrade(texto);
  const filhos = filhosDaGrade(texto);
  expect(filhos.map((no) => no.tagName.getText())).toEqual([
    "div",
    "LocalErrorBoundary",
    "LocalErrorBoundary",
    "LocalErrorBoundary",
  ]);
  expect(atributo(filhos[0], "data-aviso-historico")).toBe("falha");
  for (const [indice, componente] of [
    "OperationalPerformanceChart",
    "StrategicIntelligenceBlocks",
    "TopProductsList",
  ].entries()) {
    expect(filhos[indice + 1].parent.getText()).toContain(`<${componente}`);
  }
  const carregando = estado === "carregando";
  const vazio = estado === "vazio" || estado === "erro" || carregando;
  const stats: DashboardStats = {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [],
    topProducts:
      vazio || estado === "produtos vazios"
        ? []
        : [
            {
              id: "produto-ficticio",
              name: "Produto de teste",
              quantity: 1,
              total: 10,
              image: "",
            },
          ],
    inventoryAlerts: 0,
  };
  // Renderiza os TRÊS componentes reais do histórico, incluindo CartaoDoCrm real.
  // Nenhum ID é atribuído pelo teste; os únicos IDs-alvo são os títulos do app.
  // Ausência de um cartão simula o cenário isolado/fallback sem inventar seu DOM.
  const html = renderToStaticMarkup(
    createElement(
      "section",
      {
        className: atributo(historico(texto).openingElement, "className"),
      },
      alerta
        ? createElement(
            "div",
            {
              "data-aviso-historico": atributo(
                filhos[0],
                "data-aviso-historico",
              ),
            },
            "Falha de teste",
          )
        : null,
      createElement(OperationalPerformanceChart, {
        stats,
        loading: carregando,
        active: false,
      }),
      estado === "só produtos"
        ? null
        : createElement(StrategicIntelligenceBlocks, {
            categoryData:
              vazio || estado === "categorias vazias"
                ? []
                : [{ name: "Categoria de teste", value: 10 }],
            loading: carregando,
            error: estado === "erro" ? "Falha de teste" : null,
          }),
      estado === "só categorias"
        ? null
        : createElement(TopProductsList, {
            stats,
            loading: carregando,
            onNavigate: () => undefined,
          }),
    ),
  );
  const documento = new DOMParser().parseFromString(html, "text/html");
  const grade = documento.body.firstElementChild!;
  expect(grade.className).toBe(
    atributo(historico(texto).openingElement, "className"),
  );
  const categoria = grade
    .querySelector("#crm-categorias-titulo")
    ?.closest("section");
  const produto = grade
    .querySelector("#crm-produtos-lucro-titulo")
    ?.closest("section");
  expect(Boolean(categoria)).toBe(estado !== "só produtos");
  expect(Boolean(produto)).toBe(estado !== "só categorias");
  if (categoria) {
    expect(categoria.id).toBe("");
    expect(categoria.parentElement).toBe(grade);
    if (carregando)
      expect(categoria.querySelector(".premium-shimmer")).not.toBeNull();
    else if (estado === "erro")
      expect(categoria.textContent).toContain(
        "Falha ao carregar vendas por categoria",
      );
    else if (vazio || estado === "categorias vazias")
      expect(categoria.textContent).toContain("Sem dados registrados");
    else expect(categoria.textContent).toContain("Categoria de teste");
  }
  if (produto) {
    expect(produto.id).toBe("");
    expect(produto.parentElement).toBe(grade);
    if (carregando)
      expect(produto.querySelector(".premium-shimmer")).not.toBeNull();
    else if (vazio || estado === "produtos vazios")
      expect(produto.textContent).toContain("Nenhum dado de vendas disponível");
    else expect(produto.textContent).toContain("Produto de teste");
  }
  const spans = new Map<Element, number>();
  const prioridades = new Map<Element, number>();
  for (const token of tokens) {
    const regra = token.match(/^xl:\[(.+)\]:col-span-(\d+)$/);
    if (!regra) continue;
    // Entre estas regras, a única diferença de especificidade é o número
    // de IDs, inclusive dentro de :has; o universal não acrescenta peso.
    const prioridade = (regra[1].match(/#[\w-]+/g) ?? []).length;
    for (const el of grade.querySelectorAll(regra[1].replace("&", ":scope"))) {
      if (prioridade >= (prioridades.get(el) ?? -1)) {
        spans.set(el, Number(regra[2]));
        prioridades.set(el, prioridade);
      }
    }
  }
  const linhas = new Map<Element, number>();
  let coluna = 0;
  let linha = 0;
  for (const el of grade.children) {
    const span = spans.get(el) ?? 1;
    const par =
      Boolean(categoria && produto) && (el === categoria || el === produto);
    expect(span, `${estado}/alerta=${alerta}`).toBe(par ? 1 : 2);
    if (span === 2) expect(coluna).toBe(0);
    linhas.set(el, linha);
    coluna += span;
    if (coluna === 2) {
      linha++;
      coluna = 0;
    }
  }
  expect(coluna).toBe(0);
  if (categoria && produto)
    expect(linhas.get(categoria)).toBe(linhas.get(produto));
}

describe("P29 — histórico completo do CRM no computador", () => {
  it("preserva todos os literais de classes do celular", () => {
    conferirCelular(fonte);
    expect(() =>
      conferirCelular(
        fonte.replace('className="space-y-4', 'className="space-y-5'),
      ),
    ).toThrow();
  });
  it("abre duas colunas apenas em xl e rejeita o mutante lg", () => {
    conferirGrade(fonte);
    expect(() =>
      conferirGrade(fonte.replace("xl:grid-cols-2", "lg:grid-cols-2")),
    ).toThrow();
  });
  it.each(estados)(
    "renderiza cartões reais: %s, com e sem alerta",
    (estado) => {
      for (const alerta of [false, true]) conferirEstado(fonte, estado, alerta);
    },
  );
  it("rejeita a remoção do seletor do título de categorias", () => {
    const token = atributo(historico(fonte).openingElement, "className")
      .split(/\s+/)
      .find((t) => t.endsWith(">:has(#crm-categorias-titulo)]:col-span-1"));
    expect(token).toBeTruthy();
    expect(() =>
      conferirEstado(fonte.replace(token!, ""), "ambos", false),
    ).toThrow();
  });
  it("rejeita a remoção da largura inteira e novos filhos auto-fechados", () => {
    expect(() =>
      conferirEstado(
        fonte.replace("xl:[&>*]:col-span-2", ""),
        "só produtos",
        true,
      ),
    ).toThrow();
    expect(() =>
      conferirEstado(
        fonte.replace("<LocalErrorBoundary>", "<Foo />\n<LocalErrorBoundary>"),
        "ambos",
        false,
      ),
    ).toThrow();
  });
});
