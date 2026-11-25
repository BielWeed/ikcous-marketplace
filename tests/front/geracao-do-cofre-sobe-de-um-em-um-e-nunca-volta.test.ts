// A geração do cofre local (`src/lib/geracao-do-cofre.ts`) é o aviso de que
// "a sessão acabou enquanto eu esperava": quem vai esperar anota o número antes
// e, ao voltar, descarta o que trouxe se o número mudou. Só o hook de analytics
// a tocava, por trás de dublê. Aqui se prende o contrato do contador:
//   · ler não muda o número;
//   · cada invalidação o muda (e para MAIS: nunca volta a um valor já visto,
//     senão uma gravação velha pareceria atual);
//   · quem anotou antes de DUAS invalidações também enxerga a mudança.
import {
  geracaoDoCofre,
  invalidarGravacoesEmVoo,
} from "@/lib/geracao-do-cofre";
import { describe, expect, it } from "vitest";

describe("geração do cofre", () => {
  it("ler a geração várias vezes devolve sempre o mesmo número inteiro", () => {
    const a = geracaoDoCofre();
    expect(Number.isInteger(a)).toBe(true);
    expect(geracaoDoCofre()).toBe(a);
    expect(geracaoDoCofre()).toBe(a);
  });

  it("cada invalidação sobe a geração em exatamente uma unidade", () => {
    const antes = geracaoDoCofre();
    invalidarGravacoesEmVoo();
    expect(geracaoDoCofre()).toBe(antes + 1);
    invalidarGravacoesEmVoo();
    expect(geracaoDoCofre()).toBe(antes + 2);
  });

  it("quem anotou a geração antes de uma espera vê que ela mudou depois do Sair", () => {
    const anotada = geracaoDoCofre();
    // ... a espera (rede, IndexedDB) acontece aqui; durante ela o Sair roda:
    invalidarGravacoesEmVoo();
    expect(geracaoDoCofre()).not.toBe(anotada);
  });

  it("quem anotou depois da invalidação continua valendo (a sessão nova não é descartada)", () => {
    invalidarGravacoesEmVoo();
    const anotada = geracaoDoCofre();
    expect(geracaoDoCofre()).toBe(anotada);
  });

  it("duas invalidações seguidas não devolvem a geração a um valor já anotado", () => {
    const anotadas = new Set<number>([geracaoDoCofre()]);
    for (let i = 0; i < 5; i++) {
      invalidarGravacoesEmVoo();
      const atual = geracaoDoCofre();
      expect(anotadas.has(atual)).toBe(false);
      anotadas.add(atual);
    }
  });
});
