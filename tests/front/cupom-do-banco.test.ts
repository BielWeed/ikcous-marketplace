// @vitest-environment jsdom
//
// O mapeador ÚNICO do cupom (frente B, 28/09/2026): a linha de `coupons`
// (banco) vira o `Coupon` da tela por UMA função, usada pelo hook do painel,
// pelo espelho de tempo real e pelo pré-carregamento do admin. Antes eram três
// cópias que já tinham divergido uma vez (PAINEL-12). Aqui se prova a função
// e se prova que os TRÊS caminhos chegam ao mesmo resultado — inclusive com o
// campo novo `alcance` ("quem pode usar").
//
// A regra que dói: banco antigo (sem a coluna) ou valor desconhecido vira
// 'codigo' (secreto). O mapeador NUNCA inventa 'vitrine' — inventar poria um
// cupom secreto na vitrine do checkout de todo mundo.
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LINHAS: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: LINHAS, error: null }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ultimo: ReturnType<typeof import("@/hooks/useCoupons").useCoupons> | null =
  null;

const { alcanceDoBanco, cupomDoBanco } = await import("@/lib/cupom-do-banco");

const linhaBase = {
  id: "c1",
  code: "VIP15",
  type: "fixed",
  value: 15,
  min_purchase: null,
  usage_limit: null,
  usage_count: 3,
  valid_until: null,
  active: true,
};

describe("alcanceDoBanco", () => {
  it.each(["codigo", "vitrine", "exclusivo"])("aceita '%s'", (valor) => {
    expect(alcanceDoBanco(valor)).toBe(valor);
  });

  it.each([
    ["coluna ausente (banco antigo)", undefined],
    ["null", null],
    ["texto vazio", ""],
    ["caixa diferente", "VITRINE"],
    ["valor que não existe", "todos"],
    ["número", 1],
    ["objeto", { alcance: "vitrine" }],
  ])("%s vira 'codigo' (secreto) — nunca inventa vitrine", (_nome, valor) => {
    expect(alcanceDoBanco(valor)).toBe("codigo");
  });
});

describe("cupomDoBanco", () => {
  it("lê a linha inteira, com o alcance", () => {
    expect(cupomDoBanco({ ...linhaBase, alcance: "exclusivo" })).toEqual({
      id: "c1",
      code: "VIP15",
      type: "fixed",
      value: 15,
      minPurchase: undefined,
      usageLimit: undefined,
      usageCount: 3,
      validUntil: undefined,
      active: true,
      alcance: "exclusivo",
    });
  });

  it("linha de banco SEM a coluna alcance vira cupom secreto", () => {
    expect(cupomDoBanco(linhaBase).alcance).toBe("codigo");
  });

  it("usage_count é a única fonte da contagem: used_count presente não vence nem serve de reserva", () => {
    expect(cupomDoBanco({ ...linhaBase, used_count: 99 }).usageCount).toBe(3);
    expect(
      cupomDoBanco({ ...linhaBase, usage_count: null, used_count: 7 })
        .usageCount,
    ).toBe(0);
  });

  it("zero real continua zero (?? e não ||)", () => {
    expect(cupomDoBanco({ ...linhaBase, usage_count: 0 }).usageCount).toBe(0);
    expect(cupomDoBanco({ ...linhaBase, min_purchase: 0 }).minPurchase).toBe(0);
    expect(cupomDoBanco({ ...linhaBase, usage_limit: 0 }).usageLimit).toBe(0);
  });

  it("cupom DESLIGADO continua desligado; coluna que não veio conta como ligado", () => {
    expect(cupomDoBanco({ ...linhaBase, active: false }).active).toBe(false);
    expect(cupomDoBanco({ ...linhaBase, active: null }).active).toBe(true);
  });
});

describe("os três caminhos de leitura chegam ao mesmo cupom", () => {
  const cru = {
    ...linhaBase,
    alcance: "vitrine",
    min_purchase: 100,
    usage_limit: 10,
    valid_until: "2026-12-31T23:59:59Z",
    used_count: 99,
  };
  const esperado = cupomDoBanco(cru);

  beforeEach(() => {
    LINHAS.length = 0;
    LINHAS.push(cru);
  });

  it("espelho de tempo real", async () => {
    const { TABLE_CONFIGS } = await import("@/lib/realtimeSyncEngine");
    const tabela = TABLE_CONFIGS.find((c) => c.table === "coupons");
    expect(tabela?.mapRecord?.(cru)).toEqual(esperado);
    expect(esperado.alcance).toBe("vitrine");
  });

  it("pré-carregamento do admin", async () => {
    const cache = await import("@/utils/admin_cache");
    cache.setCachedCouponsData(null);
    await cache.prefetchCouponsData();
    expect(cache.cachedCouponsData).toEqual([esperado]);
    cache.setCachedCouponsData(null);
  });

  describe("hook do painel", () => {
    let raiz: Root;
    let hospedeiro: HTMLDivElement;

    beforeEach(() => {
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
    });

    afterEach(() => {
      act(() => raiz.unmount());
      hospedeiro.remove();
    });

    it("lista com o alcance de cada cupom", async () => {
      const cache = await import("@/utils/admin_cache");
      cache.setCachedCouponsData(null);
      const { useCoupons } = await import("@/hooks/useCoupons");
      function Sonda() {
        const valor = useCoupons(true);
        useEffect(() => {
          ultimo = valor;
        });
        return null;
      }
      await act(async () => {
        raiz.render(createElement(Sonda));
      });
      await act(async () => {});
      expect(ultimo?.coupons).toEqual([esperado]);
      cache.setCachedCouponsData(null);
    });
  });
});
