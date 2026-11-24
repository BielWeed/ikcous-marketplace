import { carimboLocalParaNomeDeArquivo, dataLocal } from "@/lib/data-local-csv";
import { describe, expect, it } from "vitest";

// Caça por mutação em `data-local-csv.ts`. O nome do arquivo baixado da lista de
// pedidos (`carimboLocalParaNomeDeArquivo`) não tinha teste direto: tirar o
// minuto, ou trocar a ordem de dia e mês, deixava a suíte verde e o arquivo saía
// com nome fora de ordem alfabética e ambíguo quando o dia é menor que 13.
// Aqui o carimbo e a data da planilha são provados
// com instantes literais em UTC (Brasília = UTC-3, o relógio da LOJA, não o do
// aparelho), em duas viradas: a meia-noite (00:00 nunca vira 24:00) e o ano.

describe("carimboLocalParaNomeDeArquivo — ano-mês-dia-hora-minuto de Brasília", () => {
  it("noite de Brasília (já é dia seguinte em UTC) fica no dia da loja", () => {
    // 25/11 01:07 UTC = 24/11 22:07 em Brasília.
    expect(
      carimboLocalParaNomeDeArquivo(new Date("2026-11-25T01:07:00.000Z")),
    ).toBe("2026-11-24-22-07");
  });

  it("dia e mês menores que 13 não se confundem (05/03, não 03/05)", () => {
    // 05/03/2026 14:09 em Brasília.
    expect(
      carimboLocalParaNomeDeArquivo(new Date("2026-03-05T17:09:00.000Z")),
    ).toBe("2026-03-05-14-09");
    // 03/05/2026 14:09 em Brasília: o carimbo tem de ser diferente do de cima.
    expect(
      carimboLocalParaNomeDeArquivo(new Date("2026-05-03T17:09:00.000Z")),
    ).toBe("2026-05-03-14-09");
  });

  it("a meia-noite de Brasília é 00-00, nunca 24-00", () => {
    expect(
      carimboLocalParaNomeDeArquivo(new Date("2026-11-24T03:00:00.000Z")),
    ).toBe("2026-11-24-00-00");
  });

  it("a virada do ano segue o relógio de Brasília", () => {
    expect(
      carimboLocalParaNomeDeArquivo(new Date("2027-01-01T02:59:00.000Z")),
    ).toBe("2026-12-31-23-59");
    expect(
      carimboLocalParaNomeDeArquivo(new Date("2027-01-01T03:00:00.000Z")),
    ).toBe("2027-01-01-00-00");
  });
});

describe("dataLocal — dd/mm/aaaa hh:mm de Brasília na planilha", () => {
  it("minuto de um dígito leva zero à esquerda", () => {
    expect(dataLocal("2026-11-25T01:07:00.000Z")).toBe("24/11/2026 22:07");
  });

  it("meia-noite de Brasília é 00:00, nunca 24:00", () => {
    expect(dataLocal("2026-11-24T03:00:00.000Z")).toBe("24/11/2026 00:00");
  });

  it("data ilegível ou vazia deixa a coluna vazia, sem derrubar a planilha", () => {
    expect(dataLocal("lixo")).toBe("");
    expect(dataLocal("")).toBe("");
  });
});
