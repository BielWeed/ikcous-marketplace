// @vitest-environment jsdom
//
// Frente B (28/09/2026): "Quem pode usar" no formulário de cupom do painel.
//   - exclusivo sem ninguém na lista não salva;
//   - exclusivo novo: cria o cupom e DEPOIS grava a lista (falha fechada:
//     se a lista falha, o cupom fica exclusivo de ninguém e a tela avisa);
//   - editar um cupom sem mexer no alcance não manda `alcance` (o painel
//     continua salvando com o banco de antes da migration);
//   - vitrine sem limite nem validade mostra o aviso.
// Molde: form-do-cupom-edita-pelo-id-da-rota.test.tsx.
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
const lerClientesDoCupom = vi.fn();
const definirClientesDoCupom = vi.fn();
const buscarClientesParaCupom = vi.fn();
const onNavigate = vi.fn();

let estadoCoupons: { coupons: Record<string, unknown>[]; loading: boolean } = {
  coupons: [],
  loading: false,
};

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    ...estadoCoupons,
    addCoupon,
    updateCoupon,
    lerClientesDoCupom,
    definirClientesDoCupom,
    buscarClientesParaCupom,
  }),
}));

let container: HTMLElement | null = null;
let root: Root | null = null;

async function montar(couponId?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <AdminCouponFormView
        couponId={couponId}
        onNavigate={onNavigate}
        onSetDirty={() => {}}
      />,
    );
  });
  await act(async () => {});
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...(container?.querySelectorAll("button") ?? [])].find(
    (b) =>
      b.textContent?.trim() === texto ||
      b.textContent?.trim().startsWith(texto) ||
      b.getAttribute("aria-label") === texto,
  );
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado as HTMLButtonElement;
}

async function digitar(seletor: string, valor: string, espera = 350) {
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
  await act(async () => {
    await new Promise((r) => setTimeout(r, espera));
  });
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await act(async () => {});
}

beforeEach(() => {
  toastError.mockClear();
  addCoupon.mockReset();
  updateCoupon.mockReset();
  lerClientesDoCupom.mockReset();
  definirClientesDoCupom.mockReset();
  buscarClientesParaCupom.mockReset();
  onNavigate.mockClear();
  estadoCoupons = { coupons: [], loading: false };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("formulário de cupom — Quem pode usar", () => {
  it("exclusivo sem nenhum cliente não salva", async () => {
    await montar();
    await digitar("#coupon-code", "VIPANA");
    await digitar("#coupon-value", "15");
    await clicar(botao("Clientes escolhidos"));
    await clicar(botao("Salvar Cupom"));
    expect(addCoupon).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Escolha pelo menos um cliente para o cupom exclusivo.",
    );
  });

  it("exclusivo novo: cria o cupom e depois grava a lista escolhida", async () => {
    buscarClientesParaCupom.mockResolvedValue([
      { id: "u-ana", full_name: "Ana Prova", email: "ana@prova.teste" },
    ]);
    addCoupon.mockResolvedValue({ id: "cupom-novo" });
    definirClientesDoCupom.mockResolvedValue(undefined);

    await montar();
    await digitar("#coupon-code", "VIPANA");
    await digitar("#coupon-value", "15");
    await clicar(botao("Clientes escolhidos"));
    await digitar("#coupon-clientes-busca", "an", 400);
    expect(buscarClientesParaCupom).toHaveBeenCalledWith("an");
    await clicar(botao("Ana Prova"));
    expect(container?.textContent).toContain("Na lista (1)");

    await clicar(botao("Salvar Cupom"));
    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0]).toMatchObject({
      code: "VIPANA",
      alcance: "exclusivo",
    });
    expect(definirClientesDoCupom).toHaveBeenCalledWith("cupom-novo", [
      "u-ana",
    ]);
    expect(onNavigate).toHaveBeenCalledWith("admin-coupons");
  });

  it("a lista falha depois de criar: a tela avisa que ninguém consegue usar", async () => {
    buscarClientesParaCupom.mockResolvedValue([
      { id: "u-ana", full_name: "Ana Prova", email: null },
    ]);
    addCoupon.mockResolvedValue({ id: "cupom-novo" });
    definirClientesDoCupom.mockRejectedValue(new Error("rede"));

    await montar();
    await digitar("#coupon-code", "VIPANA");
    await digitar("#coupon-value", "15");
    await clicar(botao("Clientes escolhidos"));
    await digitar("#coupon-clientes-busca", "an", 400);
    await clicar(botao("Ana Prova"));
    await clicar(botao("Salvar Cupom"));

    expect(toastError).toHaveBeenCalledWith(
      "O cupom foi salvo, mas a lista de clientes não.",
      expect.objectContaining({
        description: expect.stringContaining("Ninguém consegue usar"),
      }),
    );
  });

  it("editar sem mexer no alcance não manda a chave `alcance`", async () => {
    estadoCoupons = {
      coupons: [
        {
          id: "cupom-1",
          code: "NATAL",
          type: "percentage",
          value: 25,
          minPurchase: 0,
          usageLimit: 0,
          active: true,
          usageCount: 0,
          alcance: "codigo",
        },
      ],
      loading: false,
    };
    updateCoupon.mockResolvedValue(undefined);
    await montar("cupom-1");
    await clicar(botao("Salvar Cupom"));
    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect("alcance" in updateCoupon.mock.calls[0][1]).toBe(false);
    expect(definirClientesDoCupom).not.toHaveBeenCalled();
  });

  it("editar um exclusivo carrega a lista do servidor", async () => {
    estadoCoupons = {
      coupons: [
        {
          id: "cupom-2",
          code: "VIPBIA",
          type: "fixed",
          value: 10,
          active: true,
          usageCount: 0,
          alcance: "exclusivo",
        },
      ],
      loading: false,
    };
    lerClientesDoCupom.mockResolvedValue([
      { id: "u-bia", nome: "Bia Prova", email: null },
    ]);
    await montar("cupom-2");
    expect(lerClientesDoCupom).toHaveBeenCalledWith("cupom-2");
    expect(container?.textContent).toContain("Na lista (1)");
    expect(container?.textContent).toContain("Bia Prova");
  });

  it("vitrine sem limite nem validade mostra o aviso", async () => {
    await montar();
    await clicar(botao("Todos os clientes"));
    expect(container?.textContent).toContain(
      "sem limite de uso nem validade",
    );
  });
});
