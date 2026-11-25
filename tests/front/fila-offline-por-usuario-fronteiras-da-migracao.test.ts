// @vitest-environment jsdom
//
// Bordas da migração da fila offline ANTIGA para a chave do usuário (L10) que
// o teste principal (`fila-offline-por-usuario.test.ts`) deixa sem prova: JSON
// válido que não é lista, itens sem identificador, empate de timestamp, o item
// do meio da fila e o número devolvido quando dois itens viram um.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_BASE_DA_FILA_DE_PEDIDOS,
  migrarFilaLegada,
} from "@/lib/fila-offline-por-usuario";

describe("migrarFilaLegada — bordas", () => {
  const BASE = CHAVE_BASE_DA_FILA_DE_PEDIDOS;
  const CHAVE_DO_USUARIO = `${BASE}:u1`;
  const idDe = (i: unknown) => (i as { orderId?: string } | null)?.orderId;

  let mapa: Map<string, string>;
  beforeEach(() => {
    mapa = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mapa.set(k, v);
      },
      removeItem: (k: string) => {
        mapa.delete(k);
      },
      get length() {
        return mapa.size;
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const gravada = () => JSON.parse(mapa.get(CHAVE_DO_USUARIO) ?? "null");

  it.each([["{}"], ['{"orderId":"p1"}'], ["null"], ["123"], ['"texto"']])(
    "chave antiga com JSON válido que NÃO é lista (%s): nada é tocado e nada é criado",
    (bruto) => {
      mapa.set(BASE, bruto);

      expect(() => migrarFilaLegada(BASE, "u1", idDe)).not.toThrow();
      expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(0);

      expect(mapa.get(BASE)).toBe(bruto);
      expect(mapa.has(CHAVE_DO_USUARIO)).toBe(false);
    },
  );

  it.each([["{}"], ["null"], ["123"]])(
    "chave do usuário com JSON válido que NÃO é lista (%s): a antiga fica inteira e a do usuário não é sobrescrita",
    (bruto) => {
      const item = { orderId: "p1", timestamp: 1 };
      mapa.set(BASE, JSON.stringify([item]));
      mapa.set(CHAVE_DO_USUARIO, bruto);

      expect(() => migrarFilaLegada(BASE, "u1", idDe)).not.toThrow();
      expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(0);

      expect(mapa.get(CHAVE_DO_USUARIO)).toBe(bruto);
      expect(JSON.parse(mapa.get(BASE) ?? "null")).toEqual([item]);
    },
  );

  it("itens SEM identificador nunca se juntam entre si: todos chegam", () => {
    mapa.set(
      BASE,
      JSON.stringify([
        { status: "sem-id-A", timestamp: 1 },
        { status: "sem-id-B", timestamp: 2 },
      ]),
    );
    mapa.set(
      CHAVE_DO_USUARIO,
      JSON.stringify([{ status: "sem-id-do-usuario", timestamp: 3 }]),
    );

    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(2);

    expect(gravada()).toEqual([
      { status: "sem-id-do-usuario", timestamp: 3 },
      { status: "sem-id-A", timestamp: 1 },
      { status: "sem-id-B", timestamp: 2 },
    ]);
  });

  it("empate de timestamp no mesmo id: fica o item que o usuário já tinha", () => {
    mapa.set(
      BASE,
      JSON.stringify([{ orderId: "p1", status: "da-antiga", timestamp: 5 }]),
    );
    mapa.set(
      CHAVE_DO_USUARIO,
      JSON.stringify([{ orderId: "p1", status: "do-usuario", timestamp: 5 }]),
    );

    migrarFilaLegada(BASE, "u1", idDe);

    expect(gravada()).toEqual([
      { orderId: "p1", status: "do-usuario", timestamp: 5 },
    ]);
  });

  it("o id repetido está no MEIO da fila do usuário: a comparação é com o item daquele id", () => {
    mapa.set(
      CHAVE_DO_USUARIO,
      JSON.stringify([
        { orderId: "pA", status: "A-recente", timestamp: 9 },
        { orderId: "pB", status: "B-velho", timestamp: 1 },
      ]),
    );
    mapa.set(
      BASE,
      JSON.stringify([{ orderId: "pB", status: "B-da-antiga", timestamp: 5 }]),
    );

    migrarFilaLegada(BASE, "u1", idDe);

    expect(gravada()).toEqual([
      { orderId: "pA", status: "A-recente", timestamp: 9 },
      { orderId: "pB", status: "B-da-antiga", timestamp: 5 },
    ]);
  });

  it("devolve quantos itens a fila ANTIGA tinha, mesmo quando dois viram um", () => {
    mapa.set(
      BASE,
      JSON.stringify([
        { orderId: "p1", status: "antiga", timestamp: 1 },
        { orderId: "p2", status: "so-antiga", timestamp: 1 },
      ]),
    );
    mapa.set(
      CHAVE_DO_USUARIO,
      JSON.stringify([{ orderId: "p1", status: "usuario", timestamp: 9 }]),
    );

    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(2);
    expect(gravada()).toHaveLength(2);
  });

  it("item da antiga SEM timestamp contra o do usuário COM timestamp: o datado fica", () => {
    mapa.set(BASE, JSON.stringify([{ orderId: "p1", status: "sem-data" }]));
    mapa.set(
      CHAVE_DO_USUARIO,
      JSON.stringify([{ orderId: "p1", status: "datado", timestamp: 7 }]),
    );

    migrarFilaLegada(BASE, "u1", idDe);

    expect(gravada()).toEqual([
      { orderId: "p1", status: "datado", timestamp: 7 },
    ]);
  });
});
