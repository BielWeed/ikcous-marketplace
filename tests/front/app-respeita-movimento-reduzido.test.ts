// Quem ativa "Reduzir movimento" no aparelho não pode ver o carrinho (alternar
// Carrinho/Meus pedidos) nem a barra de finalização do checkout deslizarem.
// O Framer só obedece à preferência dentro de um `MotionConfig`. Ele NÃO vai na
// raiz (`main.tsx`): o Framer é carregado sob demanda e a abertura não pode
// puxá-lo (`perf-entrada-sem-animacao-no-1o-paint`). Por isso cada tela de
// entrada o carrega por conta própria — e é isto que se prende aqui.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it.each([
  [
    "CartView",
    "ConteudoDoCarrinho",
    readFileSync("src/views/customer/CartView.tsx", "utf8"),
  ],
  [
    "CheckoutView",
    "CheckoutViewDaConta",
    readFileSync("src/views/customer/CheckoutView.tsx", "utf8"),
  ],
])(
  "%s envolve a tela em MotionConfig com a preferência do aparelho",
  (tela, conteudo, fonte) => {
    const arquivo = ts.createSourceFile(
      `${tela}.tsx`,
      fonte,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const entrada = arquivo.statements.find(
      (no): no is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(no) && no.name?.text === tela,
    );
    expect(entrada).toBeDefined();
    const configuracoes: ts.JsxElement[] = [];
    const visitar = (no: ts.Node) => {
      if (
        ts.isJsxElement(no) &&
        no.openingElement.tagName.getText(arquivo) === "MotionConfig"
      )
        configuracoes.push(no);
      ts.forEachChild(no, visitar);
    };
    visitar(entrada as ts.FunctionDeclaration);
    expect(configuracoes).toHaveLength(1);
    const configuracao = configuracoes[0];
    expect(configuracao.openingElement.attributes.getText(arquivo)).toMatch(
      /reducedMotion="user"/,
    );
    expect(configuracao.getText(arquivo)).toContain(`<${conteudo}`);
    expect(fonte).toMatch(
      /import\s*\{[^}]*MotionConfig[^}]*\}\s*from\s*["']framer-motion["']/,
    );
  },
);
