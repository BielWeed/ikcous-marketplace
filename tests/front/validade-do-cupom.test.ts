// A validade do cupom é o calendário da LOJA (America/Sao_Paulo), nunca o do
// aparelho de quem abre o painel. Histórico:
//  - achado 26 (22/08): o formulário gravava a data como 00:00 UTC e o cupom
//    "vale até 25/08" morria 21h antes do prometido;
//  - 12/11: a correção do 22/08 usou o fuso do APARELHO (`new Date(a, m, d, 23,
//    59, 59, 999)`). Num celular em UTC ou noutro fuso, "até 12/11" terminava
//    às 20:59 de Brasília (ou depois das 23:59, num fuso adiantado), diferente
//    do que o checkout considera (`cupons-do-checkout.ts`, Brasília).
//
// As provas abaixo trocam o fuso do processo (`process.env.TZ`, que o Node
// relê na hora) e afirmam INSTANTES LITERAIS em UTC escritos à mão — nunca o
// resultado comparado com getters do mesmo aparelho, que concordam com
// qualquer bug de fuso. O fuso volta ao que era depois de cada teste, para não
// vazar para os arquivos vizinhos. No Windows, apagar `TZ` não devolve o fuso da
// máquina (o Node continua no último escolhido); por isso, sem `TZ` de origem,
// o fuso real é lido uma vez e regravado.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dataEscolhidaParaValidade,
  validadeParaDataDoInput,
} from "@/utils/validade-do-cupom";

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = fusoDaMaquina;
});

// Aparelhos de todos os cantos: a resposta TEM de ser a mesma em todos.
const FUSOS_DO_APARELHO = [
  "America/Sao_Paulo", // controle: a loja
  "UTC", // o CI, e celular com fuso de fábrica
  "America/Manaus", // -04:00
  "America/Rio_Branco", // -05:00
  "America/Noronha", // -02:00
  "Pacific/Auckland", // +13:00 em março (horário de verão): o mais adiantado
  "Asia/Tokyo", // +09:00
  "Europe/Lisbon", // 0/+1
] as const;

describe.each(FUSOS_DO_APARELHO)(
  "validade do cupom, aparelho em %s — valores literais",
  (fuso) => {
    beforeEach(() => {
      process.env.TZ = fuso;
    });

    it("o dia escolhido vale até 23:59:59.999 de Brasília", () => {
      // Brasília é UTC-3 o ano todo (sem horário de verão desde 2019).
      expect(dataEscolhidaParaValidade("2030-03-10")).toBe(
        "2030-03-11T02:59:59.999Z",
      );
      expect(dataEscolhidaParaValidade("2026-11-12")).toBe(
        "2026-11-13T02:59:59.999Z",
      );
    });

    it("virada de ano e dia 29 de fevereiro", () => {
      expect(dataEscolhidaParaValidade("2026-12-31")).toBe(
        "2027-01-01T02:59:59.999Z",
      );
      expect(dataEscolhidaParaValidade("2028-02-29")).toBe(
        "2028-03-01T02:59:59.999Z",
      );
    });

    it("o input mostra o calendário de Brasília, não o do aparelho nem a fatia UTC", () => {
      // 00:00 UTC do dia 10 ainda é noite do dia 9 em Brasília.
      expect(validadeParaDataDoInput("2030-03-10T00:00:00.000Z")).toBe(
        "2030-03-09",
      );
      // Meio-dia UTC do dia 10 já é dia 10 em Brasília.
      expect(validadeParaDataDoInput("2030-03-10T12:00:00.000Z")).toBe(
        "2030-03-10",
      );
    });

    it("a fronteira da meia-noite de Brasília (02:59:59.999Z / 03:00:00Z)", () => {
      expect(validadeParaDataDoInput("2026-12-31T02:59:59.999Z")).toBe(
        "2026-12-30",
      );
      expect(validadeParaDataDoInput("2026-12-31T03:00:00.000Z")).toBe(
        "2026-12-31",
      );
      expect(validadeParaDataDoInput("2027-01-01T02:59:59.999Z")).toBe(
        "2026-12-31",
      );
      expect(validadeParaDataDoInput("2027-01-01T03:00:00.000Z")).toBe(
        "2027-01-01",
      );
    });

    it("gravar e reabrir o formulário devolve o MESMO dia", () => {
      for (const dia of [
        "2030-03-10",
        "2026-11-12",
        "2026-12-31",
        "2027-01-01",
        "2028-02-29",
      ]) {
        expect(validadeParaDataDoInput(dataEscolhidaParaValidade(dia))).toBe(
          dia,
        );
      }
    });

    it("entrada vazia, avulsa ou fora do calendário não vira validade", () => {
      expect(dataEscolhidaParaValidade("")).toBeUndefined();
      expect(dataEscolhidaParaValidade("amanhã")).toBeUndefined();
      expect(dataEscolhidaParaValidade("2030-13-99")).toBeUndefined();
      expect(dataEscolhidaParaValidade("2030-02-30")).toBeUndefined();
      // 2030 não é bissexto: "rolar" para 1º de março seria validade falsa.
      expect(dataEscolhidaParaValidade("2030-02-29")).toBeUndefined();
      expect(dataEscolhidaParaValidade("2030-00-10")).toBeUndefined();
    });

    it("sem validade, o input fica vazio", () => {
      expect(validadeParaDataDoInput(undefined)).toBe("");
      expect(validadeParaDataDoInput(null)).toBe("");
      expect(validadeParaDataDoInput("")).toBe("");
      expect(validadeParaDataDoInput("não é uma data")).toBe("");
    });
  },
);

describe("o cupom ainda vale à noite do dia escolhido (o defeito de 22/08 não volta)", () => {
  it("21:00 de Brasília do dia escolhido (00:00Z do dia seguinte) está antes do fim", () => {
    // O defeito antigo gravava 00:00 UTC: às 21:00 de Brasília do dia D o cupom
    // "vale até D" já estava morto.
    const gravado = new Date(dataEscolhidaParaValidade("2030-03-10")!);
    const vinteEUmaDeBrasilia = new Date("2030-03-11T00:00:00.000Z");
    expect(gravado.getTime()).toBeGreaterThan(vinteEUmaDeBrasilia.getTime());
  });

  it("em aparelho UTC, 22:00 de Brasília do dia escolhido ainda vale (o defeito de 12/11 matava às 20:59)", () => {
    process.env.TZ = "UTC";
    const gravado = new Date(dataEscolhidaParaValidade("2026-11-12")!);
    const vinteEDuasDeBrasilia = new Date("2026-11-13T01:00:00.000Z");
    expect(gravado.getTime()).toBeGreaterThan(vinteEDuasDeBrasilia.getTime());
  });

  it("e não vale depois da meia-noite de Brasília, em aparelho adiantado", () => {
    process.env.TZ = "Pacific/Auckland";
    const gravado = new Date(dataEscolhidaParaValidade("2030-03-10")!);
    const meiaNoiteDeBrasilia = new Date("2030-03-11T03:00:00.000Z");
    expect(gravado.getTime()).toBeLessThan(meiaNoiteDeBrasilia.getTime());
  });
});
