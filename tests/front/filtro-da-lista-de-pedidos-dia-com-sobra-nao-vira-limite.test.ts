import {
  fimDoDiaDaLoja,
  inicioDoDiaDaLoja,
  periodoInvertido,
} from "@/lib/filtro-da-lista-de-pedidos";
import { describe, expect, it } from "vitest";

// Caça por mutação em `diaValido` (filtro por data da lista de pedidos). O teste
// vizinho (`filtro-da-lista-de-pedidos.test.ts`) prova dias que não existem
// ("2026-02-30"), mas deixava passar as duas âncoras do formato: texto solto
// guardado no navegador com sobra antes ou depois da data — " 2026-10-14",
// "2026-10-14 ", "2026-10-14-05" ou ano de 5 dígitos — era aceito e virava um
// limite como "2026-10-14 T00:00:00-03:00" (texto que o banco não entende)
// ou "12026-10-14T00:00:00-03:00" (ano 12026) em vez de "sem limite".
// Texto puro: independe de fuso e de relógio.

describe("diaValido — só AAAA-MM-DD exato vira limite do período", () => {
  it("controle: o dia exato vira início e fim em Brasília", () => {
    expect(inicioDoDiaDaLoja("2026-10-14")).toBe("2026-10-14T00:00:00-03:00");
    expect(fimDoDiaDaLoja("2026-10-14")).toBe("2026-10-14T23:59:59.999-03:00");
  });

  it.each([
    ["espaço depois", "2026-10-14 "],
    ["espaço antes", " 2026-10-14"],
    ["sobra depois", "2026-10-14-05"],
    ["ano de 5 dígitos", "12026-10-14"],
    ["lixo antes", "x2026-10-14"],
  ])("%s não vira limite (%j)", (_, dia) => {
    expect(inicioDoDiaDaLoja(dia)).toBeUndefined();
    expect(fimDoDiaDaLoja(dia)).toBeUndefined();
  });

  it("dia com sobra não conta como período invertido", () => {
    expect(periodoInvertido("2026-10-14 ", "2026-10-13")).toBe(false);
    expect(periodoInvertido("2026-10-14", "2026-10-13 ")).toBe(false);
    expect(periodoInvertido("2026-10-14", "2026-10-13")).toBe(true);
  });
});
