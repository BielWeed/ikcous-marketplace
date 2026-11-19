/* eslint-disable security/detect-non-literal-fs-filename -- Lê só os caminhos fixos de fontes locais listados neste teste, nunca entrada de usuário. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelularSemGradeDeTablet } from "./classes-do-celular";

const arquivos = {
  favoritos: "src/views/customer/FavoritesView.tsx",
  carrinho: "src/views/customer/CartView.tsx",
  pedidos: "src/components/ui/custom/OrderList.tsx",
  busca: "src/components/ui/custom/OrderSearch.tsx",
};
const ler = (arquivo: string) => readFileSync(arquivo, "utf8");

function classes(arquivo: string) {
  const fonte = ts.createSourceFile(
    arquivo,
    ler(arquivo),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const valores: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText(fonte) === "className") {
      function coletar(filho: ts.Node) {
        if (ts.isStringLiteral(filho)) {
          const celular = classesDoCelularSemGradeDeTablet(filho.text);
          if (celular) valores.push(celular);
        } else ts.forEachChild(filho, coletar);
      }
      if (no.initializer) coletar(no.initializer);
    } else ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  return createHash("sha256").update(JSON.stringify(valores)).digest("hex");
}

describe("Favoritos e pedidos no computador", () => {
  it("preserva todas as classes abaixo de 1024px, inclusive md: e estados condicionais", () => {
    // Base 1.5.187; pedidos inclui a quebra do bairro sem espaços (17/11/2026).
    // Todos os literais de className na ordem da árvore.
    expect(classes(arquivos.favoritos)).toBe(
      "01c4f2611dc3321eaab592ad1e8eb651f00621e95352f0393f1c3baa9bb7e38e",
    );
    expect(classes(arquivos.carrinho)).toBe(
      "1dc0eeae81190e2946f2b062e7036424fc24e369d31fb97fecb039bd2be421c2",
    );
    expect(classes(arquivos.pedidos)).toBe(
      "25517ee6c392becb26e96a3c560aca5915539e126275ac1a930ad739be209bb6",
    );
    expect(classes(arquivos.busca)).toBe(
      "da4454082908c50fcec65bec2c10f2f24c6ce59b90af6465a08b5ba1dd81dbd5",
    );
  });

  it("mantém favoritos em linhas por categoria e dá duas colunas só no PC", () => {
    const fonte = ler(arquivos.favoritos);
    expect(fonte).toContain('layout="linha"');
    expect(fonte).toMatch(
      /<ul id={idLista} className="lg:grid lg:grid-cols-2 lg:gap-4">/,
    );
    // O contêiner centralizado vem UMA vez, da casca (`PaginaDoComputador`, no
    // App): Favoritos não é isento (`containerProprio`), então a tela não pode
    // aplicar `CONTAINER_DO_COMPUTADOR` de novo (largura e padding em dobro).
    expect(fonte).not.toContain("CONTAINER_DO_COMPUTADOR");
    expect(fonte).toContain("lg:max-w-full");
    const app = ler("src/App.tsx");
    const abaFavoritos = [
      ...app.matchAll(
        /<TabWrapper\s+active=\{currentView === "favorites"\}([^>]*)>/g,
      ),
    ];
    expect(abaFavoritos.length).toBeGreaterThan(0);
    for (const aba of abaFavoritos) {
      expect(aba[1]).not.toContain("containerProprio");
    }
  });

  it("usa a grade compartilhada nas sugestões, com respiro de PC", () => {
    const fonte = ler(arquivos.favoritos);
    expect(fonte).toMatch(
      /className={cn\(\s*"grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3",\s*GRADE_DE_PRODUTOS_NO_COMPUTADOR,\s*"lg:gap-x-6 lg:gap-y-10"/,
    );
    // A ação já está no fluxo; não introduzir posicionamento fixo.
    expect(fonte).not.toMatch(/lg:fixed/);
  });

  it("alinha as abas à largura e ao padding do conteúdo da aba ativa", () => {
    const fonte = ler(arquivos.carrinho);
    const abas = fonte.match(
      /className="([^"]*sticky top-\[-2px\][^"]*)"/,
    )?.[1];
    expect(abas).toBeDefined();
    const carrinho = fonte.match(
      /className="([^"]*mx-auto flex w-full max-w-7xl[^"]*)"/,
    )?.[1];
    const pedidos = fonte.match(
      /className="([^"]*lg:max-w-\[1216px\][^"]*)"/,
    )?.[1];
    expect(carrinho).toBeDefined();
    expect(pedidos).toBeDefined();
    const tokens = abas!.split(/\s+/);
    for (const token of ["lg:mx-auto", "lg:w-full", "lg:px-8"]) {
      expect(tokens).toContain(token);
    }
    for (const [id, conteudo] of [
      ["tab-cart", carrinho!],
      ["tab-orders", pedidos!],
    ]) {
      const largura = conteudo
        .split(/\s+/)
        .find((token) => /^(?:lg:)?max-w-/.test(token));
      expect(largura).toBeDefined();
      expect(tokens).toContain(
        `lg:has-[#${id}[aria-selected=true]]:${largura!.replace(/^lg:/, "")}`,
      );
      expect(conteudo.split(/\s+/)).toContain("lg:px-8");
    }
  });

  it("pedidos viram linhas largas sem esconder situação ou ações", () => {
    const fonte = ler(arquivos.pedidos);
    expect(fonte).toContain("lg:grid-cols-1");
    expect(fonte).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]");
    expect(fonte).toContain("lg:col-span-2");
    expect(fonte).toContain('data-testid="order-status-panel"');
    expect(fonte).toContain('data-testid="order-card-open"');
    expect(ler(arquivos.carrinho)).toContain("lg:max-w-[1216px]");
    expect(ler(arquivos.busca)).toContain("lg:max-w-2xl");
  });
});
