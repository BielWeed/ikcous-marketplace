// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const caminho = "src/components/admin/crm/FunilEPedidosDoCrm.tsx";
const fonte = readFileSync(
  "src/components/admin/crm/FunilEPedidosDoCrm.tsx",
  "utf8",
);
// Classes do celular de cada literal de className, na ordem da árvore, como estavam
// na base 1.5.187, sem o botão do aviso que inferia pedidos sem pagamento.
// Literal fixo: o CI clona só o último commit.
const CLASSES_DO_CELULAR_NA_BASE = [
  "flex items-stretch gap-1",
  "flex min-w-0 flex-1 items-center gap-1",
  "text-admin-text-soft size-3 shrink-0",
  "min-h-14 min-w-0 flex-1 rounded-xl border border-admin-border bg-admin-raised py-1 text-center",
  "text-admin-text font-extrabold tabular-nums",
  "text-2xl",
  "text-xl",
  "text-lg",
  "text-admin-text-soft text-[11px]",
  "space-y-3",
  "space-y-1.5",
  "flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
  "flex size-8 shrink-0 items-center justify-center rounded-lg border",
  "size-4",
  "min-w-0 flex-1",
  "text-admin-text block text-xs font-bold",
  "mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300",
  "size-3",
  "mt-0.5 flex items-center gap-1 text-[11px] text-zinc-400",
  "size-3",
  "min-w-8 rounded-full border border-admin-border bg-white/5 px-2 py-0.5 text-center text-[11px] font-black tabular-nums text-zinc-200",
  "size-4 shrink-0 text-zinc-600",
  "text-admin-text min-h-11 w-full rounded-xl bg-admin-raised text-xs font-bold",
  "text-[11px] leading-relaxed text-zinc-400",
  "space-y-4",
  "flex items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 text-xs text-amber-300",
  "min-h-11 shrink-0 px-2 font-bold",
  "text-admin-text",
  "min-h-[132px]",
  "premium-shimmer h-14 rounded-xl",
  "mt-2 space-y-1.5 text-[11px] leading-relaxed text-zinc-400",
  "flex flex-wrap gap-1.5",
  "rounded-full border border-admin-border bg-white/5 px-2 py-0.5 text-zinc-200",
  "tabular-nums",
  "text-amber-300",
  "premium-shimmer min-h-[282px] rounded-2xl",
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

function literaisDeClasse(texto: string) {
  const encontrados: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText() === "className") {
      function literal(filho: ts.Node) {
        if (ts.isStringLiteral(filho)) encontrados.push(filho.text);
        ts.forEachChild(filho, literal);
      }
      if (no.initializer) literal(no.initializer);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(analisar(texto));
  return encontrados;
}

function raizDoFunil(texto: string) {
  const arvore = analisar(texto);
  let raiz: ts.JsxElement | undefined;
  function visitar(no: ts.Node) {
    if (
      ts.isFunctionDeclaration(no) &&
      no.name?.text === "FunilEPedidosDoCrm"
    ) {
      for (const comando of no.body?.statements ?? []) {
        if (
          ts.isReturnStatement(comando) &&
          comando.expression &&
          ts.isParenthesizedExpression(comando.expression) &&
          ts.isJsxElement(comando.expression.expression)
        ) {
          raiz = comando.expression.expression;
        }
      }
    }
    ts.forEachChild(no, visitar);
  }
  visitar(arvore);
  if (!raiz) throw new Error("Raiz do funil não encontrada");
  return raiz;
}

function classes(no: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  const atributo = no.attributes.properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.getText() === "className",
  );
  return atributo &&
    ts.isJsxAttribute(atributo) &&
    atributo.initializer &&
    ts.isStringLiteral(atributo.initializer)
    ? atributo.initializer.text
    : "";
}

function filhosDaGrade(texto: string) {
  const filhos: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  function coletar(no: ts.Node) {
    if (ts.isJsxElement(no)) filhos.push(no.openingElement);
    else if (ts.isJsxSelfClosingElement(no)) filhos.push(no);
    else ts.forEachChild(no, coletar);
  }
  for (const filho of raizDoFunil(texto).children) coletar(filho);
  return filhos;
}

function conferirPreservacao(texto: string) {
  expect(literaisDeClasse(texto).map(classesDoCelular)).toEqual(
    CLASSES_DO_CELULAR_NA_BASE,
  );
}

function conferirGrade(texto: string) {
  const tokens = classes(raizDoFunil(texto).openingElement).split(/\s+/);
  for (const token of [
    "xl:grid",
    "xl:grid-cols-2",
    "xl:items-start",
    "xl:gap-6",
    "xl:space-y-0",
    "xl:[&>*]:min-w-0",
  ]) {
    expect(tokens).toContain(token);
  }
  expect(tokens).not.toContain("lg:grid-cols-2");
  expect(texto).not.toMatch(
    /(?:lg|xl|2xl):(?:overflow-hidden|order-|grid-flow-dense)/,
  );
}

