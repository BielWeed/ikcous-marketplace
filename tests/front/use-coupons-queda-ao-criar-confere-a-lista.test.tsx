// @vitest-environment jsdom
//
// Caça 28/11 (M3): criar cupom com a conexão CAINDO antes da resposta (iPhone
// trocando de app) dizia só "Erro ao criar cupom". O banco pode ter criado: a
// lojista trocava o código, salvava de novo e ficavam DOIS cupons ativos.
// Agora a queda relê a lista e diz o que achou: o cupom com aquele código
// apareceu (foi criado), ou não deu para confirmar (veja a lista antes).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;

const banco = vi.hoisted(() => ({
  linhas: [] as Linha[],
  insercao: { data: null, error: null } as {
    data: unknown;
    error: unknown;
  },
  /** O que o INSERT grava antes de a resposta se perder (ou nada). */
  gravarAntesDeCair: null as Linha | null,
  leituraFalha: false,
  leituras: 0,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => {
            if (banco.gravarAntesDeCair) {
              banco.linhas = [banco.gravarAntesDeCair, ...banco.linhas];
            }
            return banco.insercao;
          },
        }),
      }),
      select: () => ({
        order: async () => {
          banco.leituras++;
          return banco.leituraFalha
            ? {
                data: null,
                error: { message: "TypeError: Failed to fetch", code: "" },
              }
            : { data: banco.linhas, error: null };
        },
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
type Hook = ReturnType<typeof import("@/hooks/useCoupons")["useCoupons"]>;

const QUEDA = { message: "TypeError: Load failed", code: "" };
const novoCupom = {
  code: "VERAO15",
  type: "percentage" as const,
  value: 15,
} as Parameters<Hook["addCoupon"]>[0];

function linha(code: string, id: string): Linha {
  return {
    id,
    code,
    type: "percentage",
    value: 15,
    usage_count: 0,
    active: true,
  };
}

const FRASE_SEM_CONFIRMAR =
  "A conexão caiu e não deu para confirmar se o cupom foi criado. Veja se ele já aparece na lista antes de salvar de novo.";

describe("criar cupom: a conexão cai antes da resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook: Hook;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    banco.linhas = [linha("ANTIGO10", "c-antigo")];
    banco.insercao = { data: null, error: QUEDA };
    banco.gravarAntesDeCair = null;
    banco.leituraFalha = false;
    banco.leituras = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { useCoupons } = await import("@/hooks/useCoupons");
    const { setCachedCouponsData } = await import("@/utils/admin_cache");
    setCachedCouponsData(null as never);
    function Sonda() {
      const valor = useCoupons(true);
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

  async function criar() {
    await act(async () => {
      await expect(hook.addCoupon(novoCupom)).rejects.toBe(QUEDA);
    });
  }

  it("o banco criou: relê a lista e diz que o cupom foi criado (não salve de novo)", async () => {
    banco.gravarAntesDeCair = linha("VERAO15", "c-novo");
    const leiturasAntes = banco.leituras;

    await criar();

    expect(banco.leituras).toBeGreaterThan(leiturasAntes);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    const [frase] = vi.mocked(toast.info).mock.calls[0] as [string];
    expect(frase).toContain("VERAO15");
    expect(frase).toContain("foi criado");
    expect(frase).toContain("Não salve de novo");
    expect(hook.coupons.some((c) => c.code === "VERAO15")).toBe(true);
  });

  it("exclusivo criado na queda: avisa que a lista de clientes não foi salva", async () => {
    banco.gravarAntesDeCair = linha("VERAO15", "c-novo");

    await act(async () => {
      await expect(
        hook.addCoupon({ ...novoCupom, alcance: "exclusivo" }),
      ).rejects.toBe(QUEDA);
    });

    const [frase] = vi.mocked(toast.info).mock.calls[0] as [string];
    expect(frase).toContain("foi criado");
    expect(frase).toContain("lista de clientes");
  });

  it("o banco não criou: diz que não deu para confirmar e manda ver a lista", async () => {
    await criar();

    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(FRASE_SEM_CONFIRMAR, {
      duration: 15_000,
    });
  });

  it("a releitura também falha: não afirma nada, manda ver a lista", async () => {
    banco.gravarAntesDeCair = linha("VERAO15", "c-novo");
    banco.leituraFalha = true;

    await criar();

    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(FRASE_SEM_CONFIRMAR, {
      duration: 15_000,
    });
  });

  it("o código já existia na lista antes: não conclui que ESTA gravação criou", async () => {
    banco.linhas = [linha("verao15", "c-de-antes"), ...banco.linhas];
    await act(async () => {
      await hook.refreshCoupons(true, false);
    });

    await criar();

    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(FRASE_SEM_CONFIRMAR, {
      duration: 15_000,
    });
  });

  it("controle: recusa com código (23505) segue a frase do código repetido, sem releitura extra", async () => {
    banco.insercao = {
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    };
    const leiturasAntes = banco.leituras;

    await act(async () => {
      await expect(hook.addCoupon(novoCupom)).rejects.toMatchObject({
        code: "23505",
      });
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Já existe um cupom com esse código.",
    );
    expect(banco.leituras).toBe(leiturasAntes);
  });
});
