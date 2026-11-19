import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import postcss from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const caminho = "src/components/admin/financeiro/AbaCaixa.tsx";
const fonte = readFileSync(
  "src/components/admin/financeiro/AbaCaixa.tsx",
  "utf8",
);
const arvore = ts.createSourceFile(
  caminho,
  fonte,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

// Base f04669a6a: só os inicializadores de className, não a fonte inteira.
const classesDaBase = [
  "{CLASSE_BOTAO_DA_GAVETA}",
  '{cn(CLASSE_CARTAO_DO_CAIXA, "flex flex-col gap-5")}',
  '"flex flex-col items-start gap-2"',
  '"flex w-full items-center justify-between gap-3"',
  "{CLASSE_ROTULO_CAIXA_ALTA}",
  '{cn( classeDoValorDoHeroi(caixa.esperado, ocultos), esperadoNegativo ? classeDoTexto("negativo") : "text-white")}',
  // Linha da última conferência e botão de releitura.
  '"flex flex-wrap items-center gap-x-3"',
  '"text-xs text-zinc-400"',
  "{CLASSE_BOTAO_DA_GAVETA}",
  '{cn("text-xs", classeDoTexto("atencao"))}',
  '"break-words text-sm text-zinc-400"',
  '"grid grid-cols-2 gap-2.5"',
  "{CLASSE_BOTAO_DA_GAVETA}",
  "{CLASSE_BOTAO_DA_GAVETA}",
  '{cn( CLASSE_BOTAO_PRINCIPAL_DA_GAVETA, !aoNovoLancamento && "col-span-2")}',
  '"text-xs text-zinc-400"',
  '"flex flex-col"',
  '"flex min-h-14 items-start justify-between gap-3 border-t border-admin-border py-3 first:border-t-0 first:pt-0"',
  '"min-w-0"',
  '"break-words text-sm text-white"',
  '"mt-0.5 text-xs text-zinc-400"',
  '{cn( classeDoValorDaLinha(movimento.valor, true, ocultos), classeDoTexto(entrada ? "positivo" : "negativo"))}',
  '{cn(CLASSE_CARTAO_DO_CAIXA, "flex flex-col gap-5")}',
  '"flex flex-col items-start gap-2"',
  '"flex w-full items-center justify-between gap-3"',
  "{CLASSE_ROTULO_CAIXA_ALTA}",
  '"text-2xl font-bold leading-tight text-white"',
  '"max-w-md text-sm leading-relaxed text-zinc-400"',
  '"grid grid-cols-2 gap-2.5"',
  '{cn( CLASSE_BOTAO_PRINCIPAL_DA_GAVETA, !aoNovoLancamento && "col-span-2")}',
  '"flex flex-col gap-4"',
  '"sr-only"',
  '"h-52 rounded-3xl bg-white/5"',
  '"h-64 rounded-3xl bg-white/5"',
  '"min-w-0"',
  '"text-xs text-zinc-400"',
  '{cn("mt-1", className)}',
  '"flex flex-col gap-3 border-t border-admin-border py-4 first:border-t-0 first:pt-0 last:pb-0"',
  '"flex items-center justify-between gap-2"',
  '"min-w-0 break-words text-sm font-medium text-white"',
  '"whitespace-nowrap"',
  '"whitespace-nowrap"',
  '"-mt-2 break-words text-xs text-zinc-400"',
  '"grid grid-cols-3 gap-2"',
  '{ sessao.esperado === null ? "text-base font-bold text-white" : cn( classeDoValorNaColuna(sessao.esperado, false, ocultos), "text-white") }',
  '"whitespace-nowrap"',
  '{ sessao.contado === null ? "text-base font-bold text-white" : cn( classeDoValorNaColuna(sessao.contado, false, ocultos), "text-white") }',
  '"whitespace-nowrap"',
  '{cn( diferenca === null ? "text-base font-bold" : classeDoValorNaColuna(diferenca, true, ocultos), classeDoTexto(tomDaDiferenca))}',
  '"whitespace-nowrap"',
  '"flex flex-col gap-4"',
  "{`${CLASSE_BOTAO_PRIMARIO} admin-barra-principal w-full`}",
  '"size-5"',
  '"text-xs text-zinc-400"',
  '"flex flex-col"',
];

function classesSemComputador(no: ts.SourceFile): string[] {
  const classes: string[] = [];
  function visitar(atual: ts.Node) {
    if (ts.isJsxAttribute(atual) && atual.name.getText() === "className") {
      classes.push(
        (atual.initializer?.getText(no) ?? "")
          .replace(/\s*\b(?:lg|xl|2xl):[^\s"'`]+/g, "")
          .replace(/\s+/g, " ")
          .replace(/,\s*\)/g, ")"),
      );
    }
    ts.forEachChild(atual, visitar);
  }
  visitar(no);
  return classes;
}

function retornoDe(nome: string) {
  const declaracao = arvore.statements.find(
    (no): no is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(no) && no.name?.text === nome,
  );
  const retorno = declaracao?.body?.statements.find(ts.isReturnStatement);
  if (!retorno?.expression) throw new Error(`Sem retorno de ${nome}`);
  return retorno.expression;
}

function filhosPossiveis(no: ts.Node): string[] {
  if (ts.isParenthesizedExpression(no)) return filhosPossiveis(no.expression);
  if (ts.isJsxExpression(no)) {
    return no.expression ? filhosPossiveis(no.expression) : [];
  }
  if (ts.isConditionalExpression(no)) {
    return [...filhosPossiveis(no.whenTrue), ...filhosPossiveis(no.whenFalse)];
  }
  if (ts.isJsxFragment(no)) return no.children.flatMap(filhosPossiveis);
  // Componentes auto-fechados também são filhos da grade (erros e skeleton).
  if (ts.isJsxElement(no) || ts.isJsxSelfClosingElement(no)) {
    const abertura = ts.isJsxElement(no) ? no.openingElement : no;
    const nome = abertura.tagName.getText(arvore);
    if (nome === "CaixaAberto" || nome === "CaixaFechado") {
      return filhosPossiveis(retornoDe(nome));
    }
    const identificador = abertura.attributes.properties.find(
      (atributo) =>
        ts.isJsxAttribute(atributo) &&
        ["id", "data-estado-do-caixa", "titulo"].includes(
          atributo.name.getText(),
        ),
    );
    const valor =
      identificador &&
      ts.isJsxAttribute(identificador) &&
      identificador.initializer &&
      ts.isStringLiteral(identificador.initializer)
        ? identificador.initializer.text
        : null;
    return [valor ? `${nome}:${valor}` : nome];
  }
  return [];
}

const retorno = retornoDe("AbaCaixa");
if (
  !ts.isParenthesizedExpression(retorno) ||
  !ts.isJsxElement(retorno.expression)
) {
  throw new Error("Raiz da aba Caixa não encontrada");
}
const raiz = retorno.expression;
const atributo = raiz.openingElement.attributes.properties.find(
  (no) => ts.isJsxAttribute(no) && no.name.getText() === "className",
);
const grade =
  atributo &&
  ts.isJsxAttribute(atributo) &&
  atributo.initializer &&
  ts.isStringLiteral(atributo.initializer)
    ? atributo.initializer.text
    : "";

function conferirGrade(valor: string) {
  expect(valor.split(/\s+/)).toEqual(
    expect.arrayContaining([
      "xl:grid",
      "xl:grid-cols-2",
      "xl:items-start",
      "xl:gap-6",
      "xl:[&>*]:col-span-2",
      "xl:[&>[data-estado-do-caixa=aberto]]:col-span-1",
      "xl:[&>#fin-composicao-do-caixa]:col-span-1",
    ]),
  );
  expect(valor).not.toMatch(/(?:^|\s)lg:grid/);
  expect(valor).not.toMatch(/(?:sticky|overflow-hidden|order-|dense)/);
}

function conferirEstados(valor: string) {
  expect(valor).toContain("xl:[&>*]:col-span-2");
  expect(valor.match(/xl:\S+:col-span-1/g)?.sort()).toEqual([
    "xl:[&>#fin-composicao-do-caixa]:col-span-1",
    "xl:[&>[data-estado-do-caixa=aberto]]:col-span-1",
  ]);
}

// Mutantes em memória usam as MESMAS provas sobre literais reais; nunca
// executam ações financeiras nem deixam a árvore de trabalho adulterada.
describe("P23 — Caixa no computador", () => {
  it("preserva todos os className de celular e tablet da base", () => {
    expect(classesSemComputador(arvore)).toEqual(classesDaBase);
    const mutante = fonte.replace("flex flex-col gap-5", "flex flex-col gap-6");
    const arvoreMutante = ts.createSourceFile(
      caminho,
      mutante,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    expect(classesSemComputador(arvoreMutante)).not.toEqual(classesDaBase);
  });

  it("só divide em xl, sem fixar ou cortar as ações do caixa", () => {
    conferirGrade(grade);
    expect(() => conferirGrade(grade.replace("xl:grid-cols-2", ""))).toThrow();
  });

  it("enumera todos os filhos e deixa qualquer bloco isolado em largura inteira", () => {
    expect(raiz.children.flatMap(filhosPossiveis)).toEqual([
      "EstadoDeErro",
      "EsqueletoDoCaixa",
      "EstadoDeErro",
      "section:aberto",
      "CartaoSecao:fin-composicao-do-caixa",
      "CartaoSecao:Movimentos desta sessão",
      "section:fechado",
      "AcaoDaBarra",
      "CartaoSecao:Histórico do caixa",
    ]);
    conferirEstados(grade);
    expect(() =>
      conferirEstados(grade.replace("xl:[&>*]:col-span-2", "")),
    ).toThrow();
  });

  it("gera CSS real em xl para as colunas e para cada estado de largura inteira", async () => {
    const exigir = createRequire(import.meta.url);
    const tailwind = exigir("tailwindcss");
    const resultado = await postcss([
      tailwind({
        content: [{ raw: `<div class="${grade}"></div>`, extension: "html" }],
        corePlugins: { preflight: false },
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const declaracoes: string[] = [];
    resultado.root.walkAtRules("media", (media) => {
      expect(media.params).toBe("(min-width: 1280px)");
      media.walkDecls((declaracao) => {
        declaracoes.push(`${declaracao.prop}: ${declaracao.value}`);
      });
    });
    expect(declaracoes).toEqual([
      "display: grid",
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
      "align-items: flex-start",
      "gap: 1.5rem",
      "grid-column: span 1 / span 1",
      "grid-column: span 2 / span 2",
      "grid-column: span 1 / span 1",
    ]);
  });
});
