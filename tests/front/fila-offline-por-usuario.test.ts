// @vitest-environment jsdom
//
// As regras puras da chave por usuário das filas offline (L10): chave, prazo de
// 72 h e migração da fila ANTIGA. O comportamento das filas inteiras está nos
// testes de useOrders e useProducts; aqui ficam as bordas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_BASE_DA_FILA_DE_PEDIDOS,
  PRAZO_DA_FILA_OFFLINE_MS,
  chaveDoUsuario,
  migrarFilaLegada,
  separarItensVencidos,
} from "@/lib/fila-offline-por-usuario";

const AGORA = 1_700_000_000_000;

describe("chaveDoUsuario", () => {
  it("é <chave antiga>:<uid>", () => {
    expect(chaveDoUsuario("orders_offline_updates_queue", "u1")).toBe(
      "orders_offline_updates_queue:u1",
    );
  });
});

describe("PRAZO_DA_FILA_OFFLINE_MS", () => {
  it("é de 72 horas", () => {
    expect(PRAZO_DA_FILA_OFFLINE_MS).toBe(72 * 60 * 60 * 1000);
  });
});

describe("separarItensVencidos", () => {
  it("separa pelo prazo; exatamente 72 h ainda vale, 1 ms a mais não", () => {
    const noLimite = { id: "a", timestamp: AGORA - PRAZO_DA_FILA_OFFLINE_MS };
    const passou = {
      id: "b",
      timestamp: AGORA - PRAZO_DA_FILA_OFFLINE_MS - 1,
    };
    const recente = { id: "c", timestamp: AGORA - 1000 };
    const { validos, vencidos } = separarItensVencidos(
      [noLimite, passou, recente],
      AGORA,
      "valido",
    );
    expect(validos).toEqual([noLimite, recente]);
    expect(vencidos).toEqual([passou]);
  });

  it.each([
    [{ id: "x" }],
    [{ id: "x", timestamp: "123" }],
    [{ id: "x", timestamp: Number.NaN }],
    [{ id: "x", timestamp: null }],
    [null],
    ["lixo"],
  ])("sem timestamp numérico (%j): vale o que o chamador decidir", (item) => {
    expect(separarItensVencidos([item], AGORA, "valido").validos).toEqual([
      item,
    ]);
    expect(separarItensVencidos([item], AGORA, "vencido").vencidos).toEqual([
      item,
    ]);
  });

  it("fila vazia", () => {
    expect(separarItensVencidos([], AGORA, "valido")).toEqual({
      validos: [],
      vencidos: [],
    });
  });

  it("timestamp no futuro (relógio adiantado) não vence", () => {
    const item = { timestamp: AGORA + 10 * 60 * 60 * 1000 };
    expect(separarItensVencidos([item], AGORA, "vencido").validos).toEqual([
      item,
    ]);
  });
});

describe("migrarFilaLegada", () => {
  const BASE = CHAVE_BASE_DA_FILA_DE_PEDIDOS;
  const idDe = (i: unknown) => (i as { orderId?: string } | null)?.orderId;

  // Node 25 pisa em `localStorage` global antes do jsdom: um armazém próprio,
  // como nos outros testes que mexem em storage.
  let mapa: Map<string, string>;
  let chaveQueFalha: string | null;
  beforeEach(() => {
    mapa = new Map();
    chaveQueFalha = null;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mapa.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === chaveQueFalha) {
          throw new DOMException("cheio", "QuotaExceededError");
        }
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

  it("leva os itens para a chave do usuário e remove a antiga", () => {
    const item = { orderId: "p1", timestamp: 5 };
    localStorage.setItem(BASE, JSON.stringify([item]));

    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(1);

    expect(localStorage.getItem(BASE)).toBeNull();
    expect(JSON.parse(localStorage.getItem(`${BASE}:u1`) ?? "null")).toEqual([
      item,
    ]);
  });

  it("não há fila antiga: não faz nada e não cria chave nova", () => {
    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("junta com a fila do usuário; no mesmo id fica o item de timestamp maior", () => {
    localStorage.setItem(
      BASE,
      JSON.stringify([
        { orderId: "p1", status: "velho", timestamp: 1 },
        { orderId: "p2", status: "so-antigo", timestamp: 1 },
      ]),
    );
    localStorage.setItem(
      `${BASE}:u1`,
      JSON.stringify([{ orderId: "p1", status: "novo", timestamp: 9 }]),
    );

    migrarFilaLegada(BASE, "u1", idDe);

    expect(JSON.parse(localStorage.getItem(`${BASE}:u1`) ?? "[]")).toEqual([
      { orderId: "p1", status: "novo", timestamp: 9 },
      { orderId: "p2", status: "so-antigo", timestamp: 1 },
    ]);
  });

  it("o item antigo MAIS NOVO vence o do usuário no mesmo id", () => {
    localStorage.setItem(
      BASE,
      JSON.stringify([{ orderId: "p1", status: "mais-novo", timestamp: 9 }]),
    );
    localStorage.setItem(
      `${BASE}:u1`,
      JSON.stringify([{ orderId: "p1", status: "velho", timestamp: 1 }]),
    );

    migrarFilaLegada(BASE, "u1", idDe);

    expect(JSON.parse(localStorage.getItem(`${BASE}:u1`) ?? "[]")).toEqual([
      { orderId: "p1", status: "mais-novo", timestamp: 9 },
    ]);
  });

  it("rodar duas vezes é inofensivo (idempotente)", () => {
    localStorage.setItem(
      BASE,
      JSON.stringify([{ orderId: "p1", timestamp: 1 }]),
    );
    migrarFilaLegada(BASE, "u1", idDe);
    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(0);
    expect(JSON.parse(localStorage.getItem(`${BASE}:u1`) ?? "[]")).toHaveLength(
      1,
    );
  });

  it("chave antiga com JSON quebrado: nada é tocado", () => {
    localStorage.setItem(BASE, "{quebrado");
    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(0);
    expect(localStorage.getItem(BASE)).toBe("{quebrado");
    expect(localStorage.getItem(`${BASE}:u1`)).toBeNull();
  });

  it("chave do usuário com JSON quebrado: nada é tocado (não se sobrescreve o que não se leu)", () => {
    localStorage.setItem(BASE, JSON.stringify([{ orderId: "p1" }]));
    localStorage.setItem(`${BASE}:u1`, "{quebrado");
    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(0);
    expect(localStorage.getItem(`${BASE}:u1`)).toBe("{quebrado");
    expect(localStorage.getItem(BASE)).not.toBeNull();
  });

  it("falha ao gravar a chave nova (cota): a antiga continua INTEIRA", () => {
    const item = { orderId: "p1", timestamp: 1 };
    localStorage.setItem(BASE, JSON.stringify([item]));
    chaveQueFalha = `${BASE}:u1`;

    expect(() => migrarFilaLegada(BASE, "u1", idDe)).toThrow();

    expect(JSON.parse(mapa.get(BASE) ?? "null")).toEqual([item]);
    expect(mapa.has(`${BASE}:u1`)).toBe(false);
  });

  it("fila antiga vazia ([]): a chave antiga é limpa e nada é criado", () => {
    localStorage.setItem(BASE, "[]");
    expect(migrarFilaLegada(BASE, "u1", idDe)).toBe(0);
    expect(localStorage.getItem(BASE)).toBeNull();
    expect(localStorage.getItem(`${BASE}:u1`)).toBeNull();
  });
});
