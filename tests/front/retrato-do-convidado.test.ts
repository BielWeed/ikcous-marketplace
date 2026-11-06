// @vitest-environment jsdom
//
// O retrato do rastreio sem conta (sessionStorage `guest_tracked_orders`) ganhou
// o horário da consulta. O formato novo é `{ consultadoEm, pedidos }`; o antigo
// era só a lista de pedidos, e um aparelho com aba aberta pode ter guardado o
// antigo antes da atualização — os DOIS têm de ser lidos, sem quebrar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVENTO_RETRATO_LIMPO,
  gravarRetratoDoConvidado,
  interpretarRetrato,
  lerRetratoDoConvidado,
  limparRetratoDoConvidado,
  textoDoRetrato,
} from "@/lib/retrato-do-convidado";

const pedido = { id: "ped-1", status: "shipping" } as never;

describe("interpretarRetrato — aceita o formato novo e o antigo", () => {
  it("formato ANTIGO (lista pura): devolve os pedidos e horário desconhecido", () => {
    expect(interpretarRetrato(JSON.stringify([pedido]))).toEqual({
      pedidos: [pedido],
      consultadoEm: null,
    });
  });

  it("formato NOVO: devolve os pedidos e o horário gravado", () => {
    expect(
      interpretarRetrato(
        JSON.stringify({ consultadoEm: 1_700_000_000_000, pedidos: [pedido] }),
      ),
    ).toEqual({ pedidos: [pedido], consultadoEm: 1_700_000_000_000 });
  });

  it("formato novo com horário ilegível: mantém os pedidos, horário desconhecido", () => {
    for (const ruim of ["ontem", null, -5, Number.NaN, 0]) {
      expect(
        interpretarRetrato(
          JSON.stringify({ consultadoEm: ruim, pedidos: [pedido] }),
        ),
      ).toEqual({ pedidos: [pedido], consultadoEm: null });
    }
  });

  it("lixo, vazio e formatos desconhecidos viram null (nunca lançam)", () => {
    expect(interpretarRetrato(null)).toBeNull();
    expect(interpretarRetrato("")).toBeNull();
    expect(interpretarRetrato("{quebrado")).toBeNull();
    expect(interpretarRetrato("42")).toBeNull();
    expect(interpretarRetrato('"texto"')).toBeNull();
    expect(interpretarRetrato(JSON.stringify({ pedidos: "x" }))).toBeNull();
    expect(interpretarRetrato(JSON.stringify({ outra: [pedido] }))).toBeNull();
  });
});

describe("gravar / ler / limpar no sessionStorage", () => {
  let dados: Map<string, string>;
  beforeEach(() => {
    dados = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (c: string) => dados.get(c) ?? null,
      setItem: (c: string, v: string) => {
        dados.set(c, String(v));
      },
      removeItem: (c: string) => {
        dados.delete(c);
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("grava no formato novo, com o horário, e lê de volta", () => {
    gravarRetratoDoConvidado([pedido], 1_700_000_000_000);
    expect(JSON.parse(dados.get("guest_tracked_orders") ?? "null")).toEqual({
      consultadoEm: 1_700_000_000_000,
      pedidos: [pedido],
    });
    expect(lerRetratoDoConvidado()).toEqual({
      pedidos: [pedido],
      consultadoEm: 1_700_000_000_000,
    });
  });

  it("lê um retrato já guardado no formato antigo", () => {
    dados.set("guest_tracked_orders", JSON.stringify([pedido]));
    expect(lerRetratoDoConvidado()).toEqual({
      pedidos: [pedido],
      consultadoEm: null,
    });
  });

  it("sem retrato, ou com o armazenamento bloqueado, lê null", () => {
    expect(lerRetratoDoConvidado()).toBeNull();
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
    });
    expect(lerRetratoDoConvidado()).toBeNull();
  });

  it("limpar apaga a chave e avisa quem está ouvindo", () => {
    gravarRetratoDoConvidado([pedido], 1);
    const ouvinte = vi.fn();
    globalThis.addEventListener(EVENTO_RETRATO_LIMPO, ouvinte);
    limparRetratoDoConvidado();
    globalThis.removeEventListener(EVENTO_RETRATO_LIMPO, ouvinte);
    expect(dados.has("guest_tracked_orders")).toBe(false);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });

  it("limpar com o armazenamento bloqueado ainda avisa (a tela esvazia mesmo assim)", () => {
    vi.stubGlobal("sessionStorage", {
      removeItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
    });
    const ouvinte = vi.fn();
    globalThis.addEventListener(EVENTO_RETRATO_LIMPO, ouvinte);
    expect(() => limparRetratoDoConvidado()).not.toThrow();
    globalThis.removeEventListener(EVENTO_RETRATO_LIMPO, ouvinte);
    expect(ouvinte).toHaveBeenCalledTimes(1);
  });
});

describe("textoDoRetrato — de que hora é o status", () => {
  const consulta = new Date(2026, 10, 5, 9, 7).getTime();

  it("mesmo dia: só a hora, com zero à esquerda", () => {
    expect(textoDoRetrato(consulta, new Date(2026, 10, 5, 18, 0))).toBe(
      "Status de 09:07 — pode ter mudado",
    );
  });

  it("outro dia: diz o dia também", () => {
    expect(textoDoRetrato(consulta, new Date(2026, 10, 7, 8, 0))).toBe(
      "Status de 05/11 às 09:07 — pode ter mudado",
    );
  });

  it("horário desconhecido (retrato antigo): não inventa hora", () => {
    expect(textoDoRetrato(null)).toBe(
      "Status de quando você consultou — pode ter mudado",
    );
  });
});
