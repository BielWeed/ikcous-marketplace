// Caça 8 (26/10/2026), itens 6 e 8. As duas telas são pesadas demais para
// montar aqui (dezenas de dublês), então a guarda é sobre o código-fonte, como
// em acess-onda1-contrato.test.tsx.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const home = readFileSync("src/views/customer/HomeView.tsx", "utf8");
const produto = readFileSync("src/views/customer/ProductView.tsx", "utf8");

describe("HomeView — menu Ordenar por legível", () => {
  const menu = home.slice(home.indexOf("Ordenar por") - 300);
  const opcao = menu.slice(
    menu.indexOf('role="option"'),
    menu.indexOf('role="option"') + 900,
  );

  it("opção não marcada é zinc-600 em 11 px (não zinc-400 em 10 px)", () => {
    expect(opcao).toContain("text-[11px]");
    expect(opcao).not.toContain("text-[10px]");
    expect(opcao).toContain('"text-zinc-600 hover:bg-zinc-50');
    expect(opcao).not.toContain('"text-zinc-400 hover:bg-zinc-50');
  });

  it("o título do menu também sai de zinc-400", () => {
    const titulo = menu.slice(0, menu.indexOf("Ordenar por"));
    expect(titulo.slice(-200)).toContain("text-zinc-600");
  });
});

describe("ProductView — caminho (breadcrumb)", () => {
  const nav = produto.slice(
    produto.indexOf("{/* Breadcrumbs */}"),
    produto.indexOf("</nav>", produto.indexOf("{/* Breadcrumbs */}")),
  );

  it("é um <nav> com nome e texto de 11 px em zinc-600", () => {
    expect(nav).toContain('aria-label="Caminho"');
    expect(nav).toContain("text-[11px]");
    expect(nav).not.toContain("text-[9px]");
    expect(nav).toContain("text-zinc-600");
    expect(nav).not.toMatch(/uppercase tracking-widest text-zinc-400/);
  });

  it("a categoria não é mais um botão sem ação", () => {
    const botoesDoCaminho = nav.match(/<button/g) ?? [];
    expect(botoesDoCaminho).toHaveLength(1); // só o "Início", que tem onClick
    expect(nav).toMatch(/\{product\.category\}\s*<\/span>/);
  });
});
