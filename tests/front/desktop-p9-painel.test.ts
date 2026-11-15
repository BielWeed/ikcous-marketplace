import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const arquivos = [
  "src/views/admin/AdminFreeShippingCardView.tsx",
  "src/views/admin/AdminAppColorView.tsx",
  "src/views/admin/AdminBannersView.tsx",
  "src/components/admin/categorias/GerenciarCategorias.tsx",
];

function ler(caminho: string) {
  // Caminhos vêm apenas da lista literal de fontes acima, nunca de entrada externa.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(caminho, "utf8");
}

describe("P9 — painel no computador", () => {
  it.each(arquivos)("%s preserva todas as classes do celular", (caminho) => {
    const fonte = ts.createSourceFile(
      caminho,
      ler(caminho),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const classes: string[] = [];
    function visitar(no: ts.Node) {
      if (ts.isJsxAttribute(no) && no.name.getText(fonte) === "className") {
        const celular = classesDoCelular(
          (no.initializer?.getText(fonte) ?? "").replace(
            /\s*\b(?:lg|xl|2xl):[^\s"'` }]+/g,
            "",
          ),
        ).replace(/\{`\$\{(\w+)\}\s*`\}/g, "{$1}");
        if (celular !== '""') classes.push(celular);
      }
      ts.forEachChild(no, visitar);
    }
    visitar(fonte);
    expect(classes).toMatchSnapshot();
  });

  it("frete usa duas colunas apenas no computador", () => {
    const fonte = ler(arquivos[0]);
    expect(fonte).toContain("text-zinc-50 xl:max-w-4xl");
    expect(fonte).not.toMatch(/\blg:/);
    expect(fonte).toContain(
      'className="space-y-3 xl:grid xl:grid-cols-2 xl:items-start xl:gap-4 xl:space-y-0"',
    );
  });

  it("cores coloca escolha e prévia lado a lado e mensagens/ações em largura inteira", () => {
    const fonte = ler(arquivos[1]);
    expect(fonte).toContain(
      "xl:grid xl:max-w-5xl xl:grid-cols-2 xl:items-start xl:gap-5 xl:space-y-0",
    );
    expect(fonte).not.toMatch(/\blg:/);
    expect(fonte).toContain('<header className="xl:col-span-2">');
    expect(fonte).toContain("className={`${CARTAO} xl:col-span-2`}");
    expect(fonte).toContain("text-xs leading-relaxed xl:col-span-2");
    expect(fonte.match(/className={CARTAO} aria-/g)).toHaveLength(2);
    expect(
      fonte.match(/h-12 w-full rounded-2xl bg-foreground[^"\n]*xl:col-span-2/g),
    ).toHaveLength(3);
    expect(
      fonte.match(
        /\$\{ACAO\} w-full border-admin-border-strong bg-admin-bg text-zinc-50 xl:col-span-2/g,
      ),
    ).toHaveLength(2);
    expect(
      fonte.match(/<p role="alert" className="xl:col-span-2">/g),
    ).toHaveLength(2);
  });

  it("banners só usa duas colunas em 2xl, sem alterar o editor", () => {
    const fonte = ler(arquivos[2]);
    expect(fonte).not.toMatch(/Reorder\.Group|axis="y"/);
    expect(fonte).toContain("sm:p-6 lg:max-w-7xl");
    expect(fonte).toContain(
      'className="space-y-3 2xl:grid 2xl:grid-cols-2 2xl:items-start 2xl:gap-4 2xl:space-y-0"',
    );
    expect(fonte).toContain("uppercase tracking-wider 2xl:col-span-2");
    expect(fonte).toMatch(
      /<p className="[^"]*2xl:col-span-2">\s*Nenhum banner com este filtro/,
    );
    expect(fonte).toMatch(
      /className="min-h-11 w-full border-admin-border bg-admin-surface text-white 2xl:col-span-2"[\s\S]*?Adicionar Primeiro Banner/,
    );
  });

  it.each([
    [1024, 1, 720, 418],
    [1280, 1, 976, 610],
    [1536, 2, 608, 242],
    [1920, 2, 608, 242],
  ])(
    "banners em %i px deixa texto útil no detalhado",
    (janela, colunasEsperadas, cartaoEsperado, textoEsperado) => {
      const fonte = ler(arquivos[2]);
      const grade =
        fonte.match(/key={pos.value}\s+className="([^"]+)"/)?.[1] ?? "";
      const breakpoints = new Map([
        ["lg", 1024],
        ["xl", 1280],
        ["2xl", 1536],
      ]);
      let colunas = 1;
      for (const token of grade.matchAll(
        /(?:^|\s)(lg|xl|2xl):grid-cols-(\d+)/g,
      )) {
        if (janela >= (breakpoints.get(token[1]) ?? Number.POSITIVE_INFINITY)) {
          colunas = Number(token[2]);
        }
      }
      // As constantes abaixo conferem os limites reais, não só uma conta idealizada.
      expect(fonte).toContain("sm:p-6 lg:max-w-7xl");
      expect(fonte).toContain("aspect-[2/1] w-full sm:w-44 lg:w-64 xl:w-80");
      expect(fonte).toContain(
        '"flex w-full flex-col gap-3 p-3", detalhado && "sm:p-4"',
      );
      const container = Math.min(janela - 256, 1280);
      const cartao = (container - 48 - (colunas - 1) * 16) / colunas;
      const miniatura = janela >= 1280 ? 320 : 256;
      const texto = cartao - 2 - 32 - 12 - miniatura;
      expect(colunas).toBe(colunasEsperadas);
      expect(cartao).toBe(cartaoEsperado);
      expect(texto).toBe(textoEsperado);
      expect(texto).toBeGreaterThanOrEqual(200);
    },
  );

  it("categorias mantém uma coluna na folha estreita sem arrastar vertical", () => {
    const fonte = ler(arquivos[3]);
    expect(fonte).not.toMatch(/Reorder\.Group|axis="y"/);
    expect(fonte).toContain('<ul className="space-y-3">');
  });
});
