// "Todas" não é uma categoria: é o botão que tira o filtro. Se a lojista criar
// uma categoria de nome parecido ("todas", "TODAS"), o endereço com "Todas"
// continua sendo "sem filtro" -- a Home não pode trocá-lo pela grafia da
// categoria da loja, porque aí o filtro passaria a mostrar só os produtos dela
// (a comparação do catálogo só ignora o filtro com o texto exato "Todas").
import { categoriaValidaDaHome } from "@/lib/categoria-valida-da-home";
import { describe, expect, it } from "vitest";

describe("categoria válida da Home: 'Todas' não vira categoria da loja", () => {
  it("categoria ativa chamada 'todas' não troca o 'Todas' do endereço", () => {
    const loja = [
      { name: "todas", isActive: true },
      { name: "Capas", isActive: true },
    ];
    expect(categoriaValidaDaHome("Todas", loja, false)).toBe("Todas");
  });

  it("e com a lista ainda carregando o resultado é o mesmo", () => {
    const loja = [{ name: "TODAS", isActive: true }];
    expect(categoriaValidaDaHome("Todas", loja, true)).toBe("Todas");
  });

  it("controle: um nome qualquer ativo ainda volta com a grafia da loja", () => {
    const loja = [{ name: "todas as capas", isActive: true }];
    expect(categoriaValidaDaHome("TODAS AS CAPAS", loja, false)).toBe(
      "todas as capas",
    );
  });
});
