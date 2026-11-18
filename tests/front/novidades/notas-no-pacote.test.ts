// @vitest-environment jsdom
import notasDasVersoes from "@/novidades/notas-das-versoes.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTAS_NO_PACOTE,
  cortarNotasAntigas,
  notasRecentesDasVersoes,
} from "../../../scripts/notasRecentesDasVersoes";

const nota = (titulo: string) => ({
  titulo,
  novidades: [`${titulo}.`],
  correcoes: [],
  melhorias: [],
});

describe("cortarNotasAntigas", () => {
  it("fica com as N mais novas por ordem NUMÉRICA, não alfabética", () => {
    const json = JSON.stringify({
      "1.5.9": nota("nove"),
      "1.5.10": nota("dez"),
      "1.5.100": nota("cem"),
      "1.4.200": nota("quatro"),
    });
    expect(Object.keys(JSON.parse(cortarNotasAntigas(json, 2)))).toEqual([
      "1.5.10",
      "1.5.100",
    ]);
  });

  it("não mexe no conteúdo das notas que ficam nem na ordem delas", () => {
    const todas = {
      "1.0.3": nota("c"),
      "1.0.1": nota("a"),
      "1.0.2": nota("b"),
    };
    const cortado = JSON.parse(cortarNotasAntigas(JSON.stringify(todas), 2));
    expect(cortado).toEqual({
      "1.0.3": todas["1.0.3"],
      "1.0.2": todas["1.0.2"],
    });
    expect(Object.keys(cortado)).toEqual(["1.0.3", "1.0.2"]);
  });

  it("no limite exato (N notas) e abaixo dele nada é cortado", () => {
    const tres = { "1.0.1": nota("a"), "1.0.2": nota("b"), "1.0.3": nota("c") };
    expect(JSON.parse(cortarNotasAntigas(JSON.stringify(tres), 3))).toEqual(
      tres,
    );
    expect(JSON.parse(cortarNotasAntigas(JSON.stringify(tres), 50))).toEqual(
      tres,
    );
  });

  it("catálogo vazio continua vazio", () => {
    expect(JSON.parse(cortarNotasAntigas("{}", 20))).toEqual({});
  });

  it("recusa o que não é catálogo ou traz versão ilegível (falha fechada)", () => {
    expect(() => cortarNotasAntigas("[]", 20)).toThrow(/objeto/);
    expect(() => cortarNotasAntigas("null", 20)).toThrow(/objeto/);
    expect(() =>
      cortarNotasAntigas(
        JSON.stringify({ "1.0.1": nota("a"), abc: nota("b") }),
        1,
      ),
    ).toThrow(/abc/);
  });

  it("aceita versão com sufixo, lida pelo núcleo como o app lê", () => {
    const json = JSON.stringify({
      "1.0.2-sha.abc": nota("b"),
      "1.0.1": nota("a"),
    });
    expect(Object.keys(JSON.parse(cortarNotasAntigas(json, 1)))).toEqual([
      "1.0.2-sha.abc",
    ]);
  });
});

describe("notasRecentesDasVersoes (plugin)", () => {
  type Contexto = ThisParameterType<never>;
  const hooks = (plugin: ReturnType<typeof notasRecentesDasVersoes>) =>
    plugin as unknown as {
      buildStart: (this: Contexto) => void;
      transform: (
        this: Contexto,
        codigo: string,
        id: string,
      ) => { code: string; map: null } | null;
      generateBundle: (this: Contexto) => void;
    };
  const contexto = {} as Contexto;
  const catalogo = JSON.stringify(
    Object.fromEntries(
      Array.from({ length: NOTAS_NO_PACOTE + 5 }, (_, i) => [
        `1.0.${i + 1}`,
        nota(`n${i + 1}`),
      ]),
    ),
  );

  it("corta o arquivo de notas, com caminho de Windows e com query", () => {
    const p = hooks(notasRecentesDasVersoes());
    p.buildStart.call(contexto);
    for (const id of [
      "C:\\loja\\src\\novidades\\notas-das-versoes.json",
      "/loja/src/novidades/notas-das-versoes.json?import",
    ]) {
      const saida = p.transform.call(contexto, catalogo, id);
      expect(Object.keys(JSON.parse(saida?.code ?? "{}"))).toHaveLength(
        NOTAS_NO_PACOTE,
      );
    }
  });

  it("deixa qualquer outro JSON em paz", () => {
    const p = hooks(notasRecentesDasVersoes());
    p.buildStart.call(contexto);
    expect(
      p.transform.call(contexto, catalogo, "/loja/src/outro/notas.json"),
    ).toBeNull();
  });

  it("falha o build se o arquivo de notas nunca passou pelo corte", () => {
    const p = hooks(notasRecentesDasVersoes());
    p.buildStart.call(contexto);
    expect(() => p.generateBundle.call(contexto)).toThrow(/notas-das-versoes/);
    p.transform.call(
      contexto,
      catalogo,
      "/loja/src/novidades/notas-das-versoes.json",
    );
    expect(() => p.generateBundle.call(contexto)).not.toThrow();
  });
});

