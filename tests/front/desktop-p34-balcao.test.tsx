// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import postcss, { type Rule } from "postcss";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
const view = readFileSync("src/views/admin/AdminPdvView.tsx", "utf8");
const fechamento = readFileSync(
  "src/components/admin/pdv/FechamentoDaVenda.tsx",
  "utf8",
);
const cssBase = readFileSync("src/components/admin/pdv/pdv.css", "utf8");
// Literais de a70fff03f gerados na desktop-base; CI não precisa do histórico.
const classesDaView = [
  "pdv pdv-viewport",
  "cupom",
  "",
  "sr-only",
  "pdv-muted",
  "pdv-modes",
  "pdv-cyan size-5",
  "size-5",
  "pdv-blue size-5",
  "pdv-heading",
];
const classesDoFechamento = [
  "pdv-layer pdv-checkout",
  "pdv-checkout-body",
  "pdv-notice",
  "pdv-heading",
  "pdv-icon pdv-red",
  "pdv-muted",
  "pdv-secondary",
  "pdv-purple size-5",
  "pdv-notice",
  "pdv-heading",
  "pdv-icon pdv-red",
  "pdv-muted",
  "pdv-layer-heading",
  "flex items-center gap-3",
  "pdv-secondary size-11 shrink-0",
  "pdv-blue size-5",
  "sr-only",
  "pdv-muted",
  "pdv-cupom pdv-stack",
  "pdv-heading",
  "size-5",
  "flex-1",
  "pdv-muted",
  "text-sm",
  "pdv-summary-names",
  "pdv-muted",
  "pdv-discount",
  "pdv-card",
  "pdv-muted",
  "pdv-field",
  "pdv-muted mt-2",
  "pdv-card",
  "pdv-muted",
  "pdv-detail",
  "pdv-field",
  "pdv-muted mt-2 flex items-center gap-1",
  "pdv-pink size-4",
  "pdv-stack pdv-payments",
  "pdv-heading",
  "pdv-icon pdv-teal",
  "pdv-payment-grid",
  "pdv-payment",
  "pdv-icon",
  "pdv-muted",
  "pdv-payment-radio",
  "pdv-card pdv-change",
  "pdv-change-row",
  "pdv-muted",
  "pdv-field",
  "pdv-change-notes",
  "pdv-secondary",
  "faltam",
  "pdv-red",
  "",
  "pdv-stack pdv-conference",
  "pdv-check",
  "pdv-conference-copy",
  "pdv-muted",
  "pdv-detail",
  "pdv-compact-help",
  "pdv-footer",
  "pdv-checkout-status",
  "pdv-muted flex items-center gap-2",
  "pdv-orange size-4 shrink-0",
  "pdv-muted flex items-center gap-2",
  "pdv-orange size-4 shrink-0",
  "pdv-detail",
  "pdv-compact-help",
  "pdv-green flex items-center gap-2",
  "size-4 shrink-0",
  "pdv-total pdv-muted pdv-checkout-breakdown",
  "pdv-total pdv-muted pdv-checkout-breakdown",
  "pdv-total",
  "pdv-muted",
  "pdv-primary pdv-sale-action bg-green-600 text-white",
  "size-5",
  "size-5",
  "pdv-muted",
];
const classesDaAnulacao = [
  "pdv-notice",
  "pdv-icon pdv-green",
  "pdv-secondary pdv-annul-trigger",
  "pdv-red size-5",
  "pdv-notice",
  "pdv-heading",
  "pdv-icon pdv-red",
  "text-xl font-bold",
  "pdv-muted",
  "pdv-muted",
  "pdv-field",
  "pdv-muted",
  "pdv-muted",
  "text-xs text-red-400",
  "pdv-annul-actions",
  "pdv-secondary",
  "pdv-danger",
  "pdv-muted",
];

