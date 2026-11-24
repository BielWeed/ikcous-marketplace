// O endereço da loja (`/?category=...`) e o nome gravado na categoria podem
// vir com espaço sobrando nas pontas e com outra caixa ("Vestidos " no link
// colado, " vestidos" no cadastro). A Home compara pela régua da vitrine
// (minúscula, sem espaço nas pontas) e devolve a grafia da loja: sem o `trim`
// o link caía em "Todas" e a cliente perdia o filtro que o banner prometeu.
// Acento NÃO é ignorado: "Íntimos" e "Intimos" são duas categorias.
import { categoriaValidaDaHome } from "@/lib/categoria-valida-da-home";
import { describe, expect, it } from "vitest";

const lista = [
  { name: "Vestidos", isActive: true },
  { name: "  Íntimos ", isActive: true },
  { name: "Escondida", isActive: false },
];

describe("categoriaValidaDaHome — espaço nas pontas, caixa e acento", () => {
  it("espaço sobrando no link ou no nome grava a grafia da loja", () => {
    expect(categoriaValidaDaHome("  vestidos ", lista, false)).toBe("Vestidos");
    expect(categoriaValidaDaHome("íntimos", lista, false)).toBe("  Íntimos ");
  });

  it("acento diferente é outra categoria: cai em Todas", () => {
    expect(categoriaValidaDaHome("Intimos", lista, false)).toBe("Todas");
  });

  it("categoria escondida não vale, mesmo com a grafia certa", () => {
    expect(categoriaValidaDaHome("Escondida", lista, false)).toBe("Todas");
  });
});
