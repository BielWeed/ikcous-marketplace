import { mensagemDeErroDoCupom } from "@/lib/erro-do-cupom";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  apagar: vi.fn(),
  filtroUpdate: vi.fn(),
  filtroDelete: vi.fn(),
  resposta: { data: [{ id: "cupom-alvo" }], error: null } as {
    data: unknown;
    error: { code?: string; message?: string } | null;
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => {
      banco.from(...args);
      return {
        insert: (valor: unknown) => {
          banco.insert(valor);
          return { select: () => ({ single: async () => banco.resposta }) };
        },
        update: (valor: unknown) => {
          banco.update(valor);
          return {
            eq: (...filtro: unknown[]) => {
              banco.filtroUpdate(...filtro);
              return { select: async () => banco.resposta };
            },
          };
        },
        delete: () => {
          banco.apagar();
          return {
            eq: (...filtro: unknown[]) => {
              banco.filtroDelete(...filtro);
              return { select: async () => banco.resposta };
            },
          };
        },
      };
    },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
type Hook = ReturnType<typeof import("@/hooks/useCoupons")["useCoupons"]>;
// Sem active de propósito: prova o padrão em tempo de execução para chamadores antigos.
const novoCupom = {
  code: "PROMO10",
  type: "percentage" as const,
  value: 10,
  minPurchase: 123.45,
  usageLimit: 57,
  validUntil: "2026-12-31T23:59:59.999Z",
} as Parameters<Hook["addCoupon"]>[0];

describe("gravação real do hook de cupons", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook: Hook;

  beforeEach(async () => {
    vi.clearAllMocks();
    banco.resposta = { data: [{ id: "cupom-alvo" }], error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.restoreAllMocks();
  });

  it("altera somente o id do cupom pedido, nunca outra coluna ou outro cupom", async () => {
    await act(async () => hook.updateCoupon("cupom-alvo", { value: 21 }));
    expect(banco.from).toHaveBeenCalledExactlyOnceWith("coupons");
    expect(banco.update).toHaveBeenCalledExactlyOnceWith({ value: 21 });
    expect(banco.filtroUpdate).toHaveBeenCalledExactlyOnceWith(
      "id",
      "cupom-alvo",
    );
    expect(banco.filtroDelete).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Cupom atualizado");
  });

  it("apaga somente o id do cupom pedido, nunca todos os ativos", async () => {
    await act(async () => hook.deleteCoupon("cupom-alvo"));
    expect(banco.from).toHaveBeenCalledExactlyOnceWith("coupons");
    expect(banco.apagar).toHaveBeenCalledTimes(1);
    expect(banco.filtroDelete).toHaveBeenCalledExactlyOnceWith(
      "id",
      "cupom-alvo",
    );
    expect(banco.filtroUpdate).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Cupom removido");
  });

  it("cria com mínimo, limite e validade distintos e contador zerado", async () => {
    await act(async () => {
      await hook.addCoupon(novoCupom);
    });
    expect(banco.from).toHaveBeenCalledExactlyOnceWith("coupons");
    expect(banco.insert).toHaveBeenCalledExactlyOnceWith([
      {
        code: "PROMO10",
        type: "percentage",
        value: 10,
        min_purchase: 123.45,
        usage_limit: 57,
        valid_until: "2026-12-31T23:59:59.999Z",
        active: true,
        usage_count: 0,
      },
    ]);
  });

  it.each(["criar", "editar"] as const)(
    "%s com 23505 explica que o código já existe e rejeita a gravação",
    async (operacao) => {
      const error = { code: "23505", message: "duplicate key value" };
      banco.resposta = { data: null, error };
      await act(async () => {
        const gravacao =
          operacao === "criar"
            ? hook.addCoupon(novoCupom)
            : hook.updateCoupon("cupom-alvo", { code: "PROMO10" });
        await expect(gravacao).rejects.toBe(error);
      });
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(
        "Já existe um cupom com este código.",
      );
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["criar", "Erro ao criar cupom"],
    ["editar", "Erro ao atualizar cupom"],
  ] as const)(
    "%s mantém a mensagem padrão para outro erro",
    async (operacao, mensagem) => {
      const error = { code: "PGRST000", message: "rede indisponível" };
      banco.resposta = { data: null, error };
      await act(async () => {
        const gravacao =
          operacao === "criar"
            ? hook.addCoupon(novoCupom)
            : hook.updateCoupon("cupom-alvo", { code: "PROMO10" });
        await expect(gravacao).rejects.toBe(error);
      });
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(mensagem);
      expect(toast.success).not.toHaveBeenCalled();
    },
  );
});

describe("mensagem de erro do cupom", () => {
  it.each([
    { code: "23505", message: "duplicate key value" },
    { message: 'duplicate key violates constraint "coupons_code_key"' },
  ])("reconhece duplicidade por código ou constraint: %j", (error) => {
    expect(mensagemDeErroDoCupom(error, "Mensagem padrão")).toBe(
      "Já existe um cupom com este código.",
    );
  });

  it.each([
    null,
    undefined,
    { code: "PGRST000" },
    { message: "outra constraint" },
  ])("mantém o padrão sem prova de duplicidade: %j", (error) => {
    expect(mensagemDeErroDoCupom(error, "Mensagem padrão")).toBe(
      "Mensagem padrão",
    );
  });
});
