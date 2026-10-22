import { ufBrasileiraValida } from "@/lib/uf-brasileira";
import { describe, expect, it } from "vitest";

describe("UF brasileira", () => {
  it.each([
    "AC",
    "AL",
    "AP",
    "AM",
    "BA",
    "CE",
    "DF",
    "ES",
    "GO",
    "MA",
    "MT",
    "MS",
    "MG",
    "PA",
    "PB",
    "PR",
    "PE",
    "PI",
    "RJ",
    "RN",
    "RS",
    "RO",
    "RR",
    "SC",
    "SP",
    "SE",
    "TO",
  ])("aceita %s e a mesma sigla com espaços e minúsculas", (uf) => {
    expect(ufBrasileiraValida(uf)).toBe(true);
    expect(ufBrasileiraValida(` ${uf.toLowerCase()} `)).toBe(true);
  });

  it.each(["", " ", "M", "ZZ", "12", "MGG", undefined])("recusa %s", (uf) => {
    expect(ufBrasileiraValida(uf)).toBe(false);
  });
});
