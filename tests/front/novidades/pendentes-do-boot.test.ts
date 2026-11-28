// @vitest-environment jsdom
// O boot da vitrine só ANOTA a faixa de versões atravessada (sem o texto das
// notas); quem tem o texto é o armazenamento do painel, que transforma a
// anotação em novidades quando a tela de Avisos lê. Para a lojista, o que
// aparece é o mesmo de antes: mesmas versões, mesma data, mesmo "lida".
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/novidades/notas-das-versoes.json", () => ({
  default: Object.fromEntries(
    Array.from({ length: 30 }, (_, indice) => [
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

const CHAVE = "notificacoes-novidades-do-app-v1";
const CHAVE_ULTIMA_VISTA = "notificacoes-ultima-versao-vista-do-app-v1";
const CHAVE_PENDENTES = "notificacoes-novidades-pendentes-do-app-v1";
const SEGUNDA = new Date("2026-11-23T10:00:00.000Z");
const TERCA = new Date("2026-11-24T15:30:00.000Z");

let boot: typeof import("@/lib/novidades/registro-do-boot");
let armazenamento: typeof import("@/lib/novidades/armazenamento-local");

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  boot = await import("@/lib/novidades/registro-do-boot");
  armazenamento = await import("@/lib/novidades/armazenamento-local");
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function pendentes(): unknown {
  return JSON.parse(localStorage.getItem(CHAVE_PENDENTES) ?? "null");
}

describe("o boot anota a faixa sem gravar o texto das notas", () => {
  it("grava só versões e data no aparelho, numa chave que sobrevive à purga", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");

    boot.registrarNovidadesAoIniciar("1.0.3-sha.novo", null, SEGUNDA);

    expect(localStorage.getItem(CHAVE)).toBeNull();
    expect(pendentes()).toEqual([
      { de: "1.0.1", para: "1.0.3", em: SEGUNDA.toISOString() },
    ]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).not.toContain("Novidade");
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.0.3");
    expect(chaveSobreviveAPurga(CHAVE_PENDENTES)).toBe(true);
  });

  it("primeiro acesso e mesma versão não anotam nada", () => {
    boot.registrarNovidadesAoIniciar("1.0.3", null, SEGUNDA);
    boot.registrarNovidadesAoIniciar("1.0.3-sha.outro", null, TERCA);

    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.0.3");
  });

  it("rodar o mesmo boot duas vezes (escrita interrompida) não duplica a faixa", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");
    boot.registrarNovidadesAoIniciar("1.0.2", null, SEGUNDA);
    // A última versão vista ficou para trás: o mesmo boot roda de novo.
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");
    boot.registrarNovidadesAoIniciar("1.0.2", null, TERCA);

    expect(pendentes()).toEqual([
      { de: "1.0.1", para: "1.0.2", em: SEGUNDA.toISOString() },
    ]);
  });

  it("aparelho que nunca abre o painel guarda no máximo 20 faixas, sem perder versão", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");
    for (let versao = 2; versao <= 30; versao++) {
      boot.registrarNovidadesAoIniciar(`1.0.${versao}`, null, SEGUNDA);
    }

    const faixas = pendentes() as Array<{ de: string; para: string }>;
    expect(faixas).toHaveLength(20);
    // As faixas antigas se fundem: a cobertura continua de 1.0.1 a 1.0.30.
    expect(faixas[0]).toMatchObject({ de: "1.0.1", para: "1.0.11" });
    expect(faixas.at(-1)).toMatchObject({ de: "1.0.29", para: "1.0.30" });
    expect(armazenamento.listarNovidades().map(({ versao }) => versao)).toEqual(
      Array.from({ length: 20 }, (_, i) => `1.0.${30 - i}`),
    );
  });

  it("anotação corrompida não derruba o boot e é substituída", () => {
    localStorage.setItem(CHAVE_PENDENTES, "{quebrado");
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");

    expect(() =>
      boot.registrarNovidadesAoIniciar("1.0.2", null, SEGUNDA),
    ).not.toThrow();
    expect(pendentes()).toEqual([
      { de: "1.0.1", para: "1.0.2", em: SEGUNDA.toISOString() },
    ]);
  });
});

