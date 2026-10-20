// @vitest-environment jsdom
import { useCoupons } from "@/hooks/useCoupons";
import { cachedCouponsData, setCachedCouponsData } from "@/utils/admin_cache";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consultar = vi.fn();
const gravar = vi.fn();
const avisarErro = vi.fn();

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => consultar() }),
      update: () => ({ eq: (_coluna: string, id: string) => gravar(id) }),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: (...args: unknown[]) => avisarErro(...args),
  },
}));

function pendente<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (motivo: unknown) => void;
  const promessa = new Promise<T>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

function linhas(ativoA: boolean, ativoB: boolean) {
  return [
    { id: "a", code: "CUPOMA", active: ativoA },
    { id: "b", code: "CUPOMB", active: ativoB },
  ].map((cupom) => ({
    ...cupom,
    type: "percentage",
    value: 10,
    min_purchase: null,
    usage_limit: null,
    usage_count: 0,
    valid_until: null,
    alcance: "codigo",
  }));
}

type RespostaDaGravacao = { error: { code: string } | null };
type RespostaDaConsulta = RespostaDaGravacao & {
  data: ReturnType<typeof linhas> | null;
};

describe("cupons com respostas fora de ordem", () => {
  let raiz: Root;
  let tela: HTMLDivElement;
  let estado: ReturnType<typeof useCoupons>;

  function Sonda() {
    const atual = useCoupons(true);
    useEffect(() => {
      estado = atual;
    }, [atual]);
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    consultar
      .mockReset()
      .mockResolvedValue({ data: linhas(true, true), error: null });
    gravar.mockReset().mockResolvedValue({ error: null });
    avisarErro.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setCachedCouponsData(null);
    tela = document.createElement("div");
    document.body.appendChild(tela);
    raiz = createRoot(tela);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    tela.remove();
    setCachedCouponsData(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function montar() {
    await act(async () => raiz.render(<Sonda />));
    expect(estado.coupons.map((c) => c.active)).toEqual([true, true]);
    expect(estado.loading).toBe(false);
  }

  it("falha restaura o valor anterior do cupom alterado", async () => {
    await montar();
    const gravacao = pendente<RespostaDaGravacao>();
    gravar.mockReturnValueOnce(gravacao.promessa);
    let resultado!: Promise<unknown>;
    await act(async () => {
      resultado = estado
        .updateCoupon("a", { active: false })
        .catch((erro: unknown) => erro);
    });
    expect(estado.coupons.map((c) => c.active)).toEqual([false, true]);
    await act(async () => {
      gravacao.resolver({ error: { code: "42501" } });
      await resultado;
    });
    expect(estado.coupons.map((c) => c.active)).toEqual([true, true]);
  });

  it("falha em A restaura apenas A após B ser salvo e recarregado", async () => {
    await montar();
    const gravacaoA = pendente<RespostaDaGravacao>();
    const gravacaoB = pendente<RespostaDaGravacao>();
    gravar.mockImplementation((id: string) =>
      id === "a" ? gravacaoA.promessa : gravacaoB.promessa,
    );
    let resultadoA!: Promise<unknown>;
    let resultadoB!: Promise<void>;
    await act(async () => {
      resultadoA = estado
        .updateCoupon("a", { active: false })
        .catch((erro: unknown) => erro);
    });
    await act(async () => {
      resultadoB = estado.updateCoupon("b", { active: false });
    });
    expect(estado.coupons.map((c) => c.active)).toEqual([false, false]);

    consultar.mockResolvedValueOnce({ data: linhas(true, false), error: null });
    await act(async () => {
      gravacaoB.resolver({ error: null });
      await resultadoB;
    });
    expect(estado.coupons.map((c) => c.active)).toEqual([true, false]);

    const erro = { code: "42501" };
    await act(async () => {
      gravacaoA.resolver({ error: erro });
      expect(await resultadoA).toBe(erro);
    });
    expect(estado.coupons.map((c) => c.active)).toEqual([true, false]);
  });

  it("recarga antiga de A não desfaz B salvo na recarga mais recente", async () => {
    await montar();
    const antiga = pendente<RespostaDaConsulta>();
    const recente = pendente<RespostaDaConsulta>();
    consultar
      .mockReturnValueOnce(antiga.promessa)
      .mockReturnValueOnce(recente.promessa);

    await act(async () => {
      await estado.updateCoupon("a", { active: false });
    });
    await act(async () => {
      await estado.updateCoupon("b", { active: false });
    });
    expect(estado.loading).toBe(true);

    await act(async () =>
      recente.resolver({ data: linhas(false, false), error: null }),
    );
    expect(estado.coupons.map((c) => c.active)).toEqual([false, false]);
    expect(estado.loading).toBe(false);

    await act(async () =>
      antiga.resolver({ data: linhas(false, true), error: null }),
    );
    expect(estado.coupons.map((c) => c.active)).toEqual([false, false]);
    expect(cachedCouponsData?.map((c) => c.active)).toEqual([false, false]);
    expect(estado.loading).toBe(false);
  });

  it("resposta descartada mantém loading até a consulta mais recente terminar", async () => {
    await montar();
    const antiga = pendente<RespostaDaConsulta>();
    const recente = pendente<RespostaDaConsulta>();
    consultar
      .mockReturnValueOnce(antiga.promessa)
      .mockReturnValueOnce(recente.promessa);
    let primeira!: Promise<void>;
    let segunda!: Promise<void>;
    await act(async () => {
      primeira = estado.refreshCoupons();
      segunda = estado.refreshCoupons();
    });
    await act(async () => {
      antiga.resolver({ data: linhas(false, true), error: null });
      await primeira;
    });
    expect(estado.loading).toBe(true);
    expect(estado.coupons.map((c) => c.active)).toEqual([true, true]);
    expect(cachedCouponsData?.map((c) => c.active)).toEqual([true, true]);

    await act(async () => {
      recente.resolver({ data: linhas(false, false), error: null });
      await segunda;
    });
    expect(estado.loading).toBe(false);
    expect(estado.coupons.map((c) => c.active)).toEqual([false, false]);
  });

  it.each(["PGRST116", "42501", "rede"])(
    "falha antiga (%s) não altera a lista nem avisa após uma consulta nova",
    async (falha) => {
      await montar();
      const antiga = pendente<RespostaDaConsulta>();
      consultar.mockReturnValueOnce(antiga.promessa);
      let primeira!: Promise<void>;
      await act(async () => {
        primeira = estado.refreshCoupons();
      });
      consultar.mockResolvedValueOnce({
        data: linhas(false, false),
        error: null,
      });
      await act(async () => {
        await estado.refreshCoupons();
      });
      await act(async () => {
        if (falha === "rede") antiga.rejeitar(new Error("rede"));
        else antiga.resolver({ data: null, error: { code: falha } });
        await primeira;
      });
      expect(estado.coupons.map((c) => c.active)).toEqual([false, false]);
      expect(cachedCouponsData?.map((c) => c.active)).toEqual([false, false]);
      expect(estado.loading).toBe(false);
      expect(avisarErro).not.toHaveBeenCalled();
    },
  );
});
