// `corDaVariacao`: o hex que o lojista escolheu para a opção tem prioridade
// sobre o dicionário de nomes, e o zero é um dígito hexadecimal como qualquer
// outro. A conferência do hex precisa aceitar o preto puro ("#000", "#000000")
// e cores com zeros no meio ("#0a0a0a", "#102030"): se o zero ficasse fora da
// faixa aceita, a amostra do "Preto" escolhido na paleta sumiria da loja e a
// opção cairia no dicionário (ou ficaria sem cor, quando o nome não está lá).
import { corDaVariacao } from "@/utils/cor-da-variacao";
import { describe, expect, it } from "vitest";

describe("corDaVariacao — hex escolhido", () => {
  it("preto puro vale, nas duas formas (3 e 6 dígitos)", () => {
    expect(corDaVariacao("Cor sem nome no dicionário", "#000")).toBe("#000");
    expect(corDaVariacao("Cor sem nome no dicionário", "#000000")).toBe(
      "#000000",
    );
  });

  it("zeros no meio e em maiúscula também valem", () => {
    expect(corDaVariacao("Zzz", "#0a0a0a")).toBe("#0a0a0a");
    expect(corDaVariacao("Zzz", "#102030")).toBe("#102030");
    expect(corDaVariacao("Zzz", "#0AF")).toBe("#0AF");
  });

  it("hex com número de dígitos errado ou sem '#' não vale: cai no nome", () => {
    expect(corDaVariacao("Zzz", "#0000")).toBeNull();
    expect(corDaVariacao("Zzz", "#00000")).toBeNull();
    expect(corDaVariacao("Zzz", "000000")).toBeNull();
    expect(corDaVariacao("Preto", "#00000g")).toBe(corDaVariacao("Preto"));
  });
});
