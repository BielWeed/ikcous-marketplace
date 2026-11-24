// A categoria que a Home usa de fato, nos casos de borda: sem nenhuma escolha
// (nome vazio) a Home fica como está -- vazio NÃO vira "Todas" por conta própria
// --, categoria ESCONDIDA da loja cai em "Todas" (some das opções), e o nome que
// existe volta com a grafia da loja, mesmo digitado com caixa e espaços
// diferentes no endereço.
import { categoriaValidaDaHome } from "@/lib/categoria-valida-da-home";
import { describe, expect, it } from "vitest";

const LOJA = [
  { name: "Capas", isActive: true },
  { name: "Cama, Mesa e Banho", isActive: true },
  { name: "Antigas", isActive: false },
];

describe("categoria válida da Home, nas bordas", () => {
  it("sem escolha (vazio) a Home não decide nada: continua vazio", () => {
    expect(categoriaValidaDaHome("", LOJA, false)).toBe("");
  });

  it("'Todas' continua 'Todas', com a lista carregada ou não", () => {
    expect(categoriaValidaDaHome("Todas", LOJA, false)).toBe("Todas");
    expect(categoriaValidaDaHome("Todas", [], true)).toBe("Todas");
  });

  it("categoria escondida da loja cai em 'Todas'", () => {
    expect(categoriaValidaDaHome("Antigas", LOJA, false)).toBe("Todas");
  });

  it("categoria que a loja não tem cai em 'Todas'", () => {
    expect(categoriaValidaDaHome("Eletrônicos", LOJA, false)).toBe("Todas");
  });

  it("devolve a grafia da loja, ignorando caixa e espaços nas pontas", () => {
    expect(categoriaValidaDaHome("  capas ", LOJA, false)).toBe("Capas");
    expect(categoriaValidaDaHome("CAMA, MESA E BANHO", LOJA, false)).toBe(
      "Cama, Mesa e Banho",
    );
  });

  it("enquanto as categorias carregam, ou com a lista vazia (rede falhou), não decide", () => {
    expect(categoriaValidaDaHome("Eletrônicos", LOJA, true)).toBe(
      "Eletrônicos",
    );
    expect(categoriaValidaDaHome("Eletrônicos", [], false)).toBe("Eletrônicos");
  });

  it("acento é diferença: 'Íntimos' e 'Intimos' são categorias distintas", () => {
    const lista = [{ name: "Íntimos", isActive: true }];
    expect(categoriaValidaDaHome("Íntimos", lista, false)).toBe("Íntimos");
    expect(categoriaValidaDaHome("Intimos", lista, false)).toBe("Todas");
  });
});
