// @vitest-environment jsdom
//
// "Cupom preso" (issues #210 e #116), lado do checkout: quando a recusa é por
// LIMITE DE USO e há sessão, o `validateCoupon` pergunta ao banco
// (`vaga_do_cupom_presa`) se a vaga está presa num pedido cancelado do próprio
// cliente. Presa = a mensagem passa a dizer isso e em quanto tempo volta.
//
// O que este teste tranca é o lado de FORA dessa pergunta, que importa mais
// que o caminho feliz: a RPC pode não existir ainda (checkout novo + banco
// velho = PGRST202), a rede pode cair, a sessão pode não existir. Em todos
// esses casos a frase de HOJE continua, sem erro novo na tela e sem trocar a
// natureza da resposta (`networkError` só é do `validate_coupon_secure_v2`).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getSession = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: () => getSession() },
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_DE_HOJE = "Cupom atingiu o limite de uso.";

/** O que a validate_coupon_secure_v2 devolve quando o cupom está no limite. */
const RECUSA_POR_LIMITE = {
  data: { is_valid: false, discount_value: 0, error_message: FRASE_DE_HOJE },
  error: null,
};

/** Programa as duas RPCs: a validação e a pergunta da vaga presa. */
function programar(
  validate: unknown,
  vaga: unknown | (() => never) = {
    data: { presa: false, volta_em_minutos: null },
    error: null,
  },
) {
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "validate_coupon_secure_v2") return validate;
    if (nome === "vaga_do_cupom_presa") {
      if (typeof vaga === "function") return (vaga as () => never)();
      return vaga;
    }
    throw new Error(`rpc inesperada: ${nome}`);
  });
}

const chamadasDaVaga = () =>
  rpc.mock.calls.filter(([nome]) => nome === "vaga_do_cupom_presa");

describe("useCoupons.validateCoupon — cupom preso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    getSession.mockReset();
    toastError.mockReset();
    getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
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

  /** Sonda mínima: monta o hook com os hooks do React vivos e chama o método. */
  async function validar(codigo = "PROMO10", subtotal = 100) {
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

  describe("recusa por limite de uso, com sessão", () => {
    it("vaga presa: a mensagem diz que a vaga está num pedido cancelado e quando volta", async () => {
      programar(RECUSA_POR_LIMITE, {
        data: { presa: true, volta_em_minutos: 42 },
        error: null,
      });

      const r = await validar("PROMO10");

      expect(r.valid).toBe(false);
      expect(r.discount).toBe(0);
      expect(r.networkError).toBeUndefined();
      expect(r.message).toBe(
        "O cupom PROMO10 está no limite de usos agora. Uma vaga dele está presa num pedido seu que foi cancelado e volta sozinha em até 42 minutos.",
      );
      // A pergunta leva o código que a pessoa digitou, e só ele.
      expect(chamadasDaVaga()).toEqual([
        ["vaga_do_cupom_presa", { p_code: "PROMO10" }],
      ]);
    });

    it("o prazo longo vira horas", async () => {
      programar(RECUSA_POR_LIMITE, {
        data: { presa: true, volta_em_minutos: 1500 },
        error: null,
      });

      const r = await validar("PROMO10");

      expect(r.message).toContain("volta sozinha em até 25 horas.");
    });

    it("vaga NÃO presa: a frase de sempre", async () => {
      programar(RECUSA_POR_LIMITE, {
        data: { presa: false, volta_em_minutos: null },
        error: null,
      });

      const r = await validar();

      expect(r.message).toBe(FRASE_DE_HOJE);
      expect(r.valid).toBe(false);
      expect(chamadasDaVaga()).toHaveLength(1);
    });

    it("presa SEM prazo utilizável: a frase de sempre (sem promessa sem número)", async () => {
      programar(RECUSA_POR_LIMITE, {
        data: { presa: true, volta_em_minutos: null },
        error: null,
      });

      expect((await validar()).message).toBe(FRASE_DE_HOJE);
    });
  });

  describe("a pergunta falha: a frase de hoje continua e nada novo aparece", () => {
    it("RPC AUSENTE no banco (PGRST202, checkout novo + banco velho)", async () => {
      programar(RECUSA_POR_LIMITE, {
        data: null,
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.vaga_do_cupom_presa(p_code) in the schema cache",
        },
      });

      const r = await validar();

      expect(r.message).toBe(FRASE_DE_HOJE);
      expect(r.valid).toBe(false);
      expect(r.networkError).toBeUndefined();
      expect(toastError).not.toHaveBeenCalled();
    });

    it("erro de rede ao perguntar (a promessa rejeita)", async () => {
      programar(RECUSA_POR_LIMITE, () => {
        throw new TypeError("Failed to fetch");
      });

      const r = await validar();

      expect(r.message).toBe(FRASE_DE_HOJE);
      expect(r.networkError).toBeUndefined();
      expect(toastError).not.toHaveBeenCalled();
    });

    it("a leitura da sessão falha: a frase de sempre, sem perguntar", async () => {
      getSession.mockRejectedValue(new Error("storage indisponível"));
      programar(RECUSA_POR_LIMITE);

      const r = await validar();

      expect(r.message).toBe(FRASE_DE_HOJE);
      expect(r.networkError).toBeUndefined();
      expect(chamadasDaVaga()).toHaveLength(0);
    });

    it("resposta em formato inesperado", async () => {
      programar(RECUSA_POR_LIMITE, { data: "presa", error: null });

      expect((await validar()).message).toBe(FRASE_DE_HOJE);
    });
  });

  describe("quando a RPC nem é chamada", () => {
    it("SEM sessão: a pergunta não sai (a RPC é só para authenticated)", async () => {
      getSession.mockResolvedValue({ data: { session: null } });
      programar(RECUSA_POR_LIMITE, {
        data: { presa: true, volta_em_minutos: 42 },
        error: null,
      });

      const r = await validar();

      expect(r.message).toBe(FRASE_DE_HOJE);
      expect(chamadasDaVaga()).toHaveLength(0);
    });

    it.each([
      ["expirado", "Este cupom expirou."],
      ["inexistente", "Cupom inválido ou expirado."],
      ["mínimo", "Valor mínimo não atingido."],
      ["desligado pela loja", "Os cupons estão desativados nesta loja."],
    ])("outra recusa (%s) não pergunta nada", async (_motivo, frase) => {
      programar({
        data: { is_valid: false, discount_value: 0, error_message: frase },
        error: null,
      });

      const r = await validar();

      expect(r.message).toBe(frase);
      expect(chamadasDaVaga()).toHaveLength(0);
      expect(getSession).not.toHaveBeenCalled();
    });

    it("cupom VÁLIDO nunca pergunta, e o desconto sai intacto", async () => {
      programar(
        {
          data: { is_valid: true, discount_value: 10, error_message: "" },
          error: null,
        },
        { data: { presa: true, volta_em_minutos: 42 }, error: null },
      );

      const r = await validar("PROMO10", 100);

      expect(r).toEqual({ valid: true, discount: 10, message: "" });
      expect(chamadasDaVaga()).toHaveLength(0);
      expect(getSession).not.toHaveBeenCalled();
    });

    it("falha da PRÓPRIA validação continua sendo networkError, sem perguntar", async () => {
      rpc.mockRejectedValue(new TypeError("Failed to fetch"));

      const r = await validar();

      expect(r).toEqual({
        valid: false,
        discount: 0,
        message: "Erro na conexão com servidor",
        networkError: true,
      });
      expect(chamadasDaVaga()).toHaveLength(0);
    });
  });
});
