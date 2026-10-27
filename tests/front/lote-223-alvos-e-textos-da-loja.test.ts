// Lote 223 (caça 10), itens 2 (alvo do Desfazer), 5 e 6. jsdom não vê CSS: a
// guarda é sobre o código-fonte, como em caminho-e-ordenar-acessibilidade.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sonner = readFileSync("src/components/ui/sonner.tsx", "utf8");
const home = readFileSync("src/views/customer/HomeView.tsx", "utf8");
const review = readFileSync("src/components/ui/custom/ReviewCard.tsx", "utf8");

describe("lote 223 — alvos de toque e texto alternativo", () => {
  it("botão de ação do aviso (Desfazer) tem alvo de 44 px", () => {
    const acao = sonner.slice(sonner.indexOf("actionButton"));
    expect(acao.slice(0, 200)).toContain("min-h-11");
  });

  it("opção do menu Ordenar por tem alvo de 44 px", () => {
    const menu = home.slice(home.indexOf("Ordenar por") - 300);
    const i = menu.indexOf('role="option"');
    expect(menu.slice(i, i + 900)).toContain("min-h-11");
  });

  it("foto de avaliação tem texto alternativo em português", () => {
    expect(review).not.toMatch(/alt=\{`Review /);
    expect(review).toContain("Foto enviada pela cliente");
  });
});
