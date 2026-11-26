// `src/utils/validade-do-cupom.ts`: o `Date.UTC` do JavaScript trata ano de 0 a
// 99 como 1900 + ano ("0050-06-15" viraria 15/06/1950). O mês e o dia voltam
// iguais ao pedido, então só a conferência do ANO derruba essa entrada. Se ela
// sumisse, um "0050-06-15" digitado por engano (ou colado) seria gravado como
// validade de 1950 em vez de "sem validade válida" — e o cupom nasceria já
// vencido sem ninguém ver o ano estranho na tela.
import { dataEscolhidaParaValidade } from "@/utils/validade-do-cupom";
import { describe, expect, it } from "vitest";

describe("dataEscolhidaParaValidade — ano abaixo de 100", () => {
  it("'0050-06-15' (viraria 1950 no Date.UTC) não é uma validade", () => {
    expect(dataEscolhidaParaValidade("0050-06-15")).toBeUndefined();
  });

  it("os dois extremos da janela 0..99 também são recusados", () => {
    expect(dataEscolhidaParaValidade("0000-01-01")).toBeUndefined();
    expect(dataEscolhidaParaValidade("0099-12-31")).toBeUndefined();
  });

  it("controle: uma data comum segue valendo até o fim do dia em Brasília", () => {
    expect(dataEscolhidaParaValidade("2030-06-15")).toBe(
      "2030-06-16T02:59:59.999Z",
    );
  });
});
