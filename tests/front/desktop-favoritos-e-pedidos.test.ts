import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

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
          const celular = classesDoCelular(filho.text);
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
    // Assinaturas da base 1.5.187: todos os literais de className na ordem da árvore.
    expect(classes(arquivos.favoritos)).toBe(
      "4867b0736e2e22521d6e8479f6c7354e629bbf1e0727dda4f486833645300cb9",
    );
    expect(classes(arquivos.carrinho)).toBe(
      "4496dc40387eeeafe39b70316ec3ce53e3a8ae9d884b01c0897d391ac0e5254d",
    );
    expect(classes(arquivos.pedidos)).toBe(
      "30e79f7e39c6c65316a566903ceab567c7fff1d58da1cf37f2333494fb378aa1",
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
    expect(fonte).toContain("CONTAINER_DO_COMPUTADOR");
    expect(fonte).toContain("lg:max-w-full");
  });

  it("usa a grade compartilhada nas sugestões, com respiro de PC", () => {
    const fonte = ler(arquivos.favoritos);
    expect(fonte).toMatch(
      /className={cn\(\s*"grid grid-cols-2 gap-3 sm:gap-4",\s*GRADE_DE_PRODUTOS_NO_COMPUTADOR,\s*"lg:gap-x-6 lg:gap-y-10"/,
    );
    // A ação já está no fluxo; não introduzir posicionamento fixo.
    expect(fonte).not.toMatch(/lg:fixed/);
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
