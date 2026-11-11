// @vitest-environment jsdom
import { setCachedCouponsData } from "@/utils/admin_cache";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  O banco responde SUCESSO com 0 linhas quando a política de acesso barra o
  UPDATE/DELETE do cupom (admin rebaixado, cupom já apagado em outro aparelho).
  O painel não pode dizer "Cupom atualizado"/"Cupom removido" nem gravar na tela
  o estado que o banco recusou: o interruptor "desativar" que não gravou deixa
  o desconto valendo no checkout.
*/
const banco = vi.hoisted(() => ({
  resposta: { data: [{ id: "c" }], error: null } as {
    data: unknown;
    error: { code?: string; message?: string } | null;
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => ({ select: async () => banco.resposta }),
      }),
      delete: () => ({
        eq: () => ({ select: async () => banco.resposta }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
type Hook = ReturnType<typeof import("@/hooks/useCoupons")["useCoupons"]>;

const cupomNaTela = {
  id: "c",
  code: "PROMO10",
  type: "percentage",
  value: 10,
  usageCount: 0,
  active: true,
  alcance: "codigo",
};

describe("cupom: o painel só confirma o que o banco gravou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook: Hook;

  beforeEach(async () => {
    vi.clearAllMocks();
    banco.resposta = { data: [{ id: "c" }], error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    setCachedCouponsData([cupomNaTela]);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { useCoupons } = await import("@/hooks/useCoupons");
    function Sonda() {
      const valor = useCoupons(false);
      useEffect(() => {
        hook = valor;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    setCachedCouponsData(null);
    vi.restoreAllMocks();
  });

  it("controle: update com 1 linha gravada confirma e atualiza a tela", async () => {
    expect(hook.coupons[0]?.active).toBe(true);
    await act(async () => hook.updateCoupon("c", { active: false }));
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Cupom atualizado");
    expect(toast.error).not.toHaveBeenCalled();
    expect(hook.coupons[0]?.active).toBe(false);
  });

  it("update com 0 linhas (política barrou) rejeita, avisa erro e não muda a tela", async () => {
    banco.resposta = { data: [], error: null };
    await act(async () => {
      await expect(hook.updateCoupon("c", { active: false })).rejects.toThrow(
        "Nenhum cupom foi alterado.",
      );
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(hook.coupons).toHaveLength(1);
    expect(hook.coupons[0]?.active).toBe(true);
  });

  it("controle: delete com 1 linha apagada confirma 'Cupom removido'", async () => {
    await act(async () => hook.deleteCoupon("c"));
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Cupom removido");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("delete com 0 linhas rejeita e NÃO diz 'Cupom removido'", async () => {
    banco.resposta = { data: [], error: null };
    await act(async () => {
      await expect(hook.deleteCoupon("c")).rejects.toThrow(
        "Nenhum cupom foi apagado.",
      );
    });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Erro ao remover cupom",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("delete de cupom já usado (23503) rejeita e aponta a saída: DESATIVAR", async () => {
    const error = { code: "23503", message: "violates foreign key constraint" };
    banco.resposta = { data: null, error };
    await act(async () => {
      await expect(hook.deleteCoupon("c")).rejects.toBe(error);
    });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "Este cupom não pode ser apagado",
      expect.objectContaining({
        description: expect.stringContaining("DESATIVE-o"),
      }),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
