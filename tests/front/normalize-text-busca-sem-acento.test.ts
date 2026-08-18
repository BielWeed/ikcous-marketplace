// BUSCA-010 (#20) — quem digita "alianca" tem que achar "Aliança".
//
// Toda a busca do cliente comparava só com `toLowerCase()`. Em catálogo
// brasileiro isso quebra o caso mais comum que existe: teclado de celular não
// põe acento sozinho, e ninguém para de digitar para procurar o cedilha. O
// produto está ativo, em estoque, na vitrine — e a busca devolve nada.
//
// A técnica já existia no repositório (`useCategories.ts` usa NFD para gerar
// slug), só nunca tinha sido aplicada na busca.
//
// A REGRA QUE ESTES TESTES PROTEGEM: normalizar os DOIS lados da comparação.
// Normalizar só o que a pessoa digitou continua não achando o produto acentuado;
// normalizar só o produto não acha quem digitou com acento.
import { describe, expect, it } from "vitest";

import { normalizeText } from "@/lib/utils";

describe("normalizeText (#20)", () => {
  it("tira acento e cedilha", () => {
    expect(normalizeText("Aliança")).toBe("alianca");
    expect(normalizeText("coração")).toBe("coracao");
    expect(normalizeText("Ópera")).toBe("opera");
    expect(normalizeText("ÀÉÎÕÜ")).toBe("aeiou");
  });

  it("baixa a caixa e apara as pontas", () => {
    expect(normalizeText("  Blusa AZUL  ")).toBe("blusa azul");
  });

  it("texto sem acento atravessa igual", () => {
    expect(normalizeText("blusa azul")).toBe("blusa azul");
  });

  it("aguenta nulo, indefinido e vazio sem quebrar", () => {
    // A busca por descrição quebrava com produto de `description` nula
    // (SearchBar.tsx:171). Quem normaliza é quem tem que aguentar.
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText("")).toBe("");
  });

  it("a prova que importa: os dois lados se encontram nas duas direções", () => {
    const produtoCadastrado = "Aliança Luxo Coração";

    // Quem digita sem acento acha o produto com acento.
    expect(normalizeText(produtoCadastrado)).toContain(
      normalizeText("alianca"),
    );
    expect(normalizeText(produtoCadastrado)).toContain(
      normalizeText("coracao"),
    );

    // E quem digita COM acento continua achando — a correção não pode trocar
    // um lado quebrado pelo outro.
    expect(normalizeText(produtoCadastrado)).toContain(
      normalizeText("Aliança"),
    );
    expect(normalizeText(produtoCadastrado)).toContain(
      normalizeText("CORAÇÃO"),
    );
  });

  it("não junta palavras diferentes por engano", () => {
    // Trava contra normalizar demais: "cão" e "cao" viram a mesma coisa (é o
    // objetivo), mas "cao" não pode passar a casar com "capa".
    expect(normalizeText("cão")).toBe(normalizeText("cao"));
    expect(normalizeText("capa")).not.toBe(normalizeText("cao"));
  });
});
