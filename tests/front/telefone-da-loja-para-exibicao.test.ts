// O WhatsApp da loja aparecia CRU nas páginas de política ("WhatsApp
// 5534998028216", medido em 30/10/2026 na Savy): o número é guardado com o 55
// do país (13 dígitos) e a máscara de exibição só formata até 11 dígitos, então
// devolvia o texto como veio. A exibição da LOJA agora tira o 55 e formata;
// número que não se reconhece continua como está (nada de inventar dígito).
import { describe, expect, it } from "vitest";

import { telefoneDaLojaParaExibicao } from "@/lib/telefone-br";

describe("telefoneDaLojaParaExibicao", () => {
  it("celular guardado com o 55 do país vira (DDD) NNNNN-NNNN", () => {
    expect(telefoneDaLojaParaExibicao("5534998028216")).toBe("(34) 99802-8216");
    expect(telefoneDaLojaParaExibicao("+55 34 99802-8216")).toBe(
      "(34) 99802-8216",
    );
  });

  it("fixo guardado com o 55 vira (DDD) NNNN-NNNN", () => {
    expect(telefoneDaLojaParaExibicao("553433331234")).toBe("(34) 3333-1234");
  });

  it("número só com DDD já formata, sem mexer no DDD", () => {
    expect(telefoneDaLojaParaExibicao("34998028216")).toBe("(34) 99802-8216");
    expect(telefoneDaLojaParaExibicao("3433331234")).toBe("(34) 3333-1234");
  });

  it("DDD 55 de verdade (11 dígitos) não perde o DDD", () => {
    expect(telefoneDaLojaParaExibicao("55999991234")).toBe("(55) 99999-1234");
  });

  it("o que não parece telefone brasileiro volta como veio", () => {
    expect(telefoneDaLojaParaExibicao("123")).toBe("123");
    expect(telefoneDaLojaParaExibicao("+44 20 7946 0958")).toBe(
      "+44 20 7946 0958",
    );
    expect(telefoneDaLojaParaExibicao("")).toBe("");
    expect(telefoneDaLojaParaExibicao(null)).toBe("");
  });
});
