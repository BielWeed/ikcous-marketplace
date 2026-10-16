// @vitest-environment jsdom
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/novidades/notas-das-versoes.json", () => ({
  default: Object.fromEntries(
    Array.from({ length: 25 }, (_, indice) => [
      `1.0.${indice + 1}`,
      {
        titulo: "Pedidos mais claros",
        novidades: ["Veja seus pedidos com mais facilidade."],
        correcoes: [],
        melhorias: [],
      },
    ]),
  ),
}));

const chave = "notificacoes-novidades-do-app-v1";
const agora = new Date("2026-10-16T10:00:00.000Z");
let armazenamento: typeof import("@/lib/novidades/armazenamento-local");

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  armazenamento = await import("@/lib/novidades/armazenamento-local");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("novidades salvas no aparelho", () => {
  it("guarda data e leitura em uma chave preservada pela purga", () => {
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1",
        agora,
      }),
    ).toBe(1);
    expect(armazenamento.listarNovidades()).toEqual([
      {
        versao: "1.0.1",
        titulo: "Pedidos mais claros",
        novidades: ["Veja seus pedidos com mais facilidade."],
        correcoes: [],
        melhorias: [],
        registradaEm: "2026-10-16T10:00:00.000Z",
        lida: false,
      },
    ]);
    expect(chaveSobreviveAPurga(chave)).toBe(true);
    expect(JSON.parse(localStorage.getItem(chave) ?? "[]")).toHaveLength(1);
  });

  it("guarda uma entrada por versão, com a mais nova primeiro", () => {
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: "1.0.1",
        para: "1.0.3",
        agora,
      }),
    ).toBe(2);
    expect(armazenamento.listarNovidades().map((item) => item.versao)).toEqual([
      "1.0.3",
      "1.0.2",
    ]);
  });

  it("repetir a atualização não duplica nem reabre uma nota lida", () => {
    armazenamento.registrarNovidadesDaAtualizacao({
      de: null,
      para: "1.0.1",
      agora,
    });
    armazenamento.marcarNovidadeComoLida("1.0.1-sha.atual");
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1+outra",
        agora: new Date("2026-10-17T10:00:00.000Z"),
      }),
    ).toBe(0);
    expect(armazenamento.listarNovidades()).toHaveLength(1);
    expect(armazenamento.listarNovidades()[0]).toMatchObject({
      lida: true,
      registradaEm: "2026-10-16T10:00:00.000Z",
    });
  });

  it("marca só a versão pedida ou todas de uma vez", () => {
    armazenamento.registrarNovidadesDaAtualizacao({
      de: "1.0.0",
      para: "1.0.2",
      agora,
    });
    armazenamento.marcarNovidadeComoLida("1.0.1");
    expect(armazenamento.listarNovidades().map((item) => item.lida)).toEqual([
      false,
      true,
    ]);
    armazenamento.marcarNovidadeComoLida("inexistente");
    armazenamento.marcarTodasComoLidas();
    expect(armazenamento.listarNovidades().map((item) => item.lida)).toEqual([
      true,
      true,
    ]);
  });

  it("acrescenta notas novas sem reabrir as anteriores", () => {
    armazenamento.registrarNovidadesDaAtualizacao({
      de: null,
      para: "1.0.1",
      agora,
    });
    armazenamento.marcarTodasComoLidas();
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: "1.0.0",
        para: "1.0.3",
        agora,
      }),
    ).toBe(2);
    expect(armazenamento.listarNovidades().map((item) => item.lida)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("mantém só as 20 versões mais novas mesmo ao repetir a faixa", () => {
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: "1.0.0",
        para: "1.0.25",
        agora,
      }),
    ).toBe(20);
    const salvas = armazenamento.listarNovidades();
    expect(salvas).toHaveLength(20);
    expect(salvas[0]?.versao).toBe("1.0.25");
    expect(salvas[19]?.versao).toBe("1.0.6");
    armazenamento.marcarTodasComoLidas();
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: "1.0.0",
        para: "1.0.25",
        agora: new Date("2026-10-17T10:00:00.000Z"),
      }),
    ).toBe(0);
    const todasLidas = armazenamento
      .listarNovidades()
      .every((item) => item.lida);
    expect(todasLidas).toBe(true);
    expect(JSON.parse(localStorage.getItem(chave) ?? "[]")).toHaveLength(20);
  });

  it("relê o histórico persistido em uma nova carga do módulo", async () => {
    armazenamento.registrarNovidadesDaAtualizacao({
      de: null,
      para: "1.0.1",
      agora,
    });
    armazenamento.marcarTodasComoLidas();
    vi.resetModules();
    const recarregado = await import("@/lib/novidades/armazenamento-local");
    expect(recarregado.listarNovidades()[0]?.lida).toBe(true);
    expect(
      recarregado.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1",
      }),
    ).toBe(0);
  });

  it("continua em memória quando não consegue gravar", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("sem espaço");
    });
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1",
        agora,
      }),
    ).toBe(1);
    armazenamento.marcarTodasComoLidas();
    expect(armazenamento.listarNovidades()[0]?.lida).toBe(true);
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1",
      }),
    ).toBe(0);
  });

  it("preserva o último retrato se a leitura passar a lançar", () => {
    armazenamento.registrarNovidadesDaAtualizacao({
      de: null,
      para: "1.0.1",
      agora,
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("leitura bloqueada");
    });
    armazenamento.marcarTodasComoLidas();
    expect(armazenamento.listarNovidades()[0]?.lida).toBe(true);
  });

  it("funciona quando até acessar localStorage lança", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("acesso bloqueado");
    });
    expect(() => armazenamento.listarNovidades()).not.toThrow();
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1",
        agora,
      }),
    ).toBe(1);
    expect(armazenamento.listarNovidades()).toHaveLength(1);
  });

  it("funciona quando localStorage está indisponível", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1",
        agora,
      }),
    ).toBe(1);
    expect(armazenamento.listarNovidades()).toHaveLength(1);
  });

  it("trata JSON corrompido como vazio e pode voltar a salvar", () => {
    localStorage.setItem(chave, "{quebrado");
    expect(armazenamento.listarNovidades()).toEqual([]);
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "1.0.1",
        agora,
      }),
    ).toBe(1);
    expect(JSON.parse(localStorage.getItem(chave) ?? "[]")).toHaveLength(1);
  });

  it("ignora entradas persistidas sem os campos necessários", () => {
    localStorage.setItem(chave, JSON.stringify([null, { versao: "1.0.1" }]));
    expect(armazenamento.listarNovidades()).toEqual([]);
  });

  it("uma atualização sem notas não cria entrada", () => {
    expect(
      armazenamento.registrarNovidadesDaAtualizacao({
        de: null,
        para: "9.9.9",
        agora,
      }),
    ).toBe(0);
    expect(armazenamento.listarNovidades()).toEqual([]);
  });
});
