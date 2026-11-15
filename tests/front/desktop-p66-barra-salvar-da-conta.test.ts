// P66 (conta no computador), defeito D4: a barra "Salvar alterações" da conta
// tem `border-t` (a linha que separa a barra do conteúdo no celular, colada na
// navegação inferior) e, no computador, ganha `lg:rounded-3xl`. As duas juntas
// desenham um ARCO só no topo, que no computador não separa nada. A correção é
// só de computador: `lg:border-0`. Abaixo de 1024 px o className fica byte a
// byte o de antes.
//
// O jsdom não calcula CSS: que o arco some e que nada mais se mexe está no
// relatório da peça, medido em Chromium. Aqui a prova é o código-fonte REAL
// lido por AST (a conta é pesada demais para montar só por causa de um token) e
// mutantes em CÓPIA dele, para a trava não ser decorativa.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const FONTE = readFileSync(
  "src/views/customer/AccountSettingsView.tsx",
  "utf8",
);

const CELULAR_DA_BARRA =
  "bottom-docked-navigation sticky z-20 -mx-4 border-t border-border bg-background/95 px-4 pb-2.5 pt-3 backdrop-blur sm:-mx-6 sm:px-6 md:bottom-[104px]";
const ANCORA = "bottom-docked-navigation sticky z-20 -mx-4 border-t";

/** className (literal) de cada elemento cuja classe contém a âncora. */
function classesDaBarra(fonte: string): string[] {
  const arquivo = ts.createSourceFile(
    "peca.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: string[] = [];
  const visitar = (no: ts.Node) => {
    if (
      ts.isJsxAttribute(no) &&
      no.name.getText(arquivo) === "className" &&
      no.initializer &&
      ts.isStringLiteral(no.initializer) &&
      no.initializer.text.includes(ANCORA)
    )
      achados.push(no.initializer.text);
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return achados;
}

function problemas(fonte: string): string[] {
  const achados = classesDaBarra(fonte);
  if (achados.length !== 1) return [`achou ${achados.length} barras`];
  const [classe] = achados;
  const erros: string[] = [];
  if (classesDoCelular(classe) !== CELULAR_DA_BARRA)
    erros.push(`celular mudou: ${classesDoCelular(classe)}`);
  const tokens = classe.split(/\s+/);
  if (!tokens.includes("lg:border-0")) erros.push("falta lg:border-0");
  // A barra segue arredondada no computador; só a linha de cima sai.
  if (!tokens.includes("lg:rounded-3xl")) erros.push("perdeu lg:rounded-3xl");
  return erros;
}

describe("P66 D4 — barra Salvar alterações sem arco só no topo no computador", () => {
  it("a barra só ganha lg:border-0; o de celular é o de antes", () => {
    expect(problemas(FONTE)).toEqual([]);
  });

  it("mutante: sem lg:border-0 a trava fica vermelha", () => {
    const mutante = FONTE.replace(" lg:border-0", "");
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante)).toContain("falta lg:border-0");
  });

  it("mutante: mexer no literal de celular também fica vermelho", () => {
    const mutante = FONTE.replace("z-20 -mx-4 border-t", "z-20 -mx-4 border-b");
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante)).toEqual(["achou 0 barras"]);
  });
});
