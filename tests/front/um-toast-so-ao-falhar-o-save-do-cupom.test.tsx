// @vitest-environment jsdom
//
// Laudo 0109 (A12) — ao falhar o salvamento, o lojista levava DOIS toasts
// empilhados: o do hook (que diz o motivo real — "código já existe", por
// exemplo) e o genérico da tela ("Erro ao salvar o cupom. Revise as
// regras...") por cima, escondendo o motivo. O conserto tira o toast da
// tela (o hook continua dono do aviso). Este teste fixa o "UM toast só".
//
// Molde de montagem: tests/front/form-do-cupom-edita-pelo-id-da-rota.test.tsx
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: (...args: unknown[]) => toastError(...args),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

const addCoupon = vi.fn();
const updateCoupon = vi.fn();
const onNavigate = vi.fn();

let estadoCoupons: {
  coupons: Record<string, unknown>[];
  loading: boolean;
} = { coupons: [], loading: false };

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ ...estadoCoupons, addCoupon, updateCoupon }),
}));

let container: HTMLElement | null = null;
let root: Root | null = null;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <AdminCouponFormView onNavigate={onNavigate} onSetDirty={() => {}} />,
    );
  });
  await act(async () => {});
}

function acharBotao(texto: string): HTMLButtonElement | null {
  const botoes = container?.querySelectorAll("button") || [];
  for (const botao of botoes) {
    if (botao.textContent?.trim() === texto) return botao;
  }
  return null;
}

async function digitarCampo(seletor: string, valor: string) {
  const input = container?.querySelector(seletor);
  if (!input) throw new Error(`campo ${seletor} não encontrado`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // O LocalBufferedInput só repassa ao form depois da janela de debounce.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

beforeEach(() => {
  toastError.mockClear();
  addCoupon.mockReset();
  updateCoupon.mockReset();
  onNavigate.mockClear();
  estadoCoupons = { coupons: [], loading: false };
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe("form de cupom — A12: a tela não é mais a dona do toast de erro", () => {
  it("falha do salvamento: o hook avisa; a tela não empilha o genérico", async () => {
    addCoupon.mockRejectedValue(
      Object.assign(new Error("duplicate key value"), { code: "23505" }),
    );
    await montar();
    await digitarCampo("#coupon-code", "NATAL");
    await digitarCampo("#coupon-value", "15");

    await act(async () => {
      acharBotao("Salvar Cupom")?.click();
    });
    await act(async () => {});

    expect(addCoupon).toHaveBeenCalledTimes(1);
    // O ponto do A12: o aviso de falha mora no hook (useCoupons, com o
    // motivo real). O useCoupons aqui é dublê, então ZERO toasts é o
    // comportamento correto da TELA — com o defeito, este número era 1
    // (o genérico "Revise as regras de preenchimento" empilhado por cima
    // do motivo real).
    expect(toastError).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("navegação de sucesso continua igual (nenhum toast de erro)", async () => {
    addCoupon.mockResolvedValue({ id: "novo-1" });
    await montar();
    await digitarCampo("#coupon-code", "NATAL");
    await digitarCampo("#coupon-value", "15");

    await act(async () => {
      acharBotao("Salvar Cupom")?.click();
    });
    await act(async () => {});

    expect(toastError).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("admin-coupons");
  });
});
