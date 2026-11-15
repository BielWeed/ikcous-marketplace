// P66 (pedido no computador), defeito D3: "Retomar pagamento" e "Cancelar
// Pedido" esticavam a largura da coluna inteira (1328x48 e 1326x60 a 1920 px),
// com o texto numa ponta e o botão sem fim. A correção é só de computador:
// `lg:max-w-md` (448 px) nos dois. É a tela de pagamento pendente: só classe, a
// ordem, o texto e os handlers não mudam, e abaixo de 1024 px o className fica
// byte a byte o de antes.
//
// O jsdom não calcula CSS: as larguras de fato (448 px) estão no relatório da
// peça, medidas em Chromium. Aqui a prova é o código-fonte REAL lido por AST (o
// detalhe do pedido é pesado demais para montar só por causa de um token), os
// handlers conferidos como texto, e mutantes em CÓPIA dele, para a trava não
// ser decorativa.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const FONTE = readFileSync("src/views/customer/OrderDetailsView.tsx", "utf8");

const BOTOES = [
  {
    nome: "Retomar pagamento",
    celular:
      "mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition-all active:scale-95",
    onClick: "() => onRetomarPagamento(order.id)",
    texto: "Retomar pagamento",
  },
  {
    nome: "Cancelar Pedido",
    celular:
      "flex w-full items-center gap-3 border-b border-zinc-100 px-5 py-3.5 text-left text-sm font-semibold text-red-600 transition-colors last:border-b-0 hover:bg-red-50 active:bg-red-100 disabled:opacity-50",
    onClick: "handleCancelOrder",
    texto: '{isCancelling ? "Processando" : "Cancelar Pedido"}',
  },
] as const;

/** Acha o `<button>` cujo className de celular é o literal; devolve o className, o onClick e o texto. */
function achar(fonte: string, celular: string) {
  const arquivo = ts.createSourceFile(
    "peca.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: { classe: string; onClick: string; filhos: string }[] = [];
  const visitar = (no: ts.Node) => {
    if (
      ts.isJsxElement(no) &&
      no.openingElement.tagName.getText(arquivo) === "button"
    ) {
      const atributo = (nome: string) =>
        no.openingElement.attributes.properties.find(
          (a): a is ts.JsxAttribute =>
            ts.isJsxAttribute(a) && a.name.getText(arquivo) === nome,
        )?.initializer;
      const classe = atributo("className");
      if (
        classe &&
        ts.isStringLiteral(classe) &&
        classesDoCelular(classe.text) === celular
      ) {
        const onClick = atributo("onClick");
        achados.push({
          classe: classe.text,
          onClick:
            onClick && ts.isJsxExpression(onClick) && onClick.expression
              ? onClick.expression.getText(arquivo)
              : "",
          filhos: no.children.map((f) => f.getText(arquivo)).join(""),
        });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);
  return achados;
}

function problemas(fonte: string, botao: (typeof BOTOES)[number]): string[] {
  const achados = achar(fonte, botao.celular);
  if (achados.length !== 1) return [`achou ${achados.length} botões`];
  const [{ classe, onClick, filhos }] = achados;
  const erros: string[] = [];
  if (!classe.split(/\s+/).includes("lg:max-w-md"))
    erros.push("falta lg:max-w-md");
  if (onClick !== botao.onClick) erros.push(`handler mudou: ${onClick}`);
  if (!filhos.includes(botao.texto)) erros.push("texto mudou");
  return erros;
}

describe("P66 D3 — botões do pedido com 448 px no computador", () => {
  for (const botao of BOTOES) {
    it(`${botao.nome}: ganha lg:max-w-md e o resto fica como estava`, () => {
      expect(problemas(FONTE, botao)).toEqual([]);
    });

    it(`${botao.nome}: mutante no literal de celular fica vermelho`, () => {
      const mutante = FONTE.replace(
        botao.celular,
        botao.celular.replace("w-full", "w-1/2"),
      );
      expect(mutante).not.toBe(FONTE);
      expect(problemas(mutante, botao)).toEqual(["achou 0 botões"]);
    });
  }

  it("cada mutante de lg:max-w-md derruba o botão certo", () => {
    for (const botao of BOTOES) {
      // Tira a classe só do botão alvo: troca o literal dele pelo de celular puro.
      const mutante = FONTE.replace(
        `${botao.celular} lg:max-w-md`,
        botao.celular,
      );
      expect(mutante).not.toBe(FONTE);
      expect(problemas(mutante, botao)).toContain("falta lg:max-w-md");
      for (const outro of BOTOES.filter((b) => b !== botao))
        expect(problemas(mutante, outro)).toEqual([]);
    }
  });
});
