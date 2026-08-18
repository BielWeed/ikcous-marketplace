// @vitest-environment jsdom
//
// ADMIN-050 (#96), metade do cupom — e a trava que impede a correção de virar
// um estrago maior que o defeito.
//
// O DEFEITO: `updateCoupon` montava o objeto do UPDATE com todas as chaves
// fixas (`valid_until: updates.validUntil`, ...). Quando a lojista apagava a
// Validade, o formulário mandava `undefined`, o `JSON.stringify` do supabase-js
// descartava a chave antes de virar SQL, o `valid_until` antigo continuava no
// banco — e a tela dizia "Cupom atualizado". Depois da data, o cupom parava de
// funcionar no checkout sem ninguém entender por quê.
//
// A ARMADILHA: a saída óbvia — trocar `undefined` por `null` no objeto — seria
// pior que o defeito. `AdminCouponsView.tsx:564` liga e desliga cupom com
// `updateCoupon(id, { active: checked })`, um patch de UMA chave. Com `null`
// forçado, cada clique nesse interruptor apagaria código, tipo, valor, validade
// e limite de uso do cupom. Hoje isso não acontece só porque o `undefined` some
// — ou seja, o mesmo descarte que causa o defeito é o que segura o patch de pé.
//
// A SAÍDA: montar o UPDATE por PRESENÇA DE CHAVE (`"validUntil" in updates`).
// Chave ausente = não mexe. Chave presente e vazia = limpa. As duas intenções
// deixam de ser a mesma coisa.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const eq = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        update(payload);
        return { eq: (...args: unknown[]) => eq(...args) };
      },
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
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

describe("useCoupons.updateCoupon — limpar campo persiste como null (#96)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    update.mockClear();
    eq.mockClear();
    eq.mockResolvedValue({ error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  /**
   * Monta uma sonda mínima só para alcançar `updateCoupon` com os hooks do
   * React vivos (o hook chama `useState` na primeira linha), chama o método e
   * devolve o payload que chegou ao `.update()` do supabase-js.
   */
  async function chamarUpdateCoupon(updates: Record<string, unknown>) {
    const { useCoupons } = await import("@/hooks/useCoupons");

    type Metodo = (id: string, u: unknown) => Promise<void>;
    let updateCoupon!: Metodo;

    // A captura vai num efeito, não no corpo do render: escrever em variável
    // de fora durante o render é efeito colateral, e o `react-hooks/globals`
    // do projeto reprova — com razão, porque um re-render extra reexecutaria
    // a atribuição em momento imprevisível.
    function Sonda() {
      const { updateCoupon: metodo } = useCoupons(false);
      useEffect(() => {
        updateCoupon = metodo as Metodo;
      }, [metodo]);
      return null;
    }

    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await updateCoupon("cupom-1", updates);
    });

    return update.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  it("apagar a Validade grava valid_until nulo", async () => {
    const payload = await chamarUpdateCoupon({
      code: "PROMO10",
      type: "percentage",
      value: 10,
      minPurchase: 0,
      usageLimit: 0,
      validUntil: undefined,
      active: true,
    });

    expect(payload).toHaveProperty("valid_until", null);
  });

  it("a âncora: campo preenchido continua chegando com o valor", async () => {
    // Sem isto, um payload vazio por engano faria o teste acima passar pelo
    // motivo errado.
    const payload = await chamarUpdateCoupon({
      code: "PROMO10",
      type: "percentage",
      value: 10,
      validUntil: "2026-12-31T00:00:00.000Z",
      active: true,
    });

    expect(payload).toHaveProperty("valid_until", "2026-12-31T00:00:00.000Z");
    expect(payload).toHaveProperty("code", "PROMO10");
    expect(payload).toHaveProperty("value", 10);
  });

  it("patch de UMA chave não pode encostar no resto do cupom", async () => {
    // É o interruptor da lista (AdminCouponsView.tsx:564). Se este teste ficar
    // vermelho, ligar um cupom está apagando o cupom.
    const payload = await chamarUpdateCoupon({ active: false });

    expect(payload).toEqual({ active: false });
    expect(payload).not.toHaveProperty("code");
    expect(payload).not.toHaveProperty("value");
    expect(payload).not.toHaveProperty("valid_until");
    expect(payload).not.toHaveProperty("min_purchase");
    expect(payload).not.toHaveProperty("usage_limit");
  });

  it("limpar o limite de uso e a compra mínima também persiste", async () => {
    const payload = await chamarUpdateCoupon({
      minPurchase: undefined,
      usageLimit: undefined,
    });

    expect(payload).toHaveProperty("min_purchase", null);
    expect(payload).toHaveProperty("usage_limit", null);
  });
});
