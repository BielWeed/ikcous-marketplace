// Categoria com nome em alfabeto não latino ("Одежда", "衣服", "ملابس") TEM letras,
// mas o endereço (slug) só guarda a-z e 0-9 e fica vazio. A frase de antes dizia
// "precisa ter pelo menos uma letra", o que é falso para quem digitou letras.
// A regra do endereço não muda (ela vai na URL e o banco depende dela): muda só a
// frase, para dizer o que falta de verdade. Nome só de símbolo/emoji segue com a
// frase antiga, que ali é verdadeira.
import { erroDoNomeDaCategoria } from "@/lib/gestao-de-categorias";
import { describe, expect, it } from "vitest";

const FRASE_DO_ALFABETO =
  "Use pelo menos uma letra do alfabeto comum (A a Z) ou um número no nome da categoria.";

describe("erroDoNomeDaCategoria — nome com letras, mas nenhuma latina", () => {
  it.each(["Одежда", "衣服", "ملابس", "Ρούχα"])(
    "o nome %j recebe a frase do alfabeto comum, não 'sem letra'",
    (nome) => {
      expect(erroDoNomeDaCategoria(nome)).toBe(FRASE_DO_ALFABETO);
    },
  );

  it("só símbolo ou emoji continua com a frase de sem letra nem número", () => {
    expect(erroDoNomeDaCategoria("🎉🎉")).toBe(
      "O nome da categoria precisa ter pelo menos uma letra ou um número.",
    );
  });

  it("letra não latina junto de número ou de letra latina segue valendo", () => {
    expect(erroDoNomeDaCategoria("Одежда 2")).toBeNull();
    expect(erroDoNomeDaCategoria("Moda 衣服")).toBeNull();
  });
});
