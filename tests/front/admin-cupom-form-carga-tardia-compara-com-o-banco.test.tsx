// @vitest-environment jsdom
//
// Cupom: o que a lojista escolheu ANTES de a carga do cupom chegar tem de ser
// comparado com o que o BANCO tinha, não com a mistura que a tela faz ao
// carregar.
//
// A tela, ao carregar, mescla o que a lojista já digitou com o que o banco
// trouxe e guarda a mistura como "estado inicial". Comparar o alcance (e a
// validade, e o aviso de descartar) com essa mistura fazia a escolha dela
// sumir: com a consulta lenta, ela abria um cupom PÚBLICO ("Quem tiver o
// código"), escolhia "Clientes escolhidos" e acrescentava contas; a carga
// chegava; ao salvar, o alcance NÃO ia (a mistura já dizia "exclusivo"), a lista
// de contas era gravada e a tela dizia "Cupom atualizado" — com o cupom seguindo
// público (outra cliente pagaria o desconto).
//
// Formulário real; hook dublê com estado mutável (é o que encena "a carga
// chegou depois"). Molde: form-do-cupom-edita-pelo-id-da-rota.test.tsx.
import type { ClienteDoCupom } from "@/types";
import { dataEscolhidaParaValidade } from "@/utils/validade-do-cupom";
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
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: ["pix", "card", "cash"] },
  }),
}));

const addCoupon = vi.fn();
const updateCoupon = vi.fn();
const listarClientesDoCupom = vi.fn();
const definirClientesDoCupom = vi.fn();
const buscarClientesParaCupom = vi.fn();
const refreshCoupons = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();

let estadoCoupons: { coupons: Record<string, unknown>[]; loading: boolean } = {
  coupons: [],
  loading: true,
};

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    ...estadoCoupons,
    alcanceSuportado: true,
    alcanceSondado: true,
    addCoupon,
    updateCoupon,
    listarClientesDoCupom,
    definirClientesDoCupom,
    buscarClientesParaCupom,
    refreshCoupons,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ana: ClienteDoCupom = { id: "u-ana", nome: "Ana Prova", email: null };

const cupomPublico = {
  id: "cupom-1",
  code: "NATAL",
  type: "percentage",
  value: 20,
  minPurchase: 0,
  usageLimit: 0,
  validUntil: undefined,
  active: true,
  alcance: "codigo",
  usageCount: 0,
};

let container: HTMLElement | null = null;
let root: Root | null = null;

function renderizar(couponId?: string) {
  return act(async () => {
    root?.render(
      <AdminCouponFormView
        couponId={couponId}
        onNavigate={onNavigate}
        // Função nova a cada render, de propósito: a tela é `memo` e, com as
        // mesmas props, ignoraria o "a carga chegou" que o teste encena.
        onSetDirty={(sujo) => onSetDirty(sujo)}
      />,
    );
  });
}

async function montar(couponId?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await renderizar(couponId);
  await act(async () => {});
}

