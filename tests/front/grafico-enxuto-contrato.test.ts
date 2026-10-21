/* eslint-disable security/detect-non-literal-fs-filename -- Varre somente arquivos de código dentro de src deste checkout. */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Lista fechada: um novo recurso exige revisar o plugin, não um fallback visual
// silencioso. Tipos (ex.: SectorProps) não têm implementação para remover.
const PERMITIDOS = new Set([
  "Area",
  "AreaChart",
  "Bar",
  "BarChart",
  "CartesianGrid",
  "Cell",
  "ComposedChart",
  "Curve",
  "Label",
  "Line",
  "Pie",
  "PieChart",
  "ReferenceLine",
  "ResponsiveContainer",
  "Sector",
  "Tooltip",
  "XAxis",
  "YAxis",
]);

function violacoes(codigo: string, nome = "grafico.tsx"): string[] {
  const fonte = ts.createSourceFile(
    nome,
    codigo,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const erros: string[] = [];
  const componentes = new Map<string, string>();
  const erro = (mensagem: string) => erros.push(mensagem);

  function importar(no: ts.Node) {
    if (ts.isImportDeclaration(no) && ts.isStringLiteral(no.moduleSpecifier)) {
      const pacote = no.moduleSpecifier.text;
      if (pacote.startsWith("d3-") || pacote.startsWith("victory-vendor"))
        erro("escala direta");
      if (pacote === "recharts" || pacote.startsWith("recharts/")) {
        if (no.importClause?.isTypeOnly) return;
        const nomes = no.importClause?.namedBindings;
        if (
          pacote !== "recharts" ||
          no.importClause?.name ||
          !nomes ||
          !ts.isNamedImports(nomes)
        ) {
          erro("import não analisável");
        } else {
          for (const item of nomes.elements) {
            if (item.isTypeOnly) continue;
            const original = (item.propertyName ?? item.name).text;
            if (!PERMITIDOS.has(original)) erro(original);
            componentes.set(item.name.text, original);
          }
        }
      }
    }
    if (
      ts.isExportDeclaration(no) &&
      no.moduleSpecifier &&
      ts.isStringLiteral(no.moduleSpecifier) &&
      no.moduleSpecifier.text.startsWith("recharts")
    )
      erro("reexport");
    if (
      ts.isCallExpression(no) &&
      no.arguments.some(
        (a) =>
          ts.isStringLiteral(a) &&
          /^(recharts|d3-|victory-vendor)/.test(a.text),
      )
    )
      erro("import dinâmico");
    ts.forEachChild(no, importar);
  }
  importar(fonte);

  function visitar(no: ts.Node) {
    if (ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no)) {
      const componente = componentes.get(no.tagName.getText(fonte));
      if (componente) {
        const eixo = componente === "XAxis" || componente === "YAxis";
        const curva = ["Area", "Line", "Curve"].includes(componente);
        for (const prop of no.attributes.properties) {
          if (ts.isJsxSpreadAttribute(prop)) {
            // Não deixa uma propriedade futura escapar da análise por {...props}.
            if (eixo || curva) erro("spread no eixo/curva");
            continue;
          }
          const chave = prop.name.getText(fonte);
          if (eixo && ["scale", "range"].includes(chave)) erro(chave);
          if (curva && chave === "type") {
            const valor =
              prop.initializer && ts.isStringLiteral(prop.initializer)
                ? prop.initializer.text
                : prop.initializer &&
                    ts.isJsxExpression(prop.initializer) &&
                    prop.initializer.expression &&
                    ts.isStringLiteral(prop.initializer.expression)
                  ? prop.initializer.expression.text
                  : undefined;
            if (valor !== "monotone" && valor !== "linear") erro("curva");
          }
        }
      }
    }
    // Construção imperativa e acesso a tickFormat precisam de uma prova própria;
    // os três gráficos atuais usam JSX e tickFormatter do Recharts.
    if (
      ts.isCallExpression(no) &&
      no.arguments.some((a) => ts.isIdentifier(a) && componentes.has(a.text))
    )
      erro("construção imperativa");
    if (ts.isPropertyAccessExpression(no) && no.name.text === "tickFormat")
      erro("tickFormat");
    ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  return erros;
}

function arquivos(pasta: string): string[] {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    const arquivo = path.join(pasta, entrada.name);
    return entrada.isDirectory()
      ? arquivos(arquivo)
      : /\.[cm]?[jt]sx?$/.test(arquivo)
        ? [arquivo]
        : [];
  });
}

describe("contrato dos gráficos enxutos — guarda permanente", () => {
  it("nenhum gráfico pede implementação removida, outra curva, escala ou range", () => {
    const fontes = arquivos("src");
    expect(fontes.length).toBeGreaterThan(0);
    const erros = fontes.flatMap((arquivo) =>
      violacoes(fs.readFileSync(arquivo, "utf8"), arquivo).map(
        (erro) => `${arquivo}: ${erro}`,
      ),
    );
    expect(erros).toEqual([]);
  });

  it.each([
    "Brush",
    "Legend",
    "ErrorBar",
    "ReferenceArea",
    "ReferenceDot",
    "Symbols",
    "Trapezoid",
    "Scatter",
    "ScatterChart",
    "Funnel",
    "FunnelChart",
  ])("reprova novo uso de %s, mesmo com alias", (nome) => {
    expect(
      violacoes(
        `import { ${nome} as Novo } from "recharts"; const g = <Novo />;`,
      ),
    ).toContain(nome);
  });

  it.each([
    'import * as R from "recharts"; const g = <R.Brush />;',
    'import { Brush } from "recharts/es6/cartesian/Brush";',
    'export { Brush } from "recharts";',
    'const R = await import("recharts");',
    'const R = require("recharts");',
    'import { scaleLinear } from "d3-scale";',
  ])("reprova caminho que esconderia recursos da análise: %s", (codigo) => {
    expect(violacoes(codigo).length).toBeGreaterThan(0);
  });

  it.each([
    '<E scale="time" />',
    '<E range={["red", "blue"]} />',
    "<E {...props} />",
    '<L type="step" />',
    "<L type={tipo} />",
    "<L {...props} />",
  ])("reprova configuração incompatível: %s", (jsx) => {
    expect(
      violacoes(
        `import { XAxis as E, Line as L } from "recharts"; const g = ${jsx};`,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("aceita eixos padrão, as duas curvas e o Sector/Label da pizza", () => {
    expect(
      violacoes(
        'import { XAxis, Line, Area, Sector, Label } from "recharts"; const g = <><XAxis dataKey="dia" /><Line type="monotone" /><Area type={"linear"} /><Sector /><Label /></>;',
      ),
    ).toEqual([]);
  });
});
