// @vitest-environment jsdom
//
// `validateCoupon` manda o subtotal ao servidor, e é dele que o servidor tira o
// desconto e confere o "mínimo do pedido". Achados por mutação, 24/11/2026,
// que passavam com a suíte inteira verde:
//  - tirar o `arredondarParaCentavos(subtotal)`: dois preços normais somam
//    errado em ponto flutuante (10,10 + 10,20 = 20.299999999999997) e o
//    servidor receberia R$ 20,2999..., ficando UM CENTAVO ABAIXO do mínimo
//    "R$ 20,30" que a cliente acabou de atingir (recusa "Faltam R$ 0,00") e
//    calculando a porcentagem sobre a base errada;
//  - tirar a guarda de resposta vazia: o servidor responder sem corpo caía no
//    `catch` e a cliente lia "falha de conexão" (e o checkout tratava como
//    erro de rede) em vez de "Erro ao validar cupom".
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("useCoupons.validateCoupon — o que vai e o que volta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function validar(codigo: string, subtotal: number) {
    const { useCoupons } = await import("@/hooks/useCoupons");

    type Metodo = (
      code: string,
      subtotal: number,
    ) => Promise<{
      valid: boolean;
      discount: number;
      message?: string;
      networkError?: boolean;
    }>;
    let validateCoupon!: Metodo;

    function Sonda() {
      const { validateCoupon: metodo } = useCoupons(false);
      useEffect(() => {
        validateCoupon = metodo as Metodo;
      }, [metodo]);
      return null;
    }

    await act(async () => {
      raiz.render(<Sonda />);
    });
    let resultado!: Awaited<ReturnType<Metodo>>;
    await act(async () => {
      resultado = await validateCoupon(codigo, subtotal);
    });
    return resultado;
  }

  it("o subtotal vai ao servidor em centavos exatos, sem o ruído da soma de preços", async () => {
    rpc.mockResolvedValue({
      data: { is_valid: true, discount_value: 2.03, error_message: "" },
      error: null,
    });

    const somaComRuido = 10.1 + 10.2;
    // A premissa do teste: a soma crua NÃO é 20,30 em ponto flutuante.
    expect(somaComRuido).not.toBe(20.3);

    await validar("PROMO10", somaComRuido);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [nome, parametros] = rpc.mock.calls[0];
    expect(nome).toBe("validate_coupon_secure_v2");
    expect(parametros).toEqual({ p_code: "PROMO10", p_subtotal: 20.3 });
  });

  it("servidor sem corpo na resposta vira 'Erro ao validar cupom', não falha de conexão", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    const r = await validar("PROMO10", 100);

    expect(r).toEqual({
      valid: false,
      discount: 0,
      message: "Erro ao validar cupom",
    });
    expect(r.networkError).toBeUndefined();
  });
});
