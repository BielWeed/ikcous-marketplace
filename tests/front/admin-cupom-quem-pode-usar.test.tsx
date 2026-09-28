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

  it("o fetch dos cupons chegando no meio da carga não perde a lista gravada", async () => {
    // Revisão, B2: um array novo de `coupons` cancelava a carga e a tela
    // ficava em "Carregando a lista…"; salvar trocava a lista real.
    const cupom = {
      id: "cupom-2",
      code: "VIPBIA",
      type: "fixed",
      value: 10,
      active: true,
      usageCount: 0,
      alcance: "exclusivo",
    };
    estadoCoupons = { coupons: [cupom], loading: false };
    let resolver: (v: unknown) => void = () => {};
    lerClientesDoCupom.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    buscarClientesParaCupom.mockResolvedValue([
      { id: "u-caio", full_name: "Caio Novo", email: null },
    ]);
    updateCoupon.mockResolvedValue(undefined);
    definirClientesDoCupom.mockResolvedValue(undefined);
    await montar("cupom-2");

    // Salvar enquanto a lista carrega é recusado.
    await clicar(botao("Salvar Cupom"));
    expect(updateCoupon).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Aguarde: a lista de clientes deste cupom ainda está carregando.",
    );

    estadoCoupons = { coupons: [{ ...cupom }], loading: false };
    await act(async () => {
      root?.render(
        <AdminCouponFormView
          couponId="cupom-2"
          onNavigate={onNavigate}
          onSetDirty={() => {}}
        />,
      );
    });
    await act(async () => {
      resolver([
        { id: "u-bia", nome: "Bia Prova", email: null },
        { id: "u-duda", nome: "Duda", email: null },
      ]);
    });
    await act(async () => {});
    expect(container?.textContent).toContain("Na lista (2)");

    await digitar("#coupon-clientes-busca", "ca", 400);
    await clicar(botao("Caio Novo"));
    await clicar(botao("Salvar Cupom"));
    expect(definirClientesDoCupom).toHaveBeenCalledWith("cupom-2", [
      "u-bia",
      "u-caio",
      "u-duda",
    ]);
  });

  it("lista que não carregou trava a edição e o salvar, e oferece carregar de novo", async () => {
    estadoCoupons = {
      coupons: [
        {
          id: "cupom-3",
          code: "VIPX",
          type: "fixed",
          value: 10,
          active: true,
          usageCount: 0,
          alcance: "exclusivo",
        },
      ],
      loading: false,
    };
    lerClientesDoCupom.mockRejectedValueOnce(new Error("rede"));
    await montar("cupom-3");
    expect(container?.textContent).toContain("não carregou");
    const busca = container?.querySelector(
      "#coupon-clientes-busca",
    ) as HTMLInputElement;
    expect(busca.disabled).toBe(true);
    await clicar(botao("Salvar Cupom"));
    expect(updateCoupon).not.toHaveBeenCalled();
    expect(definirClientesDoCupom).not.toHaveBeenCalled();

    lerClientesDoCupom.mockResolvedValueOnce([
      { id: "u-x", nome: "Xis", email: null },
    ]);
    await clicar(botao("Carregar de novo"));
    await act(async () => {});
    expect(container?.textContent).toContain("Na lista (1)");
  });

  it("salvar que falha depois do otimista não deixa a lista travada", async () => {
    // Revisão, 2ª rodada (R2-b): o update otimista virava o alcance para
    // exclusivo, a falha revertia, e a tela ficava em "Carregando a lista…"
    // com o salvar recusado para sempre.
    const cupom = {
      id: "cupom-1",
      code: "NATAL",
      type: "percentage",
      value: 25,
      minPurchase: 0,
      usageLimit: 0,
      active: true,
      usageCount: 0,
      alcance: "codigo",
    };
    estadoCoupons = { coupons: [cupom], loading: false };
    lerClientesDoCupom.mockReturnValue(new Promise(() => {}));
    buscarClientesParaCupom.mockResolvedValue([
      { id: "u-ana", full_name: "Ana Prova", email: null },
    ]);
    const redesenhar = async () => {
      await act(async () => {
        root?.render(
          <AdminCouponFormView
            couponId="cupom-1"
            onNavigate={onNavigate}
            onSetDirty={() => {}}
          />,
        );
      });
    };
    updateCoupon.mockImplementation(
      async (_id: string, mudancas: Record<string, unknown>) => {
        // Como o useCoupons real: otimista antes do await, reverte na falha.
        estadoCoupons = {
          coupons: [{ ...cupom, ...mudancas }],
          loading: false,
        };
        await redesenhar();
        estadoCoupons = { coupons: [cupom], loading: false };
        await redesenhar();
        throw new Error("duplicate key");
      },
    );
    await montar("cupom-1");
    await clicar(botao("Clientes escolhidos"));
    await digitar("#coupon-clientes-busca", "an", 400);
    await clicar(botao("Ana Prova"));
    await clicar(botao("Salvar Cupom"));
    await act(async () => {});

    const busca = container?.querySelector(
      "#coupon-clientes-busca",
    ) as HTMLInputElement;
    expect(busca.disabled).toBe(false);
    expect(container?.textContent).not.toContain("Carregando a lista…");

    toastError.mockClear();
    updateCoupon.mockReset();
    updateCoupon.mockResolvedValue(undefined);
    definirClientesDoCupom.mockResolvedValue(undefined);
    await clicar(botao("Salvar Cupom"));
    expect(updateCoupon).toHaveBeenCalledTimes(1);
  });

  it("vitrine sem limite nem validade mostra o aviso", async () => {
    await montar();
    await clicar(botao("Todos os clientes"));
    expect(container?.textContent).toContain("sem limite de uso nem validade");
  });
});
