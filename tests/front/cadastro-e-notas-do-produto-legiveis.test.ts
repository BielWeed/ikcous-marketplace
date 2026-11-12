import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Só classes: guarda as âncoras exatas sem envolver os fluxos de autenticação.
describe("dicas do cadastro e legendas das notas legíveis", () => {
  const auth = readFileSync("src/views/shared/AuthView.tsx", "utf8");
  const produto = readFileSync("src/views/customer/ProductView.tsx", "utf8");

  it("as seis dicas dos campos usam zinc-500 sobre o fundo claro", () => {
    expect(auth.match(/placeholder:text-zinc-500/g)).toHaveLength(6);
    expect(auth).not.toContain("placeholder:text-zinc-300");
  });

  it("Não recebeu? e E-mail errado? têm 12 px e zinc-600", () => {
    const legendas = [
      ...auth.matchAll(
        /<p className="([^"]*)">\s*(?:Não recebeu\?|E-mail errado\?)/g,
      ),
    ];
    expect(legendas).toHaveLength(3);
    for (const [, classes] of legendas) {
      expect(classes.split(" ")).toContain("text-xs");
      expect(classes.split(" ")).toContain("text-zinc-600");
    }
  });

  it.each([
    ["escala", /<span className="([^"]*)">\s*\/ 5/],
    ["base de experiências", /<span className="([^"]*)">\s*Baseado em/],
    ["estrela", /<span className="([^"]*)">\s*\{star\}/],
    ["contagem", /<span className="([^"]*)">\s*\{count\}/],
  ] as const)(
    "%s usa zinc-400 e pelo menos text-xs no painel escuro",
    (_, ancora) => {
      const achado = produto.match(ancora);
      expect(achado).not.toBeNull();
      const classes = achado![1].split(" ");
      expect(classes).toContain("text-zinc-400");
      expect(classes).toContain("text-xs");
      expect(classes).not.toContain("text-zinc-500");
      expect(classes).not.toContain("text-zinc-600");
    },
  );
});
