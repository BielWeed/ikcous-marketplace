// @vitest-environment jsdom
// Duas abas do painel no mesmo aparelho: a antiga (pacote com notas até a
// 1.0.3) e a nova (até a 1.0.4). O boot da nova anota "1.0.3 → 1.0.4" e já
// grava 1.0.4 como última versão vista. A aba antiga lê a anotação pelo evento
// `storage`, mas não tem o texto da 1.0.4: se a apagasse, ninguém anotaria de
// novo e a nota da 1.0.4 sumiria para sempre neste aparelho.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "notificacoes-novidades-do-app-v1";
const CHAVE_PENDENTES = "notificacoes-novidades-pendentes-do-app-v1";
const SEGUNDA = new Date("2026-11-23T10:00:00.000Z");
const TERCA = new Date("2026-11-24T15:30:00.000Z");

type Armazenamento = typeof import("@/lib/novidades/armazenamento-local");

/** Carrega um pacote novo (outra aba) que conhece as notas até 1.0.<ultima>. */
async function abaComNotasAte(ultima: number): Promise<Armazenamento> {
  vi.resetModules();
  vi.doMock("@/novidades/notas-das-versoes.json", () => ({
    default: Object.fromEntries(
      Array.from({ length: ultima }, (_, indice) => [
        `1.0.${indice + 1}`,
        {
          titulo: `Versão ${indice + 1}`,
          novidades: [`Novidade ${indice + 1}.`],
          correcoes: [],
          melhorias: [],
        },
      ]),
    ),
  }));
  return import("@/lib/novidades/armazenamento-local");
}

function anotar(faixas: Array<{ de: string; para: string; em: Date }>): string {
  const texto = JSON.stringify(
    faixas.map(({ de, para, em }) => ({ de, para, em: em.toISOString() })),
  );
  localStorage.setItem(CHAVE_PENDENTES, texto);
  return texto;
}

function versoes(armazenamento: Armazenamento): string[] {
  return armazenamento.listarNovidades().map(({ versao }) => versao);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock("@/novidades/notas-das-versoes.json");
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("faixa anotada por uma versão que o pacote ainda não conhece", () => {
  it("a aba antiga não consome a faixa; a nova a transforma em nota uma vez", async () => {
    const texto = anotar([{ de: "1.0.3", para: "1.0.4", em: SEGUNDA }]);

    const antiga = await abaComNotasAte(3);
    expect(versoes(antiga)).toEqual([]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBe(texto);
    expect(localStorage.getItem(CHAVE)).toBeNull();

    const nova = await abaComNotasAte(4);
    expect(nova.listarNovidades()).toEqual([
      expect.objectContaining({
        versao: "1.0.4",
        titulo: "Versão 4",
        registradaEm: SEGUNDA.toISOString(),
        lida: false,
      }),
    ]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
    // A aba antiga, relendo depois, vê a mesma nota sem duplicar.
    expect(versoes(antiga)).toEqual(["1.0.4"]);
  });

  it("faixa só em parte conhecida fica inteira para quem conhece o destino", async () => {
    // 1.0.2 → 1.0.4: a aba antiga tem o texto da 1.0.3, mas não o da 1.0.4.
    const texto = anotar([{ de: "1.0.2", para: "1.0.4", em: SEGUNDA }]);

    const antiga = await abaComNotasAte(3);
    expect(versoes(antiga)).toEqual([]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBe(texto);

    const nova = await abaComNotasAte(4);
    expect(
      nova
        .listarNovidades()
        .map(({ versao, registradaEm }) => [versao, registradaEm]),
    ).toEqual([
      ["1.0.4", SEGUNDA.toISOString()],
      ["1.0.3", SEGUNDA.toISOString()],
    ]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
  });

  it("consome só as faixas conhecidas e guarda a do futuro, sem perder o lida", async () => {
    anotar([
      { de: "1.0.1", para: "1.0.2", em: SEGUNDA },
      { de: "1.0.2", para: "1.0.4", em: TERCA },
    ]);

    const antiga = await abaComNotasAte(3);
    expect(versoes(antiga)).toEqual(["1.0.2"]);
    expect(JSON.parse(localStorage.getItem(CHAVE_PENDENTES) ?? "null")).toEqual(
      [{ de: "1.0.2", para: "1.0.4", em: TERCA.toISOString() }],
    );
    antiga.marcarNovidadeComoLida("1.0.2");

    const nova = await abaComNotasAte(4);
    expect(
      nova
        .listarNovidades()
        .map(({ versao, registradaEm, lida }) => [versao, registradaEm, lida]),
    ).toEqual([
      ["1.0.4", TERCA.toISOString(), false],
      ["1.0.3", TERCA.toISOString(), false],
      ["1.0.2", SEGUNDA.toISOString(), true],
    ]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
  });

  it("destino que o pacote conhece continua sendo consumido na hora", async () => {
    anotar([{ de: "1.0.2", para: "1.0.3", em: SEGUNDA }]);

    const atual = await abaComNotasAte(3);
    expect(versoes(atual)).toEqual(["1.0.3"]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
  });

  it("volta de versão (destino mais antigo que as notas) também é consumida", async () => {
    anotar([{ de: "1.0.4", para: "1.0.3", em: SEGUNDA }]);

    const atual = await abaComNotasAte(4);
    expect(versoes(atual)).toEqual([]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
  });
});
