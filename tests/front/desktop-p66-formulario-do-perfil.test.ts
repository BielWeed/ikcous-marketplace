// P66 (conta no computador), defeito D2: o formulário "Perfil" da conta
// (`#form-perfil`) ocupava a coluna inteira ao lado das abas, e os campos
// ficavam gigantes (806 px a 1280 de largura, 966 px a 1920). A correção é só
// de computador: `lg:max-w-lg` no formulário limita os campos a 512 px. Abaixo
// de 1024 px o className fica byte a byte o de antes (`space-y-4`).
//
// O jsdom não calcula CSS: a largura dos campos (512 px) está no relatório da
// peça, medida em Chromium. Aqui a prova é o código-fonte REAL lido por AST (a
// conta é uma tela pesada demais para montar só por causa de um token) e um
// mutante em CÓPIA dele, para a trava não ser decorativa.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const FONTE = readFileSync(
  "src/views/customer/AccountSettingsView.tsx",
  "utf8",
);

const CELULAR_DO_FORMULARIO = "space-y-4";

/** className (texto) do `<form id="form-perfil">`, ou `null` se não achar um só. */
function classeDoFormulario(fonte: string): string | null {
  const arquivo = ts.createSourceFile(
    "peca.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: string[] = [];
  const visitar = (no: ts.Node) => {
    if (ts.isJsxOpeningElement(no) && no.tagName.getText(arquivo) === "form") {
      const atributo = (nome: string) =>
        no.attributes.properties.find(
          (a): a is ts.JsxAttribute =>
            ts.isJsxAttribute(a) && a.name.getText(arquivo) === nome,
        )?.initializer;
      const id = atributo("id");
      const classe = atributo("className");
      if (
        id &&
        ts.isStringLiteral(id) &&
        id.text === "form-perfil" &&
        classe &&
        ts.isStringLiteral(classe)
      )
        achados.push(classe.text);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return achados.length === 1 ? achados[0] : null;
}

function problemas(fonte: string): string[] {
  const classe = classeDoFormulario(fonte);
  if (classe === null) return ["não achou o form-perfil com className literal"];
  const erros: string[] = [];
  if (classesDoCelular(classe) !== CELULAR_DO_FORMULARIO)
    erros.push(`celular mudou: ${classesDoCelular(classe)}`);
  if (!classe.split(/\s+/).includes("lg:max-w-lg"))
    erros.push("falta lg:max-w-lg");
  return erros;
}

describe("P66 D2 — formulário do perfil com campos de 512 px no computador", () => {
  it("o className do formulário só ganha lg:max-w-lg; o de celular é o de antes", () => {
    expect(problemas(FONTE)).toEqual([]);
  });

  it("mutante: sem lg:max-w-lg a trava fica vermelha", () => {
    const mutante = FONTE.replace("space-y-4 lg:max-w-lg", "space-y-4");
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante)).toContain("falta lg:max-w-lg");
  });

  it("mutante: mexer no literal de celular também fica vermelho", () => {
    const mutante = FONTE.replace(
      'id="form-perfil"\n                  noValidate\n                  className="space-y-4',
      'id="form-perfil"\n                  noValidate\n                  className="space-y-3',
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante).join()).toContain("celular mudou");
  });
});