// O corte só é inocente se o aparelho guardar EXATAMENTE o mesmo com e sem ele.
// Isto roda o armazenamento de verdade (não um dublê) contra o catálogo real: se
// alguém subir o teto de notas guardadas no aparelho (LIMITE em
// armazenamento-local.ts) sem subir NOTAS_NO_PACOTE, ESTE teste reprova.
describe("o corte não muda o que o aparelho guarda", () => {
  afterEach(() => vi.doUnmock("@/novidades/notas-das-versoes.json"));

  const todas = notasDasVersoes as Record<string, unknown>;
  const partes = (v: string) => v.split(".").map(Number);
  const maisNovaPrimeiro = (a: string, b: string) => {
    const x = partes(a);
    const y = partes(b);
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  };
  const versoes = Object.keys(todas).sort(maisNovaPrimeiro);
  const agora = new Date("2026-10-16T10:00:00.000Z");

  // Cada passo é um BUILD diferente: o aparelho recebe o catálogo daquele build.
  const catalogoDoBuild = (para: string, cortar: boolean) => {
    const ate = Object.fromEntries(
      Object.entries(todas).filter(([v]) => maisNovaPrimeiro(v, para) >= 0),
    );
    return cortar
      ? JSON.parse(cortarNotasAntigas(JSON.stringify(ate), NOTAS_NO_PACOTE))
      : ate;
  };

  async function rodar(
    cortar: boolean,
    passos: Array<{ de: string | null; para: string }>,
  ) {
    localStorage.clear();
    const gravadas: number[] = [];
    let lista: unknown[] = [];
    for (const passo of passos) {
      vi.resetModules();
      vi.doMock("@/novidades/notas-das-versoes.json", () => ({
        default: catalogoDoBuild(passo.para, cortar),
      }));
      const armazenamento = await import("@/lib/novidades/armazenamento-local");
      gravadas.push(
        armazenamento.registrarNovidadesDaAtualizacao({ ...passo, agora }),
      );
      lista = armazenamento.listarNovidades();
    }
    return { gravadas, lista };
  }

  const atual = versoes[0];

  it("de qualquer origem (inclusive aparelho novo e versão anterior a todas)", async () => {
    expect(versoes.length).toBeGreaterThan(NOTAS_NO_PACOTE);
    for (const de of [null, "0.0.1", ...versoes]) {
      const inteiro = await rodar(false, [{ de, para: atual }]);
      const cortado = await rodar(true, [{ de, para: atual }]);
      expect(cortado, `de=${de}`).toEqual(inteiro);
    }
  });

  it("aparelho que passou por várias builds e repete a mesma faixa", async () => {
    const meio = versoes[Math.floor(versoes.length / 2)];
    const velho = versoes[versoes.length - 1];
    for (const passos of [
      [
        { de: velho, para: meio },
        { de: meio, para: atual },
      ],
      [
        { de: velho, para: atual },
        { de: velho, para: atual },
      ],
    ]) {
      expect(await rodar(true, passos)).toEqual(await rodar(false, passos));
    }
  });
});
