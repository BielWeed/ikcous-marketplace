import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * O reset global de src/index.css (`button { border: none }`) deixa
 * `border-style: none` em todo <button>. A classe Tailwind `border` so define
 * a ESPESSURA, entao um botao com `border` e sem `border-solid` fica sem
 * contorno nenhum. Nas telas Tinta o contorno fino e parte do estilo.
 *
 * A varredura usa o AST do TypeScript: para cada <button> e <Button> pega a
 * className (literal, template, ternario, cn(...)) e resolve identificadores
 * que apontam para constantes de string do mesmo arquivo.
 */

const ARQUIVOS = [
  "src/components/ui/custom/AddressForm.tsx",
  "src/views/customer/AddressFormView.tsx",
  "src/components/ui/custom/FileirasDeVariacao.tsx",
  "src/components/account/PrivacidadeEMeusDados.tsx",
  "src/views/customer/AccountSettingsView.tsx",
  "src/views/customer/AboutStoreView.tsx",
  "src/views/customer/NotificationsView.tsx",
  "src/views/admin/AdminNotificationsView.tsx",
];

// `border`, `border-2`, `border-t`, `border-x-4`, com variantes (hover:, md:)
// inclui largura arbitraria (`border-[1.5px]`); `border-[#fff]` e cor, nao entra
// eslint-disable-next-line security/detect-unsafe-regex -- regex curta aplicada a classes Tailwind deste repositorio, sem entrada externa.
const ESPESSURA = /^!?border(?:-[xytblrse])?(?:-\d+|-\[\d[\d.]*[a-z]*\])?$/;
const ESTILO = /^!?border-(?:solid|dashed|dotted|double)$/;
// tira as variantes (hover:, md:, dark:) e fica com a classe pura
const semVariante = (t: string) => t.slice(t.lastIndexOf(":") + 1);

// Fora do lote visual: botao "Remover" do dialogo de capa (tela antiga, nunca
// aprovada no estilo Tinta). Ligar o contorno la mudaria uma tela fora do pedido.
const IGNORADOS = [
  "text-red-500 shadow-none transition-all hover:border-red-500/30",
];

function classesDoBotao(
  fonte: string,
  nome = "arquivo.tsx",
): { linha: number; classes: string }[] {
  const sf = ts.createSourceFile(
    nome,
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const constantes = new Map<string, ts.Expression>();
  const coletar = (n: ts.Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer
    ) {
      constantes.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, coletar);
  };
  coletar(sf);

  const textoDe = (n: ts.Node, visto: Set<string>): string => {
    if (ts.isStringLiteralLike(n)) return `${n.text} `;
    if (ts.isTemplateExpression(n)) {
      const spans = n.templateSpans
        .map((s) => `${textoDe(s.expression, visto)}${s.literal.text} `)
        .join("");
      return `${n.head.text} ${spans}`;
    }
    if (ts.isIdentifier(n)) {
      const alvo = constantes.get(n.text);
      if (alvo && !visto.has(n.text)) {
        return textoDe(alvo, new Set(visto).add(n.text));
      }
      return "";
    }
    let acc = "";
    ts.forEachChild(n, (c) => {
      acc += textoDe(c, visto);
    });
    return acc;
  };

  const achados: { linha: number; classes: string }[] = [];
  const visitar = (n: ts.Node) => {
    const abertura = ts.isJsxElement(n)
      ? n.openingElement
      : ts.isJsxSelfClosingElement(n)
        ? n
        : null;
    if (abertura && ["button", "Button"].includes(abertura.tagName.getText())) {
      for (const p of abertura.attributes.properties) {
        if (
          ts.isJsxAttribute(p) &&
          p.name.getText() === "className" &&
          p.initializer
        ) {
          // <Button variant="outline"> traz `border` da variante: conta como espessura
          const outline = abertura.attributes.properties.some(
            (a) =>
              ts.isJsxAttribute(a) &&
              a.name.getText() === "variant" &&
              a.initializer?.getText().includes("outline"),
          );
          achados.push({
            linha:
              sf.getLineAndCharacterOfPosition(abertura.getStart()).line + 1,
            classes: `${outline ? "border " : ""}${textoDe(p.initializer, new Set())}`,
          });
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return achados;
}

function semBorderSolid(classes: string): boolean {
  const toks = classes.split(/\s+/).filter(Boolean);
  return (
    toks.some((t) => ESPESSURA.test(semVariante(t))) &&
    !toks.some((t) => ESTILO.test(semVariante(t)))
  );
}

describe("botoes das telas Tinta: border precisa de border-solid", () => {
  it("controle: o detector distingue com e sem border-solid", () => {
    const ruim = `const X = "rounded border px-2"; export const A = () => <button className={\`flex \${X}\`} />;`;
    const bom = `const X = "rounded border border-solid px-2"; export const A = () => <button className={\`flex \${X}\`} />;`;
    const semBorda = `export const A = () => <button className="rounded px-2 border-transparent" />;`;
    const maiuscula = `export const A = () => <Button className={cn("border-t border-border", on && "x")} />;`;
    expect(classesDoBotao(ruim).map((a) => semBorderSolid(a.classes))).toEqual([
      true,
    ]);
    expect(classesDoBotao(bom).map((a) => semBorderSolid(a.classes))).toEqual([
      false,
    ]);
    expect(
      classesDoBotao(semBorda).map((a) => semBorderSolid(a.classes)),
    ).toEqual([false]);
    expect(
      classesDoBotao(maiuscula).map((a) => semBorderSolid(a.classes)),
    ).toEqual([true]);
  });

  for (const arquivo of ARQUIVOS) {
    it(`${arquivo}: nenhum botao com espessura de borda sem estilo`, () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminhos fixos da lista ARQUIVOS acima.
      const fonte = readFileSync(resolve(process.cwd(), arquivo), "utf8");
      const ruins = classesDoBotao(fonte, arquivo)
        .filter(
          (a) =>
            semBorderSolid(a.classes) &&
            !IGNORADOS.some((i) => a.classes.includes(i)),
        )
        .map((a) => `linha ${a.linha}: ${a.classes.trim().slice(0, 90)}`);
      expect(ruins).toEqual([]);
    });
  }
});
