// P66 (conta no computador), defeito D1: as abas "Perfil / Segurança" da conta
// ficavam com 23 px de altura (o desenho pede `h-11` = 44 px) de 1024 a 1920 px.
// Causa: no computador o `role="tablist"` vira coluna (`lg:flex-col`) e o
// `flex-1` de cada aba passa a mandar na ALTURA (flex-basis 0 numa coluna sem
// altura definida), zerando o `h-11`. A correção é só de computador: `lg:flex-none`
// em cada aba devolve a altura do `h-11`. Abaixo de 1024 px (linha, onde o
// `flex-1` reparte a LARGURA) o className fica byte a byte o de antes.
//
// O jsdom não calcula CSS: a altura de fato (44 px) está no relatório da peça,
// medida em Chromium. Aqui a prova é o código-fonte REAL lido por AST (a conta é
// uma tela pesada demais para montar só por causa de um token) e um mutante em
// CÓPIA dele, para a trava não ser decorativa.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const FONTE = readFileSync(
  "src/views/customer/AccountSettingsView.tsx",
  "utf8",
);

// Como cada pedaço do className da aba era no celular (congelado como literal).
const CELULAR_DA_ABA = [
  "flex h-11 flex-1 items-center justify-center rounded-[10px] text-[15px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-zinc-900/50",
  "bg-foreground text-background",
  "text-foreground/70 hover:text-foreground",
];
const ANCORA = "flex h-11 flex-1 items-center justify-center rounded-[10px]";

/** Pedaços de texto do `className` do elemento cujo literal contém a âncora. */
function pedacosDoClassName(fonte: string): string[][] {
  const arquivo = ts.createSourceFile(
    "peca.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: string[][] = [];
  const coletar = (no: ts.Node, partes: string[]) => {
    if (
      ts.isStringLiteral(no) ||
      ts.isNoSubstitutionTemplateLiteral(no) ||
      ts.isTemplateHead(no) ||
      ts.isTemplateMiddle(no) ||
      ts.isTemplateTail(no)
    )
      partes.push(no.text);
    else ts.forEachChild(no, (filho) => coletar(filho, partes));
  };
  const visitar = (no: ts.Node) => {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText(arquivo) === "className" &&
      no.initializer
    ) {
      const partes: string[] = [];
      coletar(no.initializer, partes);
      if (partes.some((parte) => parte.includes(ANCORA))) achados.push(partes);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return achados;
}

function problemas(fonte: string): string[] {
  const achados = pedacosDoClassName(fonte);
  if (achados.length !== 1) return [`achou ${achados.length} abas`];
  const partes = achados[0];
  const erros: string[] = [];
  const celular = partes.map(classesDoCelular).filter(Boolean);
  if (JSON.stringify(celular) !== JSON.stringify(CELULAR_DA_ABA))
    erros.push(`celular mudou: ${JSON.stringify(celular)}`);
  const tokens = partes[0].split(/\s+/);
  if (!tokens.includes("lg:flex-none")) erros.push("falta lg:flex-none");
  return erros;
}

describe("P66 D1 — abas da conta com altura de 44 px no computador", () => {
  it("o className da aba só ganha lg:flex-none; o de celular é o de antes", () => {
    expect(problemas(FONTE)).toEqual([]);
  });

  it("a aba continua dentro do tablist que vira coluna no computador", () => {
    // Se o tablist deixasse de ser coluna, o `lg:flex-none` perderia o motivo.
    expect(FONTE).toContain("lg:row-start-2 lg:flex-col lg:self-start");
  });

  it("mutante: sem lg:flex-none a trava fica vermelha", () => {
    const mutante = FONTE.replace(" lg:flex-none ${", " ${");
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante)).toContain("falta lg:flex-none");
  });

  it("mutante: mexer no literal de celular também fica vermelho", () => {
    const mutante = FONTE.replace(
      "flex h-11 flex-1 items-center",
      "flex h-10 flex-1 items-center",
    );
    expect(problemas(mutante).join()).toMatch(/celular mudou|achou 0/);
  });
});
