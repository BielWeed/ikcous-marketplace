// O formulário de produto não pode deixar um campo atrás do cabeçalho de cima
// nem da barra Publicar/Salvar de baixo. O jsdom não faz layout: aqui se prova
// só o que é texto — a regra de CSS que reserva a área e o espaço do fim da
// página. A medida real (320/360/390 px, com e sem teclado) é de navegador.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê arquivos-fonte de caminho fixo do repositório */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const CSS = readFileSync(
  join(raiz, "src/components/admin/products/formulario-produto.css"),
  "utf8",
);
const FONTE = readFileSync(
  join(raiz, "src/views/admin/AdminProductFormView.tsx"),
  "utf8",
);

describe("formulário de produto — nada fica coberto", () => {
  it("campo com foco é levado para fora da barra de baixo (mesma reserva do painel)", () => {
    const bloco = CSS.match(
      /\.produto-formulario\s*:is\([^)]*\)\s*\{[^}]*\}/,
    )?.[0];
    expect(bloco, "regra de scroll-margin ausente").toBeDefined();
    expect(bloco).toMatch(/scroll-margin-bottom:\s*var\(--admin-tab-pb/);
    expect(bloco).toMatch(/scroll-margin-top:/);
  });

  it("a reserva de baixo do painel já inclui a prateleira medida e o teclado", () => {
    const layout = readFileSync(
      join(raiz, "src/components/layouts/AdminLayout.tsx"),
      "utf8",
    );
    expect(layout).toContain("--admin-prateleira-altura");
    expect(layout).toMatch(/--admin-tab-pb[\s\S]*visualBottomOffset/);
  });

  it("a raiz do formulário reserva o fim da página (pb-admin)", () => {
    expect(FONTE).toMatch(/className="produto-formulario pb-admin /);
  });

  it("os controles novos só usam tokens admin-* (nenhuma cor fixa de marca)", () => {
    const novo = CSS.slice(CSS.indexOf("/* Chave de liga/desliga"));
    // O único hexadecimal é o anel de foco, que já é o do resto do formulário.
    const semOAnelDeFoco = novo.replace("var(--lit-t-8bb4ff, #8bb4ff)", "");
    expect(semOAnelDeFoco).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(novo).not.toMatch(/(amber|yellow|gold|f8d658|e3ac16)/i);
    expect(novo).toContain("hsl(var(--admin-");
  });
});
