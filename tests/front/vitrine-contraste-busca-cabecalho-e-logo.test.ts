import busca from "@/components/ui/custom/SearchBar?raw";
import { expect, it } from "vitest";

it("combina cor legível e fundo branco na mesma sugestão de produto", () => {
  const sugestoes = [
    ...busca.matchAll(
      /<button\s[^>]*onClick=\{\(\) => handleSuggestionClick\(item\.name, item\.id\)\}\s+className="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g,
    ),
  ];
  expect(sugestoes.length).toBeGreaterThan(0);
  for (const [, classesDaLinha, conteudo] of sugestoes) {
    const linha = classesDaLinha.split(" ");
    expect(linha).toContain("group");
    expect(linha).toContain("hover:bg-white");
    expect(linha).not.toContain("hover:bg-zinc-50");
    const nome = conteudo
      .match(/<span className="([^"]+)">\s*\{item\.name\}\s*<\/span>/)?.[1]
      .split(" ");
    expect(nome).toContain("group-hover:text-primary-legivel");
    expect(nome).not.toContain("group-hover:text-primary");
  }
});
