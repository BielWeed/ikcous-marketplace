// Caça por mutação nos utilitários de `src/lib/utils.ts` e `src/lib/cpf.ts`
// que sobreviviam aos testes que já existem:
//   - `reaisComVirgula` aceitava, na prática, "R$ 12.5" (1 casa) como dinheiro
//     do banco e inventava um zero ("R$ 12,50") em texto que não era dinheiro;
//   - `getAvatarGradient` não tinha teste nenhum (cor do avatar muda sozinha);
//   - `mascararCpfParaExibicao` mascarava um CNPJ (14 dígitos) como se fosse
//     CPF, escondendo e mostrando os dígitos errados.
import { mascararCpfParaExibicao } from "@/lib/cpf";
import {
  getAvatarGradient,
  reaisComEspacoComum,
  reaisComVirgula,
} from "@/lib/utils";
import { describe, expect, it } from "vitest";

const semNbsp = (texto: string) => texto.replace(/\u00a0/g, " ");

describe("reaisComVirgula — só reescreve o que é dinheiro do banco (2 casas)", () => {
  it("uma casa depois do ponto não é dinheiro do banco: fica como está", () => {
    expect(reaisComVirgula("R$ 12.5")).toBe("R$ 12.5");
    expect(reaisComVirgula("faltam R$ 3.5 de frete")).toBe(
      "faltam R$ 3.5 de frete",
    );
  });

  it("três casas depois do ponto também ficam como estão (é milhar, não centavo)", () => {
    expect(reaisComVirgula("R$ 12.345")).toBe("R$ 12.345");
  });

  it("duas casas viram vírgula; e cada valor do texto é tratado sozinho", () => {
    expect(semNbsp(reaisComVirgula("de R$ 12.50 por R$ 9.90"))).toBe(
      "de R$ 12,50 por R$ 9,90",
    );
  });

  it("texto sem dinheiro volta igual, e vazio continua vazio", () => {
    expect(reaisComVirgula("sem valor aqui")).toBe("sem valor aqui");
    expect(reaisComVirgula("")).toBe("");
  });
});

// 27/11/2026: o espaço depois do "R$" é o ponto em que um preço pode quebrar
// de linha num cartão estreito (320-360 px, fonte do sistema em 130%); com o
// inseparável do Intl, a quebra caía DENTRO do número ("R$ 1.23" / "4,56").
describe("reaisComEspacoComum — o preço só quebra entre o R$ e o número", () => {
  it("troca o espaço inseparável do Intl por espaço comum", () => {
    expect(reaisComEspacoComum(1234.56)).toBe("R$ 1.234,56");
    expect(reaisComEspacoComum(1234.56)).not.toContain("\u00a0");
  });

  it("o número continua com milhar e vírgula, sem espaço dentro dele", () => {
    expect(reaisComEspacoComum(12999.9).split(" ")).toEqual([
      "R$",
      "12.999,90",
    ]);
  });
});

describe("getAvatarGradient — a cor do avatar é estável e vem do nome", () => {
  it("a soma dos códigos das letras escolhe a cor (A = 65, 65 % 6 = 5)", () => {
    expect(getAvatarGradient("A")).toBe("from-cyan-500 to-blue-600");
    // B = 66 → 66 % 6 = 0
    expect(getAvatarGradient("B")).toBe("from-amber-500 to-orange-600");
  });

  it("o mesmo nome dá sempre a mesma cor", () => {
    expect(getAvatarGradient("Maria Souza")).toBe(
      getAvatarGradient("Maria Souza"),
    );
  });

  it("nome vazio usa o nome padrão, e o nome padrão pode ser trocado", () => {
    // "Usuario" soma 744 → 744 % 6 = 0.
    expect(getAvatarGradient("")).toBe("from-amber-500 to-orange-600");
    expect(getAvatarGradient("", "A")).toBe("from-cyan-500 to-blue-600");
    expect(getAvatarGradient(undefined as unknown as string)).toBe(
      "from-amber-500 to-orange-600",
    );
  });

  it("a cor dá a volta nas seis opções (66 → 0, 67 → 1)", () => {
    expect(getAvatarGradient("C")).toBe("from-emerald-500 to-teal-600");
  });
});

describe("mascararCpfParaExibicao — só mascara o que tem 11 dígitos", () => {
  it("CNPJ fictício de 14 dígitos volta como veio, sem mascarar pela metade", () => {
    expect(mascararCpfParaExibicao("11.222.333/0001-81")).toBe(
      "11.222.333/0001-81",
    );
    expect(mascararCpfParaExibicao("11222333000181")).toBe("11222333000181");
  });

  it("12 dígitos (um a mais que o CPF) também volta como veio", () => {
    expect(mascararCpfParaExibicao("111444777350")).toBe("111444777350");
  });
});
