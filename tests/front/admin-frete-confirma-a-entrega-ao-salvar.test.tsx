// @vitest-environment jsdom
//
// Loja pronta (27/11/2026, migration 20261652000000): a loja nova traz de
// fábrica a entrega na cidade (R$ 10, 1 dia), e o passo "entrega" do Início
// pede confirmação. Salvar a tela de Frete também confirma — no MESMO pedido —
// mas só quando falta (coluna presente e vazia: `entregaConfirmada === false`).
// Banco atrasado (sem a coluna: campo ausente) nunca recebe a chave: a RPC
// velha a descartaria e o "gravou mesmo?" acusaria falha no Salvar inteiro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig =
  vi.fn<
    (updates: Record<string, unknown>, opcoes?: unknown) => Promise<boolean>
  >();
const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}));

const { estadoDaLoja } = vi.hoisted(() => ({
  estadoDaLoja: { atual: {} as Record<string, unknown> },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const consulta = (): any =>
          Object.assign(Promise.resolve({ data: [], error: null }), {
            not: () => consulta(),
            neq: () => consulta(),
          });
        return consulta();
      },
    }),
    functions: { invoke: vi.fn<() => Promise<unknown>>() },
  },
}));

vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function configBase(): Record<string, unknown> {
  return {
    localDeliveryFee: 10,
    localDeliveryDays: 1,
    freeShippingMin: 150,
    enabledShippingMethods: ["sedex", "pac"],
    nationalShippingStrategy: "acima_de_valor",
    nationalShippingMin: 100,
    nationalDiscountType: null,
    nationalDiscountValue: 0,
    nationalBenefitScope: "mais_barata",
  };
}

describe("AdminShippingView: salvar o Frete confirma a entrega da Loja pronta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateConfig.mockResolvedValue(true);
    estadoDaLoja.atual = configBase();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrir() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(
        <AdminShippingView
          active={true}
          onSetDirty={vi.fn<(sujo: boolean) => void>()}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function digitar(id: string, texto: string) {
    const campo = hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
    expect(campo).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function salvar() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Salvar",
    ) as HTMLButtonElement;
    expect(botao).toBeTruthy();
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
  }

  it("loja nova (falta confirmar): o Salvar leva a confirmação junto, num pedido só", async () => {
    estadoDaLoja.atual = { ...configBase(), entregaConfirmada: false };
    await abrir();
    await digitar("frete-nacional-minimo", "200,00");
    await salvar();
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0]?.[0]).toEqual({
      nationalShippingMin: 200,
      entregaConfirmada: true,
    });
  });

  it.each([
    ["já confirmada", { entregaConfirmada: true }],
    ["banco sem a coluna (campo ausente)", {}],
  ])("%s: o Salvar grava só o que mudou", async (_nome, extra) => {
    estadoDaLoja.atual = { ...configBase(), ...extra };
    await abrir();
    await digitar("frete-nacional-minimo", "200,00");
    await salvar();
    expect(updateConfig).toHaveBeenCalledTimes(1);
    expect(updateConfig.mock.calls[0]?.[0]).toEqual({
      nationalShippingMin: 200,
    });
  });

  it("Salvar recusado (valor inválido) não confirma nada", async () => {
    estadoDaLoja.atual = { ...configBase(), entregaConfirmada: false };
    await abrir();
    await digitar("frete-nacional-minimo", "79,996");
    await salvar();
    expect(updateConfig).not.toHaveBeenCalled();
  });
});
