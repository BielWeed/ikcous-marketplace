// @vitest-environment jsdom
import { useCoupons } from "@/hooks/useCoupons";
import { setCachedCouponsData } from "@/utils/admin_cache";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { AdminCouponsView } from "@/views/admin/AdminCouponsView";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sucesso = vi.fn();
const erro = vi.fn();
const navegar = vi.fn();
const ler = vi.fn();
const inserir = vi.fn();
const atualizar = vi.fn();
const apagar = vi.fn();
const clientes = vi.fn();
const updateConfig = vi.fn();
const refresh = vi.fn();
let banco: Record<string, unknown>;
let hook: ReturnType<typeof useCoupons>;

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableCoupons: true, formasPagamentoEntrega: ["cash"] },
    isLoaded: true,
    updateConfig,
    refresh,
  }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => sucesso(...args),
    error: (...args: unknown[]) => erro(...args),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ler(),
        limit: async () => ({ error: null }),
      }),
      insert: () => ({ select: () => ({ single: () => inserir() }) }),
      update: () => ({ eq: () => ({ select: () => atualizar() }) }),
      delete: () => ({ eq: () => ({ select: () => apagar() }) }),
    }),
    rpc: (nome: string) =>
      nome === "get_admin_customers_paged"
        ? Promise.resolve({
            data: {
              data: [{ id: "u1", full_name: "Ana", email: null }],
              total_count: 1,
            },
            error: null,
          })
        : clientes(),
  },
}));

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

function Sonda() {
  const estado = useCoupons(true);
  useEffect(() => {
    hook = estado;
  });
  return null;
}

let raiz: Root;
let tela: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  class Observador {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", Observador);
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  banco = {
    id: "c1",
    code: "VIP",
    type: "percentage",
    value: 10,
    active: true,
    usage_count: 0,
    alcance: "codigo",
  };
  setCachedCouponsData(null);
  ler
    .mockReset()
    .mockImplementation(async () => ({ data: [{ ...banco }], error: null }));
  inserir.mockReset().mockResolvedValue({ data: { id: "c1" }, error: null });
  atualizar
    .mockReset()
    .mockResolvedValue({ data: [{ id: "c1" }], error: null });
  apagar.mockReset().mockResolvedValue({ data: [{ id: "c1" }], error: null });
  clientes.mockReset().mockResolvedValue({ data: [], error: null });
  updateConfig.mockReset().mockResolvedValue(true);
  refresh.mockReset().mockResolvedValue(undefined);
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});

afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  setCachedCouponsData(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function montar(modo: "sonda" | "lista" | "novo" | "editar") {
  if (modo === "lista")
    setCachedCouponsData([
      {
        id: "c1",
        code: "VIP",
        type: "percentage",
        value: 10,
        active: true,
        usageCount: 0,
      },
    ]);
  await act(async () => {
    raiz.render(
      modo === "sonda" ? (
        <Sonda />
      ) : modo === "lista" ? (
        <AdminCouponsView onNavigate={navegar} />
      ) : (
        <AdminCouponFormView
          couponId={modo === "editar" ? "c1" : undefined}
          onNavigate={navegar}
        />
      ),
    );
  });
  await passar(500);
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function botao(texto: string) {
  const b = [...document.body.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === texto,
  );
  if (!b) throw new Error(`Botão não encontrado: ${texto}`);
  return b;
}

async function digitar(seletor: string, valor: string) {
  act(() => {
    const campo = tela.querySelector(seletor);
    if (!campo) throw new Error(seletor);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await passar(400);
}

describe("cupons do painel: espera limitada e confirmação real", () => {
  it("interruptor não antecipa o desconto, barra dois toques no mesmo lote e confirma uma vez", async () => {
    const voo = pendente<{ data: { id: string }[]; error: null }>();
    atualizar.mockReturnValue(voo.promessa);
    await montar("lista");
    const chave = tela.querySelector(
      '[aria-label="Ativação manual de VIP"]',
    ) as HTMLButtonElement;
    await act(async () => {
      chave.click();
      chave.click();
    });
    expect(atualizar).toHaveBeenCalledTimes(1);
    expect(chave.getAttribute("aria-checked")).toBe("true");
    expect(chave.disabled).toBe(true);
    expect(sucesso).not.toHaveBeenCalled();
    banco.active = false;
    await act(async () => {
      voo.resolver({ data: [{ id: "c1" }], error: null });
    });
    expect(chave.getAttribute("aria-checked")).toBe("false");
    expect(chave.disabled).toBe(false);
    expect(sucesso).toHaveBeenCalledTimes(1);
  });

  it("estado do cupom só muda depois da resposta confirmada", async () => {
    atualizar.mockReturnValue(new Promise(() => {}));
    await montar("sonda");
    await act(async () => {
      void hook.updateCoupon("c1", { active: false });
    });
    expect(hook.coupons[0].active).toBe(true);
  });

  it.each(["criar", "editar", "apagar"] as const)(
    "%s pendurado libera a chamada, relê e ignora confirmação tardia",
    async (operacao) => {
      const voo = pendente<{ data: { id: string }[]; error: null }>();
      const gravar =
        operacao === "criar"
          ? inserir
          : operacao === "editar"
            ? atualizar
            : apagar;
      gravar.mockReturnValue(voo.promessa);
      await montar("sonda");
      let terminou = false;
      let falha: unknown;
      await act(async () => {
        const pedido =
          operacao === "criar"
            ? hook.addCoupon({
                code: "NOVO",
                type: "percentage",
                value: 10,
                active: true,
              })
            : operacao === "editar"
              ? hook.updateCoupon("c1", { active: false })
              : hook.deleteCoupon("c1");
        void pedido
          .catch((e) => {
            falha = e;
          })
          .finally(() => {
            terminou = true;
          });
      });
      banco.active = false; // A gravação pode ter chegado, embora sua resposta não.
      await passar(15_000);
      expect(terminou).toBe(true);
      expect(falha).toBeTruthy();
      expect(erro).toHaveBeenCalledTimes(1);
      expect(erro.mock.calls[0][0]).toMatch(/Sem resposta da rede.*Confira/);
      expect(ler).toHaveBeenCalledTimes(2);
      expect(hook.coupons[0].active).toBe(false);
      await act(async () => {
        voo.resolver({ data: [{ id: "c1" }], error: null });
      });
      expect(sucesso).not.toHaveBeenCalled();
      expect(ler).toHaveBeenCalledTimes(2);
    },
  );

  it("releitura também tem prazo: uma resposta antiga não pinta a lista depois", async () => {
    const voo = pendente<{ data: Record<string, unknown>[]; error: null }>();
    ler.mockReturnValueOnce(voo.promessa);
    await montar("sonda");
    await passar(12_000);
    expect(hook.loading).toBe(false);
    expect(hook.erroDaListagem).toBeTruthy();
    await act(async () => {
      voo.resolver({ data: [banco], error: null });
    });
    expect(hook.coupons).toEqual([]);
    expect(hook.erroDaListagem).toBeTruthy();
  });

  it("releitura pendurada após erro não prende a gravação nem empilha aviso", async () => {
    atualizar.mockReturnValue(new Promise(() => {}));
    await montar("sonda");
    ler.mockReturnValue(new Promise(() => {}));
    let terminou = false;
    await act(async () => {
      void hook
        .updateCoupon("c1", { active: false })
        .catch(() => {})
        .finally(() => {
          terminou = true;
        });
    });
    await passar(15_000);
    expect(terminou).toBe(true);
    await passar(12_000);
    expect(erro).toHaveBeenCalledTimes(1);
    expect(hook.erroDaListagem).toBeTruthy();
  });

  it.each(["novo", "editar"] as const)(
    "formulário %s libera Salvar sem perder o digitado nem navegar após estouro",
    async (modo) => {
      const voo = pendente<{ data: { id: string }; error: null }>();
      (modo === "novo" ? inserir : atualizar).mockReturnValue(voo.promessa);
      await montar(modo);
      await digitar("#coupon-code", "VIPNOVO");
      if (modo === "novo") await digitar("#coupon-value", "10");
      await act(async () => {
        botao("Salvar Cupom").click();
      });
      expect(botao("Salvando...").disabled).toBe(true);
      await passar(15_000);
      expect(botao("Salvar Cupom").disabled).toBe(false);
      expect(
        (tela.querySelector("#coupon-code") as HTMLInputElement).value,
      ).toBe("VIPNOVO");
      expect(erro).toHaveBeenCalledTimes(1);
      expect(navegar).not.toHaveBeenCalled();
      await act(async () => {
        voo.resolver({ data: { id: "c1" }, error: null });
      });
      expect(navegar).not.toHaveBeenCalled();
      expect(sucesso).not.toHaveBeenCalled();
    },
  );

  it("apagar pendurado fecha a confirmação e não comemora depois", async () => {
    const voo = pendente<{ data: { id: string }[]; error: null }>();
    apagar.mockReturnValue(voo.promessa);
    await montar("lista");
    await act(async () => {
      (
        tela.querySelector(
          '[aria-label="Detalhes do cupom VIP"]',
        ) as HTMLButtonElement
      ).click();
    });
    const lixeira = tela.querySelector(
      'button[aria-label="Excluir cupom VIP"]',
    ) as HTMLButtonElement;
    expect(lixeira).toBeTruthy();
    await act(async () => lixeira.click());
    await act(async () => botao("Excluir cupom").click());
    await passar(15_000);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(erro).toHaveBeenCalledTimes(1);
    await act(async () => {
      voo.resolver({ data: [{ id: "c1" }], error: null });
    });
    expect(sucesso).not.toHaveBeenCalled();
  });

  it("chave geral segue travada até o updateConfig voltar: um só aviso, sem prazo próprio da tela", async () => {
    // Duble fiel ao StoreContext: prazo de 20 s dentro do updateConfig, que
    // avisa com toast por conta própria e devolve false (nunca lança).
    updateConfig.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          setTimeout(() => {
            erro("Sem resposta da rede (aviso do updateConfig)");
            resolve(false);
          }, 20_000);
        }),
    );
    await montar("lista");
    const chave = tela.querySelector(
      "#enable-coupons-switch",
    ) as HTMLButtonElement;
    expect(chave).toBeTruthy();
    await act(async () => {
      chave.click();
      chave.click();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(chave.disabled).toBe(true);

    // Aos 15 s a tela não pode soltar a chave nem avisar por conta própria.
    await passar(15_000);
    expect(chave.disabled).toBe(true);
    expect(erro).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      chave.click();
    });
    expect(updateConfig).toHaveBeenCalledTimes(1);

    // Aos 20 s o updateConfig volta (false): chave liberada, um único aviso
    // (o dele) e nenhum "sucesso".
    await passar(5_000);
    expect(chave.disabled).toBe(false);
    expect(erro).toHaveBeenCalledTimes(1);
    expect(erro.mock.calls[0][0]).toContain("aviso do updateConfig");
    expect(sucesso).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("chave geral: updateConfig que grava avisa sucesso uma vez e solta a chave", async () => {
    updateConfig.mockResolvedValue(true);
    await montar("lista");
    const chave = tela.querySelector(
      "#enable-coupons-switch",
    ) as HTMLButtonElement;
    await act(async () => {
      chave.click();
    });
    expect(updateConfig).toHaveBeenCalledWith(
      { enableCoupons: false },
      { silentSuccess: true },
    );
    expect(chave.disabled).toBe(false);
    expect(sucesso).toHaveBeenCalledTimes(1);
    expect(erro).not.toHaveBeenCalled();
  });

  it("lista de clientes de cupom novo sem resposta avisa incerteza e relê, sem afirmar recusa", async () => {
    clientes.mockReturnValue(new Promise(() => {}));
    await montar("novo");
    await digitar("#coupon-code", "EXCLUSIVO");
    await digitar("#coupon-value", "10");
    const escolher = [...tela.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Clientes escolhidos"),
    );
    await act(async () => escolher!.click());
    await digitar("#coupon-clientes-busca", "an");
    const ana = [...tela.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Ana"),
    );
    await act(async () => ana!.click());
    await act(async () => botao("Salvar Cupom").click());
    await passar(15_000);
    expect(botao("Salvar Cupom").disabled).toBe(false);
    expect(erro.mock.calls[0][0]).toMatch(/Sem resposta da rede.*Confira/);
    expect(erro.mock.calls[0][0]).not.toContain("não");
    expect(ler.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("editar clientes pendurado não confirma o cupom, nem após resposta tardia", async () => {
    const voo = pendente<{ error: null }>();
    clientes.mockReturnValue(voo.promessa);
    await montar("sonda");
    let terminou = false;
    await act(async () => {
      void hook
        .updateCoupon("c1", { active: false }, ["u1"])
        .catch(() => {})
        .finally(() => {
          terminou = true;
        });
    });
    await passar(15_000);
    expect(terminou).toBe(true);
    expect(hook.coupons[0].active).toBe(true);
    expect(erro).toHaveBeenCalledTimes(1);
    await act(async () => {
      voo.resolver({ error: null });
    });
    expect(sucesso).not.toHaveBeenCalled();
    expect(hook.coupons[0].active).toBe(true);
  });
});
