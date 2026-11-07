// @vitest-environment jsdom
//
// Formulário de cupom: quando o Salvar recusa (código vazio, desconto zero ou
// acima de 100%, mínimo, limite de uso, lista de clientes), o aviso era só um
// toast de ~4 s. O foco ficava no "Salvar" e nenhum campo era marcado: com o
// teclado, ou com o aviso já passado, a pessoa não sabia qual dos campos
// estava errado. Agora a recusa também (1) marca o campo (`aria-invalid`),
// (2) escreve o motivo junto dele, ligado por `aria-describedby`, e (3) leva o
// foco ao campo. O toast e os textos continuam os mesmos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
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

let estadoCoupons: { coupons: Record<string, unknown>[]; loading: boolean } = {
  coupons: [],
  loading: false,
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
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)?.set;

describe("AdminCouponFormView: recusa do Salvar marca o campo e leva o foco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoCoupons = { coupons: [], loading: false };
    addCoupon.mockResolvedValue({ id: "novo" });
    listarClientesDoCupom.mockResolvedValue([]);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function abrirTela(couponId?: string) {
    const { AdminCouponFormView } = await import(
      "@/views/admin/AdminCouponFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminCouponFormView couponId={couponId} onNavigate={vi.fn()} />,
      );
    });
    await act(async () => {});
  }

  const campo = (id: string) =>
    hospedeiro.querySelector(`#${id}`) as HTMLInputElement;

  async function digitar(id: string, valor: string) {
    const el = campo(id);
    await act(async () => {
      el.focus();
      setter?.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      // Sair do campo manda o texto para o formulário (o Salvar vem de Tab).
      el.blur();
    });
  }

  const botao = (texto: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(texto),
    ) as HTMLButtonElement;

  async function clicar(texto: string) {
    await act(async () => {
      botao(texto).click();
    });
    await act(async () => {});
  }

  /** O texto de erro que o campo declara em `aria-describedby`. */
  function erroDoCampo(el: HTMLElement): string {
    const ids = (el.getAttribute("aria-describedby") ?? "").split(" ");
    return ids
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n?.getAttribute("role") === "alert")
      .map((n) => n.textContent)
      .join(" ");
  }

  it("código vazio: toast continua, o campo é marcado, tem texto e recebe o foco", async () => {
    await abrirTela();
    await clicar("Salvar Cupom");

    const codigo = campo("coupon-code");
    expect(toastError).toHaveBeenCalledWith("O código do cupom é obrigatório.");
    expect(codigo.getAttribute("aria-invalid")).toBe("true");
    expect(erroDoCampo(codigo)).toBe("O código do cupom é obrigatório.");
    expect(document.activeElement).toBe(codigo);
    // Os outros campos não ganham marca de erro.
    expect(campo("coupon-value").getAttribute("aria-invalid")).toBeNull();
    expect(addCoupon).not.toHaveBeenCalled();
  });

  it("desconto zero: o foco vai ao campo de valor e o código (certo) não é marcado", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await clicar("Salvar Cupom");

    const valor = campo("coupon-value");
    expect(toastError).toHaveBeenCalledWith(
      "O valor do desconto deve ser maior que zero.",
    );
    expect(valor.getAttribute("aria-invalid")).toBe("true");
    expect(erroDoCampo(valor)).toBe(
      "O valor do desconto deve ser maior que zero.",
    );
    expect(document.activeElement).toBe(valor);
    expect(campo("coupon-code").getAttribute("aria-invalid")).toBeNull();
  });

  it("porcentagem acima de 100: foco e marca no valor", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await digitar("coupon-value", "150");
    await clicar("Salvar Cupom");

    const valor = campo("coupon-value");
    expect(erroDoCampo(valor)).toBe(
      "O valor do desconto em porcentagem não pode ser maior que 100%.",
    );
    expect(valor.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(valor);
  });

  it("desconto fixo com 3 casas: foco e marca no valor", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await clicar("R$ Fixo");
    await digitar("coupon-value", "7.505");
    await clicar("Salvar Cupom");

    const valor = campo("coupon-value");
    expect(erroDoCampo(valor)).toBe(
      "O desconto fixo precisa ter no máximo 2 casas depois da vírgula.",
    );
    expect(document.activeElement).toBe(valor);
  });

  it("mínimo de compra negativo: foco e marca no mínimo", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await digitar("coupon-value", "10");
    await digitar("coupon-min-purchase", "-5");
    await clicar("Salvar Cupom");

    const minimo = campo("coupon-min-purchase");
    expect(erroDoCampo(minimo)).toBe(
      "O valor mínimo de compra não pode ser negativo.",
    );
    expect(minimo.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(minimo);
  });

  it("mínimo com 3 casas: foco e marca no mínimo", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await digitar("coupon-value", "10");
    await digitar("coupon-min-purchase", "49.991");
    await clicar("Salvar Cupom");

    expect(erroDoCampo(campo("coupon-min-purchase"))).toBe(
      "O mínimo de compra precisa ter no máximo 2 casas depois da vírgula.",
    );
    expect(document.activeElement).toBe(campo("coupon-min-purchase"));
  });

  it.each([
    ["-1", "O limite de uso não pode ser negativo."],
    ["2.5", "O limite de uso precisa ser um número inteiro"],
    ["3000000000", "O limite de uso pode ir até 2.000.000.000"],
  ])("limite de uso %s: foco e marca no limite", async (texto, frase) => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await digitar("coupon-value", "10");
    await digitar("coupon-usage-limit", texto);
    await clicar("Salvar Cupom");

    const limite = campo("coupon-usage-limit");
    expect(toastError).toHaveBeenCalledWith(frase);
    expect(limite.getAttribute("aria-invalid")).toBe("true");
    expect(erroDoCampo(limite)).toBe(frase);
    expect(document.activeElement).toBe(limite);
  });

  it("com dois campos errados, o foco vai ao primeiro que o Salvar recusa e só ele é marcado", async () => {
    await abrirTela();
    // Valor vazio E limite inválido: o valor vem antes.
    await digitar("coupon-code", "PROMO10");
    await digitar("coupon-usage-limit", "2.5");
    await clicar("Salvar Cupom");

    expect(document.activeElement).toBe(campo("coupon-value"));
    expect(campo("coupon-value").getAttribute("aria-invalid")).toBe("true");
    expect(campo("coupon-usage-limit").getAttribute("aria-invalid")).toBeNull();
  });

  it("editar o campo apaga a marca e o texto; salvar de novo com tudo certo grava", async () => {
    await abrirTela();
    await clicar("Salvar Cupom");
    expect(campo("coupon-code").getAttribute("aria-invalid")).toBe("true");

    await digitar("coupon-code", "PROMO10");
    expect(campo("coupon-code").getAttribute("aria-invalid")).toBeNull();
    expect(campo("coupon-code").getAttribute("aria-describedby")).toBeNull();
    expect(hospedeiro.querySelector("#coupon-code-erro")).toBeNull();

    await digitar("coupon-value", "10");
    await clicar("Salvar Cupom");
    expect(addCoupon).toHaveBeenCalledTimes(1);
  });

  it("sair do campo sem corrigir NÃO apaga o erro (só digitar apaga)", async () => {
    await abrirTela();
    await clicar("Salvar Cupom");
    const codigo = campo("coupon-code");
    expect(document.activeElement).toBe(codigo);

    await act(async () => {
      codigo.blur();
    });
    expect(codigo.getAttribute("aria-invalid")).toBe("true");
    expect(hospedeiro.querySelector("#coupon-code-erro")).toBeTruthy();
  });

  it("um novo Salvar troca o erro de campo: corrigir o código e errar o valor muda a marca", async () => {
    await abrirTela();
    await clicar("Salvar Cupom");
    expect(campo("coupon-code").getAttribute("aria-invalid")).toBe("true");

    await digitar("coupon-code", "PROMO10");
    await clicar("Salvar Cupom");
    expect(campo("coupon-code").getAttribute("aria-invalid")).toBeNull();
    expect(campo("coupon-value").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(campo("coupon-value"));
  });

  it("exclusivo sem cliente: foco na busca de clientes, com o motivo ligado a ela", async () => {
    await abrirTela();
    await digitar("coupon-code", "VIPANA");
    await digitar("coupon-value", "15");
    await clicar("Clientes escolhidos");
    await clicar("Salvar Cupom");

    const busca = campo("coupon-clientes-busca");
    expect(toastError).toHaveBeenCalledWith(
      "Escolha pelo menos um cliente para o cupom exclusivo.",
    );
    expect(document.activeElement).toBe(busca);
    expect(erroDoCampo(busca)).toBe(
      "Escolha pelo menos um cliente para o cupom exclusivo.",
    );
    // O texto de ajuda que a busca já tinha continua ligado a ela.
    expect(busca.getAttribute("aria-describedby")).toContain(
      "coupon-clientes-busca-help",
    );
    expect(addCoupon).not.toHaveBeenCalled();
  });

  it("lista de clientes que não carregou (busca travada): o foco vai à região 'Quem pode usar'", async () => {
    estadoCoupons = {
      coupons: [
        {
          id: "c1",
          code: "VIP",
          type: "percentage",
          value: 10,
          usageCount: 0,
          active: true,
          alcance: "exclusivo",
        },
      ],
      loading: false,
    };
    listarClientesDoCupom.mockRejectedValue(new Error("rede"));
    await abrirTela("c1");
    toastError.mockClear();
    await clicar("Salvar Cupom");

    const regiao = hospedeiro.querySelector(
      "#coupon-quem-pode-usar",
    ) as HTMLElement;
    expect(regiao).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith(
      "A lista de clientes deste cupom não carregou. Tente carregar de novo antes de salvar.",
    );
    expect(document.activeElement).toBe(regiao);
    expect(regiao.getAttribute("aria-describedby")).toBe(
      "coupon-clientes-busca-erro",
    );
    expect(
      document.getElementById("coupon-clientes-busca-erro")?.textContent,
    ).toMatch(/não carregou/);
    expect(updateCoupon).not.toHaveBeenCalled();
  });

  it("validade digitada e não entendida: o foco vai ao campo de validade (que já era marcado)", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await digitar("coupon-value", "10");
    Object.defineProperty(campo("coupon-valid-until"), "validity", {
      configurable: true,
      value: { badInput: true },
    });
    await clicar("Salvar Cupom");

    const validade = campo("coupon-valid-until");
    expect(validade.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(validade);
    expect(addCoupon).not.toHaveBeenCalled();
  });

  it("salvar com tudo certo grava e não deixa marca de erro sobrando", async () => {
    await abrirTela();
    await digitar("coupon-code", "PROMO10");
    await digitar("coupon-value", "10");
    await clicar("Salvar Cupom");
    expect(addCoupon).toHaveBeenCalledTimes(1);
    for (const id of [
      "coupon-code",
      "coupon-value",
      "coupon-min-purchase",
      "coupon-usage-limit",
    ]) {
      expect(campo(id).getAttribute("aria-invalid")).toBeNull();
    }
  });
});
