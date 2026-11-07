// Contrato de fonte: jsdom não mede a geometria; conferir também em navegador.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- fonte fixa do repositório
const CSS = readFileSync(
  new URL("../../src/index.css", import.meta.url),
  "utf8",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fonte fixa do repositório
const CART = readFileSync(
  new URL(
    "../../src/components/ui/custom/CartFooterSummary.tsx",
    import.meta.url,
  ),
  "utf8",
);
const baixa =
  /@media \(width >= 768px\) and \(height <= 500px\)\s*\{([\s\S]*?)\n\}/;

describe("aparelho deitado — espaço para os itens", () => {
  it("retira a folga flutuante tanto da navegação como das barras acima dela", () => {
    const regra = baixa.exec(CSS)?.[1] ?? "";
    expect(regra).toMatch(/:root\s*\{\s*--customer-nav-offset: 0px;/);
    expect(regra).toMatch(
      /nav\[aria-label="Navegação principal"\]\s*\{\s*bottom: var\(--customer-nav-offset\);/,
    );
  });

  it("esconde só a linha extra do carrinho, sem esconder total, frete ou ação", () => {
    expect(CART).toMatch(
      /className="cart-summary-context hidden w-full[^"]*md:flex"/,
    );
    const regra = baixa.exec(CSS)?.[1] ?? "";
    expect(regra).toMatch(
      /\.bottom-docked-navigation \.cart-summary-context\s*\{\s*display: none;/,
    );
    expect(regra).not.toMatch(
      /\.bottom-docked-navigation\s*\{\s*display: none/,
    );
  });
});
