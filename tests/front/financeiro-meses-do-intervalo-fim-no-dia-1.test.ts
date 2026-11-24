// Resultado mês a mês (DRE): quando o período TERMINA no dia 1 de um mês, esse
// dia ainda é um mês do período. Achado por mutação (24/11/2026): trocar
// `cursor <= intervalo.fim` por `<` não derrubava nada — e a consequência é
// um dia de venda do dia 1 que some das colunas, com as colunas deixando de
// somar o total do período.
import { mesesDoIntervalo } from "@/lib/financeiro";
import { describe, expect, it } from "vitest";

const pares = (inicio: string, fim: string) =>
  mesesDoIntervalo({ inicio, fim }).map((mes) => [mes.inicio, mes.fim]);

describe("mesesDoIntervalo: fim no dia 1", () => {
  it("período que acaba no dia 1 mantém esse dia; um único dia 1 é um mês, não zero", () => {
    expect(pares("2026-01-15", "2026-03-01")).toEqual([
      ["2026-01-15", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-01"],
    ]);
    expect(pares("2026-09-01", "2026-09-01")).toEqual([
      ["2026-09-01", "2026-09-01"],
    ]);
  });

  it("virada de ano e fevereiro bissexto terminando no dia 1", () => {
    expect(pares("2026-12-31", "2027-01-01")).toEqual([
      ["2026-12-31", "2026-12-31"],
      ["2027-01-01", "2027-01-01"],
    ]);
    expect(pares("2028-02-28", "2028-03-01")).toEqual([
      ["2028-02-28", "2028-02-29"],
      ["2028-03-01", "2028-03-01"],
    ]);
  });
});
