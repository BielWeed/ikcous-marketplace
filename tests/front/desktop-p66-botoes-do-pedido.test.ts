// P66 (pedido no computador), defeito D3: o botão "Retomar pagamento" esticava
// a largura da coluna inteira (1328 px a 1920), com o texto no meio de um
// botão sem fim. A correção é só de computador: `lg:max-w-md` (448 px) nele.
// "Cancelar Pedido" NÃO é botão solto: é uma linha de lista que ocupa o cartão
// inteiro com a setinha na ponta; limitá-la deixava a seta no meio do cartão
// (visto em captura a 1280 px), então ela fica como estava. É a tela de
// pagamento pendente: só classe, a ordem, o texto e os handlers não mudam, e
// abaixo de 1024 px o className fica byte a byte o de antes.
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
    limita: true,
  },
  {
    nome: "Cancelar Pedido",
    celular:
      "flex w-full items-center gap-3 border-b border-zinc-100 px-5 py-3.5 text-left text-sm font-semibold text-red-600 transition-colors last:border-b-0 hover:bg-red-50 active:bg-red-100 disabled:opacity-50",
    onClick: "handleCancelOrder",
    texto: '{isCancelling ? "Processando" : "Cancelar Pedido"}',
    limita: false,
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
  const tem = classe.split(/\s+/).includes("lg:max-w-md");
  if (botao.limita && !tem) erros.push("falta lg:max-w-md");
  // A linha Cancelar Pedido não ganha NENHUMA classe de computador: qualquer
  // `lg:max-w-*`, `xl:max-w-*` ou `lg:w-*` a estreitaria como o `lg:max-w-md`.
  if (!botao.limita && classe !== botao.celular)
    erros.push("lg:max-w-md onde a linha deve ocupar o cartão");
  if (onClick !== botao.onClick) erros.push(`handler mudou: ${onClick}`);
  if (!filhos.includes(botao.texto)) erros.push("texto mudou");
  return erros;
}

describe("P66 D3 — Retomar pagamento com 448 px no computador; Cancelar Pedido segue largo", () => {
  for (const botao of BOTOES) {
    it(`${botao.nome}: ${botao.limita ? "ganha lg:max-w-md" : "não ganha lg:max-w-md"} e o resto fica como estava`, () => {
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
    for (const botao of BOTOES.filter((b) => b.limita)) {
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

  it("mutante: pôr lg:max-w-md na linha Cancelar Pedido fica vermelho", () => {
    const cancelar = BOTOES[1];
    const mutante = FONTE.replace(
      cancelar.celular,
      `${cancelar.celular} lg:max-w-md`,
    );
    expect(mutante).not.toBe(FONTE);
    expect(problemas(mutante, cancelar)).toContain(
      "lg:max-w-md onde a linha deve ocupar o cartão",
    );
  });
});
