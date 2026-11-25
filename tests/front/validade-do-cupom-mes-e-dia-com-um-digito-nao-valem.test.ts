// Achado por mutação, 25/11/2026: trocar `\d{2}` por `\d+` (mês e dia) na
// regra de `dataEscolhidaParaValidade` deixava a suíte verde, porque os testes
// de "só aceita AAAA-MM-DD" erravam o ano ou o separador, nunca a largura do mês
// e do dia. O campo de data do navegador sempre entrega "AAAA-MM-DD", então
// um valor como "2030-1-5" só chega por rascunho antigo, colagem ou cache: e
// aceitá-lo gravaria uma validade para uma data que a lojista nunca viu escrita
// assim, em vez de recusar e pedir a data de novo.
import { dataEscolhidaParaValidade } from "@/utils/validade-do-cupom";
import { describe, expect, it } from "vitest";

describe("dataEscolhidaParaValidade — mês e dia têm sempre dois dígitos", () => {
  it.each(["2030-1-5", "2030-01-5", "2030-1-05", "2030-001-05", "2030-01-005"])(
    "%s é recusada (sem validade)",
    (entrada) => {
      expect(dataEscolhidaParaValidade(entrada)).toBeUndefined();
    },
  );

  it("controle: a mesma data com dois dígitos vale até o último milissegundo do dia em Brasília", () => {
    expect(dataEscolhidaParaValidade("2030-01-05")).toBe(
      "2030-01-06T02:59:59.999Z",
    );
  });
});
