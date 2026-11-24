// @vitest-environment jsdom
// Lacunas achadas por mutação em "O que há de novo": os testes existentes só
// variam o ÚLTIMO número da versão (1.0.x / 1.5.x), então ignorar o número do
// meio ou o primeiro na ordenação passava. Aqui as versões mudam de major e
// minor, em ordem numérica (1.10.0 vem depois de 1.9.0, que textualmente é o
// contrário), e o histórico gravado com versão repetida não perde o "já lida".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/novidades/notas-das-versoes.json", () => {
  const nota = {
    titulo: "Pedidos mais claros",
    novidades: ["Veja seus pedidos com mais facilidade."],
    correcoes: [],
    melhorias: [],
  };
  return {
    default: {
      "1.4.9": nota,
      "1.5.0": nota,
      "1.5.1": nota,
      "1.5.2": { ...nota, novidades: ["   "] },
      "1.9.0": nota,
      "1.10.0": nota,
      "2.0.0": nota,
    },
  };
});

const chave = "notificacoes-novidades-do-app-v1";
const agora = new Date("2026-10-16T10:00:00.000Z");
let notas: typeof import("@/lib/novidades/notas");
let armazenamento: typeof import("@/lib/novidades/armazenamento-local");

function entradaGravada(versao: string, lida: boolean, registradaEm = agora) {
  return {
    versao,
    titulo: "Pedidos mais claros",
    novidades: ["Veja seus pedidos com mais facilidade."],
    correcoes: [],
    melhorias: [],
    registradaEm: registradaEm.toISOString(),
    lida,
  };
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  notas = await import("@/lib/novidades/notas");
  armazenamento = await import("@/lib/novidades/armazenamento-local");
});

afterEach(() => {
  localStorage.clear();
});

describe("notasEntre — versões que mudam além do último número", () => {
  it("mudar o número do meio conta: de 1.4.9 para 1.5.1 anuncia 1.5.0 e 1.5.1", () => {
    expect(notas.notasEntre("1.4.9", "1.5.1").map((n) => n.versao)).toEqual([
      "1.5.0",
      "1.5.1",
    ]);
  });

  it("compara em número, não em texto: 1.10.0 vem depois de 1.9.0", () => {
    expect(notas.notasEntre("1.9.0", "2.0.0").map((n) => n.versao)).toEqual([
      "1.10.0",
      "2.0.0",
    ]);
    expect(notas.notasEntre("1.5.1", "1.10.0").map((n) => n.versao)).toEqual([
      "1.9.0",
      "1.10.0",
    ]);
  });

  it("origem mais nova no número do meio não anuncia nada do passado", () => {
    expect(notas.notasEntre("1.10.0", "1.9.0")).toEqual([]);
    expect(notas.notasEntre("1.9.0", "1.5.1")).toEqual([]);
  });

  it("nota com texto só de espaços é descartada em vez de aparecer vazia", () => {
    expect(notas.notasEntre("1.5.1", "1.5.2")).toEqual([]);
    expect(notas.notasEntre(null, "1.5.2")).toEqual([]);
  });
});

describe("novidades guardadas — ordem por número e versão repetida", () => {
  it("lista a mais nova primeiro mesmo trocando major e minor", () => {
    armazenamento.registrarNovidadesDaAtualizacao({
      de: "1.4.9",
      para: "2.0.0",
      agora,
    });
    expect(armazenamento.listarNovidades().map((n) => n.versao)).toEqual([
      "2.0.0",
      "1.10.0",
      "1.9.0",
      "1.5.1",
      "1.5.0",
    ]);
  });

  it("relógio inválido na hora de registrar não perde a nota nem grava data quebrada", () => {
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: "1.9.0",
        para: "1.10.0",
        agora: new Date(Number.NaN),
      }),
    ).toBe(1);
    const [nota] = armazenamento.listarNovidades();
    expect(Number.isFinite(Date.parse(nota?.registradaEm ?? ""))).toBe(true);
    const gravado: unknown = JSON.parse(localStorage.getItem(chave) ?? "[]");
    expect(Array.isArray(gravado) ? gravado : []).toHaveLength(1);
  });

  it("histórico gravado com a mesma versão duas vezes vira uma entrada e mantém o 'já lida'", () => {
    // Uma escrita antiga ou uma corrida entre abas pode deixar a versão repetida.
    localStorage.setItem(
      chave,
      JSON.stringify([
        entradaGravada("1.5.1", true),
        entradaGravada("1.5.1", false),
      ]),
    );
    const lidas = armazenamento.listarNovidades();
    expect(lidas).toHaveLength(1);
    expect(lidas[0]?.lida).toBe(true);
  });

  it("repetida na ordem inversa também termina lida", () => {
    localStorage.setItem(
      chave,
      JSON.stringify([
        entradaGravada("1.5.1", false),
        entradaGravada("1.5.1", true),
      ]),
    );
    expect(armazenamento.listarNovidades().map((n) => n.lida)).toEqual([true]);
  });

  it("sufixo de build no histórico gravado vira só o núcleo e a mesma versão não duplica", () => {
    localStorage.setItem(
      chave,
      JSON.stringify([
        entradaGravada("1.5.1-sha.abc", false),
        entradaGravada("1.5.1+build.9", true),
      ]),
    );
    const lidas = armazenamento.listarNovidades();
    expect(lidas.map((n) => n.versao)).toEqual(["1.5.1"]);
    expect(lidas[0]?.lida).toBe(true);
  });

  it("entrada gravada com data ilegível ou 'lida' que não é verdadeiro/falso é descartada", () => {
    localStorage.setItem(
      chave,
      JSON.stringify([
        { ...entradaGravada("1.5.0", false), registradaEm: "ontem" },
        { ...entradaGravada("1.5.1", false), lida: "sim" },
        entradaGravada("1.9.0", false),
      ]),
    );
    expect(armazenamento.listarNovidades().map((n) => n.versao)).toEqual([
      "1.9.0",
    ]);
  });
});