function conferirEstados(texto: string) {
  const tokens = classes(raizDoFunil(texto).openingElement).split(/\s+/);
  const filhos = filhosDaGrade(texto);
  // Inclui componentes auto-fechados, sem descer no conteúdo dos cartões.
  expect(filhos.map((no) => no.tagName.getText())).toEqual([
    "div",
    "MetricasDoPainel",
    "CartaoDoCrm",
    "div",
    "Pipeline",
  ]);
  expect(tokens).toContain("xl:[&>.metricas-painel]:col-span-2");
  expect(tokens).toContain("xl:[&>[role=alert]]:col-span-2");
  expect(tokens).toContain("xl:[&:has(>[aria-hidden=true])>*]:col-span-2");
  expect(filhos[0].getText()).toContain('role="alert"');
  expect(filhos[3].getText()).toContain('aria-hidden="true"');
  const metricas = readFileSync(
    "src/components/admin/MetricasDoPainel.tsx",
    "utf8",
  );
  expect(metricas).toContain(
    'className="metricas-painel metricas-relatorio h-[148px] min-w-0"',
  );
  // Carregando, erro/offline sem dados, vazio e dados (com/sem aviso).
  // No vazio funil e fila continuam presentes, cada qual com seu estado vazio.
  for (const estado of [
    { nome: "carregando", indices: [1, 2, 3], carregando: true },
    { nome: "erro sem dados", indices: [1], carregando: false },
    { nome: "offline sem dados", indices: [1], carregando: false },
    { nome: "sem pedidos", indices: [1, 2, 4], carregando: false },
    { nome: "com pedidos", indices: [1, 2, 4], carregando: false },
    { nome: "falha ao atualizar", indices: [0, 1, 2, 4], carregando: false },
  ]) {
    const grade = document.createElement("div");
    for (const indice of estado.indices) {
      const no = filhos.at(indice);
      if (!no) throw new Error("Filho não enumerado");
      const tag = no.tagName.getText();
      const elemento = document.createElement(
        tag === "div" ? "div" : "section",
      );
      for (const atributo of no.attributes.properties) {
        if (
          ts.isJsxAttribute(atributo) &&
          atributo.initializer &&
          ts.isStringLiteral(atributo.initializer)
        ) {
          const nome = atributo.name.getText();
          elemento.setAttribute(
            nome === "className" ? "class" : nome,
            atributo.initializer.text,
          );
        }
      }
      if (tag === "MetricasDoPainel") elemento.classList.add("metricas-painel");
      grade.appendChild(elemento);
    }
    // Aplica os seletores REAIS dos literais, incluindo :has do carregamento.
    // Não decide o span pelo nome do estado nem pelo índice do filho.
    const spans = new Map<Element, number>();
    for (const token of tokens) {
      const regra = token.match(/^xl:\[(.+)\]:col-span-(\d+)$/);
      if (!regra) continue;
      for (const filho of grade.querySelectorAll(
        regra[1].replace("&", ":scope"),
      )) {
        spans.set(filho, Number(regra[2]));
      }
    }
    let coluna = 0;
    for (const filho of grade.children) {
      const span = spans.get(filho) ?? 1;
      if (span === 2) expect(coluna, estado.nome).toBe(0);
      coluna = (coluna + span) % 2;
    }
    expect(coluna, estado.nome).toBe(0);
  }
}

describe("P24 — Funil e pedidos no computador", () => {
  it("preserva as classes móveis do funil e da fila", () => {
    conferirPreservacao(fonte);
    expect(() =>
      conferirPreservacao(
        fonte.replace('className="space-y-4', 'className="space-y-5'),
      ),
    ).toThrow();
  });

  it("compara funil e fila só em xl sem cortar conteúdo", () => {
    conferirGrade(fonte);
    expect(() =>
      conferirGrade(fonte.replace("xl:grid-cols-2", "lg:grid-cols-2")),
    ).toThrow();
  });

  it("enumera todos os filhos e não deixa buracos em nenhum estado", () => {
    conferirEstados(fonte);
    expect(() =>
      conferirEstados(
        fonte.replace("xl:[&:has(>[aria-hidden=true])>*]:col-span-2", ""),
      ),
    ).toThrow();
  });

  it.each([
    [1024, 1, 720],
    [1280, 2, 476],
    [1536, 2, 604],
    [1920, 2, 604],
  ])("em %i px usa %i coluna(s) de %i px", (janela, colunas, largura) => {
    conferirGrade(fonte);
    const casca = readFileSync(
      "src/components/layouts/AdminLayout.tsx",
      "utf8",
    );
    expect(casca).toContain("hidden w-64 shrink-0");
    expect(casca).toContain(
      "relative mx-auto flex size-full max-w-7xl flex-col",
    );
    const colunasAtivas = janela >= 1280 ? 2 : 1;
    const gap = colunasAtivas === 2 ? 24 : 0;
    const util = Math.min(janela - 256, 1280) - 48;
    expect(colunasAtivas).toBe(colunas);
    expect((util - gap) / colunasAtivas).toBe(largura);
    expect(largura).toBeGreaterThanOrEqual(420);
    // O funil é flexível, não SVG com largura/viewBox fixo.
    expect(fonte).not.toMatch(/<svg\b|viewBox=|<BarChart\b/);
  });
});