describe("o painel transforma a anotação em novidades", () => {
  it("as notas aparecem com a data do boot, não a da leitura, e a anotação some", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");
    boot.registrarNovidadesAoIniciar("1.0.3", null, SEGUNDA);

    expect(armazenamento.listarNovidades()).toEqual([
      expect.objectContaining({
        versao: "1.0.3",
        titulo: "Versão 3",
        registradaEm: SEGUNDA.toISOString(),
        lida: false,
      }),
      expect.objectContaining({
        versao: "1.0.2",
        registradaEm: SEGUNDA.toISOString(),
        lida: false,
      }),
    ]);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
    expect(JSON.parse(localStorage.getItem(CHAVE) ?? "[]")).toHaveLength(2);
  });

  it("cada faixa guarda a data do PRÓPRIO boot", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");
    boot.registrarNovidadesAoIniciar("1.0.2", null, SEGUNDA);
    boot.registrarNovidadesAoIniciar("1.0.3", null, TERCA);

    expect(
      armazenamento
        .listarNovidades()
        .map(({ versao, registradaEm }) => [versao, registradaEm]),
    ).toEqual([
      ["1.0.3", TERCA.toISOString()],
      ["1.0.2", SEGUNDA.toISOString()],
    ]);
  });

  it("aparelho com notas do formato antigo mantém o que já foi lido", () => {
    // Gravado pelo build anterior, que punha o texto no aparelho no boot.
    localStorage.setItem(
      CHAVE,
      JSON.stringify([
        {
          versao: "1.0.2",
          titulo: "Texto antigo guardado",
          novidades: ["Guardado."],
          correcoes: [],
          melhorias: [],
          registradaEm: "2026-11-01T10:00:00.000Z",
          lida: true,
        },
        {
          versao: "1.0.1",
          titulo: "Outra antiga",
          novidades: ["Guardada."],
          correcoes: [],
          melhorias: [],
          registradaEm: "2026-10-30T10:00:00.000Z",
          lida: false,
        },
      ]),
    );
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.2");
    // Uma anotação repetindo a 1.0.2 (já lida) não a reabre nem a reescreve.
    localStorage.setItem(
      CHAVE_PENDENTES,
      JSON.stringify([{ de: "1.0.1", para: "1.0.2", em: TERCA.toISOString() }]),
    );
    boot.registrarNovidadesAoIniciar("1.0.3", null, TERCA);

    expect(
      armazenamento
        .listarNovidades()
        .map(({ versao, titulo, lida }) => [versao, titulo, lida]),
    ).toEqual([
      ["1.0.3", "Versão 3", false],
      ["1.0.2", "Texto antigo guardado", true],
      ["1.0.1", "Outra antiga", false],
    ]);
  });

  it("marcar como lida depois da leitura persiste e não ressuscita a anotação", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");
    boot.registrarNovidadesAoIniciar("1.0.2", null, SEGUNDA);
    armazenamento.marcarNovidadeComoLida("1.0.2");

    expect(armazenamento.listarNovidades()[0]?.lida).toBe(true);
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
  });

  it("faixa que outra aba anotou DURANTE a leitura não é apagada", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.0.1");
    boot.registrarNovidadesAoIniciar("1.0.2", null, SEGUNDA);
    const real = window.localStorage;
    let anotouNoMeio = false;
    vi.spyOn(window, "localStorage", "get").mockReturnValue({
      getItem(chave: string) {
        // Simula outra aba que terminou o boot da 1.0.3 entre a leitura da
        // anotação e a limpeza dela (o painel já gravou as notas).
        if (chave === CHAVE_PENDENTES && !anotouNoMeio && real.getItem(CHAVE)) {
          anotouNoMeio = true;
          real.setItem(
            CHAVE_PENDENTES,
            JSON.stringify([
              { de: "1.0.1", para: "1.0.2", em: SEGUNDA.toISOString() },
              { de: "1.0.2", para: "1.0.3", em: TERCA.toISOString() },
            ]),
          );
        }
        return real.getItem(chave);
      },
      setItem: real.setItem.bind(real),
      removeItem: real.removeItem.bind(real),
      clear: real.clear.bind(real),
      key: real.key.bind(real),
      length: 0,
    } as Storage);

    armazenamento.listarNovidades();
    vi.restoreAllMocks();

    expect(anotouNoMeio).toBe(true);
    expect(armazenamento.listarNovidades().map(({ versao }) => versao)).toEqual(
      ["1.0.3", "1.0.2"],
    );
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
  });

  it("anotação ilegível é descartada sem apagar as notas guardadas", () => {
    localStorage.setItem(
      CHAVE,
      JSON.stringify([
        {
          versao: "1.0.2",
          titulo: "Guardada",
          novidades: ["Guardada."],
          correcoes: [],
          melhorias: [],
          registradaEm: "2026-11-01T10:00:00.000Z",
          lida: true,
        },
      ]),
    );
    localStorage.setItem(
      CHAVE_PENDENTES,
      JSON.stringify([
        { de: "lixo", para: "1.0.3", em: SEGUNDA.toISOString() },
        { de: "1.0.2", para: "1.0.3", em: "não é data" },
        "texto",
      ]),
    );

    expect(armazenamento.listarNovidades().map(({ versao }) => versao)).toEqual(
      ["1.0.2"],
    );
    expect(localStorage.getItem(CHAVE_PENDENTES)).toBeNull();
  });

  it("a anotação feita em outra aba avisa a tela aberta", () => {
    // @ts-expect-error flag interna do React, sem tipo público.
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { useNovidadesDoAparelho } = armazenamento;
    function Sonda() {
      const { novidades, naoLidas } = useNovidadesDoAparelho();
      return createElement("span", null, `${novidades.length}:${naoLidas}`);
    }
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    act(() => raiz.render(createElement(Sonda)));
    expect(hospedeiro.textContent).toBe("0:0");

    // Outra aba terminou o boot da 1.0.3: só a anotação mudou no aparelho.
    act(() => {
      localStorage.setItem(
        CHAVE_PENDENTES,
        JSON.stringify([
          { de: "1.0.1", para: "1.0.3", em: SEGUNDA.toISOString() },
        ]),
      );
      window.dispatchEvent(
        new StorageEvent("storage", { key: CHAVE_PENDENTES }),
      );
    });

    expect(hospedeiro.textContent).toBe("2:2");
    act(() => raiz.unmount());
    hospedeiro.remove();
  });
});
