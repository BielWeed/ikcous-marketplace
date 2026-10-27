// Tela de entrada do lojista: o "olho" da senha precisa de nome para leitor de
// tela e alvo de toque de 44 px, e a faixa de erro precisa ser anunciada.
// (A tela de cliente já tinha os três; jsdom não vê CSS, então provamos pela
// estrutura do arquivo, como loja-detalhes-visuais-e-de-acessibilidade.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = readFileSync("src/views/admin/AdminLoginView.tsx", "utf8");

describe("AdminLoginView: acessibilidade", () => {
  it("o olho da senha tem nome que alterna e alvo de 44 px", () => {
    const i = fonte.indexOf("setShowPassword(!showPassword)");
    const botao = fonte.slice(
      fonte.lastIndexOf("<button", i),
      fonte.indexOf("</button>", i),
    );
    expect(botao).toContain('"Ocultar senha"');
    expect(botao).toContain('"Mostrar senha"');
    expect(botao).toContain("aria-pressed");
    expect(botao).toContain("size-11");
  });
  it("a faixa de erro é anunciada (role=alert)", () => {
    const i = fonte.indexOf("{error}");
    const faixa = fonte.slice(fonte.lastIndexOf("<div", i), i);
    expect(faixa).toContain('role="alert"');
  });
});