/** A consulta lenta responde: o cupom chega depois de a tela já estar em uso. */
async function carregar(cupom: Record<string, unknown>) {
  estadoCoupons = { coupons: [cupom], loading: false };
  await renderizar("cupom-1");
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

const clicar = async (texto: string) => {
  await act(async () => botao(texto).click());
  await act(async () => {});
};

async function digitar(seletor: string, valor: string, espera = 400) {
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
  // Os campos com buffer só repassam ao formulário depois do respiro.
  await act(async () => {
    await new Promise((r) => setTimeout(r, espera));
  });
}

/** Antes da carga: escolhe "Clientes escolhidos" e acrescenta a Ana. */
async function escolherExclusivoComAna() {
  await clicar("Clientes escolhidos");
  await digitar("#coupon-clientes-busca", "an");
  await clicar("Ana Prova");
}

const ultimoAviso = () => onSetDirty.mock.lastCall?.[0];

beforeEach(() => {
  toastError.mockClear();
  addCoupon.mockReset();
  updateCoupon.mockReset().mockResolvedValue(undefined);
  definirClientesDoCupom.mockReset();
  refreshCoupons.mockReset();
  onNavigate.mockClear();
  onSetDirty.mockClear();
  listarClientesDoCupom.mockReset().mockResolvedValue([]);
  buscarClientesParaCupom.mockReset().mockResolvedValue({
    clientes: [{ id: "u-ana", full_name: "Ana Prova", email: null }],
    total: 1,
  });
  estadoCoupons = { coupons: [], loading: true };
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("cupom público aberto com a consulta lenta: 'Clientes escolhidos' antes da carga", () => {
  it("o alcance escolhido vai junto com a lista (o cupom deixa de ser público)", async () => {
    await montar("cupom-1");
    await escolherExclusivoComAna();
    expect(container?.textContent).toContain("Na lista (1)");

    await carregar(cupomPublico);
    await clicar("Salvar Cupom");

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon).toHaveBeenCalledWith(
      "cupom-1",
      { alcance: "exclusivo" },
      ["u-ana"],
    );
    expect(onNavigate).toHaveBeenCalledWith("admin-coupons");
  });

  it("controle: quem não mexe no alcance NÃO manda alcance", async () => {
    await montar("cupom-1");
    await digitar("#coupon-usage-limit", "50");

    await carregar(cupomPublico);
    await clicar("Salvar Cupom");

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    const [, remendo, lista] = updateCoupon.mock.calls[0];
    expect(remendo).toEqual({ usageLimit: 50 });
    expect("alcance" in remendo).toBe(false);
    expect(lista).toBeUndefined();
  });

  it("controle: depois da carga, escolher e voltar ao alcance de antes não manda nada", async () => {
    estadoCoupons = { coupons: [cupomPublico], loading: false };
    await montar("cupom-1");
    await clicar("Clientes escolhidos");
    await clicar("Quem tiver o código");
    await clicar("Salvar Cupom");

    expect(updateCoupon).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("admin-coupons");
  });

  it("controle: depois da carga, escolher 'Clientes escolhidos' manda alcance e lista (caminho de sempre)", async () => {
    estadoCoupons = { coupons: [cupomPublico], loading: false };
    await montar("cupom-1");
    await escolherExclusivoComAna();
    await clicar("Salvar Cupom");

    expect(updateCoupon).toHaveBeenCalledWith(
      "cupom-1",
      { alcance: "exclusivo" },
      ["u-ana"],
    );
  });

  it("controle: cupom NOVO com 'Clientes escolhidos' manda o alcance", async () => {
    addCoupon.mockResolvedValue({ id: "cupom-novo" });
    definirClientesDoCupom.mockResolvedValue(undefined);
    estadoCoupons = { coupons: [], loading: false };
    await montar();
    await digitar("#coupon-code", "VIPANA");
    await digitar("#coupon-value", "15");
    await escolherExclusivoComAna();
    await clicar("Salvar Cupom");

    expect(addCoupon).toHaveBeenCalledTimes(1);
    expect(addCoupon.mock.calls[0][0]).toMatchObject({
      code: "VIPANA",
      alcance: "exclusivo",
    });
    expect(definirClientesDoCupom).toHaveBeenCalledWith("cupom-novo", [
      "u-ana",
    ]);
  });
});

describe("cupom exclusivo aberto com a consulta lenta: 'Todos os clientes' antes da carga", () => {
  const cupomExclusivo = { ...cupomPublico, alcance: "exclusivo" };

  it("o alcance escolhido vai e a lista antiga é esvaziada (a escolha dela não some)", async () => {
    listarClientesDoCupom.mockResolvedValue([ana]);
    await montar("cupom-1");
    await clicar("Todos os clientes");

    await carregar(cupomExclusivo);
    await act(async () => {});
    await clicar("Salvar Cupom");

    expect(updateCoupon).toHaveBeenCalledTimes(1);
    expect(updateCoupon).toHaveBeenCalledWith(
      "cupom-1",
      { alcance: "vitrine" },
      [],
    );
  });
});

describe("o aviso de 'descartar alterações' enxerga o que foi escolhido antes da carga", () => {
  it("escolher o alcance antes da carga deixa a tela suja depois dela", async () => {
    await montar("cupom-1");
    await clicar("Todos os clientes");
    expect(ultimoAviso()).toBe(true);

    await carregar(cupomPublico);

    expect(ultimoAviso()).toBe(true);
  });

  it("controle: sem mexer em nada, a carga não suja a tela", async () => {
    await montar("cupom-1");
    await carregar(cupomPublico);

    expect(ultimoAviso()).toBe(false);
  });

  it("voltar ao valor do banco depois da carga limpa o aviso", async () => {
    await montar("cupom-1");
    await clicar("Todos os clientes");
    await carregar(cupomPublico);
    expect(ultimoAviso()).toBe(true);

    await clicar("Quem tiver o código");

    expect(ultimoAviso()).toBe(false);
  });
});

describe("validade que já passou, escolhida antes da carga, pede confirmação", () => {
  it("pergunta antes de salvar e não grava sem confirmar", async () => {
    await montar("cupom-1");
    await digitar("#coupon-valid-until", "2020-01-02");

    await carregar(cupomPublico);
    await clicar("Salvar Cupom");

    expect(document.body.textContent).toContain("Essa data já passou");
    expect(updateCoupon).not.toHaveBeenCalled();
  });

  it("controle: cupom que JÁ estava vencido e a data intocada não pergunta", async () => {
    const vencido = {
      ...cupomPublico,
      validUntil: dataEscolhidaParaValidade("2020-01-02"),
    };
    await montar("cupom-1");
    await digitar("#coupon-usage-limit", "50");

    await carregar(vencido);
    await clicar("Salvar Cupom");

    expect(document.body.textContent).not.toContain("Essa data já passou");
    expect(updateCoupon).toHaveBeenCalledTimes(1);
  });
});

describe("código antigo com acento não é renomeado em silêncio", () => {
  it("digitar de volta o código que o banco já tem não manda renomeação", async () => {
    const antigo = { ...cupomPublico, code: "VERÃO10" };
    await montar("cupom-1");
    // Antes da carga ela digitou outra coisa; depois, devolveu o código real.
    await digitar("#coupon-code", "X1");

    await carregar(antigo);
    await digitar("#coupon-code", "VERÃO10");
    await clicar("Salvar Cupom");

    expect(updateCoupon).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("admin-coupons");
  });
});