function classesDaFonte(fonte: string, celular = true) {
  const lista: string[] = [];
  const ast = ts.createSourceFile(
    "pdv.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  function visitar(no: ts.Node) {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText() === "className" &&
      no.initializer
    ) {
      function literal(filho: ts.Node) {
        if (ts.isStringLiteral(filho))
          lista.push(celular ? classesDoCelular(filho.text) : filho.text);
        ts.forEachChild(filho, literal);
      }
      literal(no.initializer);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(ast);
  return lista;
}

async function compilar(fonteView = view, fonteFechamento = fechamento) {
  const exigir = createRequire(import.meta.url);
  const tailwind = exigir("tailwindcss");
  const classes = [
    ...classesDaFonte(fonteView, false),
    ...classesDaFonte(fonteFechamento, false),
  ]
    .join(" ")
    .split(/\s+/)
    .filter((token) => /^(lg|xl|2xl):/.test(token))
    .join(" ");
  return (
    await postcss([
      tailwind({
        content: [{ raw: classes, extension: "html" }],
        corePlugins: { preflight: false },
      }),
    ]).process("@tailwind utilities;", { from: undefined })
  ).root;
}
let utilidades: postcss.Root;
beforeAll(async () => {
  utilidades = await compilar();
});

function renderizar(
  pagamento: "cash" | "pix" | "card" | null,
  desconto: number,
  erro: string | null,
) {
  const host = document.createElement("div");
  // Caixa do painel: classes extraídas da view; filhos da grade são REAIS.
  const classe = classesDaFonte(view, false).find((valor) =>
    valor.startsWith("pdv pdv-viewport"),
  );
  host.innerHTML = renderToStaticMarkup(
    createElement(
      "div",
      {
        className: classe,
        "data-etapa": "fechamento",
      },
      createElement(FechamentoDaVenda, {
        estado: {
          ...estadoInicialDaVenda(() => "ficticia"),
          etapa: "fechamento",
          itens: [
            {
              chave: "ficticio::",
              productId: "ficticio",
              variantId: null,
              nome: "Produto fictício",
              variacao: null,
              imagem: "",
              preco: 50,
              quantidade: 1,
              estoque: 3,
            },
          ],
          pagamento,
          desconto,
          motivoDoDesconto: desconto ? "Mostruário" : "",
          erro,
        },
        despachar: vi.fn(),
        aoRegistrarVenda: vi.fn(),
        limparCupom: vi.fn(),
      }),
    ),
  );
  return host;
}

function declaracoes(regra: Rule) {
  const resultado: Record<string, string> = {};
  regra.walkDecls((decl) => {
    resultado[decl.prop] = decl.value;
  });
  return resultado;
}

// jsdom 29 troca até o & ESCAPADO por :scope. A sonda isolada deu 0
// matches com \\& e 1 com \\26 (o MESMO caractere CSS). Não muda o seletor.
function paraJsdom(seletor: string) {
  return seletor.replace(/\\&/g, "\\26 ");
}

function conferirGrade(folha: postcss.Root, host: ParentNode) {
  const regras: Rule[] = [];
  folha.walkAtRules("media", (media) => {
    expect(media.params).toBe("(min-width: 1280px)");
    media.walkRules((regra) => {
      regras.push(regra);
    });
  });
  expect(regras.length).toBeGreaterThan(0);
  const corpo = host.querySelector(".pdv-checkout-body")!;
  const estilos: Record<string, string> = {};
  const spans = new Map<Element, Set<string>>();
  for (const regra of regras) {
    // Os seletores compilados pelo Tailwind, inclusive xl:[&>...], precisam
    // casar com os filhos reais, não com ids ou cartões fabricados.
    const alvos = host.querySelectorAll(paraJsdom(regra.selector));
    expect(alvos.length, regra.selector).toBeGreaterThan(0);
    const decls = declaracoes(regra);
    for (const alvo of alvos) {
      if (alvo === corpo) Object.assign(estilos, decls);
      if (decls["grid-column"]) {
        const valores = spans.get(alvo) ?? new Set<string>();
        valores.add(decls["grid-column"]);
        spans.set(alvo, valores);
      }
    }
    // CSS próprio do PDV pode carregar depois das utilidades. O que troca
    // display/gap/colunas precisa ganhar também nessa ordem de carregamento.
    if (Array.from(alvos).includes(corpo)) {
      regra.walkDecls((decl) => {
        if (["display", "gap", "grid-template-columns"].includes(decl.prop))
          expect(decl.important).toBe(true);
      });
    }
  }
  expect(estilos).toMatchObject({
    display: "grid",
    "grid-template-columns": "repeat(2, minmax(0, 1fr))",
    gap: "1.5rem",
    "align-content": "flex-start",
    "align-items": "flex-start",
  });
  for (const filho of corpo.children) {
    const par = filho.matches(".pdv-discount, .pdv-payments");
    expect(spans.get(filho)?.has("span 2 / span 2"), filho.className).toBe(
      true,
    );
    expect(
      spans.get(filho)?.has("span 1 / span 1") ?? false,
      filho.className,
    ).toBe(par);
  }
  // Seletores de span 1 têm classe do filho: mais específicos que > *.
  for (const regra of regras.filter(
    (r) => declaracoes(r)["grid-column"] === "span 1 / span 1",
  )) {
    expect(regra.selector).toMatch(/>\s*\.pdv-(discount|payments)$/);
  }
  const desconto = corpo.querySelector(".pdv-discount")!;
  const umaColuna = regras.find(
    (r) =>
      declaracoes(r)["grid-template-columns"] === "repeat(1, minmax(0, 1fr))",
  );
  expect(umaColuna).toBeDefined();
  expect(desconto.matches(paraJsdom(umaColuna!.selector))).toBe(true);
  const largura = regras.find((r) => declaracoes(r)["max-width"] === "none");
  expect(largura).toBeDefined();
  const painel = host.querySelector(".pdv")!;
  expect(painel.matches(paraJsdom(largura!.selector))).toBe(true);
  painel.setAttribute("data-etapa", "cupom");
  expect(painel.matches(paraJsdom(largura!.selector))).toBe(false);
  painel.setAttribute("data-etapa", "fechamento");
  expect(host.querySelector(".pdv-footer")).not.toBeNull();
  expect(
    host.querySelector(".pdv-footer")!.closest(".pdv-checkout-body"),
  ).toBeNull();
  return estilos;
}

describe("P34 — fechamento no computador sem mudar a venda", () => {
  it("preserva literalmente todas as classes do celular", () => {
    expect(classesDaFonte(view)).toEqual(classesDaView);
    expect(classesDaFonte(fechamento)).toEqual(classesDoFechamento);
    expect(
      classesDaFonte(
        readFileSync(
          "src/components/admin/pdv/AnularVendaDoBalcao.tsx",
          "utf8",
        ),
      ),
    ).toEqual(classesDaAnulacao);
  });
  it.each(["cash", "pix", "card", null] as const)(
    "avisos, resumo e troco ocupam a linha inteira; só desconto e pagamento dividem (%s)",
    (pagamento) => {
      for (const desconto of [0, 5])
        for (const erro of [null, "Falha fictícia de rede"]) {
          conferirGrade(utilidades, renderizar(pagamento, desconto, erro));
        }
    },
  );
  it("as colunas emitidas cabem no painel e só começam em 1280px", () => {
    const estilos = conferirGrade(utilidades, renderizar("cash", 0, null));
    let padding = 0;
    postcss.parse(cssBase).walkRules(".pdv", (regra) => {
      if (regra.parent?.type === "root")
        padding = Number.parseFloat(declaracoes(regra).padding);
    });
    expect(padding).toBe(16);
    const gap = Number.parseFloat(estilos.gap) * 16;
    for (const [janela, esperado] of [
      [1280, 460],
      [1536, 588],
      [1920, 588],
    ]) {
      const util = Math.min(janela - 256, 1280) - 48;
      const coluna = (util - 2 * padding - gap) / 2;
      expect(coluna).toBe(esperado);
      expect(coluna).toBeGreaterThanOrEqual(420);
    }
    // O CSS móvel continua flex e não recebe utilidades antes de xl.
    const base = postcss.parse(cssBase);
    base.walkRules(".pdv-checkout-body", (regra) => {
      if (regra.parent?.type === "root")
        expect(declaracoes(regra).display).toBe("flex");
    });
    utilidades.walkAtRules("media", (media) => {
      expect(media.params).toBe("(min-width: 1280px)");
    });
  });
  it("pega mutantes em cópias das classes, compiladas sem tocar a produção", async () => {
    const host = renderizar("cash", 5, "Falha fictícia");
    const semGrade = fechamento.replace("xl:!grid ", "");
    expect(semGrade).not.toBe(fechamento);
    expect(() => conferirGrade(postcss.parse(""), host)).toThrow();
    const compiladoSemGrade = await compilar(view, semGrade);
    expect(() => conferirGrade(compiladoSemGrade, host)).toThrow();
    const seletorMorto = fechamento.replace(
      "xl:[&>.pdv-discount]:col-span-1",
      "xl:[&>#desconto-inexistente]:col-span-1",
    );
    expect(seletorMorto).not.toBe(fechamento);
    const compiladoMorto = await compilar(view, seletorMorto);
    expect(() => conferirGrade(compiladoMorto, host)).toThrow();
    const semSpan = fechamento.replace("xl:[&>*]:col-span-2 ", "");
    expect(semSpan).not.toBe(fechamento);
    const compiladoSemSpan = await compilar(view, semSpan);
    expect(() => conferirGrade(compiladoSemSpan, host)).toThrow();
  });
});
